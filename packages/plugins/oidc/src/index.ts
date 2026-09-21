import buildDebug from 'debug';
import type { Express, Request, Response } from 'express';
import { Router } from 'express';
import { decodeJwt } from 'jose';
import { createHash } from 'node:crypto';

import { getApiToken } from '@verdaccio/auth';
import type { TokenEncryption } from '@verdaccio/auth';
import { createRemoteUser } from '@verdaccio/config';
import { API_ERROR, errorUtils, pluginUtils, reqUtils } from '@verdaccio/core';
import { rateLimit } from '@verdaccio/middleware';
import { getPublicUrl } from '@verdaccio/url';
import type { Config, Logger, RemoteUser } from '@verdaccio/types';

import { OidcVerifier, exchangeCode, extractIdentity, fetchUserinfo } from './client';
import { ProviderResolver } from './discovery';
import { cliConfirmPage, cliDonePage, errorPage, handoffPage } from './handoff';
import { OidcStateStore } from './state';
import type { OidcConfig, OidcIdentity, OidcMiddlewareConfig } from './types';

const debug = buildDebug('verdaccio:plugin:oidc');

const CLI_NEXT_PREFIX = '/-/v1/login_cli/';
const STATE_TTL_HINT = 'the sign-in took too long, start over';

/** The pieces of the Auth service the plugin uses: token issuing plus the
 * chained authenticate() for the password fallback of the CLI session. */
interface AuthLike extends TokenEncryption {
  authenticate(user: string, password: string, cb: pluginUtils.AuthCallback): void;
}

/**
 * Validate the post-login redirect target.
 *
 * Only same-origin absolute paths are allowed; //evil.com would make the
 * handoff page leak the freshly minted token to another origin, and the
 * /-/v1/login_cli/ prefix marks a CLI session the callback completes
 * instead of redirecting to.
 */
export function isSafeNext(next: unknown): next is string {
  return (
    typeof next === 'string' &&
    next.startsWith('/') &&
    !next.startsWith('//') &&
    // no backslashes or control chars; edge-case redirect parsers treat
    // /\evil.com as protocol-relative
    // eslint-disable-next-line no-control-regex
    /[\\\u0000-\u001f]/.test(next) === false
  );
}

export function cliSessionFromNext(next: string): string | undefined {
  if (next.startsWith(CLI_NEXT_PREFIX) === false) {
    return undefined;
  }
  const sessionId = next.slice(CLI_NEXT_PREFIX.length);
  return /^[0-9a-f-]{36}$/.test(sessionId) ? sessionId : undefined;
}

