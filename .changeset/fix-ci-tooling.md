---
'verdaccio-htpasswd': patch
---

Fix a `__proto__` username becoming unreadable after being written to the htpasswd file. `addUserToHTPasswd` accepts `__proto__` because it is URI-safe, but `parseHTPasswd` assigned keys through the prototype setter, so the line was silently dropped and `users['__proto__']` returned `Object.prototype` instead of the stored hash. Entries are now defined as own properties, so the prototype is not modified and every parsed line round-trips.
