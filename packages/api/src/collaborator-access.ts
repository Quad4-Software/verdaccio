import type { Auth } from '@verdaccio/auth';
import { authUtils, reqUtils } from '@verdaccio/core';
import { allow } from '@verdaccio/middleware';
import type { Storage } from '@verdaccio/store';
import type { Logger } from '@verdaccio/types';

import type { $NextFunctionVer, $RequestExtend, $ResponseExtend } from '../types/custom';

/**
 * `allow` variant that falls back to the manifest's collaborator map when the
 * auth plugin's package rules deny the action. Read collaborators satisfy
 * `access`, write collaborators satisfy `publish`/`unpublish`.
 *
 * A generated token's package scope is still authoritative: a collaborator
 * grant on the manifest must never widen what the token is scoped for, so
 * the same matchPackagePatterns check the auth layer runs is repeated here.
 */
export function allowWithCollaborators(auth: Auth, storage: Storage, logger: Logger) {
  const base = allow(auth, {
    beforeAll: (a, b) => logger.trace(a, b),
    afterAll: (a, b) => logger.trace(a, b),
  });
  return function (action: string) {
    const check = base(action);
    return function (req: $RequestExtend, res: $ResponseExtend, next: $NextFunctionVer): void {
      check(req, res, (err?: unknown) => {
        if (!err) {
          return next();
        }
        const name = req.params?.package ? reqUtils.paramToString(req.params.package) : '';
        const username = req.remote_user?.name;
        if (
          name === '' ||
          typeof username !== 'string' ||
          authUtils.matchPackagePatterns(name, req.remote_user?.token?.packages) === false
        ) {
          return next(err as Error);
        }
        storage
          .getCollaboratorPermission(name, username)
          .then((permission) => {
            const granted =
              action === 'access'
                ? permission === 'read' || permission === 'write'
                : permission === 'write';
            return granted ? next() : next(err as Error);
          })
          .catch(() => next(err as Error));
      });
    };
  };
}
