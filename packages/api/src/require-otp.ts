import buildDebug from 'debug';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { TfaStore } from '@verdaccio/auth';
import { HEADERS, HTTP_STATUS, errorUtils, reqUtils } from '@verdaccio/core';
import type { Logger } from '@verdaccio/types';

import type { $RequestExtend } from '../types/custom';

const debug = buildDebug('verdaccio:api:otp');

/**
 * Header carrying the one-time password.
 *
 * npm sets it from `opts.otp` (`npm-registry-fetch/lib/index.js`) and Yarn from
 * `getOtpHeaders` (`plugin-npm/sources/npmHttpUtils.ts`); both spell it the same.
 */
export const OTP_HEADER = 'npm-otp';

/**
 * The challenge value clients look for.
 *
 * npm only raises `EOTP` when a 401 carries a `www-authenticate` header whose
 * comma-separated values include `otp`, and Yarn's `isOtpError` does the same.
 * Anything else — including the `Bearer` that `final` adds to every other 401 —
 * surfaces as a plain authentication failure and the client never retries.
 */
export const OTP_CHALLENGE = 'otp';

/**
 * Wording kept close to npmjs on purpose: npm has a fallback that matches
 * `/one-time pass/` against the body when the header is missing, so a client
 * that somehow loses the header still recognises the challenge.
 */
const OTP_REQUIRED_MESSAGE =
  'You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.';

const OTP_VERIFIED = Symbol.for('verdaccio.otpVerified');

/**
 * The npm CLI sends the code in the npm-otp header; the web login form posts
 * it as an `otp` field in the JSON body — accept either.
 */
function otpFrom(req: Request): string | undefined {
  const header = req.get(OTP_HEADER);
  if (typeof header === 'string' && header !== '') {
    return header;
  }
  const body = (req as $RequestExtend).body?.otp;
  return typeof body === 'string' && body !== '' ? body : undefined;
}

/**
 * Which operations a mode covers.
 *
 * - `auth`: logging in and minting tokens, required by both modes
 * - `write`: publishing and other mutations, required only by `auth-and-writes`
 */
export type OtpScope = 'auth' | 'write';

export interface RequireOtpOptions {
  /** Absent when `flags.tfa` is off, which turns the middleware into a no-op. */
  tfaStore?: TfaStore;
  scope: OtpScope;
  logger: Logger;
  /**
   * Resolve whose two-factor configuration applies.
   *
   * Defaults to the authenticated user, but login has no authenticated user
   * yet — there the name comes off the request body.
   */
  getUsername?: (req: Request) => string | undefined;
}

function defaultGetUsername(req: Request): string | undefined {
  const name = (req as $RequestExtend).remote_user?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Answer 401 in the exact shape npm and Yarn recognise as "send me an OTP". */
function challenge(res: Response, _next: NextFunction): void {
  // the header is what npm and Yarn match on; `otpRequired` in the body lets
  // the web login dialog switch to its OTP field instead of reporting a
  // generic credentials failure
  res.header(HEADERS.WWW_AUTH, OTP_CHALLENGE);
  res.header('npm-notice', 'Provide a one-time password from your authenticator app.');
  res.status(HTTP_STATUS.UNAUTHORIZED).json({
    error: OTP_REQUIRED_MESSAGE,
    otpRequired: true,
  });
}

/**
 * Demand a one-time password from users who have two-factor enabled.
 *
 * A no-op when the flag is off, when the user has no two-factor configured, or
 * when their mode does not cover this operation, so requests from everybody
 * else are untouched.
 */
export function requireOtp(options: RequireOtpOptions): RequestHandler {
  const { tfaStore, scope, logger } = options;
  const getUsername = options.getUsername ?? defaultGetUsername;

  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    // flag off: never touch the token store, not even to look
    if (!tfaStore) {
      return next();
    }

    const username = getUsername(req);
    if (!username) {
      // not authenticated (or not identifiable): other middleware decides
      return next();
    }

    // OIDC-exchanged tokens are OTP-exempt: the verified CI identity stands in
    // for the second factor, and a CI job could never answer the challenge
    if ((req as $RequestExtend).remote_user?.token?.otpExempt === true) {
      return next();
    }

    let record;
    try {
      record = await tfaStore.get(username);
    } catch (err) {
      // an unreadable record must not fall through as "no two-factor"
      return next(err);
    }

    if (!record || record.pending) {
      return next();
    }
    if (scope === 'write' && record.mode === 'auth-only') {
      debug('%o is in auth-only mode, writes do not need an OTP', username);
      return next();
    }

    const otp = otpFrom(req);
    if (!otp) {
      debug('challenging %o for an OTP', username);
      return challenge(res, next);
    }

    if (await tfaStore.verify(username, otp)) {
      debug('OTP accepted for %o', username);
      // replay protection consumes the step — a later OTP middleware on the
      // same request must accept this verification instead of verifying again
      (req as any)[OTP_VERIFIED] = true;
      return next();
    }

    logger.warn({ username }, 'rejected an invalid one-time password for @{username}');
    return challenge(res, next);
  };
}

