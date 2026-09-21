import createDebugger from 'debug';
import type { HttpResponseResolver } from 'msw';
import { HttpResponse, delay, http } from 'msw';
import fs from 'node:fs';
import path from 'node:path';

import jqueryReadme from './api/jquery-readme';
import storybookReadme from './api/storybook-readme';

const debug = createDebugger('verdaccio:ui-components:api');
debug('Setting up MSW API mocks.');

const BASE_URL = 'http://localhost:9000';

/** MSW 2 defaults `ResponseBodyType` to `undefined`, which does not match `HttpResponse.json()`; widen the resolver. */
type MswResolver = HttpResponseResolver<any, any, any>;

export const mockHomePackages = (data?: any) =>
  http.get(`${BASE_URL}/-/verdaccio/data/packages`, (async () => {
    debug('Received request for home packages. Returning mock data.');
    await delay(500);
    const responseData = data || Array(400).fill(require('./api/home-packages.json'));
    debug(`Responding with ${responseData.length} packages.`);
    return HttpResponse.json(responseData);
  }) as unknown as MswResolver);

export const mockSearch = (data?: any) =>
  http.get(`${BASE_URL}/-/verdaccio/data/search/*`, (async () => {
    await delay(500);
    debug('Received search request. Returning mock search results.');
    const responseData = data || require('./api/search-verdaccio.json');
    debug(`Responding with ${responseData.length} search results.`);
    return HttpResponse.json(responseData);
  }) as unknown as MswResolver);

export const mockSidebar = (packageName: string, data?: any, status = 200) =>
  http.get(`${BASE_URL}/-/verdaccio/data/sidebar/${packageName}`, (({ params }) => {
    if (status !== 200) {
      debug(
        `Simulating error response for sidebar of package ${packageName} with status ${status}`
      );
      return new HttpResponse(null, { status });
    }

    debug(`Received request for sidebar of package ${packageName}. Returning mock data.`);
    // Default logic for storybook v-params
    if (packageName === 'storybook' && !data) {
      const { v } = params;
      debug(`Storybook sidebar request with v=${v}. Returning appropriate mock data.`);
      return HttpResponse.json(
        v ? require('./api/storybook-v.json') : require('./api/storybook-sidebar.json')
      );
    }

    const responseData = data || require(`./api/${packageName}-sidebar.json`);
    return HttpResponse.json(responseData);
  }) as unknown as MswResolver);

export const mockReadme = (packageName: string, content?: string) =>
  http.get(`${BASE_URL}/-/verdaccio/data/package/readme/${packageName}`, (() => {
    debug(`Received request for README of package ${packageName}.`);
    if (content) {
      debug(`Received request for README of package ${packageName}. Returning custom content.`);
      return HttpResponse.text(content);
    }

    // Fallback to existing logic
    if (packageName === 'storybook') {
      debug('Returning README for storybook package.');
      return HttpResponse.text(storybookReadme);
    }
    if (packageName === 'jquery') {
      debug('Returning README for jquery package.');
      return HttpResponse.text(jqueryReadme);
    }
    debug(`Returning README for package ${packageName}.`);
    return HttpResponse.text(`readme for ${packageName}`);
  }) as unknown as MswResolver);

