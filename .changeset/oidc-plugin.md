---
'verdaccio-oidc': minor
'@verdaccio/ui-components': minor
'@verdaccio/ui-theme': minor
'@verdaccio/ui-i18n': minor
---

Add OpenID Connect single sign-on through a new bundled plugin, `verdaccio-oidc`.

Operators can point Verdaccio at any OIDC provider (Authentik, Keycloak, Entra ID, Auth0, Okta, ...) and users sign in with the provider instead of a local password. The plugin covers the full matrix:

- Browser login through the authorization code flow with PKCE, state and nonce validation. The web UI shows an SSO button on the login dialog and the `/-/web/login` page when the plugin is enabled; the button label is configurable.
- `npm login --auth-type=web`: the plugin serves the npm web-authn endpoints (`/-/v1/login`, `/-/v1/done/:sessionId`) and requires an explicit Allow click in the browser before the CLI receives the token.
- `npm login --auth-type=legacy`: an OIDC id or access token can be used in place of the password; it is verified against the provider JWKS and must match the requested username.
- API requests with an OIDC `Authorization: Bearer` token are verified against the provider JWKS, so CI systems can use provider-issued tokens directly.
- `/-/oauth/logout` redirects to the provider end-session endpoint when one is configured or discovered.

Provider endpoints are discovered from `<issuer>/.well-known/openid-configuration`; every endpoint can also be set manually for providers without discovery. Groups come from a configurable claim (dot paths such as `realm_access.roles` work, and the userinfo endpoint is queried as a fallback), are mapped to Verdaccio groups for use in `packages:` access rules, and `authorized-groups` can restrict login to specific groups.

To enable it, configure both sections:

```yaml
auth:
  oidc:
    issuer: https://accounts.example.com
    client-id: verdaccio
    client-secret: ...

middlewares:
  oidc:
    enabled: true
```

Multi-replica deployments need sticky sessions: pending authorization requests and CLI sessions are held in process memory for the duration of a login flow.
