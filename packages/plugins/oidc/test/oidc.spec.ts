import express from 'express';
import type { Express } from 'express';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JWK, KeyLike } from 'jose';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { createRemoteUser } from '@verdaccio/config';
import type { Config } from '@verdaccio/types';

import { extractIdentity } from '../src/client';
import { ProviderResolver } from '../src/discovery';
import OidcPlugin, { cliSessionFromNext, isSafeNext } from '../src/index';
import { OidcStateStore } from '../src/state';
import type { OidcConfig } from '../src/types';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child() {
    return this;
  },
} as any;

// --- a real IdP stub on localhost; nock cannot intercept undici fetch ---

let idp: Server;
let idpBase: string;
let privateKey: KeyLike;
let publicJwk: JWK;
let discoveryHits = 0;
// the nonce the token endpoint embeds in the next id token ; set by the test
// after parsing it out of the authorize redirect
let nextNonce: string | undefined;

async function signToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(idpBase)
    .setAudience('verdaccio')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  idp = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/.well-known/openid-configuration') {
      discoveryHits += 1;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer: idpBase,
          authorization_endpoint: `${idpBase}/authorize`,
          token_endpoint: `${idpBase}/token`,
          userinfo_endpoint: `${idpBase}/userinfo`,
          jwks_uri: `${idpBase}/jwks`,
          end_session_endpoint: `${idpBase}/logout`,
        })
      );
      return;
    }
    if (url.pathname === '/jwks') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (url.pathname === '/token') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      const params = new URLSearchParams(body);
      if (params.get('grant_type') !== 'authorization_code' || !params.get('code_verifier')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      const idToken = await signToken({
        sub: 'sub-alice',
        preferred_username: 'alice',
        email: 'alice@example.com',
        groups: ['dev', 'ops'],
        nonce: nextNonce,
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id_token: idToken, access_token: 'at-1', token_type: 'Bearer' }));
      return;
    }
    if (url.pathname === '/userinfo') {
      if (req.headers.authorization !== 'Bearer at-1') {
        res.statusCode = 401;
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ groups: ['from-userinfo'] }));
      return;
    }
    if (url.pathname === '/logout') {
      res.statusCode = 302;
      res.setHeader('location', '/');
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });

  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
  const address = idp.address();
  idpBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise((resolve) => idp.close(resolve));
});

function oidcConfig(extra: Partial<OidcConfig> = {}): OidcConfig {
  return {
    issuer: idpBase,
    'client-id': 'verdaccio',
    ...extra,
  };
}

function appConfig(oidc: OidcConfig): Config {
  return {
    url_prefix: '',
    auth: { oidc },
    security: { web: { sign: { expiresIn: '1h' } }, api: { legacy: true } },
  } as unknown as Config;
}

const fakeAuth = {
  jwtEncrypt: vi.fn(async (user: any) => `webtoken:${user.name}:${user.real_groups.join(',')}`),
  aesEncrypt: vi.fn((payload: string) => `aes:${payload}`),
  authenticate: vi.fn((user: string, _password: string, cb: any) =>
    cb(null, user === 'bob' ? ['bob', '$all'] : false)
  ),
};

function middlewarePlugin(oidc: OidcConfig): OidcPlugin {
  return new OidcPlugin({ enabled: true }, { config: appConfig(oidc), logger });
}

function buildApp(oidc: OidcConfig, simulateJwt401 = false): { app: Express; plugin: OidcPlugin } {
  const plugin = middlewarePlugin(oidc);
  const app = express();
  app.use(express.json());
  if (simulateJwt401) {
    // stands in for apiJWTmiddleware: local bearer passes, everything else 401s
    app.use((req, _res, next) => {
      const header = req.headers.authorization;
      if (header === 'Bearer local-token') {
        (req as any).remote_user = createRemoteUser('localuser', ['localuser']);
        return next();
      }
      if (header?.startsWith('Bearer ')) {
        return next({ status: 401, message: 'invalid token' });
      }
      next();
    });
  }
  plugin.register_middlewares(app, fakeAuth as any, {});
  app.get('/protected', (req, res) => {
    res.json({ user: (req as any).remote_user?.name ?? null });
  });
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message });
  });
  return { app, plugin };
}

afterAll(() => {
  vi.restoreAllMocks();
});

