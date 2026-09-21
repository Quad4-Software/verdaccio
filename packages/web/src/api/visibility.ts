import buildDebug from 'debug';
import { Router } from 'express';

import type { Auth } from '@verdaccio/auth';
import { createAnonymousRemoteUser } from '@verdaccio/config';
import { errorUtils } from '@verdaccio/core';
import { WebUrls } from '@verdaccio/middleware';
import type { $NextFunctionVer, $RequestExtend, $ResponseExtend } from '@verdaccio/middleware';
import { canPublish } from '@verdaccio/store';
import type { Storage } from '@verdaccio/store';
import type { Config, RemoteUser } from '@verdaccio/types';

import { hasLogin } from '../web-utils';
import { resolveScopedName } from './scoped-access';

const debug = buildDebug('verdaccio:web:api:visibility');

const VALID_VISIBILITY = ['public', 'private'];

/**
 * Lets publishers flip the packument visibility flag. The flag lives on the
 * stored manifest, so the package must exist locally; remote-only packages
 * return 404 like anywhere else.
 */
function addVisibilityWebApi(storage: Storage, auth: Auth, config: Config): Router {
  const router = Router(); /* eslint new-cap: 0 */

  router.put(
    [WebUrls.visibility_scoped_package, WebUrls.visibility_package],
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      const name = resolveScopedName(req.params.scope, req.params.package);
      if (name === null) {
        return next(errorUtils.getNotFound());
      }
      const visibility = req.body?.visibility;
      if (!VALID_VISIBILITY.includes(visibility)) {
        return next(errorUtils.getBadRequest('visibility must be "public" or "private"'));
      }
      try {
        const remoteUser: RemoteUser = hasLogin(config)
          ? req.remote_user
          : createAnonymousRemoteUser();
        if ((await canPublish(auth, name, remoteUser)) === false) {
          return next(errorUtils.getForbidden());
        }
        // throws not found for packages that only exist on uplinks, which is
        // the intended behaviour since the flag is stored locally
        await storage.setPackageVisibility(name, visibility as 'public' | 'private');
        debug('visibility of %o set to %o by %o', name, visibility, remoteUser.name);
        next({ success: true, name, visibility });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

export default addVisibilityWebApi;
