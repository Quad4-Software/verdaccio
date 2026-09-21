import buildDebug from 'debug';
import type { Request, Response } from 'express';
import { Router } from 'express';

import type { Auth } from '@verdaccio/auth';
import type { VerdaccioError } from '@verdaccio/core';
import { HEADERS, HTTP_STATUS, errorUtils, validationUtils } from '@verdaccio/core';
import { WebUrls, rateLimit } from '@verdaccio/middleware';
import type { Config, JWTSignOptions, RemoteUser } from '@verdaccio/types';

import type { $NextFunctionVer } from './package';

const debug = buildDebug('verdaccio:web:api:setup');

const INVALID_LINK =
  'This setup link is invalid or expired. If there is still no admin account, generate a new link with verdaccio setup-link';

type SetupPlugin = {
  validateSetupAccount: (user: string, password: string) => string | null;
  inspectSetup: (token: string) => { state: 'ok'; expires: number } | { state: string };
  consumeSetup: (token: string) => 'ok' | 'invalid' | 'admin-exists';
  bootstrapAdmin: (
    user: string,
    password: string,
    cb: (err: VerdaccioError | null, ok?: boolean) => void
  ) => void;
};

function findSetupPlugin(auth: Auth): SetupPlugin | undefined {
  return auth.plugins?.find((plugin) => {
    const candidate = plugin as Partial<SetupPlugin>;
    return (
      typeof candidate.validateSetupAccount === 'function' &&
      typeof candidate.inspectSetup === 'function' &&
      typeof candidate.consumeSetup === 'function' &&
      typeof candidate.bootstrapAdmin === 'function'
    );
  }) as SetupPlugin | undefined;
}

function readToken(body: { token?: unknown }): string {
  return typeof body?.token === 'string' ? body.token : '';
}

function addSetupApi(auth: Auth, config: Config): Router {
  const route = Router();

  route.post(
    WebUrls.setup_status,
    rateLimit(config?.userRateLimit),
    function (req: Request, res: Response, next: $NextFunctionVer): void {
      const plugin = findSetupPlugin(auth);
      if (!plugin) {
        return next(errorUtils.getNotFound('setup is not available'));
      }
      const inspected = plugin.inspectSetup(readToken(req.body));
      if (inspected.state === 'admin-exists') {
        return next(errorUtils.getConflict('an admin account already exists'));
      }
      if (inspected.state !== 'ok' || !('expires' in inspected)) {
        return next(errorUtils.getCode(HTTP_STATUS.UNAUTHORIZED, INVALID_LINK));
      }
      res.set(HEADERS.CACHE_CONTROL, HEADERS.NO_CACHE);
      return next({ ok: true, expires: inspected.expires });
    }
  );

  route.post(
    WebUrls.setup,
    rateLimit(config?.userRateLimit),
    function (req: Request, res: Response, next: $NextFunctionVer): void {
      const plugin = findSetupPlugin(auth);
      if (!plugin) {
        return next(errorUtils.getNotFound('setup is not available'));
      }

      const token = readToken(req.body);
      const name = typeof req.body?.username === 'string' ? req.body.username : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const accountError = plugin.validateSetupAccount(name, password);
      if (accountError) {
        return next(errorUtils.getCode(HTTP_STATUS.BAD_REQUEST, accountError));
      }
      if (
        validationUtils.validatePassword(password, config?.server?.passwordValidationRegex) ===
        false
      ) {
        return next(
          errorUtils.getCode(HTTP_STATUS.BAD_REQUEST, 'password does not meet the policy')
        );
      }

      const consumed = plugin.consumeSetup(token);
      if (consumed === 'admin-exists') {
        return next(errorUtils.getConflict('an admin account already exists'));
      }
      if (consumed !== 'ok') {
        return next(errorUtils.getCode(HTTP_STATUS.UNAUTHORIZED, INVALID_LINK));
      }

      debug('creating the first admin account');
      plugin.bootstrapAdmin(name, password, (err, ok): void => {
        if (err || !ok) {
          debug('admin account was not created');
          return next(
            errorUtils.getCode(
              err?.status && err.status >= 400 ? err.status : HTTP_STATUS.INTERNAL_ERROR,
              err?.message ||
                'could not create the admin account. generate a new link with verdaccio setup-link'
            )
          );
        }

        auth.authenticate(name, password, async (authErr, user): Promise<void> => {
          if (authErr || !user) {
            return next(
              errorUtils.getCode(
                HTTP_STATUS.INTERNAL_ERROR,
                'the admin account was created. log in with that username and password'
              )
            );
          }
          const jWTSignOptions: JWTSignOptions = config.security.web.sign;
          const session = await auth.jwtEncrypt(user as RemoteUser, jWTSignOptions);
          res.set(HEADERS.CACHE_CONTROL, HEADERS.NO_CACHE);
          return next({ token: session, username: name });
        });
      });
    }
  );

  return route;
}

export default addSetupApi;
