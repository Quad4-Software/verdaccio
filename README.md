# Verdaccio

Quad4 fork of [Verdaccio](https://verdaccio.org). Private npm registry with a dark UI and the Quad4 mark.

Upstream docs: https://verdaccio.org/docs

Requires Node.js 24 or newer.

## Run

```bash
pnpm install
pnpm build
node packages/verdaccio/bin/verdaccio
```

UI: http://127.0.0.1:4873

```bash
npm set registry http://127.0.0.1:4873
```

## Defaults

Shipped config (`packages/config/src/conf/default.yaml` and `docker.yaml`):

- Dark UI, title `Registry`, gravatar off
- Signup off (`max_users: -1`). The first admin is created in the web UI
- Passwords hashed with argon2id
- Anonymous read, authenticated publish
- Dotfile paths denied
- Auth headers and cookies redacted in logs

On first start, if there is no admin account, the server log prints a one-time link. It expires after 15 minutes. Open it and set the admin username and password. Set `VERDACCIO_PUBLIC_URL` to the public origin with no port and no trailing slash so the logged link is absolute.

If that link expires and there is still no admin account, generate another one:

```bash
verdaccio setup-link
```

The running server picks up the new link without a restart.

## Administration

Admins see an Administration entry in the account menu (`/-/web/admin`): registry metrics, user management (create, delete, reset password, reset 2FA, grant or revoke admin), package visibility toggles, and the recent admin action log.

A user is an admin when the auth plugin returns the `$admin` group for them or when they match `security.admins` in the config:

```yaml
security:
  admins: alice bob
```

Group names from the auth plugin work too. User management needs an auth plugin that exposes it; the bundled htpasswd plugin does and stores the admin list in `<htpasswd file>.admins`. The action log is held in memory and resets on restart.

## Authentication

- TOTP two-factor auth. Users enroll under `/-/web/two-factor`; the setup page shows a QR code for authenticator apps.
- OIDC single sign-on via the bundled `verdaccio-oidc` plugin. Browser login, npm CLI web auth, bearer tokens, PKCE, JWKS verification, and group mapping are supported. See `packages/plugins/oidc`.
- Scoped tokens. `npm token create` accepts `packages` and `scopes` (minimatch patterns, converted to `@scope/*`), plus `cidr` IP or range pinning and `readonly`. Enforced in the auth layer, so plugins cannot widen a token's scope.
- Trusted publishing. `POST /-/npm/v1/oidc/token/exchange/package/:package` exchanges a CI OIDC token (GitHub Actions `id-token`, GitLab `NPM_ID_TOKEN`) for a short-lived publish token. Configure publishers under `security.trustedPublishing` in the config.

## Feeds

RSS feeds are served at `/-/verdaccio/data/feed` (recent package updates) and `/-/verdaccio/data/feed/<package>` (per-package release history). Feeds respect package access rules and private visibility.

## Supply chain

The container image is published to `ghcr.io` on tags and `master` pushes (`latest` on release tags, `nightly-master` on master), with SBOM, provenance attestations, and keyless cosign signatures:

```bash
cosign verify ghcr.io/<org>/<repo>:latest \
  --certificate-identity-regexp "https://github.com/<org>/<repo>" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Releases attach a CycloneDX SBOM and `openvex.json`.

For scanning packages and the image itself, these free tools cover the surface:

| Tool                         | Covers                                 |
| ---------------------------- | -------------------------------------- |
| `trivy fs .` / `trivy image` | deps, image CVEs, secrets, misconfig   |
| `grype` + `syft`             | image/filesystem CVEs, SBOM generation |
| `osv-scanner`                | dependency vulnerabilities via OSV     |
| `pnpm audit` / `npm audit`   | dependency advisories                  |
| `gitleaks`                   | secrets in the repo                    |
| `semgrep` (community)        | source-level SAST                      |

`pnpm audit` and OpenSSF Scorecard, CodeQL, and zizmor already run in CI under `.github/workflows`.
