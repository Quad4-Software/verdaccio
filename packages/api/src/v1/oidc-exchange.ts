import buildDebug from 'debug';
import type { Response, Router } from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import type { JWTVerifyOptions, JWTPayload } from 'jose';

import type { Auth } from '@verdaccio/auth';
import { isAESLegacy } from '@verdaccio/auth';
import { createRemoteUser } from '@verdaccio/config';
import {
  API_ERROR,
  HEADERS,
  HTTP_STATUS,
  TOKEN_BEARER,
  authUtils,
  cryptoUtils,
  errorUtils,
  validationUtils,
} from '@verdaccio/core';
import { rateLimit } from '@verdaccio/middleware';
import type { Storage } from '@verdaccio/store';
import type { Config, JWTSignOptions, Logger, TrustedPublisher } from '@verdaccio/types';

import type { $NextFunctionVer, $RequestExtend } from '../../types/custom';

const debug = buildDebug('verdaccio:api:oidc-exchange');

export const OIDC_EXCHANGE_ENDPOINT = '/-/npm/v1/oidc/token/exchange/package/{*packagePath}';

const DEFAULT_EXCHANGE_TTL = '15m';

// default JWKS locations per provider; an entry can override both issuer and
// jwksUri for self-hosted instances
const PROVIDER_DEFAULTS: Record<string, { issuer: string; jwks: (iss: string) => string }> = {
  github: {
    issuer: 'https://token.actions.githubusercontent.com',
    jwks: (iss) => `${iss}/.well-known/jwks`,
  },
  gitlab: {
    issuer: 'https://gitlab.com',
    jwks: (iss) => `${iss}/oauth/discovery/keys`,
  },
};

// jose's remote set caches and rotates keys by kid on its own
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, set);
  }
  return set;
}

function bearerToken(req: $RequestExtend): string | undefined {
  const header = req.get(HEADERS.AUTHORIZATION);
  if (typeof header !== 'string') {
    return;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toUpperCase() !== TOKEN_BEARER.toUpperCase() || !token) {
    return;
  }
  return token;
}

/**
 * The npm CLI mints the CI token with audience `npm:{registry host}`. The
 * host must come from the configured public URL — `req.hostname` reads the
 * Host header, which the client controls; falling back to it would let a
 * token minted for any audience exchange here, so we fail closed instead.
 */
function expectedAudience(
  req: $RequestExtend,
  entry: TrustedPublisher,
  config: Config
): string | undefined {
  if (entry.audience) {
    return entry.audience;
  }
  const configured = process.env.VERDACCIO_PUBLIC_URL ?? config.url_prefix;
  if (typeof configured === 'string') {
    try {
      const host = new URL(configured).hostname;
      if (host !== '') {
        return `npm:${host}`;
      }
    } catch {
      debug('could not derive audience from configured public url %o', configured);
    }
  }
  return undefined;
}

function issuerOf(entry: TrustedPublisher): string {
  return entry.issuer ?? PROVIDER_DEFAULTS[entry.provider]?.issuer ?? '';
}

function isLoopbackUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Fail closed on malformed trusted-publisher entries: an entry without
 * packages/repository/user, an unknown provider without an explicit issuer,
 * or a plain-http endpoint outside localhost dev is skipped with a warning
 * instead of silently broadening what tokens are accepted.
 */
function validPublishers(publishers: TrustedPublisher[], logger: Logger): TrustedPublisher[] {
  return publishers.filter((entry) => {
    const issuer = issuerOf(entry);
    const jwksUri = entry.jwksUri ?? PROVIDER_DEFAULTS[entry.provider]?.jwks(issuer);
    const problems = [
      !Array.isArray(entry.packages) || entry.packages.length === 0,
      typeof entry.repository !== 'string' || entry.repository === '',
      typeof entry.user !== 'string' || entry.user === '',
      issuer === '' || typeof jwksUri !== 'string',
      (issuer.startsWith('http://') || (jwksUri ?? '').startsWith('http://')) &&
        !isLoopbackUrl(issuer) &&
        !isLoopbackUrl(jwksUri ?? ''),
    ];
    if (problems.some(Boolean)) {
      logger.warn(
        { repository: entry.repository, provider: entry.provider },
        'trusted publishing entry for @{repository} is malformed or insecure, skipped'
      );
      return false;
    }
    return true;
  });
}

// github: `owner/repo/.github/workflows/file.yml@ref`, matched on the file name
function githubWorkflowFile(payload: JWTPayload): string | undefined {
  const ref = (payload.job_workflow_ref ?? payload.workflow_ref) as string | undefined;
  const match = typeof ref === 'string' ? ref.match(/\.github\/workflows\/([^@/]+)/) : null;
  return match?.[1];
}

// gitlab: `gitlab.com/{project}//{ci-file}@{ref}`
function gitlabCiFile(payload: JWTPayload): string | undefined {
  const ref = payload.ci_config_ref_uri as string | undefined;
  const match = typeof ref === 'string' ? ref.match(/\/\/([^@]+)@/) : null;
  return match?.[1];
}

