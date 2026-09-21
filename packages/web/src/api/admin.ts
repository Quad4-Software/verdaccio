import { Router } from 'express';
import { readFileSync } from 'node:fs';

import type { Auth } from '@verdaccio/auth';
import { TfaStore } from '@verdaccio/auth';
import { HTTP_STATUS, authUtils, errorUtils, reqUtils, validationUtils } from '@verdaccio/core';
import type { VerdaccioError } from '@verdaccio/core';
import type { $NextFunctionVer, $RequestExtend, $ResponseExtend } from '@verdaccio/middleware';
import { WebUrls, getRequestMetrics } from '@verdaccio/middleware';
import type { Storage } from '@verdaccio/store';
import type { Config, RemoteUser } from '@verdaccio/types';

import { listAdminActions, recordAdminAction } from './admin-audit';
import { resolveScopedName } from './scoped-access';

const VALID_VISIBILITY = ['public', 'private'];

/**
 * The user-management surface a storage auth plugin may implement. Everything
 * is optional: endpoints report 501 when the active plugin lacks the method.
 */
type UserAdminPlugin = {
  listUsers?: (cb: (err: VerdaccioError | null, users?: string[]) => void) => void;
  listAdmins?: () => string[];
  setAdminFlag?: (
    user: string,
    enabled: boolean,
    cb: (err: VerdaccioError | null, ok?: boolean) => void
  ) => void;
  deleteUser?: (user: string, cb: (err: VerdaccioError | null, ok?: boolean) => void) => void;
  resetPassword?: (
    user: string,
    password: string,
    cb: (err: VerdaccioError | null, ok?: boolean) => void
  ) => void;
};

function findUserAdminPlugin(auth: Auth): UserAdminPlugin | undefined {
  return auth.plugins?.find(
    (plugin) => typeof (plugin as UserAdminPlugin).listUsers === 'function'
  ) as UserAdminPlugin | undefined;
}

