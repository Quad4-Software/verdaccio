import type { Router } from 'express';
import express from 'express';

import type { Auth } from '@verdaccio/auth';
import {
  WebUrlsNamespace,
  antiLoop,
  encodeScopePackage,
  enforceGeneratedTokenMetadata,
  makeURLrelative,
  match,
  registerBodyParser,
  validateName,
  validatePackage,
} from '@verdaccio/middleware';
import type { Storage } from '@verdaccio/store';
import type { Config, Logger } from '@verdaccio/types';

import { TfaStore } from '@verdaccio/auth';

import access from './access';
import distTags from './dist-tags';
import pkg from './package';
import ping from './ping';
import publish from './publish';
import registry, { metrics } from './registry';
import { assertTokenStoreSupport, requireOtp, requirePackagePublishOtp } from './require-otp';
import search from './search';
import stage from './stage';
import user from './user';
import login from './v1/login';
import oidcExchange from './v1/oidc-exchange';
import profile from './v1/profile';
import v1Search from './v1/search';
import token from './v1/token';
import whoami from './whoami';

export default function (config: Config, auth: Auth, storage: Storage, logger: Logger): Router {
  /* eslint new-cap:off */
  const app = express.Router();

  // validate all of these params as a package name
  // this might be too harsh, so ask if it causes trouble
  app.param('package', validatePackage);
  app.param('filename', validateName);
  app.param('tag', validateName);
  app.param('version', validateName);
  app.param('revision', validateName);
  app.param('token', validateName);

  // Express route parameter names must be valid JavaScript identifiers, which means
  // they cannot start with a hyphen (-) or contain special characters like dots (.)
  app.param('_rev', match(/^-rev$/));
  app.param('org_couchdb_user', match(/^org\.couchdb\.user:/));

  // Body parser must be registered before JWT middleware which pauses/resumes the stream
  registerBodyParser(app, config);

  // the OIDC exchange endpoint must run before the JWT middleware: the CI
  // bearer token is foreign and, under AES-legacy security, the auth
  // middleware would answer a hard 401 before this route is reached
  oidcExchange(app, auth, storage, config, logger);
  // the metrics bearer token is not a registry credential; mount before JWT
  metrics(app, config, storage, logger);

  app.use(WebUrlsNamespace.endpoints, (_req, _res, next) => next('router'));

  // Avoid executing JWT twice when the parent app already registered the JWT middleware
  const apiJwtMiddleware = auth.apiJWTmiddleware();
  app.use((req, res, next) => {
    const remoteUser = (req as any).remote_user ?? (res.locals as any).remote_user;
    if (remoteUser) {
      return next();
    }
    return apiJwtMiddleware(req, res, next);
  });

  // built once: without the flag nothing must reach the token store
  let tfaStore: TfaStore | undefined;
  if (config.flags?.tfa) {
    // refuse to start rather than answer 503 on every write later
    assertTokenStoreSupport(storage, logger);
    tfaStore = new TfaStore(storage, config.secret, logger);
  }
  const otpForAuth = requireOtp({ tfaStore, scope: 'auth', logger });
  // at login there is no authenticated user yet: the name is in the body
  const otpForLogin = requireOtp({
    tfaStore,
    scope: 'auth',
    logger,
    getUsername: (req) => (typeof req.body?.name === 'string' ? req.body.name : undefined),
  });
  const otpForWrites = requireOtp({ tfaStore, scope: 'write', logger });
  const otpForPackagePublish = requirePackagePublishOtp(storage, tfaStore, logger);
  // the web-login session endpoint reads the name from a different field
  const otpForCliLogin = requireOtp({
    tfaStore,
    scope: 'auth',
    logger,
    getUsername: (req) => (typeof req.body?.username === 'string' ? req.body.username : undefined),
  });

  app.use(enforceGeneratedTokenMetadata(storage, logger));
  app.use(antiLoop(config));
  app.use(makeURLrelative);
  // encode / in a scoped package name to be matched as a single parameter in routes
  app.use(encodeScopePackage);
  // for "npm whoami"
  whoami(app);
  profile(app, auth, config, storage, logger, otpForAuth);
  search(app, logger);
  user(app, auth, config, logger, otpForLogin);
  distTags(app, auth, storage, logger, otpForWrites, otpForPackagePublish);
  publish(app, auth, storage, config, logger, otpForWrites, otpForPackagePublish);
  ping(app);
  v1Search(app, auth, storage, config, logger);
  token(app, auth, storage, config, logger, otpForAuth);
  registry(app, auth, config, storage, logger);
  access(app, auth, config, storage, logger, otpForWrites, otpForPackagePublish);
  // must stay before pkg(): its '/:package{/:version}' route would otherwise
  // swallow GET /-/stage
  if (config.flags?.stage) {
    stage(app, auth, storage, config, logger, otpForWrites);
  }
  pkg(app, auth, storage, logger);
  if (config.flags?.webLogin) {
    login(app, auth, storage, config, logger, otpForCliLogin);
  }
  return app;
}
