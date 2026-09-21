import type { Auth } from '@verdaccio/auth';
import { authUtils, errorUtils, reqUtils } from '@verdaccio/core';
import { allow } from '@verdaccio/middleware';
import type { Storage } from '@verdaccio/store';
import type { Logger, RemoteUser } from '@verdaccio/types';

import type { $NextFunctionVer, $RequestExtend, $ResponseExtend } from '../types/custom';

/**
 * An auth plugin denial (4xx, or allowed === false) may fall back to the
 * collaborator map; a plugin crash (5xx or no status) must not — the real
 * error has to surface instead of being masked by a grant.
 */
function isAuthDenial(err: any): boolean {
  const status = Number(err?.status);
  return err === null || (Number.isInteger(status) && status >= 400 && status < 500);
}

function allowAccess(auth: Auth, name: string, remoteUser: RemoteUser): Promise<boolean> {
  return new Promise((resolve, reject) => {
    auth.allow_access({ packageName: name }, remoteUser, (err: any, allowed?: boolean) => {
      if (err) {
        return isAuthDenial(err) ? resolve(false) : reject(err);
      }
      resolve(allowed === true);
    });
  });
}

/**
 * Route-level package access check for endpoints that are not wrapped by the
 * `allow` middleware: the auth plugin's access rules first, then the
 * collaborator map on denial. A generated token's package scope is checked
 * before any collaborator grant is consulted so a grant can never widen it.
 */
export async function assertPackageAccess(
  auth: Auth,
  storage: Storage,
  name: string,
  remoteUser: RemoteUser
): Promise<void> {
  if (authUtils.matchPackagePatterns(name, remoteUser?.token?.packages) === false) {
    throw errorUtils.getForbidden('token is not scoped for this package');
  }
  if (await allowAccess(auth, name, remoteUser)) {
    return;
  }
  const username = remoteUser?.name;
  if (typeof username === 'string') {
    const permission = await storage.getCollaboratorPermission(name, username).catch(() => null);
    if (permission === 'read' || permission === 'write') {
      return;
    }
  }
  throw errorUtils.getNotFound();
}

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
        if (isAuthDenial(err) === false) {
          return next(err as Error);
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
