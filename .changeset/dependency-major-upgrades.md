---
'@verdaccio/ui-theme': minor
'@verdaccio/ui-components': minor
'@verdaccio/web': minor
'@verdaccio/cli': minor
'@verdaccio/admin-cli': minor
'@verdaccio/hooks': minor
'@verdaccio/proxy': minor
'verdaccio-audit': minor
'@verdaccio/local-storage': minor
'@verdaccio/search-indexer': minor
---

Upgrade several dependencies across major versions: MUI 9, i18next 26 and react-i18next 17 in the web UI, got 16 in the uplink/notification HTTP clients, globby 16 for storage file listing, Orama 3 for the in-memory search index, chalk 6 in the CLIs, and Vitest 5, Cypress 16, jsdom 30 and msw-storybook-addon 3 for the development toolchain.

Operator-visible changes are limited to upstream behavior changes:

- got 16 now strips credentials when a tarball or request redirect crosses origins or otherwise changes the request origin. That is a security improvement for CDN redirects, but an unusual uplink setup that intentionally forwards credentials across origins may need review.
- Orama 3 tokenizes hyphenated package names differently, so the web UI search can now match packages such as `verdaccio-search` when querying `verdaccio`.
- i18next 26 no longer accepts the removed `showSupportNotice` and `whitelist` options; bundled configuration was updated and custom setups embedding the UI should use `supportedLngs`.
- Storybook now uses the msw-storybook-addon 3 loader API.

The development toolchain upgrades also change the local requirements: Vitest 5 requires Node.js 22.12.0 or newer and jsdom 30 requires Node.js 24.15.0 or newer, so contributors should run the latest Node.js 24 or 26 release. `@types/node` is pinned to the 24.x line to match the supported Node.js floor.
