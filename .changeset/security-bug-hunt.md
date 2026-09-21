---
'@verdaccio/api': patch
'@verdaccio/auth': patch
'@verdaccio/core': patch
'@verdaccio/tarball': patch
'@verdaccio/middleware': patch
'@verdaccio/local-storage': patch
'@verdaccio/store': patch
'@verdaccio/web': patch
'@verdaccio/ui-theme': patch
'@verdaccio/ui-components': patch
---

Fix a batch of authorization, authentication and data-integrity bugs found in a deep review of the new registry surface, plus harden several failure paths.

**Two-factor authentication.** Users with TOTP enabled were able to log in with password alone through the web login and the browser-assisted CLI login flows; both now challenge for a one-time code (the web form gained an OTP field), and a publisher without any TFA enrolment gets a clear error instead of an unsatisfiable challenge. `publish_requires_tfa` now also covers unpublish and dist-tag writes, the package access toggle itself requires a second factor, and a second middleware in the same request no longer consumes the code twice. Pure `npm star` bodies are not challenged.

**Package mutation authorization.** Packument PUT bodies that only carry `maintainers` (npm owner add/rm) or `dist-tags` now require an owner just like version removal, instead of being open to any authenticated publisher. Bodies with a malformed `users` field are rejected rather than wiping the star map, and deprecate bodies can no longer mutate other users' star entries.

**Generated token enforcement.** Web JWT sessions previously dropped the embedded token key, so `/-/verdaccio/*` requests skipped revocation, CIDR, read-only and package-scope checks; the claim is preserved and enforcement is mounted on the web API.

**OIDC trusted publishing.** The expected token audience no longer falls back to the request's Host header; it must come from the entry's `audience`, `VERDACCIO_PUBLIC_URL` or `url_prefix`, and verification fails closed when none is configured.

**Publish integrity.** `dist.integrity` is recomputed from the uploaded tarball bytes instead of trusting the publisher's claim, provenance bundles must be structurally valid DSSE with a subject matching the package name, version and actual tarball digest, and publisher-supplied `signatures`/`attestations`/`scan` fields are stripped before registry-generated values are written.

**Publish scanning.** The scanner inspects the real `package.json` inside the uploaded tarball rather than trusting publish-body metadata, stream and gzip errors are propagated instead of hanging, entry and response sizes are bounded, and truncation past the entry limit is reported as a finding.

**Access control.** `/-/org/:scope/package` and `/-/user/:user/package` no longer leak package existence to callers without access, collaborator fallbacks only apply to genuine authorization denials (plugin errors no longer masquerade as grants), and `/-/v1/search` honors collaborator read access while still enforcing token package scope.

**Download counts.** Counting moved to the tarball stream's completion so aborted clients and failed upstream fetches no longer inflate stats, and counters are deleted when a package is fully removed. Stats maps are prototype-safe and a corrupt stats file resets instead of permanently erroring the endpoints.

**Storage.** A lock-file bug in the local storage plugin masked the real error as `resource temporarily unavailable` when an update callback threw; the original error now propagates after unlocking.

**Misc.** `passwordValidationRegex` now tolerates JS-literal `/pattern/flags` strings written in YAML (previously the delimiters became literal characters and no password could match), `web.showVersion: false` hides the version from the footer, `/-/metrics` requires `metrics.enabled: true` instead of serving unauthenticated when unconfigured, the metrics bearer comparison is byte-length safe, retention retargets `latest` to the newest surviving version instead of leaving it dangling, and merged search results keep local scores when a remote item shadows a local package.