describe('isSafeNext', () => {
  test('accepts same-origin paths', () => {
    expect(isSafeNext('/')).toBe(true);
    expect(isSafeNext('/-/web/detail/foo')).toBe(true);
  });

  test('rejects external and malformed targets', () => {
    expect(isSafeNext('//evil.com')).toBe(false);
    expect(isSafeNext('/\\evil.com')).toBe(false);
    expect(isSafeNext('https://evil.com')).toBe(false);
    expect(isSafeNext('')).toBe(false);
    expect(isSafeNext(undefined)).toBe(false);
    expect(isSafeNext('/foo\u0000bar')).toBe(false);
  });
});

describe('cliSessionFromNext', () => {
  test('extracts the session id', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(cliSessionFromNext(`/-/v1/login_cli/${id}`)).toBe(id);
  });

  test('rejects other paths', () => {
    expect(cliSessionFromNext('/-/web/login')).toBeUndefined();
    expect(cliSessionFromNext('/-/v1/login_cli/not-a-uuid')).toBeUndefined();
  });
});

describe('extractIdentity', () => {
  test('uses preferred_username and groups by default', () => {
    const identity = extractIdentity(
      { preferred_username: 'alice', groups: ['dev', 'ops'] },
      oidcConfig(),
      logger
    );
    expect(identity.username).toBe('alice');
    expect(identity.groups).toEqual(['dev', 'ops']);
  });

  test('falls back to email then sub', () => {
    expect(extractIdentity({ email: 'alice@example.com' }, oidcConfig(), logger).username).toBe(
      'alice@example.com'
    );
    expect(extractIdentity({ sub: 'sub-1' }, oidcConfig(), logger).username).toBe('sub-1');
  });

  test('honours custom claims and dot paths', () => {
    const identity = extractIdentity(
      { uid: 'bob', realm_access: { roles: ['a', 'b'] } },
      oidcConfig({ 'username-claim': 'uid', 'groups-claim': 'realm_access.roles' }),
      logger
    );
    expect(identity.username).toBe('bob');
    expect(identity.groups).toEqual(['a', 'b']);
  });

  test('splits string-joined group claims', () => {
    const identity = extractIdentity(
      { preferred_username: 'alice', groups: 'dev ops' },
      oidcConfig(),
      logger
    );
    expect(identity.groups).toEqual(['dev', 'ops']);
  });

  test('rejects missing or unsafe usernames', () => {
    expect(() => extractIdentity({}, oidcConfig(), logger)).toThrow();
    expect(() =>
      extractIdentity({ preferred_username: 'bad name' }, oidcConfig(), logger)
    ).toThrow();
    expect(() => extractIdentity({ preferred_username: 42 }, oidcConfig(), logger)).toThrow();
  });

  test('enforces authorized-groups', () => {
    const cfg = oidcConfig({ 'authorized-groups': ['dev'] });
    expect(
      extractIdentity({ preferred_username: 'alice', groups: ['dev'] }, cfg, logger).username
    ).toBe('alice');
    expect(() =>
      extractIdentity({ preferred_username: 'alice', groups: ['other'] }, cfg, logger)
    ).toThrow();
    expect(() => extractIdentity({ preferred_username: 'alice' }, cfg, logger)).toThrow();
  });
});

describe('ProviderResolver', () => {
  test('derives issuer from jwks-uri and skips discovery when manual', async () => {
    const resolver = new ProviderResolver(
      {
        'jwks-uri': 'https://manual.example.com/jwks',
        'authorization-endpoint': 'https://manual.example.com/auth',
        'token-endpoint': 'https://manual.example.com/token',
      },
      logger
    );
    const provider = await resolver.resolve();
    expect(provider.issuer).toBe('https://manual.example.com');
    expect(provider.jwksUri).toBe('https://manual.example.com/jwks');
  });

  test('discovers endpoints and caches the document', async () => {
    const hitsBefore = discoveryHits;
    const resolver = new ProviderResolver(oidcConfig(), logger);
    const provider = await resolver.resolve();
    expect(provider.authorizationEndpoint).toBe(`${idpBase}/authorize`);
    expect(provider.endSessionEndpoint).toBe(`${idpBase}/logout`);
    await resolver.resolve();
    expect(discoveryHits).toBe(hitsBefore + 1);
  });

  test('fails when endpoints cannot be resolved', async () => {
    const resolver = new ProviderResolver({ 'client-id': 'x' }, logger);
    await expect(resolver.resolve()).rejects.toThrow();
  });
});

