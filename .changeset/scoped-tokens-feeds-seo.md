---
'@verdaccio/api': minor
'@verdaccio/auth': minor
'@verdaccio/config': minor
'@verdaccio/core': minor
'@verdaccio/middleware': minor
'@verdaccio/types': minor
'@verdaccio/web': minor
---

Add package-scoped access tokens, npm-compatible trusted publishing, RSS feeds, and dynamic page metadata.

`npm token create` now accepts `packages` and `scopes` options that restrict a token to matching package names (minimatch syntax, `@scope/*` entries generated from `scopes`), plus `packages_and_scopes_permission: "read"` to force read-only behavior. Scoping is enforced in the auth layer for reads, publishes, unpublishes, and stages, so auth plugins cannot widen it, and it composes with the existing `cidr` IP pinning and `readonly` flags.

Adds `POST /-/npm/v1/oidc/token/exchange/package/:package`, the endpoint the npm CLI calls for trusted publishing. A CI OIDC token (GitHub Actions `id-token` or GitLab `NPM_ID_TOKEN`) is verified against the issuer's JWKS and the publisher configuration under `security.trustedPublishing`, then exchanged for a short-lived registry token scoped to the package.

The web UI now emits meta description, Open Graph, Twitter card, canonical, and JSON-LD (`SoftwarePackage`) tags, with package-specific values on `/-/web/detail/<name>` pages for crawlers and link previews. RSS feeds are served at `/-/verdaccio/data/feed` for recent package updates and `/-/verdaccio/data/feed/<package>` for per-package release history; both honor package access and private-visibility rules.

Security: all interpolated template values are HTML-escaped, the `ui-options.js` payload escapes `<` so config values cannot break out of the script element, and generated tokens created through the web flow are no longer confused by a case-sensitive Bearer scheme check.
