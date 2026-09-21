---
'@verdaccio/types': minor
'@verdaccio/core': minor
'@verdaccio/config': minor
'@verdaccio/auth': patch
'verdaccio-htpasswd': minor
'@verdaccio/middleware': minor
'@verdaccio/server': patch
'@verdaccio/web': minor
'@verdaccio/ui-components': minor
'@verdaccio/ui-theme': minor
'@verdaccio/ui-i18n': minor
---

Add an administration panel to the web UI and a matching admin REST API.

A user is an administrator when the auth plugin returns the `$admin` group for them or when they match the new `security.admins` configuration list (usernames or plugin groups):

```yaml
security:
  admins: alice bob
```

The bundled htpasswd plugin records the bootstrap admin and any grant/revoke in a `<htpasswd file>.admins` sidecar file and reports `$admin` on login. Other auth plugins keep working; user management endpoints answer 501 when the active plugin cannot manage users.

Admins get an Administration entry in the account menu leading to `/-/web/admin`, backed by endpoints under `/-/verdaccio/data/admin`:

- `GET /status` reports whether the caller is an admin and whether the auth plugin supports user management; it is the only admin endpoint readable without admin rights.
- `GET/POST /users`, `DELETE /users/:user`, `PUT /users/:user/password`, `PUT /users/:user/admin`, `DELETE /users/:user/tfa` cover listing, creating, deleting, password reset, admin grant/revoke, and two-factor reset.
- `GET /packages` and `PUT /packages/visibility/:package` list local packages and toggle their visibility flag.
- `GET /metrics` reports version, uptime, memory, local package and user counts, and a process-local request counter collected by a new middleware mounted in the server.
- `GET /audit` returns the most recent administrative actions.

Safety rules enforced server-side: all endpoints except `status` reject non-admins with 403, an admin cannot delete or revoke themselves, and the last remaining admin account cannot be deleted or demoted. The audit list is in-memory and bounded to the newest 500 entries; it is an operational convenience, not a durable compliance log, and resets on restart.

Two smaller fixes ride along: `TfaStore.disable` no longer throws when the user never enrolled, and the htpasswd plugin now drops deleted users from its in-memory cache instead of merging reloads over them.
