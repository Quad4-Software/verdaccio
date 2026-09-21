import { unlinkSync } from 'node:fs';
import os from 'node:os';
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

function mockTheme() {
  mockManifest.mockReturnValue(() => ({
    staticPath: path.join(import.meta.dirname, 'static'),
    manifestFiles: { js: ['runtime.js', 'vendors.js', 'main.js'] },
    manifest: require('./partials/manifest/manifest.json'),
  }));
}

// the htpasswd file lands next to the random storage dir and survives test
// runs; start every run from a clean slate
function cleanHtpasswd() {
  const base = path.join(os.tmpdir(), 'storage', 'htpasswd-admin');
  for (const suffix of ['', '.admins', '.setup']) {
    try {
      unlinkSync(`${base}${suffix}`);
    } catch {
      // file may not exist
    }
  }
}

async function createUser(api: supertest.Agent, name: string, password: string) {
  return api
    .put(`/-/user/org.couchdb.user:${name}`)
    .send({ name, password })
    .expect(HTTP_STATUS.CREATED);
}

async function login(api: supertest.Agent, name: string, password: string): Promise<string> {
  const res = await api
    .post('/-/verdaccio/sec/login')
    .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
    .send(JSON.stringify({ username: name, password }))
    .expect(HTTP_STATUS.OK);
  return res.body.token;
}

function authed(api: supertest.Agent, token: string) {
  return (method: 'get' | 'post' | 'put' | 'delete', url: string) =>
    api[method](url).set(HEADERS.AUTHORIZATION, `Bearer ${token}`);
}

describe('admin api', () => {
  let api: supertest.Agent;
  let admin: ReturnType<typeof authed>;

  beforeAll(async () => {
    cleanHtpasswd();
    mockTheme();
    const app = await initializeServer('admin.yaml');
    api = supertest(app);
    await createUser(api, 'admin', 'admin-pass-1234');
    admin = authed(api, await login(api, 'admin', 'admin-pass-1234'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockManifest.mockClear();
  });

  test('reports status and enforces admin rights', async () => {
    // anonymous is not an admin
    const anonymous = await api.get('/-/verdaccio/data/admin/status').expect(HTTP_STATUS.OK);
    expect(anonymous.body.admin).toBe(false);

    // a regular user is not an admin either
    await createUser(api, 'reader', 'reader-pass-123');
    const readerToken = await login(api, 'reader', 'reader-pass-123');
    const req = authed(api, readerToken);
    const nonAdmin = await req('get', '/-/verdaccio/data/admin/status').expect(HTTP_STATUS.OK);
    expect(nonAdmin.body.admin).toBe(false);
    await req('get', '/-/verdaccio/data/admin/users').expect(HTTP_STATUS.FORBIDDEN);
    await api.get('/-/verdaccio/data/admin/metrics').expect(HTTP_STATUS.FORBIDDEN);

    // the configured admin passes
    const status = await admin('get', '/-/verdaccio/data/admin/status').expect(HTTP_STATUS.OK);
    expect(status.body.admin).toBe(true);
    expect(status.body.userManagement).toBe(true);
  });

  test('manages users end to end', async () => {
    await admin('post', '/-/verdaccio/data/admin/users')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify({ username: 'worker', password: 'worker-pass-1' }))
      .expect(HTTP_STATUS.OK);

    const list = await admin('get', '/-/verdaccio/data/admin/users').expect(HTTP_STATUS.OK);
    const names = list.body.users.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(['admin', 'worker']));
    expect(list.body.users.find((u) => u.name === 'worker').admin).toBe(false);

    // grant admin rights to the worker
    await admin('put', '/-/verdaccio/data/admin/users/worker/admin')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify({ admin: true }))
      .expect(HTTP_STATUS.OK);
    const afterGrant = await admin('get', '/-/verdaccio/data/admin/users').expect(HTTP_STATUS.OK);
    expect(afterGrant.body.users.find((u) => u.name === 'worker').admin).toBe(true);

    // the worker can now reach the admin api
    const worker = authed(api, await login(api, 'worker', 'worker-pass-1'));
    const workerStatus = await worker('get', '/-/verdaccio/data/admin/status').expect(
      HTTP_STATUS.OK
    );
    expect(workerStatus.body.admin).toBe(true);

    // admin password reset
    await admin('put', '/-/verdaccio/data/admin/users/worker/password')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify({ password: 'new-pass-12345' }))
      .expect(HTTP_STATUS.OK);
    await login(api, 'worker', 'new-pass-12345');

    // tfa reset answers even without an enrolment
    await admin('delete', '/-/verdaccio/data/admin/users/worker/tfa').expect(HTTP_STATUS.OK);

    // self delete is refused
    await admin('delete', '/-/verdaccio/data/admin/users/admin').expect(HTTP_STATUS.BAD_REQUEST);

    // revoking and deleting the worker works
    await admin('put', '/-/verdaccio/data/admin/users/worker/admin')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify({ admin: false }))
      .expect(HTTP_STATUS.OK);
    await admin('delete', '/-/verdaccio/data/admin/users/worker').expect(HTTP_STATUS.OK);
    const finalList = await admin('get', '/-/verdaccio/data/admin/users').expect(HTTP_STATUS.OK);
    expect(finalList.body.users.map((u) => u.name)).not.toContain('worker');
  });

  test('lists packages, toggles visibility and reports metrics and audit', async () => {
    await api
      .put('/foo')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, `Bearer ${await login(api, 'admin', 'admin-pass-1234')}`)
      .send(JSON.stringify(generatePackageMetadata('foo', '1.0.0')))
      .expect(HTTP_STATUS.CREATED);

    const packages = await admin('get', '/-/verdaccio/data/admin/packages').expect(HTTP_STATUS.OK);
    expect(packages.body.packages.map((p) => p.name)).toContain('foo');

    await admin('put', '/-/verdaccio/data/admin/packages/visibility/foo')
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .send(JSON.stringify({ visibility: 'private' }))
      .expect(HTTP_STATUS.OK);

    const metrics = await admin('get', '/-/verdaccio/data/admin/metrics').expect(HTTP_STATUS.OK);
    expect(metrics.body.counts.packages).toBeGreaterThanOrEqual(1);
    expect(metrics.body.counts.users).toBeGreaterThanOrEqual(1);
    expect(metrics.body.uptime).toBeGreaterThanOrEqual(0);
    expect(metrics.body.requests.total).toBeGreaterThanOrEqual(0);

    const audit = await admin('get', '/-/verdaccio/data/admin/audit').expect(HTTP_STATUS.OK);
    expect(
      audit.body.audit.some(
        (entry) => entry.action === 'package.visibility' && entry.target === 'foo'
      )
    ).toBe(true);
  });
});
