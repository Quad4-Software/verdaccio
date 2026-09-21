import path from 'node:path';
import supertest from 'supertest';
import { beforeAll, describe, expect, test, vi } from 'vitest';

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

function mockTheme() {
  mockManifest.mockReturnValue(() => ({
    staticPath: path.join(import.meta.dirname, 'static'),
    manifestFiles: { js: ['runtime.js', 'vendors.js', 'main.js'] },
    manifest: require('./partials/manifest/manifest.json'),
  }));
}

async function publish(api: supertest.Agent, name: string, token: string, version = '1.0.0') {
  const pkg = generatePackageMetadata(name, version);
  return api
    .put(`/${encodeURIComponent(name)}`)
    .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
    .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
    .send(JSON.stringify(pkg))
    .expect(HTTP_STATUS.CREATED);
}

describe('seo meta tags', () => {
  test('the home page renders site meta and the rss discovery link', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const res = await supertest(app).get('/-/web/home').expect(HTTP_STATUS.OK);

    expect(res.text).toContain('<meta name="description"');
    expect(res.text).toContain('<meta property="og:title" content="verdaccio">');
    expect(res.text).toContain('<meta name="twitter:card" content="summary">');
    expect(res.text).toContain('rel="alternate" type="application/rss+xml"');
  });

  test('a package detail page renders package meta and json-ld', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publish(api, 'seo-pkg', token);

    const res = await api.get('/-/web/detail/seo-pkg').expect(HTTP_STATUS.OK);

    expect(res.text).toContain('<title>seo-pkg@1.0.0 - verdaccio</title>');
    expect(res.text).toContain('<meta property="og:title" content="seo-pkg@1.0.0 - verdaccio">');
    expect(res.text).toContain('rel="canonical"');
    expect(res.text).toContain('/-/web/detail/seo-pkg');
    expect(res.text).toContain('application/ld+json');
    expect(res.text).toContain('"@type":"SoftwarePackage"');
    expect(res.text).toContain('"name":"seo-pkg"');
  });

  test('a scoped package detail page renders package meta', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publish(api, '@scope/seo-pkg', token);

    const res = await api.get('/-/web/detail/@scope/seo-pkg').expect(HTTP_STATUS.OK);

    expect(res.text).toContain('"name":"@scope/seo-pkg"');
  });

  test('a missing package falls back to generic meta', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');

    const res = await supertest(app).get('/-/web/detail/missing-pkg').expect(HTTP_STATUS.OK);

    expect(res.text).toContain('<meta property="og:title" content="verdaccio">');
    expect(res.text).not.toContain('SoftwarePackage');
  });

  test('a private package does not leak meta to anonymous users', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    await publish(api, 'seo-hidden', token);
    await api
      .put('/-/verdaccio/data/package/visibility/seo-hidden')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .send(JSON.stringify({ visibility: 'private' }))
      .expect(HTTP_STATUS.OK);

    const res = await api.get('/-/web/detail/seo-hidden').expect(HTTP_STATUS.OK);

    expect(res.text).not.toContain('seo-hidden');
    expect(res.text).not.toContain('SoftwarePackage');
  });

  test('package meta escapes html in the description', async () => {
    mockTheme();
    const app = await initializeServer('visibility.yaml');
    const api = supertest(app);
    const token = await login(api);
    const pkg = generatePackageMetadata('seo-xss', '1.0.0');
    pkg.versions['1.0.0'].description = '</title><script>alert(1)</script>';
    await api
      .put('/seo-xss')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, `Bearer ${token}`)
      .send(JSON.stringify(pkg))
      .expect(HTTP_STATUS.CREATED);

    const res = await api.get('/-/web/detail/seo-xss').expect(HTTP_STATUS.OK);

    expect(res.text).not.toContain('</title><script>');
    expect(res.text).toContain('&lt;/title&gt;&lt;script&gt;');
    // the json-ld payload escapes < as unicode so the script element cannot be closed
    expect(res.text).toContain('\\u003c/title>');
  });
});