/**
 * Enforce the per-package `publish_requires_tfa` flag (`npm access set mfa`).
 *
 * When set, every publish for that package must carry a valid OTP from the
 * publishing user, unless the credential is an automation token and the
 * package allows automation tokens to bypass the challenge.
 */
export function requirePackagePublishOtp(
  storage: any,
  tfaStore: TfaStore | undefined,
  logger: Logger
): RequestHandler {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const name = reqUtils.paramToString((req as $RequestExtend).params?.package);
    if (typeof name !== 'string' || name === '') {
      return next();
    }
    // npm's package-mfa covers mutations, not the star map — a body whose only
    // meaningful key is `users` is a star/unstar and skips the package OTP
    const body = req.body;
    if (
      body != null &&
      typeof body === 'object' &&
      typeof body.users === 'object' &&
      body.users !== null &&
      body._attachments === undefined &&
      body.versions === undefined &&
      body['dist-tags'] === undefined &&
      body.maintainers === undefined
    ) {
      return next();
    }
    let policy;
    try {
      policy = await storage.getPackagePublishPolicy(name);
    } catch (err) {
      return next(err);
    }
    if (!policy) {
      return next();
    }

    const user = (req as $RequestExtend).remote_user;
    if (typeof user?.name !== 'string' || user.name === '') {
      // unauthenticated writes are rejected by the permission middleware anyway
      return next();
    }

    // only OIDC-exchanged CI tokens are "automation" tokens — a plain scoped
    // token in an interactive session must not bypass the package challenge
    const isAutomationToken = user.token?.otpExempt === true;
    if (policy.automation_token_overrides_tfa && isAutomationToken) {
      debug('automation token bypasses publish TFA for %o', name);
      return next();
    }

    if (!tfaStore) {
      logger.warn(
        { name },
        'package @{name} requires publish TFA but flags.tfa is off; blocking the write'
      );
      return next(
        errorUtils.getForbidden(
          'this package requires two-factor authentication, which is not enabled on this registry'
        )
      );
    }

    // a user without two-factor can never answer the challenge — fail with a
    // clear error instead of looping EOTP forever
    const record = await tfaStore.get(user.name);
    if (!record || record.pending) {
      return next(
        errorUtils.getForbidden(
          'this package requires two-factor authentication; enable 2FA on your account first'
        )
      );
    }

    // already verified by the user-level OTP middleware on this request —
    // the same code would be rejected as a replay if verified again
    if ((req as any)[OTP_VERIFIED] === true) {
      return next();
    }

    const otp = otpFrom(req);
    if (!otp) {
      debug('challenging %o for a package-level OTP on %o', user.name, name);
      return challenge(res, next);
    }
    if (await tfaStore.verify(user.name, otp)) {
      return next();
    }
    logger.warn({ username: user.name }, 'rejected an invalid one-time password for @{username}');
    return challenge(res, next);
  };
}

/**
 * Fail fast when two-factor is enabled on a storage plugin that cannot hold it.
 *
 * `Storage.readTokens` rejects with 503 when the plugin lacks the token
 * interface. Without this check that rejection would surface on every single
 * write, for every user, including those who never enabled two-factor.
 */
export function assertTokenStoreSupport(storage: any, logger: Logger): void {
  const plugin = storage?.localStorage?.getStoragePlugin?.();
  const missing = ['saveToken', 'readTokens', 'deleteToken'].filter(
    (method) => typeof plugin?.[method] !== 'function'
  );

  if (missing.length > 0) {
    logger.error(
      { missing: missing.join(', ') },
      'the storage plugin does not implement @{missing}, which two-factor authentication needs'
    );
    throw new Error(
      `flags.tfa is enabled but the storage plugin does not implement ${missing.join(', ')}`
    );
  }
}
