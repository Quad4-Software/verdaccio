---
'@verdaccio/core': patch
'@verdaccio/middleware': patch
'@verdaccio/server': patch
'@verdaccio/node-api': patch
'verdaccio-oidc': patch
---

Harden HTTP responses and surface insecure configuration at startup.

- The security headers middleware (X-Frame-Options, Content-Security-Policy, X-Content-Type-Options, X-XSS-Protection) now also sets `Referrer-Policy: strict-origin-when-cross-origin`, so full request URLs are not leaked to third-party origins, and it is mounted on every response, not only the web UI namespace. Packuments, tarballs and API errors served to browsers now get `nosniff` and frame protection too. Headers already set by an upstream proxy are still respected.
- Startup logs a warning when `security.api.legacy` token mode is in effect (the default), which keeps credentials inside every request token, and when `legacy` and `jwt` are both configured since jwt silently wins. No behaviour changes.
- The OIDC plugin rate-limits its token-bearing endpoints (`POST /-/v1/login`, `POST /-/v1/login_cli/:sessionId`, `POST /-/oauth/confirm/:id`) with the same `userRateLimit` the built-in login and token routes use.
