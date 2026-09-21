---
'@verdaccio/types': minor
'@verdaccio/core': minor
'@verdaccio/config': minor
'@verdaccio/auth': minor
'@verdaccio/store': minor
'@verdaccio/middleware': minor
'@verdaccio/api': minor
'@verdaccio/web': minor
'@verdaccio/ui-components': minor
'@verdaccio/ui-theme': minor
'@verdaccio/ui-i18n': minor
---

Add package visibility controls so operators and publishers can hide packages from users who should not see them.

Two independent mechanisms are provided.

A `visibility` key on `packages:` rules takes a group list with the same syntax as `access`/`publish` (`$all`, `$authenticated`, `$anonymous`, usernames and plugin groups). When set, users outside the list get a 404 on every read of a matching package (metadata, versions, tarballs, dist-tags) and the package is dropped from the web package list and search results, so its existence is not leaked:

```yaml
packages:
  'internal-*':
    access: $authenticated
    publish: team-internal
    visibility: team-internal
```

A packument-level `visibility` flag can be toggled per package through the web API or the new Visibility section in the web UI package sidebar. Setting a package to `private` hides it from everyone except users allowed to publish it; `public` clears the flag. The endpoint is `PUT /-/verdaccio/data/package/visibility/:package` (or `/package/visibility/:scope/:package`), requires publish permission on the package, accepts only `public`/`private`, and returns 404 for packages that only exist on uplinks since the flag is stored in the local manifest.

No migration is needed: packages without either setting behave exactly as before.
