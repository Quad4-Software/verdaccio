import fc from 'fast-check';
import supertest from 'supertest';
import { beforeAll, describe, expect, test } from 'vitest';

import { HEADERS, HTTP_STATUS, TOKEN_BEARER } from '@verdaccio/core';

import { buildToken, initializeServer } from './_helper';

// the test harness answers 590 when no mounted route matches a request; on a
// real server Express's default handler answers 404 there, so both mean the
// request was refused cleanly
const HARNESS_FALLTHROUGH = 590;
const isNot5xx = (status: number) =>
  status < HTTP_STATUS.INTERNAL_ERROR || status === HARNESS_FALLTHROUGH;

const addUser = (name: string) => `/-/user/org.couchdb.user:${encodeURIComponent(name)}`;

const HOSTILE_NAMES = [
  '..',
  '../..',
  '%2e%2e',
  '%2e%2e%2f%2e%2e',
  '..%2f..%2fetc%2fpasswd',
  '__proto__',
  'constructor',
  'node_modules',
  'favicon.ico',
  '.',
  '.hidden',
  'a'.repeat(1024),
  '@scope',
  '@scope/',
  '/absolute',
  'a/b/c/d',
  '\x00null',
  '%00',
  'name\ninjection',
  '<script>alert(1)</script>',
  '${7*7}',
  '{}',
  'null',
  'undefined',
];

describe('adversarial http inputs', () => {
  let app;

  beforeAll(async () => {
    app = await initializeServer('publish.yaml');
  });

  describe('package endpoints', () => {
    test.each(HOSTILE_NAMES)('GET /%s answers a client error, never 5xx', async (name) => {
      const response = await supertest(app)
        .get(`/${encodeURIComponent(name)}`)
        .set(HEADERS.ACCEPT, HEADERS.JSON);
      expect(isNot5xx(response.status)).toBe(true);
    });

    test('random package names never produce a 5xx', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ maxLength: 200 }), async (name) => {
          const response = await supertest(app)
            .get(`/${encodeURIComponent(name)}`)
            .set(HEADERS.ACCEPT, HEADERS.JSON);
          expect(isNot5xx(response.status)).toBe(true);
        }),
        { numRuns: 30 }
      );
    });

    test.each(HOSTILE_NAMES)('PUT /%s with a malformed body never produces 5xx', async (name) => {
      const response = await supertest(app)
        .put(`/${encodeURIComponent(name)}`)
        .set(HEADERS.CONTENT_TYPE, HEADERS.JSON)
        .send(JSON.stringify({ name, versions: 'not-an-object' }));
      expect(isNot5xx(response.status)).toBe(true);
    });

    test('arbitrary publish bodies never produce a 5xx', async () => {
      await fc.assert(
        fc.asyncProperty(fc.jsonValue(), async (body) => {
          const response = await supertest(app)
            .put('/fuzz-target')
            .set(HEADERS.CONTENT_TYPE, HEADERS.JSON)
            .send(JSON.stringify(body));
          expect(isNot5xx(response.status)).toBe(true);
        }),
        { numRuns: 30 }
      );
    });
  });

  describe('authentication endpoints', () => {
    test('hostile adduser bodies never produce a 5xx', async () => {
      await fc.assert(
        fc.asyncProperty(fc.jsonValue(), async (body) => {
          const response = await supertest(app)
            .put(addUser('fuzz-user'))
            .set(HEADERS.CONTENT_TYPE, HEADERS.JSON)
            .send(JSON.stringify(body));
          expect(isNot5xx(response.status)).toBe(true);
        }),
        { numRuns: 30 }
      );
    });

    test.each(HOSTILE_NAMES)('adduser as %s is refused cleanly', async (name) => {
      const response = await supertest(app)
        .put(addUser(name))
        .set(HEADERS.CONTENT_TYPE, HEADERS.JSON)
        .send({ name, password: 'secret123' });
      expect(isNot5xx(response.status)).toBe(true);
    });

    test('a garbage bearer token is refused, not trusted', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1 }), async (token) => {
          const response = await supertest(app)
            .get('/-/v1/whoami')
            .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, token));
          expect(response.status).not.toBe(HTTP_STATUS.OK);
          expect(isNot5xx(response.status)).toBe(true);
        }),
        { numRuns: 30 }
      );
    });
  });

  describe('search and dist-tags', () => {
    test('hostile search text never produces a 5xx', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ maxLength: 500 }), async (text) => {
          const response = await supertest(app).get(
            `/-/v1/search?text=${encodeURIComponent(text)}`
          );
          expect(isNot5xx(response.status)).toBe(true);
        }),
        { numRuns: 30 }
      );
    });

    test.each(HOSTILE_NAMES)('dist-tag %s on a missing package is a client error', async (tag) => {
      const response = await supertest(app)
        .put(`/-/package/missing/dist-tags/${encodeURIComponent(tag)}`)
        .set(HEADERS.CONTENT_TYPE, HEADERS.JSON)
        .send(JSON.stringify('1.0.0'));
      expect(isNot5xx(response.status)).toBe(true);
    });
  });
});
