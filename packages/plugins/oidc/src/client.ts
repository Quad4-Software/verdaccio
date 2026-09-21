import buildDebug from 'debug';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyOptions, JWTPayload } from 'jose';

import { errorUtils, validationUtils } from '@verdaccio/core';
import type { Logger } from '@verdaccio/types';

import type { OidcConfig, OidcIdentity, OidcProvider } from './types';

const debug = buildDebug('verdaccio:plugin:oidc:client');

const TOKEN_EXCHANGE_TIMEOUT_MS = 15 * 1000;

export interface TokenSet {
  id_token?: string;
  access_token?: string;
  expires_in?: number;
}

/** Read a possibly nested claim (realm_access.roles-style dot paths work). */
export function claimValue(claims: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node !== null && typeof node === 'object') {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, claims);
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    // some providers (older keycloak, ldap mappers) emit a space- or
    // comma-joined string instead of a JSON array
    return value.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

/**
 * Map verified claims to a verdaccio identity.
 *
 * @throws a 400 when the username claim is missing or not URL-safe ; an
 *   arbitrary claim value would otherwise become an unusable package ACL name
 */
export function extractIdentity(
  claims: Record<string, unknown>,
  config: OidcConfig,
  logger: Logger
): OidcIdentity {
  const usernameClaim = config['username-claim'] ?? 'preferred_username';
  const groupsClaim = config['groups-claim'] ?? 'groups';

  const rawName = claimValue(claims, usernameClaim);
  const username =
    typeof rawName === 'string' && rawName.length > 0
      ? rawName
      : typeof claims['email'] === 'string'
        ? (claims['email'] as string)
        : typeof claims['sub'] === 'string'
          ? (claims['sub'] as string)
          : undefined;

  if (!username || validationUtils.validateName(username) === false) {
    logger.warn(
      { claim: usernameClaim },
      'oidc identity has no usable username claim @{claim} (missing or not url-safe)'
    );
    throw errorUtils.getBadRequest('identity has no usable username claim');
  }

  const authorized = config['authorized-groups'];
  const groups = asStringList(claimValue(claims, groupsClaim));
  if (Array.isArray(authorized) && authorized.length > 0) {
    const allowed = groups.some((group) => authorized.includes(group));
    if (!allowed) {
      logger.warn({ username }, 'oidc user @{username} is not in any authorized group');
      throw errorUtils.getForbidden('user is not a member of an authorized group');
    }
  }

  return { username, groups, claims };
}

/** Verify an OIDC JWT (id or access token) against the provider JWKS. */
export class OidcVerifier {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private jwksUri?: string;

  public constructor(private readonly config: OidcConfig) {}

  public async verify(token: string, provider: OidcProvider): Promise<JWTPayload> {
    let jwks = this.jwks;
    if (!jwks || this.jwksUri !== provider.jwksUri) {
      // createRemoteJWKSet already caches keys and refetches on unknown kid
      jwks = createRemoteJWKSet(new URL(provider.jwksUri));
      this.jwks = jwks;
      this.jwksUri = provider.jwksUri;
    }
    const options: JWTVerifyOptions = { issuer: provider.issuer };
    // id tokens always carry the client id; access tokens at providers like
    // keycloak carry the resource server, which 'token-audience' overrides
    const audience = [this.config['client-id'], this.config['token-audience']].filter(
      (value): value is string => typeof value === 'string'
    );
    if (audience.length > 0) {
      options.audience = audience;
    }
    const { payload } = await jwtVerify(token, jwks, options);
    return payload;
  }
}

/** Exchange an authorization code for tokens at the token endpoint. */
export async function exchangeCode(
  provider: OidcProvider,
  config: OidcConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config['client-id'] as string,
    code_verifier: codeVerifier,
  });
  if (config['client-secret']) {
    body.set('client_secret', config['client-secret']);
  }

  const res = await fetch(provider.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    debug('token exchange failed with %o: %o', res.status, await res.text().catch(() => ''));
    throw errorUtils.getUnauthorized('authorization code exchange failed');
  }
  return (await res.json()) as TokenSet;
}

/** Call the userinfo endpoint, used as a fallback source for the groups claim. */
export async function fetchUserinfo(
  provider: OidcProvider,
  accessToken: string
): Promise<Record<string, unknown>> {
  if (!provider.userinfoEndpoint) {
    return {};
  }
  const res = await fetch(provider.userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    debug('userinfo failed with %o', res.status);
    return {};
  }
  return (await res.json()) as Record<string, unknown>;
}
