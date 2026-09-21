import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import supertest from 'supertest';
import { describe, expect, test } from 'vitest';

import { HEADERS, HEADER_TYPE, HTTP_STATUS, TOKEN_BEARER } from '@verdaccio/core';
import { generatePackageMetadata } from '@verdaccio/test-helper';

import {
  buildToken,
  createUser,
  getPackage,
  initializeServer,
  publishVersionWithToken,
} from './_helper';

// registry only accepts a bundle whose in-toto subject is bound to the stored
// tarball: name must reference the publish and digest must match the bytes
function sigstoreBundle(pkgName: string, version: string, tarballB64: string) {
  const sha512 = createHash('sha512').update(Buffer.from(tarballB64, 'base64')).digest('hex');
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(
        JSON.stringify({
          _type: 'https://in-toto.io/Statement/v1',
          subject: [{ name: `pkg:npm/${pkgName}@${version}`, digest: { sha512 } }],
          predicateType: 'https://slsa.dev/provenance/v1',
        })
      ).toString('base64'),
      signatures: [{ keyid: 'test', sig: 'AAAA' }],
    },
  };
}

// minimal hand-rolled tar holding one package/package.json so the publish
// scanner inspects real tarball contents rather than request metadata
function tarballWithManifest(manifest: Record<string, unknown>): string {
  const content = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(512);
  header.write('package/package.json', 0);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write('        ', 148);
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(body);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc(1024)])).toString('base64');
}

function metadataWithTarball(pkgName: string, version: string, manifest: Record<string, unknown>) {
  const metadata = generatePackageMetadata(pkgName, version) as any;
  const data = tarballWithManifest(manifest);
  const key = `${pkgName.split('/').pop()}-${version}.tgz`;
  metadata._attachments[key].data = data;
  metadata._attachments[key].length = Buffer.from(data, 'base64').length;
  return metadata;
}

async function publishWithProvenance(app, pkgName: string, version: string, token: string) {
  const metadata = generatePackageMetadata(pkgName, version) as any;
  const tgzKey = `${pkgName.split('/').pop()}-${version}.tgz`;
  const bundle = sigstoreBundle(pkgName, version, metadata._attachments[tgzKey].data);
  metadata._attachments[`${pkgName.split('/').pop()}-${version}.sigstore`] = {
    content_type: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    data: JSON.stringify(bundle),
  };
  return supertest(app)
    .put(`/${encodeURIComponent(pkgName)}`)
    .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
    .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, token))
    .send(JSON.stringify(metadata))
    .set('accept', HEADERS.GZIP)
    .expect(HTTP_STATUS.CREATED);
}

function star(app, pkgName: string, rev: string, users: Record<string, boolean>, token: string) {
  return supertest(app)
    .put(`/${encodeURIComponent(pkgName)}`)
    .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
    .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, token))
    .send(JSON.stringify({ _id: pkgName, _rev: rev, name: pkgName, users }));
}

function getTarball(app, pkgName: string, file: string, token?: string) {
  const test = supertest(app).get(`/${encodeURIComponent(pkgName)}/-/${file}`);
  if (token) {
    test.set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, token));
  }
  return test;
}

