---
'verdaccio-htpasswd': patch
'@verdaccio/ui-components': patch
'@verdaccio/api': patch
---

Fix a `__proto__` username becoming unreadable after being written to the htpasswd file. `addUserToHTPasswd` accepts `__proto__` because it is URI-safe, but `parseHTPasswd` assigned keys through the prototype setter, so the line was silently dropped and `users['__proto__']` returned `Object.prototype` instead of the stored hash. Entries are now defined as own properties, so the prototype is not modified and every parsed line round-trips.

Restore a logo next to the version marker in the footer. The branding pass removed the footer chrome entirely; the version marker now shows the configured logo beside it, without the external link.

Fix tarball downloads going uncounted when the client disconnects right after the last byte. The route aborted the stream pipeline on socket close before the source 'end' event could fire, so the download counter never ran. A fully delivered body now counts on close, while mid-transfer disconnects still abort uncounted.