describe('OidcStateStore', () => {
  test('pending auth is single-use', () => {
    const store = new OidcStateStore();
    const { state } = store.createPendingAuth('/');
    expect(store.consumePendingAuth(state)).toBeDefined();
    expect(store.consumePendingAuth(state)).toBeUndefined();
    store.stop();
  });

  test('cli token is handed out once', () => {
    const store = new OidcStateStore();
    const id = store.createCliSession();
    expect(store.consumeCliToken(id)).toEqual({ token: undefined });
    expect(store.completeCliSession(id, 'tok')).toBe(true);
    expect(store.consumeCliToken(id)).toEqual({ token: 'tok' });
    expect(store.consumeCliToken(id)).toBeUndefined();
    store.stop();
  });

  test('confirm ids are single-use', () => {
    const store = new OidcStateStore();
    const id = store.createCliSession();
    const confirmId = store.createPendingConfirm(id, 'tok', 'alice');
    expect(store.consumePendingConfirm(confirmId)?.username).toBe('alice');
    expect(store.consumePendingConfirm(confirmId)).toBeUndefined();
    store.stop();
  });
});

describe('authenticate (JWT as password)', () => {
  const plugin = () => new OidcPlugin(oidcConfig(), { config: appConfig(oidcConfig()), logger });

  test('passes through non-JWT passwords', async () => {
    const result = await new Promise((resolve) => {
      plugin().authenticate('alice', 'secret-password', (err, groups) => resolve({ err, groups }));
    });
    expect(result).toEqual({ err: null, groups: false });
  });

  test('accepts a verified token for the matching user', async () => {
    const token = await signToken({ preferred_username: 'alice', groups: ['dev'] });
    const result = await new Promise((resolve) => {
      plugin().authenticate('alice', token, (err, groups) => resolve({ err, groups }));
    });
    expect(result).toEqual({ err: null, groups: ['alice', 'dev'] });
  });

  test('rejects a token issued for another user', async () => {
    const token = await signToken({ preferred_username: 'alice' });
    const result = await new Promise((resolve) => {
      plugin().authenticate('mallory', token, (err, groups) => resolve({ err, groups }));
    });
    expect(result).toEqual({ err: null, groups: false });
  });

  test('rejects a token from another issuer', async () => {
    const token = await new SignJWT({ preferred_username: 'alice' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://other.example.com')
      .setAudience('verdaccio')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    const result = await new Promise((resolve) => {
      plugin().authenticate('alice', token, (err, groups) => resolve({ err, groups }));
    });
    expect(result).toEqual({ err: null, groups: false });
  });
});

describe('middleware routes', () => {
  test('GET /-/oauth/config exposes the button metadata', async () => {
    const { app, plugin } = buildApp(oidcConfig({ 'login-button-text': 'Sign in with SSO' }));
    const res = await supertest(app).get('/-/oauth/config');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.loginButtonText).toBe('Sign in with SSO');
    expect(res.body.authorize).toBe('/-/oauth/authorize');
    plugin._stop();
  });

  test('GET /-/oauth/authorize redirects to the IdP with PKCE', async () => {
    const { app, plugin } = buildApp(oidcConfig());
    const res = await supertest(app).get('/-/oauth/authorize?next=%2F-%2Fweb%2Fdetail%2Ffoo');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin).toBe(idpBase);
    expect(location.pathname).toBe('/authorize');
    expect(location.searchParams.get('client_id')).toBe('verdaccio');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    plugin._stop();
  });

  test('callback with unknown state is rejected', async () => {
    const { app, plugin } = buildApp(oidcConfig());
    const res = await supertest(app).get('/-/oauth/callback?state=bogus&code=x');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Sign-in failed');
    plugin._stop();
  });

  test('callback surfaces provider errors', async () => {
    const { app, plugin } = buildApp(oidcConfig());
    const res = await supertest(app).get('/-/oauth/callback?error=access_denied');
    expect(res.status).toBe(400);
    expect(res.text).toContain('access_denied');
    plugin._stop();
  });

  test('full browser flow issues a web token into the handoff page', async () => {
    const { app, plugin } = buildApp(oidcConfig());
    const authorize = await supertest(app).get('/-/oauth/authorize?next=%2F-%2Fweb%2Fdetail%2Ffoo');
    const location = new URL(authorize.headers.location);
    nextNonce = location.searchParams.get('nonce') as string;
    const state = location.searchParams.get('state');

    const res = await supertest(app).get(`/-/oauth/callback?code=abc&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('localStorage');
    expect(res.text).toContain('webtoken:alice:alice,dev,ops');
    expect(res.text).toContain('/-/web/detail/foo');
    plugin._stop();
  });

  test('npm web-authn flow parks the token behind an explicit confirm', async () => {
    const { app, plugin } = buildApp(oidcConfig());

    const login = await supertest(app).post('/-/v1/login');
    expect(login.status).toBe(200);
    const { loginUrl, doneUrl } = login.body;
    const sessionId = new URL(doneUrl).pathname.split('/').pop() as string;
    expect(loginUrl).toContain(`/-/v1/login_cli/${sessionId}`);

    const authorize = await supertest(app).get(
      `/-/oauth/authorize?next=${encodeURIComponent(`/-/v1/login_cli/${sessionId}`)}`
    );
    const location = new URL(authorize.headers.location);
    nextNonce = location.searchParams.get('nonce') as string;
    const state = location.searchParams.get('state');

    const callback = await supertest(app).get(`/-/oauth/callback?code=abc&state=${state}`);
    expect(callback.status).toBe(200);
    expect(callback.text).toContain('Approve CLI login');
    expect(callback.text).toContain('alice');

    // the token is not visible to the cli yet
    const pendingPoll = await supertest(app).get(doneUrl.replace(/^https?:\/\/[^/]+/, ''));
    expect(pendingPoll.status).toBe(202);

    const confirmPath = callback.text.match(/action="([^"]+)"/)?.[1];
    const confirm = await supertest(app).post(confirmPath as string);
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('CLI login complete');

    const done = await supertest(app).get(doneUrl.replace(/^https?:\/\/[^/]+/, ''));
    expect(done.status).toBe(200);
    expect(done.body.token).toMatch(/^aes:/);
    plugin._stop();
  });

  test('cli password post completes the session', async () => {
    const { app, plugin } = buildApp(oidcConfig());
    const login = await supertest(app).post('/-/v1/login');
    const sessionId = new URL(login.body.doneUrl).pathname.split('/').pop();

    const res = await supertest(app)
      .post(`/-/v1/login_cli/${sessionId}`)
      .send({ username: 'bob', password: 'secret' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^aes:/);
    expect(fakeAuth.authenticate).toHaveBeenCalledWith('bob', 'secret', expect.any(Function));
    plugin._stop();
  });

  test('cli password post rejects bad credentials', async () => {
    const { app, plugin } = buildApp(oidcConfig());
    const login = await supertest(app).post('/-/v1/login');
    const sessionId = new URL(login.body.doneUrl).pathname.split('/').pop();

    const res = await supertest(app)
      .post(`/-/v1/login_cli/${sessionId}`)
      .send({ username: 'mallory', password: 'nope' });
    expect(res.status).toBe(401);
    plugin._stop();
  });

  test('OIDC bearer token recovers the 401 from the core jwt middleware', async () => {
    const { app, plugin } = buildApp(oidcConfig(), true);
    const token = await signToken({ preferred_username: 'alice', groups: ['dev'] });
    const res = await supertest(app).get('/protected').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('alice');
    plugin._stop();
  });

  test('foreign bearer tokens still get the original 401', async () => {
    const { app, plugin } = buildApp(oidcConfig(), true);
    const res = await supertest(app).get('/protected').set('authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    plugin._stop();
  });

  test('local bearer tokens are untouched', async () => {
    const { app, plugin } = buildApp(oidcConfig(), true);
    const res = await supertest(app).get('/protected').set('authorization', 'Bearer local-token');
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('localuser');
    plugin._stop();
  });

  test('logout redirects to the end session endpoint when discovered', async () => {
    const { app, plugin } = buildApp(oidcConfig());
    const res = await supertest(app).get('/-/oauth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`${idpBase}/logout`);
    expect(res.headers.location).toContain('post_logout_redirect_uri');
    plugin._stop();
  });

  test('middleware is a no-op without an oidc client id', async () => {
    const plugin = new OidcPlugin(
      { enabled: true },
      { config: { url_prefix: '', auth: {} } as unknown as Config, logger }
    );
    const app = express();
    plugin.register_middlewares(app, fakeAuth as any, {});
    const res = await supertest(app).get('/-/oauth/config');
    expect(res.status).toBe(404);
    expect(logger.error).toHaveBeenCalled();
    plugin._stop();
  });
});