describe('registry parity endpoints', () => {
  test('GET /-/npm/v1/keys serves the signing key set', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const response = await supertest(app).get('/-/npm/v1/keys').expect(HTTP_STATUS.OK);
    expect(Array.isArray(response.body.keys)).toBe(true);
    expect(response.body.keys).toHaveLength(1);
    const key = response.body.keys[0];
    expect(key.keyid).toMatch(/^SHA256:/);
    expect(key.keytype).toBe('ecdsa-sha2-nistp256');
    expect(key.expires).toBeNull();
  });

  test('publish adds dist.signatures and provenance produces dist.attestations', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const credentials = { name: 'parity-user', password: 'testpass' };
    const user = await createUser(app, credentials.name, credentials.password);
    const token = user.body.token;

    await publishWithProvenance(app, 'attested-pkg', '1.0.0', token);

    const manifest = await getPackage(app, token, 'attested-pkg');
    const version = manifest.body.versions['1.0.0'];
    expect(version.dist.signatures).toHaveLength(1);
    expect(version.dist.signatures[0].keyid).toMatch(/^SHA256:/);
    expect(version.dist.attestations).toHaveLength(1);
    expect(version.dist.attestations[0].provenance.predicateType).toBe(
      'https://slsa.dev/provenance/v1'
    );
    expect(version.dist.attestations[0].url).toContain('/-/npm/v1/attestations/attested-pkg@1.0.0');
    // internal storage fields must not leak into the packument
    expect(manifest.body._attestations).toBeUndefined();
    expect(manifest.body.collaborators).toBeUndefined();
    expect(manifest.body.publish_requires_tfa).toBeUndefined();
  });

  test('GET /-/npm/v1/attestations returns the stored bundles', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const credentials = { name: 'att-user', password: 'testpass' };
    const user = await createUser(app, credentials.name, credentials.password);
    await publishWithProvenance(app, 'att-pkg-2', '2.0.0', user.body.token);

    const response = await supertest(app)
      .get('/-/npm/v1/attestations/att-pkg-2@2.0.0')
      .expect(HTTP_STATUS.OK);
    expect(response.body.attestations).toHaveLength(1);
    expect(response.body.attestations[0].bundle.mediaType).toBe(
      'application/vnd.dev.sigstore.bundle.v0.3+json'
    );
    expect(response.body.attestations[0].predicateType).toBe('https://slsa.dev/provenance/v1');

    await supertest(app)
      .get('/-/npm/v1/attestations/att-pkg-2@9.9.9')
      .expect(HTTP_STATUS.NOT_FOUND);
  });

  test('star and unstar only mutate the caller entry', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const alice = (await createUser(app, 'alice', 'testpass')).body.token;
    const bob = (await createUser(app, 'bob', 'testpass')).body.token;
    await publishVersionWithToken(app, 'starred-pkg', '1.0.0', alice).expect(HTTP_STATUS.CREATED);
    const manifest = await getPackage(app, alice, 'starred-pkg');

    // alice stars
    await star(app, 'starred-pkg', manifest.body._rev, { alice: true }, alice).expect(
      HTTP_STATUS.CREATED
    );
    let check = await getPackage(app, alice, 'starred-pkg');
    expect(check.body.users).toEqual({ alice: true });

    // bob cannot flip alice's entry
    await star(app, 'starred-pkg', check.body._rev, { alice: false, bob: true }, bob).expect(
      HTTP_STATUS.FORBIDDEN
    );

    // bob stars his own entry
    check = await getPackage(app, bob, 'starred-pkg');
    await star(app, 'starred-pkg', check.body._rev, { alice: true, bob: true }, bob).expect(
      HTTP_STATUS.CREATED
    );

    // the CouchDB view answers per user
    const aliceStars = await supertest(app)
      .get(`/-/_view/starredByUser?key=${encodeURIComponent('"alice"')}`)
      .expect(HTTP_STATUS.OK);
    expect(aliceStars.body.rows).toEqual([{ value: 'starred-pkg' }]);

    // alice unstars
    check = await getPackage(app, alice, 'starred-pkg');
    await star(app, 'starred-pkg', check.body._rev, { bob: true }, alice).expect(
      HTTP_STATUS.CREATED
    );
    const aliceAfter = await supertest(app)
      .get(`/-/_view/starredByUser?key=${encodeURIComponent('"alice"')}`)
      .expect(HTTP_STATUS.OK);
    expect(aliceAfter.body.rows).toEqual([]);
  });

  test('collaborator grant, list and revoke', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const owner = (await createUser(app, 'owner-user', 'testpass')).body.token;
    const collab = (await createUser(app, 'collab-user', 'testpass')).body.token;
    await publishVersionWithToken(app, 'collab-pkg', '1.0.0', owner).expect(HTTP_STATUS.CREATED);

    const listBefore = await supertest(app)
      .get('/-/package/collab-pkg/collaborators')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .expect(HTTP_STATUS.OK);
    expect(listBefore.body['owner-user']).toBe('write');

    await supertest(app)
      .put('/-/package/collab-pkg/collaborators/collab-user')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .send({ permissions: 'write' })
      .expect(HTTP_STATUS.OK);

    const list = await supertest(app)
      .get('/-/package/collab-pkg/collaborators')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, collab))
      .expect(HTTP_STATUS.OK);
    expect(list.body['collab-user']).toBe('write');

    // a write collaborator can publish
    await publishVersionWithToken(app, 'collab-pkg', '1.1.0', collab).expect(HTTP_STATUS.CREATED);

    await supertest(app)
      .delete('/-/package/collab-pkg/collaborators/collab-user')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .expect(HTTP_STATUS.OK);
    const listAfter = await supertest(app)
      .get('/-/package/collab-pkg/collaborators')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .expect(HTTP_STATUS.OK);
    expect(listAfter.body['collab-user']).toBeUndefined();
  });

  test('access endpoint toggles visibility and mfa flags', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const owner = (await createUser(app, 'access-owner', 'testpass')).body.token;
    await publishVersionWithToken(app, 'access-pkg', '1.0.0', owner).expect(HTTP_STATUS.CREATED);

    const visibility = await supertest(app)
      .get('/-/package/access-pkg/visibility')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .expect(HTTP_STATUS.OK);
    expect(visibility.body.public).toBe(true);

    await supertest(app)
      .post('/-/package/access-pkg/access')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .send({ access: 'restricted' })
      .expect(HTTP_STATUS.OK);

    const after = await supertest(app)
      .get('/-/package/access-pkg/visibility')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .expect(HTTP_STATUS.OK);
    expect(after.body.public).toBe(false);

    await supertest(app)
      .post('/-/package/access-pkg/access')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, owner))
      .send({ publish_requires_tfa: true, automation_token_overrides_tfa: true })
      .expect(HTTP_STATUS.OK);

    // mfa flags are internal and do not leak into the packument
    const manifest = await getPackage(app, owner, 'access-pkg');
    expect(manifest.body.publish_requires_tfa).toBeUndefined();
  });

  test('ls-packages lists only the caller packages', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const alice = (await createUser(app, 'ls-alice', 'testpass')).body.token;
    const bob = (await createUser(app, 'ls-bob', 'testpass')).body.token;
    await publishVersionWithToken(app, 'alice-pkg', '1.0.0', alice).expect(HTTP_STATUS.CREATED);
    await publishVersionWithToken(app, 'bob-pkg', '1.0.0', bob).expect(HTTP_STATUS.CREATED);

    const mine = await supertest(app)
      .get('/-/user/ls-alice/package')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, alice))
      .expect(HTTP_STATUS.OK);
    expect(mine.body['alice-pkg']).toBe('write');
    expect(mine.body['bob-pkg']).toBeUndefined();

    // bob cannot enumerate alice's packages
    await supertest(app)
      .get('/-/user/ls-alice/package')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, bob))
      .expect(HTTP_STATUS.FORBIDDEN);
  });

  test('team routes answer 501', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const token = (await createUser(app, 'team-user', 'testpass')).body.token;
    await supertest(app)
      .put('/-/team/myscope/myteam/package')
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, token))
      .send({ package: 'x', permissions: 'write' })
      .expect(HTTP_STATUS.NOT_IMPLEMENTED);
  });

  test('download counts are recorded and queryable', async () => {
    const app = await initializeServer('registry-parity.yaml');
    const token = (await createUser(app, 'dl-user', 'testpass')).body.token;
    await publishVersionWithToken(app, 'dl-pkg', '1.0.0', token).expect(HTTP_STATUS.CREATED);
    await getTarball(app, 'dl-pkg', 'dl-pkg-1.0.0.tgz', token).expect(HTTP_STATUS.OK);
    await getTarball(app, 'dl-pkg', 'dl-pkg-1.0.0.tgz', token).expect(HTTP_STATUS.OK);

    const point = await supertest(app)
      .get('/-/npm/v1/downloads/point/last-week/dl-pkg')
      .expect(HTTP_STATUS.OK);
    expect(point.body.package).toBe('dl-pkg');
    expect(point.body.downloads).toBeGreaterThanOrEqual(2);

    // registry caps ranges at one year like npm does
    const today = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const range = await supertest(app)
      .get(`/-/npm/v1/downloads/range/${yearAgo}:${today}/dl-pkg`)
      .expect(HTTP_STATUS.OK);
    expect(range.body.downloads.reduce((s, d) => s + d.downloads, 0)).toBeGreaterThanOrEqual(2);

    // invalid kinds and periods are rejected
    await supertest(app)
      .get('/-/npm/v1/downloads/bogus/last-week/dl-pkg')
      .expect(HTTP_STATUS.NOT_FOUND);
    await supertest(app)
      .get('/-/npm/v1/downloads/range/not-a-date/dl-pkg')
      .expect(HTTP_STATUS.BAD_REQUEST);
  });

  test('prometheus metrics endpoint requires the configured token', async () => {
    const app = await initializeServer('registry-parity.yaml');
    await supertest(app).get('/-/metrics').expect(HTTP_STATUS.UNAUTHORIZED);
    await supertest(app)
      .get('/-/metrics')
      .set(HEADERS.AUTHORIZATION, 'Bearer wrong')
      .expect(HTTP_STATUS.UNAUTHORIZED);
    const ok = await supertest(app)
      .get('/-/metrics')
      .set(HEADERS.AUTHORIZATION, 'Bearer metrics-secret')
      .expect(HTTP_STATUS.OK);
    expect(ok.text).toContain('# TYPE verdaccio_http_requests_total counter');
    expect(ok.text).toMatch(/verdaccio_registry_packages \d+/);
    expect(ok.text).toContain('verdaccio_process_uptime_seconds');
  });
});