export const mockTarball = (fileName = 'verdaccio-1.0.0.tgz') =>
  http.get(`${BASE_URL}/verdaccio/-/${fileName}`, (() => {
    const filePath = path.resolve(import.meta.dirname, `./api/${fileName}`);
    debug('filePath', filePath);
    const fileContent = fs.readFileSync(filePath);
    return new HttpResponse(fileContent, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }) as unknown as MswResolver);

/**
 * Mocks the Verdaccio reset password endpoint (PUT /-/verdaccio/sec/reset_password).
 * @param status - The HTTP status to return (default 200)
 * @param customResponse - Override the default JSON body
 */
export const mockResetPassword = (status = 200, customResponse?: object) =>
  http.put(`${BASE_URL}/-/verdaccio/sec/reset_password`, (async ({ request }) => {
    debug('Received reset password request', request.method, request.url);
    const body = (await request.json()) as { password: { old: string; new: string } };

    if (status !== 200) {
      debug(`Simulating reset password error with status ${status}`);
      return new HttpResponse(JSON.stringify(customResponse || { error: 'unauthorized' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.password?.old === 'fail') {
      debug('Simulating reset password failure for old password "fail"');
      return new HttpResponse(JSON.stringify({ error: 'invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    debug('Simulating successful password reset');
    return HttpResponse.json(customResponse || { ok: 'password changed' });
  }) as unknown as MswResolver);

/**
 * Mocks the Verdaccio CLI login endpoint (POST /-/v1/login_cli/:token).
 * @param status - The HTTP status to return (default 200)
 * @param customResponse - Override the default JSON body
 */
export const mockCliLogin = (status = 200, customResponse?: object) =>
  http.post(`${BASE_URL}/-/v1/login_cli/:token`, (async ({ request }) => {
    debug('Received CLI login request', request.method, request.url);
    const body = (await request.json()) as { username: string; password: string };

    if (status !== 200) {
      debug(`Simulating CLI login error with status ${status}`);
      return new HttpResponse(JSON.stringify(customResponse || { error: 'unauthorized' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.username === 'fail') {
      debug('Simulating CLI login failure for username "fail"');
      return new HttpResponse(JSON.stringify({ error: 'invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    debug('Simulating successful CLI login for:', body.username);
    return HttpResponse.json(
      customResponse || {
        username: body.username,
        token: 'valid-mock-token',
      }
    );
  }) as unknown as MswResolver);

/**
 * Mocks the Verdaccio signup endpoint (PUT /-/verdaccio/sec/signup).
 * Mirrors the server contract (packages/web/src/api/user.ts): a request without a
 * 36-char sessionId is rejected with 400 regardless of the requested status.
 * @param status - The HTTP status to return (default 200)
 * @param customResponse - Override the default JSON body
 */
export const mockAddUser = (status = 200, customResponse?: object) =>
  http.put(`${BASE_URL}/-/verdaccio/sec/signup`, (async ({ request }) => {
    debug('Received signup request', request.method, request.url);
    const body = (await request.json()) as {
      name: string;
      password: string;
      email?: string;
      sessionId?: string;
    };

    if (typeof body.sessionId !== 'string' || body.sessionId.length !== 36) {
      debug('Simulating signup error: invalid sessionId', body.sessionId);
      return new HttpResponse(JSON.stringify({ error: 'session id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (status !== 200) {
      debug(`Simulating signup error with status ${status}`);
      return new HttpResponse(JSON.stringify(customResponse || { error: 'conflict' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    debug('Simulating successful signup for:', body.name);
    return HttpResponse.json(
      customResponse || {
        username: body.name,
        token: 'valid-mock-token',
      }
    );
  }) as unknown as MswResolver);

/**
 * Mocks the Verdaccio login endpoint.
 * @param status - The HTTP status to return (default 200)
 * @param customResponse - Override the default JSON body
 */
export const mockLogin = (status = 200, customResponse?: object) =>
  http.post(`${BASE_URL}/-/verdaccio/sec/login`, (async ({ request }) => {
    debug('Received login request', request);
    const body = (await request.json()) as { username: string; password: string };

    // Handle specific error case based on status parameter
    if (status !== 200) {
      debug(`Simulating login error with status ${status}`);
      return new HttpResponse(JSON.stringify(customResponse || { error: 'unauthorized' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Logic for "fail" username trigger (matching your example)
    if (body.username === 'fail') {
      debug('Simulating login failure for username "fail"');
      return new HttpResponse(JSON.stringify({ error: 'invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    debug('Simulating successful login for username:', body.username);
    // Default Success
    return HttpResponse.json(
      customResponse || {
        username: body.username,
        token: 'valid-mock-token',
      }
    );
  }) as unknown as MswResolver);

/**
 * Mocks the npm profile endpoint (GET/POST /-/npm/v1/user) that the two-factor
 * enrolment flow drives. Mirrors the server contract in
 * packages/api/src/v1/profile.ts: { mode, password } starts enrolment and
 * answers an otpauth:// URI, [code] finishes it and answers recovery codes,
 * { mode: 'disable', password } turns it off.
 */
// module scope on purpose: msw registers handlers once per test file, so state
// has to live outside the handler and be reset between tests
let profileTfaEnabled = false;
export const resetProfileMock = () => {
  profileTfaEnabled = false;
};

export const mockProfile = () => {
  return [
    http.get(`${BASE_URL}/-/npm/v1/user`, (() => {
      debug('Received profile request');
      return HttpResponse.json({
        name: 'testuser',
        tfa: profileTfaEnabled ? { mode: 'auth-only', pending: false } : false,
        email: '',
        email_verified: false,
        created: '',
        updated: '',
        cidr_whitelist: null,
        fullname: '',
      });
    }) as unknown as MswResolver),
    http.post(`${BASE_URL}/-/npm/v1/user`, (async ({ request }) => {
      const body = (await request.json()) as { tfa?: any };
      const tfa = body?.tfa;

      if (Array.isArray(tfa)) {
        if (tfa[0] === '123456') {
          profileTfaEnabled = true;
          return HttpResponse.json({ tfa: ['recovery-code-1', 'recovery-code-2'] });
        }
        return new HttpResponse(JSON.stringify({ error: 'invalid one-time password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (tfa?.password === 'fail') {
        return new HttpResponse(JSON.stringify({ error: 'invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (tfa?.mode === 'disable') {
        profileTfaEnabled = false;
        return HttpResponse.json({ tfa: false });
      }

      return HttpResponse.json({
        tfa: 'otpauth://totp/Verdaccio:testuser?secret=JBSWY3DPEHPK3PXP&issuer=Verdaccio',
      });
    }) as unknown as MswResolver),
  ];
};
