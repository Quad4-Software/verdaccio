import buildDebug from 'debug';

import { errorUtils } from '@verdaccio/core';
import type { Logger } from '@verdaccio/types';

import type { OidcConfig, OidcProvider } from './types';

const debug = buildDebug('verdaccio:plugin:oidc:discovery');

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10 * 1000;
const WELL_KNOWN = '/.well-known/openid-configuration';

interface DiscoveryDocument {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  end_session_endpoint?: string;
}

/**
 * Resolve the provider endpoints from the plugin configuration.
 *
 * Discovery runs once and the document is cached; individual endpoint keys
 * always win over discovered values so providers with broken discovery can
 * still be wired by hand.
 */
export class ProviderResolver {
  private cached?: { provider: OidcProvider; expiresAt: number };
  private inflight?: Promise<OidcProvider>;

  public constructor(
    private readonly config: OidcConfig,
    private readonly logger: Logger
  ) {}

  public async resolve(): Promise<OidcProvider> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.provider;
    }
    // concurrent resolutions share one fetch
    this.inflight ??= this.fetchProvider()
      .then((provider) => {
        this.cached = { provider, expiresAt: Date.now() + DISCOVERY_TTL_MS };
        return provider;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  private async fetchProvider(): Promise<OidcProvider> {
    const doc = await this.fetchDiscoveryDocument();
    const issuer =
      this.config.issuer ?? this.config['provider-host'] ?? doc?.issuer ?? this.issuerFromJwks();
    const provider: OidcProvider = {
      issuer,
      authorizationEndpoint: this.config['authorization-endpoint'] ?? doc?.authorization_endpoint,
      tokenEndpoint: this.config['token-endpoint'] ?? doc?.token_endpoint,
      userinfoEndpoint: this.config['userinfo-endpoint'] ?? doc?.userinfo_endpoint,
      jwksUri: this.config['jwks-uri'] ?? doc?.jwks_uri,
      endSessionEndpoint: this.config['end-session-endpoint'] ?? doc?.end_session_endpoint,
    } as OidcProvider;

    const missing = (
      ['issuer', 'authorizationEndpoint', 'tokenEndpoint', 'jwksUri'] as const
    ).filter((key) => typeof provider[key] !== 'string' || provider[key] === '');
    if (missing.length > 0) {
      throw errorUtils.getInternalError(
        `oidc provider is missing ${missing.join(', ')}; set the endpoints or the issuer`
      );
    }
    if (URL.canParse(provider.issuer) && new URL(provider.issuer).protocol !== 'https:') {
      this.logger.warn(
        { issuer: provider.issuer },
        'oidc issuer @{issuer} is not https; only do this for local development'
      );
    }
    debug('resolved provider %o', provider);
    return provider;
  }

  private async fetchDiscoveryDocument(): Promise<DiscoveryDocument | undefined> {
    const uri =
      this.config['configuration-uri'] ??
      (this.config.issuer || this.config['provider-host']
        ? `${(this.config.issuer ?? this.config['provider-host'])!.replace(/\/+$/, '')}${WELL_KNOWN}`
        : undefined);
    if (!uri) {
      return undefined;
    }
    debug('fetching discovery document %o', uri);
    const res = await fetch(uri, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
    if (!res.ok) {
      throw errorUtils.getInternalError(`oidc discovery failed with status ${res.status}`);
    }
    return (await res.json()) as DiscoveryDocument;
  }

  private issuerFromJwks(): string {
    const jwksUri = this.config['jwks-uri'];
    if (jwksUri && URL.canParse(jwksUri)) {
      return new URL(jwksUri).origin;
    }
    throw errorUtils.getInternalError('oidc requires an issuer, provider-host or jwks-uri');
  }
}