function claimsMatch(payload: JWTPayload, entry: TrustedPublisher, packageName: string): boolean {
  const repository = (payload.repository ?? payload.project_path) as string | undefined;
  if (
    typeof repository !== 'string' ||
    repository.toLowerCase() !== entry.repository.toLowerCase()
  ) {
    return false;
  }
  const ciFile = entry.provider === 'github' ? githubWorkflowFile(payload) : gitlabCiFile(payload);
  if (entry.workflow && ciFile !== entry.workflow) {
    return false;
  }
  if (entry.environment && payload.environment !== entry.environment) {
    return false;
  }
  return authUtils.matchPackagePatterns(packageName, entry.packages);
}

function candidatesFor(iss: string, publishers: TrustedPublisher[]): TrustedPublisher[] {
  return publishers.filter((entry) => issuerOf(entry) === iss);
}

export default function (
  route: Router,
  auth: Auth,
  storage: Storage,
  config: Config,
  logger: Logger
): void {
  const publishers = validPublishers(config?.security?.trustedPublishing ?? [], logger);
  if (publishers.length === 0) {
    return;
  }

  route.post(
    OIDC_EXCHANGE_ENDPOINT,
    rateLimit(config?.userRateLimit),
    async function (req: $RequestExtend, res: Response, next: $NextFunctionVer) {
      const fail = (status: number, message: string) => {
        res.status(status).json({ message });
      };

      // npm sends the escaped scoped name (@scope%2Fname) as one segment and a
      // raw /{scope}/{name} works too: join the wildcard segments back
      const segments = req.params.packagePath;
      const packageName = (Array.isArray(segments) ? segments.join('/') : segments) ?? '';
      if (!validationUtils.validatePackage(packageName)) {
        return fail(HTTP_STATUS.BAD_DATA, API_ERROR.BAD_PACKAGE_DATA);
      }

      const idToken = bearerToken(req);
      if (!idToken) {
        return fail(HTTP_STATUS.UNAUTHORIZED, 'missing OIDC bearer token');
      }

      let payload: JWTPayload;
      try {
        payload = decodeJwt(idToken);
      } catch {
        return fail(HTTP_STATUS.UNAUTHORIZED, 'malformed OIDC token');
      }
      const iss = payload.iss;
      const candidates = typeof iss === 'string' ? candidatesFor(iss, publishers) : [];
      if (candidates.length === 0) {
        debug('no trusted publisher configured for issuer %o', iss);
        return fail(HTTP_STATUS.UNAUTHORIZED, 'untrusted OIDC issuer');
      }

      let verified: JWTPayload | undefined;
      let matched: TrustedPublisher | undefined;
      for (const entry of candidates) {
        const issuer = issuerOf(entry);
        const jwksUri = entry.jwksUri ?? PROVIDER_DEFAULTS[entry.provider]?.jwks(issuer);
        const audience = expectedAudience(req, entry, config);
        if (!jwksUri || !audience) {
          continue;
        }
        const options: JWTVerifyOptions = {
          issuer,
          audience,
        };
        try {
          const { payload: claims } = await jwtVerify(idToken, jwksFor(jwksUri), options);
          if (claimsMatch(claims, entry, packageName)) {
            verified = claims;
            matched = entry;
            break;
          }
        } catch (error: any) {
          debug('OIDC verification failed for issuer %o: %o', issuer, error?.message);
        }
      }

      if (!verified || !matched) {
        return fail(HTTP_STATUS.FORBIDDEN, 'OIDC token does not match a trusted publisher');
      }

      if (isAESLegacy(config.security)) {
        return fail(HTTP_STATUS.NOT_IMPLEMENTED, 'trusted publishing requires security.api.jwt');
      }
      if (typeof storage.saveToken !== 'function') {
        return fail(
          HTTP_STATUS.NOT_IMPLEMENTED,
          'trusted publishing requires a storage plugin with token support'
        );
      }

      try {
        const key = cryptoUtils.generateRandomHexString(16);
        // `otpExempt` keeps a TFA-enabled publisher account usable from CI: the
        // OIDC identity is the second factor, and the claim travels inside the
        // signed payload so a client cannot add it itself
        const remoteUser = {
          ...createRemoteUser(matched.user, [matched.user]),
          token: { key, otpExempt: true },
        };
        const sign: JWTSignOptions = {
          ...config.security.api.jwt?.sign,
          expiresIn: (matched.expiresIn ?? DEFAULT_EXCHANGE_TTL) as JWTSignOptions['expiresIn'],
        };
        const token = await auth.jwtEncrypt(remoteUser, sign);
        if (!token) {
          return fail(HTTP_STATUS.INTERNAL_ERROR, 'token exchange failed');
        }

        await storage.saveToken({
          user: matched.user,
          token: cryptoUtils.mask(token, 5),
          key,
          cidr: [],
          readonly: false,
          // the exchanged token is confined to the requested package even when
          // the publisher entry covers wider patterns
          packages: [packageName],
          created: new Date().getTime(),
        });

        logger.info(
          { packageName, repository: matched.repository, user: matched.user },
          'OIDC token exchanged for @{packageName} by @{repository} as @{user}'
        );
        res.set(HEADERS.CACHE_CONTROL, HEADERS.NO_CACHE);
        return res.status(HTTP_STATUS.OK).json({ token });
      } catch (error: any) {
        logger.error({ error: error?.message }, 'OIDC token exchange failed: @{error}');
        return next(errorUtils.getInternalError(error?.message));
      }
    }
  );
}
