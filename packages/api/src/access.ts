import buildDebug from 'debug';
import type { Router } from 'express';

import type { Auth } from '@verdaccio/auth';
import { API_ERROR, HTTP_STATUS, errorUtils, reqUtils } from '@verdaccio/core';
import { REGISTRY_API_ENDPOINTS, getRequestOptions } from '@verdaccio/middleware';
import { Storage, assertPackageVisibility } from '@verdaccio/store';
import type { Config, Logger } from '@verdaccio/types';

import { allowWithCollaborators } from './collaborator-access';
import type { $NextFunctionVer, $RequestExtend, $ResponseExtend } from '../types/custom';

const debug = buildDebug('verdaccio:api:access');

const COLLABORATOR_PERMISSIONS = new Set(['read', 'write']);

/**
 * npm access endpoints: collaborator management, package visibility and the
 * publish-time TFA flag. Team-scoped routes answer 501: teams are an npmjs
 * paid-org concept this registry does not model.
 */
export default function (
  route: Router,
  auth: Auth,
  config: Config,
  storage: Storage,
  logger: Logger
): void {
  const can = allowWithCollaborators(auth, storage, logger);
  const username = (req: $RequestExtend): string | undefined => req.remote_user?.name;

  route.get(
    REGISTRY_API_ENDPOINTS.collaborators,
    can('access'),
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const name = reqUtils.paramToString(req.params.package);
        await assertPackageVisibility(auth, storage, name, req.remote_user);
        next(await storage.getPackageCollaborators(name));
      } catch (err: any) {
        next(err);
      }
    }
  );

  route.put(
    REGISTRY_API_ENDPOINTS.collaborator,
    can('publish'),
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const name = reqUtils.paramToString(req.params.package);
        const user = reqUtils.paramToString(req.params.user);
        const permissions = req.body?.permissions;
        if (
          typeof user !== 'string' ||
          user === '' ||
          COLLABORATOR_PERMISSIONS.has(permissions) === false
        ) {
          throw errorUtils.getBadRequest('permissions must be "read" or "write"');
        }
        debug('grant %o %o on %o by %o', user, permissions, name, username(req));
        await storage.setPackageCollaborator(name, user, permissions, username(req));
        next({ ok: true });
      } catch (err: any) {
        next(err);
      }
    }
  );

  route.delete(
    REGISTRY_API_ENDPOINTS.collaborator,
    can('publish'),
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const name = reqUtils.paramToString(req.params.package);
        const user = reqUtils.paramToString(req.params.user);
        if (typeof user !== 'string' || user === '') {
          throw errorUtils.getBadRequest(API_ERROR.UNSUPORTED_REGISTRY_CALL);
        }
        await storage.setPackageCollaborator(name, user, null, username(req));
        next({ ok: true });
      } catch (err: any) {
        next(err);
      }
    }
  );

  route.get(
    REGISTRY_API_ENDPOINTS.package_visibility,
    can('access'),
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const name = reqUtils.paramToString(req.params.package);
        await assertPackageVisibility(auth, storage, name, req.remote_user);
        const manifest = await storage.getPackageManifest({
          name,
          requestOptions: getRequestOptions(req),
          uplinksLook: false,
        });
        next({ public: manifest.visibility !== 'private' });
      } catch (err: any) {
        next(err);
      }
    }
  );

  // npm access public|restricted and npm access set mfa=... share this route
  route.post(
    REGISTRY_API_ENDPOINTS.package_access,
    can('publish'),
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const name = reqUtils.paramToString(req.params.package);
        const body = req.body ?? {};
        if (body.access === 'public' || body.access === 'restricted') {
          await storage.setPackageVisibility(
            name,
            body.access === 'restricted' ? 'private' : 'public',
            username(req)
          );
          return next({ ok: true });
        }
        if (typeof body.publish_requires_tfa === 'boolean') {
          await storage.setPackagePublishTfa(
            name,
            body.publish_requires_tfa,
            body.automation_token_overrides_tfa === true,
            username(req)
          );
          return next({ ok: true });
        }
        throw errorUtils.getBadRequest(API_ERROR.UNSUPORTED_REGISTRY_CALL);
      } catch (err: any) {
        next(err);
      }
    }
  );

  route.get(
    REGISTRY_API_ENDPOINTS.user_packages,
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const user = reqUtils.paramToString(req.params.user);
        if (typeof user !== 'string' || user === '') {
          throw errorUtils.getBadRequest(API_ERROR.UNSUPORTED_REGISTRY_CALL);
        }
        // listing another user's packages leaks what they own; limit it to
        // the caller themselves or an admin-scoped caller
        const actor = username(req);
        if (actor !== user && config.security?.admins?.includes(actor ?? '') !== true) {
          throw errorUtils.getForbidden();
        }
        next(await storage.listEntityPackages({ user }));
      } catch (err: any) {
        next(err);
      }
    }
  );

  route.get(
    REGISTRY_API_ENDPOINTS.org_packages,
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const scope = reqUtils.paramToString(req.params.scope);
        if (typeof scope !== 'string' || scope === '') {
          throw errorUtils.getBadRequest(API_ERROR.UNSUPORTED_REGISTRY_CALL);
        }
        const packages = await storage.listEntityPackages({ scope });
        // private packages must not be enumerated by callers that cannot see them
        const visible: Record<string, 'read' | 'write'> = {};
        for (const [name, permission] of Object.entries(packages)) {
          try {
            await assertPackageVisibility(auth, storage, name, req.remote_user);
            visible[name] = permission;
          } catch {
            // not visible to this caller
          }
        }
        next(visible);
      } catch (err: any) {
        next(err);
      }
    }
  );

  const teamsUnsupported = function (
    _req: $RequestExtend,
    _res: $ResponseExtend,
    next: $NextFunctionVer
  ): void {
    next(errorUtils.getCode(HTTP_STATUS.NOT_IMPLEMENTED, 'teams are not supported'));
  };
  route.put(REGISTRY_API_ENDPOINTS.team_package, can('publish'), teamsUnsupported);
  route.delete(REGISTRY_API_ENDPOINTS.team_package, can('publish'), teamsUnsupported);
  route.get(REGISTRY_API_ENDPOINTS.team_package, can('access'), teamsUnsupported);
}