function baseUrl(config: Config, req: Request): string {
  const base = getPublicUrl(config.url_prefix, {
    host: req.hostname,
    protocol: req.protocol,
    headers: req.headers,
  });
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Express 5 types route params as string | string[]; empty means absent. */
function routeParam(value: string | string[] | undefined): string | undefined {
  const param = reqUtils.paramToString(value);
  return param === '' ? undefined : param;
}

/**
 * OpenID Connect plugin.
 *
 * Loaded twice, once per config section: auth: oidc: authenticates users
 * (the password field carries an OIDC token for npm login --auth-type=legacy
 * and _auth basic credentials), and middlewares: oidc: mounts the browser
 * flow ; /-/oauth/authorize, /-/oauth/callback, the npm login
 * --auth-type=web endpoints and /-/oauth/config for the web UI.
 */
export default class OidcPlugin
  extends pluginUtils.Plugin<OidcConfig | OidcMiddlewareConfig>
  implements
    pluginUtils.Auth<OidcConfig>,
    pluginUtils.ExpressMiddleware<OidcMiddlewareConfig, unknown, AuthLike>
{
  private readonly logger: Logger;
  private readonly state = new OidcStateStore();
  private resolver?: ProviderResolver;
  private verifier?: OidcVerifier;

  public constructor(
    config: OidcConfig | OidcMiddlewareConfig,
    options: pluginUtils.PluginOptions
  ) {
    super(config, options);
    this.logger = options.logger;
  }

  /**
   * The OIDC settings: the plugin's own config when it has them (the auth:
   * instance), otherwise the auth.oidc section of the app config (the
   * middlewares: instance).
   */
  private oidcConfig(): OidcConfig {
    const own = this.config as OidcConfig;
    if (
      own &&
      typeof own === 'object' &&
      (own['client-id'] ?? own.issuer ?? own['provider-host'])
    ) {
      return own;
    }
    const appAuth = (this.options.config as Config)?.auth as Record<string, OidcConfig> | undefined;
    return appAuth?.oidc ?? own;
  }

  private getResolver(): ProviderResolver {
    this.resolver ??= new ProviderResolver(this.oidcConfig(), this.logger);
    return this.resolver;
  }

  private getVerifier(): OidcVerifier {
    this.verifier ??= new OidcVerifier(this.oidcConfig());
    return this.verifier;
  }

  /**
   * Authenticate with an OIDC token in the password field.
   *
   * cb(null, false) on every mismatch so the chain falls through to the
   * next plugin ; a real password that happens to look like a JWT must still
   * reach htpasswd.
   */
  public authenticate(user: string, password: string, cb: pluginUtils.AuthCallback): void {
    if (typeof password !== 'string' || password.split('.').length !== 3) {
      return cb(null, false);
    }
    this.authenticateJwt(user, password).then(
      (groups) => cb(null, groups),
      (err) => {
        this.logger.error(
          { user, err: err?.message },
          'oidc token verification failed unexpectedly for @{user}: @{err}'
        );
        return cb(errorUtils.getInternalError('oidc verification failed'));
      }
    );
  }

  private async authenticateJwt(user: string, token: string): Promise<string[] | false> {
    let provider;
    try {
      provider = await this.getResolver().resolve();
    } catch (err) {
      debug('provider resolution failed: %o', err);
      return false;
    }
    let claims;
    try {
      claims = await this.getVerifier().verify(token, provider);
    } catch (err) {
      // expired, wrong signature, wrong issuer ; just not an OIDC credential
      debug('token did not verify: %o', err);
      return false;
    }
    let identity: OidcIdentity;
    try {
      identity = extractIdentity(claims as Record<string, unknown>, this.oidcConfig(), this.logger);
    } catch {
      return false;
    }
    // the token must belong to the user it logs in as
    if (identity.username !== user) {
      debug('token username %o does not match login %o', identity.username, user);
      return false;
    }
    return [identity.username, ...identity.groups];
  }

  public register_middlewares(app: Express, auth: AuthLike, _storage: unknown): void {
    const middlewareConfig = this.config as OidcMiddlewareConfig;
    if (middlewareConfig?.enabled === false) {
      return;
    }
    const oidcConfig = this.oidcConfig();
    if (!oidcConfig?.['client-id']) {
      this.logger.error(
        'oidc middleware is enabled but no oidc auth configuration was found; set auth.oidc.client-id'
      );
      return;
    }

    // apiJWTmiddleware answers 401 to any Bearer it cannot verify, which is
    // every OIDC token. Two escape hatches: a plain middleware for paths that
    // skip the JWT middleware entirely (/-/verdaccio), and an error middleware
    // that retries the failed request when the bearer is a valid OIDC token.
    app.use((req: Request, _res: Response, next: () => void) => {
      this.upgradeBearerToken(req).finally(() => next());
    });
    app.use((err: any, req: Request, res: Response, next: (err?: any) => void) => {
      if ((err?.status ?? err?.statusCode) !== 401) {
        return next(err);
      }
      this.upgradeBearerToken(req).then(
        (user) => {
          if (user) {
            (req as any).remote_user = user;
            (res.locals as any).remote_user = user;
            return next();
          }
          return next(err);
        },
        () => next(err)
      );
    });

    const router = Router(); /* eslint new-cap: 0 */
    // same limiter the built-in login/token routes use
    const loginRateLimit = rateLimit((this.options.config as Config)?.userRateLimit);

    router.get('/-/oauth/config', (_req, res) => {
      res.json({
        enabled: true,
        loginButtonText: oidcConfig['login-button-text'] ?? 'Login with SSO',
        authorize: '/-/oauth/authorize',
      });
    });

    router.get('/-/oauth/authorize', (req, res, next) => {
      this.handleAuthorize(req as Request, res).catch(next);
    });

    router.get('/-/oauth/callback', (req, res, next) => {
      this.handleCallback(req as Request, res, auth).catch(next);
    });

    // npm web-authn contract: POST /-/v1/login -> { loginUrl, doneUrl }
    router.post('/-/v1/login', loginRateLimit, (req: Request, res) => {
      const sessionId = this.state.createCliSession();
      const base = baseUrl(this.options.config as Config, req);
      res.json({
        loginUrl: `${base}/-/web/login?next=${CLI_NEXT_PREFIX}${sessionId}`,
        doneUrl: `${base}/-/v1/done/${sessionId}`,
      });
    });

    // the login page posts credentials here; mirrors /-/v1/login_cli/:sessionId
    router.post('/-/v1/login_cli/:sessionId', loginRateLimit, (req: Request, res) => {
      this.handleCliPassword(req, res, auth).catch((err) => {
        this.logger.error({ err: err?.message }, 'cli login failed: @{err}');
        res.status(500).json({ error: 'login failed' });
      });
    });

    // the CLI polls here until the browser flow or the password post completes
    router.get('/-/v1/done/:sessionId', (req: Request, res) => {
      const sessionId = routeParam(req.params.sessionId);
      const session = sessionId ? this.state.consumeCliToken(sessionId) : undefined;
      if (!session) {
        res.status(400).json({ error: 'invalid or expired session' });
        return;
      }
      if (!session.token) {
        res.status(202).set('Retry-After', '5').json({});
        return;
      }
      res.json({ token: session.token });
    });

    // explicit approval gate between finishing OIDC and releasing the token
    router.post('/-/oauth/confirm/:confirmId', loginRateLimit, (req: Request, res) => {
      const confirmId = routeParam(req.params.confirmId);
      const confirm = confirmId ? this.state.consumePendingConfirm(confirmId) : undefined;
      if (!confirm || !this.state.completeCliSession(confirm.sessionId, confirm.token)) {
        res.status(400).send(errorPage('this confirmation link is invalid or expired'));
        return;
      }
      this.logger.info({ username: confirm.username }, 'oidc cli login approved for @{username}');
      res.send(cliDonePage());
    });

    router.get('/-/oauth/logout', (req: Request, res, next) => {
      this.getResolver()
        .resolve()
        .then((provider) => {
          const base = baseUrl(this.options.config as Config, req);
          if (provider.endSessionEndpoint) {
            const url = new URL(provider.endSessionEndpoint);
            url.searchParams.set('post_logout_redirect_uri', `${base}/`);
            res.redirect(url.toString());
          } else {
            res.redirect(`${base}/`);
          }
        })
        .catch(next);
    });

    app.use(router);
    this.logger.info(
      { name: 'verdaccio-oidc', pluginCategory: 'middleware' },
      'oidc endpoints mounted under /-/oauth'
    );
  }

  /**
   * Accept an OIDC Bearer token when the local check left the request
   * anonymous. The issuer pre-check keeps foreign JWTs from triggering JWKS
   * traffic. Returns the remote user so the error-middleware caller can
   * distinguish "not ours" from "invalid".
   */
  private async upgradeBearerToken(req: Request): Promise<RemoteUser | undefined> {
    const remoteUser = (req as any).remote_user as RemoteUser | undefined;
    if (remoteUser?.name) {
      return remoteUser;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.split('.').length !== 3) {
      return undefined;
    }
    let issuer: string | undefined;
    try {
      issuer = decodeJwt(token).iss;
    } catch {
      return undefined;
    }
    let provider;
    try {
      provider = await this.getResolver().resolve();
    } catch {
      return undefined;
    }
    if (issuer !== provider.issuer) {
      return undefined;
    }
    try {
      const claims = await this.getVerifier().verify(token, provider);
      const identity = extractIdentity(
        claims as Record<string, unknown>,
        this.oidcConfig(),
        this.logger
      );
      const user = createRemoteUser(identity.username, [identity.username, ...identity.groups]);
      (req as any).remote_user = user;
      debug('bearer token accepted for %o', identity.username);
      return user;
    } catch (err) {
      debug('oidc bearer rejected: %o', err);
      return undefined;
    }
  }

  private async handleAuthorize(req: Request, res: Response): Promise<void> {
    const nextParam = req.query.next;
    const next = isSafeNext(nextParam) ? nextParam : '/';
    const config = this.oidcConfig();
    const provider = await this.getResolver().resolve();
    const { state, nonce, codeVerifier } = this.state.createPendingAuth(next);

    const callbackUrl = `${baseUrl(this.options.config as Config, req)}/-/oauth/callback`;
    const url = new URL(provider.authorizationEndpoint);
    url.searchParams.set('client_id', config['client-id'] as string);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', config.scope ?? 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    debug('redirecting to idp %o', url.origin);
    res.redirect(url.toString());
  }

  private async handleCallback(req: Request, res: Response, auth: AuthLike): Promise<void> {
    const { code, state, error } = req.query;
    if (typeof error === 'string') {
      res.status(400).send(errorPage(`identity provider returned an error: ${error}`));
      return;
    }
    const pending = typeof state === 'string' ? this.state.consumePendingAuth(state) : undefined;
    if (!pending) {
      res.status(400).send(errorPage(STATE_TTL_HINT));
      return;
    }
    if (typeof code !== 'string' || code.length === 0) {
      res.status(400).send(errorPage('missing authorization code'));
      return;
    }

    const config = this.oidcConfig();
    const provider = await this.getResolver().resolve();
    const callbackUrl = `${baseUrl(this.options.config as Config, req)}/-/oauth/callback`;

    const tokens = await exchangeCode(provider, config, code, callbackUrl, pending.codeVerifier);
    if (!tokens.id_token) {
      res.status(502).send(errorPage('the provider did not return an id token'));
      return;
    }

    const claims = await this.getVerifier().verify(tokens.id_token, provider);
    if (claims.nonce !== pending.nonce) {
      this.logger.warn('oidc callback nonce mismatch');
      res.status(400).send(errorPage('nonce mismatch'));
      return;
    }

    let identity: OidcIdentity;
    try {
      identity = extractIdentity(claims as Record<string, unknown>, config, this.logger);
    } catch (err: any) {
      res.status(err?.status ?? 403).send(errorPage(err?.message ?? 'identity rejected'));
      return;
    }

    // userinfo fallback for providers that keep groups out of the id token
    if (
      identity.groups.length === 0 &&
      config['userinfo-for-groups'] !== false &&
      tokens.access_token
    ) {
      const userinfo = await fetchUserinfo(provider, tokens.access_token);
      if (Object.keys(userinfo).length > 0) {
        try {
          identity = extractIdentity({ ...userinfo, ...claims }, config, this.logger);
        } catch {
          // keep the id-token identity; groups just stay empty
        }
      }
    }

    const remoteUser = createRemoteUser(identity.username, [identity.username, ...identity.groups]);
    const cliSessionId = cliSessionFromNext(pending.next);

    if (cliSessionId) {
      if (!this.state.hasCliSession(cliSessionId)) {
        res.status(400).send(errorPage('the login session expired, run npm login again'));
        return;
      }
      const token = await getApiToken(
        auth,
        this.options.config as Config,
        remoteUser,
        tokens.id_token
      );
      if (typeof token !== 'string') {
        res.status(500).send(errorPage('could not issue a cli token'));
        return;
      }
      // the token only reaches npm after an explicit Allow click
      const confirmId = this.state.createPendingConfirm(cliSessionId, token, identity.username);
      res.send(cliConfirmPage(identity.username, `/-/oauth/confirm/${confirmId}`));
      return;
    }

    const webToken = await auth.jwtEncrypt(
      remoteUser,
      (this.options.config as Config).security.web.sign
    );
    this.logger.info({ username: identity.username }, 'oidc login for @{username}');
    res.send(handoffPage(identity.username, webToken, pending.next));
  }

  /** Password completion of a CLI session ; mirrors api/src/v1/login.ts. */
  private async handleCliPassword(req: Request, res: Response, auth: AuthLike): Promise<void> {
    const sessionId = routeParam(req.params.sessionId);
    if (!sessionId || !this.state.hasCliSession(sessionId)) {
      res.status(400).json({ error: 'invalid or expired session' });
      return;
    }
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }
    const groups = await new Promise<string[] | false | undefined>((resolve, reject) => {
      auth.authenticate(username, password, (err, g) => (err ? reject(err) : resolve(g)));
    });
    if (!groups) {
      res.status(401).json({ error: API_ERROR.BAD_USERNAME_PASSWORD });
      return;
    }
    const user = createRemoteUser(username, groups);
    const token = await getApiToken(auth, this.options.config as Config, user, password);
    if (typeof token !== 'string') {
      res.status(401).json({ error: 'could not issue a token' });
      return;
    }
    this.state.completeCliSession(sessionId, token);
    res.status(201).json({ token });
  }

  /** Test seam. */
  public _stop(): void {
    this.state.stop();
  }
}

export { OidcPlugin };
export type { OidcConfig, OidcMiddlewareConfig } from './types';
