import path from 'node:path';
import supertest from 'supertest';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { HEADERS, HEADER_TYPE, HTTP_STATUS } from '@verdaccio/core';
import { setup } from '@verdaccio/logger';
import { generatePackageMetadata } from '@verdaccio/test-helper';

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

async function publishWithToken(
  api: supertest.Agent,
  name: string,
  token: string,
  version = '1.0.0'
) {
  return api
    .put(`/${encodeURIComponent(name)}`)
    .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
    .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
    .send(JSON.stringify(generatePackageMetadata(name, version)))
    .expect(HTTP_STATUS.CREATED);
}

function mockTheme() {
  mockManifest.mockReturnValue(() => ({
    staticPath: path.join(import.meta.dirname, 'static'),
    manifestFiles: { js: ['runtime.js', 'vendors.js', 'main.js'] },
    manifest: require('./partials/manifest/manifest.json'),
  }));
}

describe('rss feeds', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockManifest.mockClear();
  });

  test('the global feed lists published packages as rss items', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publishWithToken(api, 'feed-pkg', token);

    const resp = await api.get('/-/verdaccio/data/feed').expect(HTTP_STATUS.OK);

    expect(resp.headers['content-type']).toContain('application/rss+xml');
    expect(resp.text).toContain('<rss version="2.0"');
    expect(resp.text).toContain('<title>feed-pkg@1.0.0</title>');
    expect(resp.text).toContain('<link>');
  });

  test('the per-package feed lists every published version', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publishWithToken(api, 'feed-versions', token, '1.0.0');
    await publishWithToken(api, 'feed-versions', token, '1.1.0');

    const resp = await api.get('/-/verdaccio/data/feed/feed-versions').expect(HTTP_STATUS.OK);

    expect(resp.text).toContain('<title>feed-versions@1.0.0</title>');
    expect(resp.text).toContain('<title>feed-versions@1.1.0</title>');
    // newest first
    expect(resp.text.indexOf('feed-versions@1.1.0')).toBeLessThan(
      resp.text.indexOf('feed-versions@1.0.0')
    );
  });

  test('a private package is hidden from the anonymous feed', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publishWithToken(api, 'feed-hidden', token);
    await api
      .put('/-/verdaccio/data/package/visibility/feed-hidden')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .send(JSON.stringify({ visibility: 'private' }))
      .expect(HTTP_STATUS.OK);

    const feed = await api.get('/-/verdaccio/data/feed').expect(HTTP_STATUS.OK);
    expect(feed.text).not.toContain('feed-hidden');
    await api.get('/-/verdaccio/data/feed/feed-hidden').expect(HTTP_STATUS.NOT_FOUND);

    // the publisher still sees their own feed
    const ownFeed = await api
      .get('/-/verdaccio/data/feed')
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .expect(HTTP_STATUS.OK);
    expect(ownFeed.text).toContain('feed-hidden');
  });

  test('feed entries escape xml in package metadata', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    const pkg = generatePackageMetadata('feed-xss', '1.0.0');
    pkg.versions['1.0.0'].description = '<script>alert(1)</script>&"quotes"';
    await api
      .put('/feed-xss')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .send(JSON.stringify(pkg))
      .expect(HTTP_STATUS.CREATED);

    const feed = await api.get('/-/verdaccio/data/feed/feed-xss').expect(HTTP_STATUS.OK);
    expect(feed.text).not.toContain('<script>');
    expect(feed.text).toContain('&lt;script&gt;');
  });
});
