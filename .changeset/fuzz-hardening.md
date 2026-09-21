---
'@verdaccio/api': patch
'@verdaccio/core': patch
'@verdaccio/local-storage': patch
'@verdaccio/web': patch
'verdaccio-htpasswd': patch
---

Fix several request-handling crashes found by new fuzz and adversarial test suites.

- Requests with a `null` or otherwise non-object JSON body no longer crash the adduser, web login, signup, profile and token endpoints with a 500. The handlers now treat a missing body as empty and answer a 4xx client error instead.
- Package names longer than 214 characters are rejected by name validation, matching the npm registry limit, and filesystem errors such as `ENAMETOOLONG` that a name can still trigger are mapped to a 404 instead of an internal error.
- `isUserInGroups` no longer throws when a remote user carries no `groups` array.
- The htpasswd plugin no longer resolves `__proto__` and similar names to `Object.prototype` members when checking whether an account exists or verifying its password. Previously an `adduser` request for such a name could leave the request hanging.

The repository now runs property-based fuzz tests (`fast-check`) over package-name validation, config normalization, token helpers and the htpasswd utilities, an adversarial HTTP suite asserting hostile inputs never produce a 5xx, and metamorphic publish tests asserting packument invariants hold across publish, unpublish and dist-tag operations.
