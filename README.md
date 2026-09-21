# Verdaccio

Quad4 fork of [Verdaccio](https://verdaccio.org). Private npm registry with a dark UI and the Quad4 mark.

Upstream docs: https://verdaccio.org/docs

Requires Node.js 24 or newer.

## Run

```bash
pnpm install
pnpm build
node packages/verdaccio/bin/verdaccio
```

UI: http://127.0.0.1:4873

```bash
npm set registry http://127.0.0.1:4873
```

## Defaults

Shipped config (`packages/config/src/conf/default.yaml` and `docker.yaml`):

- Dark UI, title `Registry`, gravatar off
- Signup off (`max_users: -1`). The first admin is created in the web UI
- Passwords hashed with argon2id
- Anonymous read, authenticated publish
- Dotfile paths denied
- Auth headers and cookies redacted in logs

On first start, if there is no admin account, the server log prints a one-time link. It expires after 15 minutes. Open it and set the admin username and password. Set `VERDACCIO_PUBLIC_URL` to the public origin with no port and no trailing slash so the logged link is absolute.

If that link expires and there is still no admin account, generate another one:

```bash
verdaccio setup-link
```

The running server picks up the new link without a restart.
