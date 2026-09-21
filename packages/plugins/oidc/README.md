# verdaccio-oidc - OpenID Connect authentication plugin for Verdaccio

[![Verdaccio Home](https://img.shields.io/badge/Homepage-Verdaccio-405236?style=flat)](https://verdaccio.org)
[![MIT License](https://img.shields.io/github/license/verdaccio/verdaccio?label=License&color=405236)](https://github.com/verdaccio/verdaccio/blob/master/LICENSE)

OpenID Connect login for the Verdaccio web UI and the npm CLI. The plugin
implements the authorization code flow with PKCE, provider discovery, JWKS
token verification and group claim mapping, and it can also verify OIDC bearer
tokens directly on API requests.

## Installation

The plugin is bundled with Verdaccio. Enable it under both `auth` and
`middlewares`:

```yaml
auth:
  oidc:
    issuer: https://accounts.example.com
    client-id: verdaccio
    client-secret: optional-for-public-clients
    # groups-claim: groups
    # username-claim: preferred_username
    # authorized-groups: [engineering]
    # token-audience: api://verdaccio
    # scope: openid profile email
    # login-button-text: Login with SSO

middlewares:
  oidc:
    enabled: true
```

The `auth` section configures identity and token verification. The
`middlewares` section mounts the browser routes under `/-/oauth/*` and the npm
web-authn endpoints (`/-/v1/login`, `/-/v1/done/:sessionId`).

## Endpoints

The provider endpoints are normally discovered from
`<issuer>/.well-known/openid-configuration`. Every endpoint can also be set
manually, which is required for providers without discovery:

```yaml
auth:
  oidc:
    client-id: verdaccio
    authorization-endpoint: https://idp.example.com/oauth2/auth
    token-endpoint: https://idp.example.com/oauth2/token
    jwks-uri: https://idp.example.com/jwks.json
    # issuer defaults to the jwks-uri origin when unset
    # userinfo-endpoint: https://idp.example.com/userinfo
    # end-session-endpoint: https://idp.example.com/logout
```

Manual values always win over discovered ones. Non-HTTPS issuers log a
warning; keep them for local development only.

## Configuration reference

| key                      | default                | description                                          |
| ------------------------ | ---------------------- | ---------------------------------------------------- |
| `issuer`                 |                        | issuer URL, used for discovery and the `iss` check   |
| `provider-host`          |                        | alias for `issuer`                                   |
| `configuration-uri`      |                        | explicit discovery document URL                      |
| `authorization-endpoint` | discovered             | authorization endpoint                               |
| `token-endpoint`         | discovered             | token endpoint                                       |
| `userinfo-endpoint`      | discovered             | userinfo endpoint, used for the group fallback       |
| `jwks-uri`               | discovered             | JWKS document for signature verification             |
| `end-session-endpoint`   | discovered             | RP-initiated logout target of `/-/oauth/logout`      |
| `client-id`              |                        | OAuth client id, also the expected token audience    |
| `client-secret`          |                        | optional client secret for the token exchange        |
| `token-audience`         |                        | extra accepted `aud` besides `client-id`             |
| `scope`                  | `openid profile email` | requested scope                                      |
| `username-claim`         | `preferred_username`   | claim used as the Verdaccio username                 |
| `groups-claim`           | `groups`               | claim (dot paths allowed) mapped to Verdaccio groups |
| `authorized-groups`      |                        | when set, login requires membership in one of them   |
| `userinfo-for-groups`    | `true`                 | query userinfo when the id token has no groups       |
| `login-button-text`      | `Login with SSO`       | label of the SSO button in the web UI                |

## Flows

- Web UI: the login dialog shows an SSO button once `/-/oauth/config` reports
  the plugin enabled. After the provider round trip the callback mints a web
  token and hands it to the browser session.
- `npm login --auth-type=web`: the plugin answers `/-/v1/login` with a login
  URL and a polling URL. After the provider round trip the browser shows an
  explicit approval page before the CLI receives the token.
- `npm login --auth-type=legacy` and basic auth: an OIDC token can be used in
  place of the password. The token is verified against the provider JWKS and
  must carry the username in `username-claim`.
- Bearer tokens: API requests with an OIDC access token in the
  `Authorization: Bearer` header are verified against the provider JWKS.
- Logout: `/-/oauth/logout` redirects to the provider's end session endpoint
  when one is configured or discovered.

## Groups and permissions

Claims from the `groups-claim` become Verdaccio groups, so package access
rules can target them:

```yaml
packages:
  '@internal/*':
    access: $all
    publish: engineering
```

The username itself is also added as a group, so `publish: alice` restricts
publishing to that user.

## Deployment notes

Pending authorization requests and CLI sessions live in process memory. A
deployment with several replicas needs sticky sessions for the few minutes a
login flow spans, or the callback may land on a replica that never saw the
authorize request.
