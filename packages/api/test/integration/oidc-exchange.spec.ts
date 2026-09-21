import express from 'express';
import type { Application } from 'express';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { KeyObject } from 'node:crypto';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { HEADERS, HTTP_STATUS } from '@verdaccio/core';

import { initializeServerWithContext, publishVersionWithToken } from './_helper';

const GITHUB_ISS = 'https://issuer.test';
const GITLAB_ISS = 'https://gitlab.test';

let privateKey: KeyObject;
let jwksServer: Server;
let jwksUri: string;
let app: Application;

async function ciJwt(claims: Record<string, unknown>, iss = GITHUB_ISS): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(iss)
    .setAudience('npm:127.0.0.1')
    .setSubject('repo:acme/widgets')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

function exchange(pkgName: string, token?: string) {
  const req = supertest(app).post(
    `/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(pkgName)}`
  );
  if (token) {
    req.set(HEADERS.AUTHORIZATION, `Bearer ${token}`);
  }
  return req;
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  Object.assign(jwk, { kid: 'test-key', use: 'sig', alg: 'RS256' });

  const jwksApp = express();
  jwksApp.get('/jwks', (_req, res) => res.json({ keys: [jwk] }));
  await new Promise<void>((resolve) => {
    jwksServer = jwksApp.listen(0, '127.0.0.1', resolve);
  });
  const { port } = jwksServer.address() as { port: number };
  jwksUri = `http://127.0.0.1:${port}/jwks`;

  const context = await initializeServerWithContext('trusted-publishing.yaml', (conf) => {
    for (const entry of conf.security.trustedPublishing) {
      entry.jwksUri = jwksUri;
    }
  });
  app = context.app;
});

afterAll(() => {
  jwksServer?.close();
});

describe('oidc token exchange', () => {
  const githubClaims = {
    repository: 'acme/widgets',
    job_workflow_ref: 'acme/widgets/.github/workflows/release.yml@refs/heads/main',
  };

  test('exchanges a valid GitHub OIDC token for a scoped registry token', async () => {
    const resp = await exchange('@token/ci-pkg', await ciJwt(githubClaims)).expect(HTTP_STATUS.OK);
    expect(typeof resp.body.token).toBe('string');

    // the exchanged token publishes in-scope and is refused out-of-scope
    await publishVersionWithToken(app, '@token/ci-pkg', '1.0.0', resp.body.token).expect(
      HTTP_STATUS.CREATED
    );
    await publishVersionWithToken(app, '@token/other-pkg', '1.0.0', resp.body.token).expect(
      HTTP_STATUS.FORBIDDEN
    );
  });

  test('rejects a request without a bearer token', async () => {
    const resp = await exchange('@token/ci-pkg');
    expect(resp.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  test('rejects a token from an untrusted issuer', async () => {
    const resp = await exchange('@token/ci-pkg', await ciJwt(githubClaims, 'https://evil.test'));
    expect(resp.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  test('rejects a token for a different repository', async () => {
    const token = await ciJwt({ ...githubClaims, repository: 'acme/other' });
    const resp = await exchange('@token/ci-pkg', token);
    expect(resp.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  test('rejects a token from a different workflow file', async () => {
    const token = await ciJwt({
      ...githubClaims,
      job_workflow_ref: 'acme/widgets/.github/workflows/sneaky.yml@refs/heads/main',
    });
    const resp = await exchange('@token/ci-pkg', token);
    expect(resp.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  test('rejects a package outside the publisher package list', async () => {
    const resp = await exchange('only-you-can-publish', await ciJwt(githubClaims));
    expect(resp.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  test('rejects a token signed with the wrong key', async () => {
    const other = await generateKeyPair('RS256');
    const token = await new SignJWT(githubClaims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(GITHUB_ISS)
      .setAudience('npm:127.0.0.1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(other.privateKey);
    const resp = await exchange('@token/ci-pkg', token);
    expect(resp.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  test('accepts a GitLab token only in its configured environment', async () => {
    const base = {
      project_path: 'acme/gitlab-proj',
      ci_config_ref_uri: 'gitlab.test/acme/gitlab-proj//.gitlab-ci.yml@refs/heads/main',
    };
    const ok = await ciJwt({ ...base, environment: 'production' }, GITLAB_ISS);
    const resp = await exchange('@token/gitlab-pkg', ok);
    expect(resp.status).toBe(HTTP_STATUS.OK);

    const noEnv = await ciJwt(base, GITLAB_ISS);
    const denied = await exchange('@token/gitlab-pkg-2', noEnv);
    expect(denied.status).toBe(HTTP_STATUS.FORBIDDEN);
  });
});
