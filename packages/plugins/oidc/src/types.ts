/**
 * Plugin configuration, under auth: oidc: (identity settings) and
 * middlewares: oidc: (enabled plus the optional button label).
 */
export interface OidcConfig {
  /**
   * The issuer URL. /.well-known/openid-configuration is appended for
   * discovery unless configuration-uri or the individual endpoints are set.
   */
  issuer?: string;
  /** Alias for issuer, kept for familiarity with existing OIDC plugins. */
  'provider-host'?: string;
  /** Explicit discovery document URL; skips issuer derivation. */
  'configuration-uri'?: string;
  'authorization-endpoint'?: string;
  'token-endpoint'?: string;
  'userinfo-endpoint'?: string;
  'jwks-uri'?: string;
  /** RP-initiated logout endpoint, used by /-/oauth/logout when present. */
  'end-session-endpoint'?: string;
  'client-id'?: string;
  'client-secret'?: string;
  /**
   * Accepted audience besides client-id, for access tokens issued to a
   * different resource server (e.g. keycloak's aud: account style tokens).
   */
  'token-audience'?: string;
  /** Authorization scope. @default 'openid profile email' */
  scope?: string;
  /** Claim used as the verdaccio username. @default 'preferred_username' */
  'username-claim'?: string;
  /** Claim (dot path allowed) carrying the user's groups. @default 'groups' */
  'groups-claim'?: string;
  /** When set, login is refused unless the user is in one of these groups. */
  'authorized-groups'?: string[];
  /** Also try the userinfo endpoint when the id token carries no groups claim. */
  'userinfo-for-groups'?: boolean;
  /** Label of the SSO button in the web UI. */
  'login-button-text'?: string;
}

/** middlewares: oidc: section ; routes only mount when enabled. */
export interface OidcMiddlewareConfig {
  enabled?: boolean;
}

/** The resolved provider endpoints after discovery/manual override. */
export interface OidcProvider {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri: string;
  endSessionEndpoint?: string;
}

/** Claims extracted from a verified token or userinfo response. */
export interface OidcIdentity {
  username: string;
  groups: string[];
  /** Raw claims, kept for debugging and future claim mapping. */
  claims: Record<string, unknown>;
}