function callPlugin<T>(
  method: (cb: (err: VerdaccioError | null, result?: T) => void) => void
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    method((err, result) => (err ? reject(err) : resolve(result)));
  });
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function addAdminApi(storage: Storage, auth: Auth, config: Config): Router {
  const route = Router(); /* eslint new-cap: 0 */
  const tfaStore =
    config.flags?.tfa === true ? new TfaStore(storage, config.secret, auth.logger) : undefined;

  const isAdminRequest = (req: $RequestExtend): boolean =>
    authUtils.isAdmin(req.remote_user as RemoteUser | undefined, config.security?.admins);

  route.get(WebUrls.admin_status, (req: $RequestExtend, _res: $ResponseExtend, next) => {
    next({
      admin: isAdminRequest(req),
      // lets the ui hide user-management controls the plugin cannot serve
      userManagement: findUserAdminPlugin(auth) !== undefined,
    });
  });

  route.use((req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer): void => {
    if (isAdminRequest(req)) {
      return next();
    }
    next(errorUtils.getForbidden('administrator rights are required'));
  });

  route.get(
    WebUrls.admin_users,
    async (req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      const plugin = findUserAdminPlugin(auth);
      if (typeof plugin?.listUsers !== 'function') {
        return next(
          errorUtils.getCode(
            HTTP_STATUS.NOT_IMPLEMENTED,
            'the auth plugin does not support listing users'
          )
        );
      }
      try {
        const names = (await callPlugin<string[]>((cb) => plugin.listUsers!(cb))) ?? [];
        const admins = plugin.listAdmins?.() ?? [];
        const users = await Promise.all(
          names.map(async (name) => ({
            name,
            admin: admins.includes(name),
            tfa: tfaStore ? await tfaStore.isEnabled(name) : false,
          }))
        );
        next({ users });
      } catch (err) {
        next(err);
      }
    }
  );

  route.post(
    WebUrls.admin_users,
    (req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      const username = typeof req.body?.username === 'string' ? req.body.username : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!validationUtils.validateName(username)) {
        return next(errorUtils.getBadRequest('username is not valid'));
      }
      if (
        validationUtils.validatePassword(password, config?.server?.passwordValidationRegex) ===
        false
      ) {
        return next(errorUtils.getBadRequest('password does not meet the policy'));
      }
      auth.add_user(username, password, (err, user) => {
        if (err || !user) {
          return next(err ?? errorUtils.getInternalError('could not create the user'));
        }
        recordAdminAction(req.remote_user?.name, 'user.create', username);
        next({ success: true, username });
      });
    }
  );

  route.delete(
    WebUrls.admin_user,
    async (req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      const plugin = findUserAdminPlugin(auth);
      if (typeof plugin?.deleteUser !== 'function') {
        return next(
          errorUtils.getCode(
            HTTP_STATUS.NOT_IMPLEMENTED,
            'the auth plugin does not support deleting users'
          )
        );
      }
      const target = reqUtils.paramToString(req.params.user);
      if (target === req.remote_user?.name) {
        return next(errorUtils.getBadRequest('cannot delete your own account'));
      }
      // admins also come from security.admins in config; only plain usernames
      // there are enumerable, group entries cannot be counted
      const pluginAdmins = plugin.listAdmins?.() ?? [];
      const configAdmins = (config.security?.admins ?? []).filter(
        (entry) => !entry.startsWith('$')
      );
      const otherAdmins = new Set([...pluginAdmins, ...configAdmins]);
      // the caller passed the admin guard, so they always count as remaining
      if (typeof req.remote_user?.name === 'string') {
        otherAdmins.add(req.remote_user.name);
      }
      otherAdmins.delete(target);
      if (otherAdmins.size === 0) {
        return next(errorUtils.getBadRequest('cannot delete the last admin account'));
      }
      try {
        await callPlugin((cb) => plugin.deleteUser!(target, cb));
        await tfaStore?.disable(target);
        recordAdminAction(req.remote_user?.name, 'user.delete', target);
        next({ success: true });
      } catch (err) {
        next(err);
      }
    }
  );

  route.put(
    WebUrls.admin_user_password,
    async (req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      const plugin = findUserAdminPlugin(auth);
      if (typeof plugin?.resetPassword !== 'function') {
        return next(
          errorUtils.getCode(
            HTTP_STATUS.NOT_IMPLEMENTED,
            'the auth plugin does not support resetting passwords'
          )
        );
      }
      const target = reqUtils.paramToString(req.params.user);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (
        validationUtils.validatePassword(password, config?.server?.passwordValidationRegex) ===
        false
      ) {
        return next(errorUtils.getBadRequest('password does not meet the policy'));
      }
      try {
        await callPlugin((cb) => plugin.resetPassword!(target, password, cb));
        recordAdminAction(req.remote_user?.name, 'user.password-reset', target);
        next({ success: true });
      } catch (err) {
        next(err);
      }
    }
  );

  route.put(
    WebUrls.admin_user_admin,
    async (req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      const plugin = findUserAdminPlugin(auth);
      if (typeof plugin?.setAdminFlag !== 'function') {
        return next(
          errorUtils.getCode(
            HTTP_STATUS.NOT_IMPLEMENTED,
            'the auth plugin does not support admin flags'
          )
        );
      }
      const target = reqUtils.paramToString(req.params.user);
      const enabled = req.body?.admin === true;
      if (enabled === false && target === req.remote_user?.name) {
        return next(errorUtils.getBadRequest('cannot revoke your own admin rights'));
      }
      if (enabled === false) {
        // admins also come from security.admins in config; only plain usernames
        // there are enumerable, group entries cannot be counted
        const pluginAdmins = plugin.listAdmins?.() ?? [];
        const configAdmins = (config.security?.admins ?? []).filter(
          (entry) => !entry.startsWith('$')
        );
        const others = new Set([...pluginAdmins, ...configAdmins]);
        // the caller passed the admin guard, so they always count as remaining
        if (typeof req.remote_user?.name === 'string') {
          others.add(req.remote_user.name);
        }
        others.delete(target);
        if (others.size === 0) {
          return next(errorUtils.getBadRequest('cannot revoke the last admin account'));
        }
      }
      try {
        await callPlugin((cb) => plugin.setAdminFlag!(target, enabled, cb));
        recordAdminAction(req.remote_user?.name, 'user.admin', target, String(enabled));
        next({ success: true, admin: enabled });
      } catch (err) {
        next(err);
      }
    }
  );

  route.delete(
    WebUrls.admin_user_tfa,
    async (req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      if (!tfaStore) {
        return next(
          errorUtils.getCode(HTTP_STATUS.NOT_IMPLEMENTED, 'two-factor support is not enabled')
        );
      }
      const target = reqUtils.paramToString(req.params.user);
      await tfaStore.disable(target);
      recordAdminAction(req.remote_user?.name, 'user.tfa-reset', target);
      next({ success: true });
    }
  );

  route.get(
    WebUrls.admin_packages,
    async (_req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      try {
        const packages = await storage.getLocalDatabase();
        next({
          packages: packages.map((pkg) => ({
            name: pkg.name,
            version: pkg.version,
            visibility: pkg.visibility === 'private' ? 'private' : 'public',
          })),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  route.put(
    [WebUrls.admin_package_visibility_scoped, WebUrls.admin_package_visibility],
    async (req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      const name = resolveScopedName(req.params.scope, req.params.package);
      if (name === null) {
        return next(errorUtils.getNotFound());
      }
      const visibility = req.body?.visibility;
      if (!VALID_VISIBILITY.includes(visibility)) {
        return next(errorUtils.getBadRequest('visibility must be "public" or "private"'));
      }
      try {
        await storage.setPackageVisibility(name, visibility as 'public' | 'private');
        recordAdminAction(req.remote_user?.name, 'package.visibility', name, visibility);
        next({ success: true, name, visibility });
      } catch (err) {
        next(err);
      }
    }
  );

  route.get(
    WebUrls.admin_metrics,
    async (_req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer) => {
      try {
        const packages = await storage.getLocalDatabase();
        const plugin = findUserAdminPlugin(auth);
        const users =
          typeof plugin?.listUsers === 'function'
            ? ((await callPlugin<string[]>((cb) => plugin.listUsers!(cb))) ?? []).length
            : null;
        const memory = process.memoryUsage();
        next({
          version: packageVersion(),
          node: process.version,
          uptime: process.uptime(),
          startedAt: getRequestMetrics().startedAt,
          memory: {
            rss: memory.rss,
            heapTotal: memory.heapTotal,
            heapUsed: memory.heapUsed,
          },
          counts: {
            packages: packages.length,
            users,
          },
          requests: {
            total: getRequestMetrics().total,
            byStatus: getRequestMetrics().byStatus,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  route.get(WebUrls.admin_audit, (_req: $RequestExtend, _res: $ResponseExtend, next) => {
    next({ audit: listAdminActions() });
  });

  return route;
}

export default addAdminApi;