describe('publish scanning', () => {
  test('enforce mode rejects lifecycle scripts', async () => {
    const app = await initializeServer('registry-scan.yaml');
    const token = (await createUser(app, 'scan-user', 'testpass')).body.token;
    // the policy runs against the package.json inside the tarball — putting
    // scripts only in the publish metadata must not be what trips the scan
    const metadata = metadataWithTarball('scanned-pkg', '1.0.0', {
      name: 'scanned-pkg',
      version: '1.0.0',
      scripts: { postinstall: 'node index.js' },
    });
    await supertest(app)
      .put(`/${encodeURIComponent('scanned-pkg')}`)
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, token))
      .send(JSON.stringify(metadata))
      .expect(HTTP_STATUS.FORBIDDEN);

    // the rejected publish must not leave a package behind
    await getPackage(app, token, 'scanned-pkg', HTTP_STATUS.NOT_FOUND);
  });

  test('denied licenses are rejected', async () => {
    const app = await initializeServer('registry-scan.yaml');
    const token = (await createUser(app, 'scan-user2', 'testpass')).body.token;
    const metadata = metadataWithTarball('denied-license', '1.0.0', {
      name: 'denied-license',
      version: '1.0.0',
      license: 'SSPL-1.0',
    });
    await supertest(app)
      .put(`/${encodeURIComponent('denied-license')}`)
      .set(HEADER_TYPE.CONTENT_TYPE, HEADERS.JSON)
      .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, token))
      .send(JSON.stringify(metadata))
      .expect(HTTP_STATUS.FORBIDDEN);
  });

  test('clean packages still publish under enforce mode', async () => {
    const app = await initializeServer('registry-scan.yaml');
    const token = (await createUser(app, 'scan-user3', 'testpass')).body.token;
    await publishVersionWithToken(app, 'clean-pkg', '1.0.0', token).expect(HTTP_STATUS.CREATED);
  });
});
