import path from 'node:path';
import supertest from 'supertest';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { HEADERS, HEADER_TYPE, HTTP_STATUS } from '@verdaccio/core';
import { setup } from '@verdaccio/logger';
import { generatePackageMetadata, publishVersion } from '@verdaccio/test-helper';

import { initializeServer } from './helper';

beforeAll(async () => {
  await setup({});
});

const mockManifest = vi.hoisted(() => vi.fn());
vi.mock('@verdaccio/ui-theme', () => ({ default: (...args: any[]) => mockManifest()(...args) }));

async function login(api: supertest.Agent): Promise<string> {
  const res = await api
    .post('/-/verdaccio/sec/login')
    .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
    .send(JSON.stringify({ username: 'test', password: 'test' }))
    .expect(HTTP_STATUS.OK);
  return res.body.token;
}

async function publishWithToken(api: supertest.Agent, name: string, token: string) {
  return api
    .put(`/${encodeURIComponent(name)}`)
    .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
    .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
    .send(JSON.stringify(generatePackageMetadata(name, '1.0.0')))
    .expect(HTTP_STATUS.CREATED);
}

function mockTheme() {
  mockManifest.mockReturnValue(() => ({
    staticPath: path.join(import.meta.dirname, 'static'),
    manifestFiles: { js: ['runtime.js', 'vendors.js', 'main.js'] },
    manifest: require('./partials/manifest/manifest.json'),
  }));
}

describe('package visibility api', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockManifest.mockClear();
  });

  test('a publisher can toggle a package private and back', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publishWithToken(api, 'foo', token);

    await api
      .put('/-/verdaccio/data/package/visibility/foo')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .send(JSON.stringify({ visibility: 'private' }))
      .expect(HTTP_STATUS.OK);

    // anonymous listing drops the package
    const list = await api
      .get('/-/verdaccio/data/packages')
      .set('Accept', HEADERS.JSON_CHARSET)
      .expect(HTTP_STATUS.OK);
    expect(list.body.map((p) => p.name)).not.toContain('foo');

    // anonymous sidebar gets 404
    await api.get('/-/verdaccio/data/sidebar/foo').expect(HTTP_STATUS.NOT_FOUND);

    // the publisher still sees it
    const ownList = await api
      .get('/-/verdaccio/data/packages')
      .set('Accept', HEADERS.JSON_CHARSET)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .expect(HTTP_STATUS.OK);
    expect(ownList.body.map((p) => p.name)).toContain('foo');

    await api
      .get('/-/verdaccio/data/sidebar/foo')
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .expect(HTTP_STATUS.OK);

    // back to public
    await api
      .put('/-/verdaccio/data/package/visibility/foo')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .send(JSON.stringify({ visibility: 'public' }))
      .expect(HTTP_STATUS.OK);

    await api.get('/-/verdaccio/data/sidebar/foo').expect(HTTP_STATUS.OK);
  });

  test('rejects invalid visibility values and anonymous changes', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publishWithToken(api, 'foo', token);

    await api
      .put('/-/verdaccio/data/package/visibility/foo')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify({ visibility: 'bogus' }))
      .expect(HTTP_STATUS.BAD_REQUEST);

    // foo publishes are limited to the test user, so an anonymous toggle is
    // forbidden
    await api
      .put('/-/verdaccio/data/package/visibility/foo')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify({ visibility: 'private' }))
      .expect(HTTP_STATUS.FORBIDDEN);
  });

  test('rule visibility hides the package from listings and reads for outsiders', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    await publishVersion(app, 'hidden-pkg', '1.0.0').expect(HTTP_STATUS.CREATED);

    const list = await api
      .get('/-/verdaccio/data/packages')
      .set('Accept', HEADERS.JSON_CHARSET)
      .expect(HTTP_STATUS.OK);
    expect(list.body.map((p) => p.name)).not.toContain('hidden-pkg');

    await api.get('/-/verdaccio/data/sidebar/hidden-pkg').expect(HTTP_STATUS.NOT_FOUND);

    const token = await login(api);
    const ownList = await api
      .get('/-/verdaccio/data/packages')
      .set('Accept', HEADERS.JSON_CHARSET)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .expect(HTTP_STATUS.OK);
    expect(ownList.body.map((p) => p.name)).toContain('hidden-pkg');
  });
});
