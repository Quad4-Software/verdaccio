import supertest from 'supertest';
import { beforeAll, describe, expect, test } from 'vitest';

import { HEADERS, HTTP_STATUS } from '@verdaccio/core';

import { initializeServer, publishVersion } from './_helper';

const getPackument = (app: any, name: string) =>
  supertest(app).get(`/${name}`).set(HEADERS.ACCEPT, HEADERS.JSON);

const versionKeys = (packument: any): string[] => Object.keys(packument.versions ?? {}).sort();

describe('metamorphic publish relations', () => {
  let app;

  beforeAll(async () => {
    app = await initializeServer('publish.yaml');
  });

  test('the version set grows monotonically across publishes', async () => {
    await publishVersion(app, 'meta-grow', '1.0.0').expect(HTTP_STATUS.CREATED);
    const afterOne = (await getPackument(app, 'meta-grow').expect(HTTP_STATUS.OK)).body;
    expect(versionKeys(afterOne)).toEqual(['1.0.0']);

    await publishVersion(app, 'meta-grow', '2.0.0').expect(HTTP_STATUS.CREATED);
    const afterTwo = (await getPackument(app, 'meta-grow').expect(HTTP_STATUS.OK)).body;
    // the second publish must not destroy the first version
    expect(versionKeys(afterTwo)).toEqual(['1.0.0', '2.0.0']);
    expect(afterTwo['dist-tags'].latest).toBe('2.0.0');
  });

  test('re-publishing an identical version is refused, the packument is untouched', async () => {
    await publishVersion(app, 'meta-idem', '1.0.0').expect(HTTP_STATUS.CREATED);
    const before = (await getPackument(app, 'meta-idem').expect(HTTP_STATUS.OK)).body;

    await publishVersion(app, 'meta-idem', '1.0.0').expect(HTTP_STATUS.CONFLICT);
    const after = (await getPackument(app, 'meta-idem').expect(HTTP_STATUS.OK)).body;
    expect(versionKeys(after)).toEqual(versionKeys(before));
  });

  test('unpublish then republish restores the same version set', async () => {
    await publishVersion(app, 'meta-cycle', '1.0.0').expect(HTTP_STATUS.CREATED);
    await publishVersion(app, 'meta-cycle', '1.1.0').expect(HTTP_STATUS.CREATED);

    // unpublish the whole packument: DELETE /:package/-rev/:revision
    const packument = (await getPackument(app, 'meta-cycle').expect(HTTP_STATUS.OK)).body;
    await supertest(app)
      .delete(`/meta-cycle/-rev/${packument._rev}`)
      .set(HEADERS.ACCEPT, HEADERS.JSON)
      .expect(HTTP_STATUS.CREATED);

    await getPackument(app, 'meta-cycle').expect(HTTP_STATUS.NOT_FOUND);

    await publishVersion(app, 'meta-cycle', '1.0.0').expect(HTTP_STATUS.CREATED);
    const restored = (await getPackument(app, 'meta-cycle').expect(HTTP_STATUS.OK)).body;
    expect(versionKeys(restored)).toEqual(['1.0.0']);
  });

  test('repeated reads are identical modulo the request-local tarball origin', async () => {
    await publishVersion(app, 'meta-stable', '3.0.0').expect(HTTP_STATUS.CREATED);
    // supertest binds a fresh port per request and the registry embeds the
    // request origin in tarball urls, so compare with the origin stripped
    const stripOrigin = (text: string) =>
      text.replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://localhost');
    const first = (await getPackument(app, 'meta-stable').expect(HTTP_STATUS.OK)).text;
    const second = (await getPackument(app, 'meta-stable').expect(HTTP_STATUS.OK)).text;
    expect(stripOrigin(second)).toBe(stripOrigin(first));
  });

  test('adding then removing a dist-tag round-trips the tag set', async () => {
    await publishVersion(app, 'meta-tags', '1.0.0').expect(HTTP_STATUS.CREATED);
    const before = (await getPackument(app, 'meta-tags').expect(HTTP_STATUS.OK)).body;
    const originalTags = Object.keys(before['dist-tags']).sort();

    await supertest(app)
      .put('/-/package/meta-tags/dist-tags/beta')
      .set(HEADERS.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify('1.0.0'))
      .expect(HTTP_STATUS.CREATED);

    const tagged = (await getPackument(app, 'meta-tags').expect(HTTP_STATUS.OK)).body;
    expect(tagged['dist-tags'].beta).toBe('1.0.0');

    await supertest(app).delete('/-/package/meta-tags/dist-tags/beta').expect(HTTP_STATUS.CREATED);

    const cleaned = (await getPackument(app, 'meta-tags').expect(HTTP_STATUS.OK)).body;
    expect(Object.keys(cleaned['dist-tags']).sort()).toEqual(originalTags);
  });
});
