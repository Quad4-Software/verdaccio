---
'@verdaccio/types': minor
'@verdaccio/core': minor
'@verdaccio/local-storage': minor
'@verdaccio/middleware': minor
'@verdaccio/store': minor
'@verdaccio/api': minor
'@verdaccio/web': minor
---

Close several npm registry parity gaps and add operational controls for private registries.

**Provenance attestations.** Publishing with `npm publish --provenance` sends a `.sigstore` attachment alongside the tarball; the registry now parses the Sigstore DSSE bundle, persists the attestation per version, and exposes it through `dist.attestations` in the packument and `GET /-/npm/v1/attestations/<pkg>@<version>`. Malformed bundles are rejected instead of stored.

**Registry signatures (`npm audit signatures`).** When `security.signatures.enabled: true` is set, the registry generates or loads a persistent ECDSA P-256 signing key, publishes the public key set at `GET /-/npm/v1/keys`, and stamps every publish with a `dist.signatures` entry carrying a `SHA256:` key id. Tarballs without an integrity value get a sha512 integrity computed at publish time so the signature has something to sign.

**Stars.** npm <=10 style star/unstar bodies on the packument PUT are accepted: a user may only flip their own `users` entry, and `GET /-/_view/starredByUser?key="name"` lists a user's starred packages, filtered by package visibility.

**Collaborators and npm access.** `GET/PUT/DELETE /-/package/:pkg/collaborators(/:user)` manage a per-package collaborator map with `read`/`write` levels; read collaborators gain `access`, write collaborators gain `publish`/`unpublish`, but a generated token's package scope is still authoritative and cannot be widened by a grant. `POST /-/package/:pkg/access` toggles `public`/`restricted` (mapped to the package visibility flag) and `publish_requires_tfa`/`automation_token_overrides_tfa` (npm access set mfa). `GET /-/user/:user/package` lists a user's packages for the caller themselves or an admin; `GET /-/org/:scope/package` lists a scope with private packages filtered out. Team routes answer 501.

**npm owner.** `npm owner add/rm/ls` works through the packument PUT `maintainers` path, with the existing owner check enforced.

**Download counts.** Tarball downloads are counted per package per UTC day in a sidecar stats database (best-effort: plugins without stats support and storage failures never break a download). `GET /-/npm/v1/downloads/point/:period(/:pkg)` and `/range/:range(/:pkg)` return npm-shaped aggregates; ranges over 366 days and malformed periods are rejected.

**Search scoring.** `/-/v1/search` now ranks results by npm-style quality/popularity/maintenance signals weighted by the `quality`, `popularity`, `maintenance` query params instead of a flat score. `size` is capped at 250, `from` at 10000, and the candidate set is bounded so oversized or crafted queries cannot exhaust the server.

**Publish-time scanning.** With `scan.enabled: true` the publish pipeline inspects the tarball and metadata before the version is committed: lifecycle scripts (`preinstall`, `postinstall`, ...) and other configured findings can warn or reject the publish. Rejected first publishes roll back the partially written package directory. Optional `scan.osv: true` queries OSV for known-vulnerable dependencies.

**Retention and storage quota.** `retention.enabled` with `max_versions`, `max_age_days`, `exclude` patterns, `keep_tagged`, `dry_run` and `interval_minutes` runs a periodic sweep that prunes old versions while always keeping the newest version and every dist-tag target; a hard per-sweep ceiling prevents a misconfiguration from wiping the registry. `retention.max_storage_mb` rejects publishes once the storage directory exceeds the quota with a 507. Admins can trigger a sweep on demand via `POST /-/verdaccio/admin/retention`.

**Prometheus metrics.** `GET /-/metrics` exposes request, publish, unpublish, tarball, download, package count, uptime and memory metrics in Prometheus text format when `metrics.enabled: true`; a dedicated `metrics.token` bearer secret (constant-time compared) gates the endpoint, mounted ahead of the registry JWT middleware since the token is not a Verdaccio credential.
