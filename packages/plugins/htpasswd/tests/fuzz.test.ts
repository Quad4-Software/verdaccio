import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { constants } from '@verdaccio/core';

import {
  addUserToHTPasswd,
  parseHTPasswd,
  removeUserFromHTPasswd,
  sanityCheck,
  verifyPassword,
} from '../src/utils';

const hashConfig = { algorithm: constants.HtpasswdHashAlgorithm.sha1 };

// uri-safe usernames are the only ones addUserToHTPasswd accepts
const safeUser = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s === encodeURIComponent(s) && s.trim() !== '' && !s.includes(':'));

const bodyFromEntries = (entries: Array<[string, string]>) =>
  entries.map(([u, h]) => `${u}:${h}`).join('\n');

describe('fuzz: htpasswd parsing', () => {
  test('parseHTPasswd never throws and yields only string values', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const parsed = parseHTPasswd(input);
        expect(typeof parsed).toBe('object');
        for (const [key, value] of Object.entries(parsed)) {
          expect(typeof key).toBe('string');
          expect(typeof value).toBe('string');
        }
      })
    );
  });

  test('a __proto__ line cannot pollute the result prototype', () => {
    fc.assert(
      fc.property(fc.string(), (hash) => {
        const parsed = parseHTPasswd(`__proto__:${hash}\nuser:abc`);
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        // the setter ignores non-object values, so no own property is created
        expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);
      })
    );
  });

  test('parseHTPasswd output keys never contain separators', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.string(), fc.string())), (entries) => {
        const parsed = parseHTPasswd(bodyFromEntries(entries));
        for (const key of Object.keys(parsed)) {
          expect(key.includes(':')).toBe(false);
        }
      })
    );
  });
});

describe('fuzz: htpasswd mutation metamorphics', () => {
  test('add then remove restores the original user set', async () => {
    await fc.assert(
      fc.asyncProperty(safeUser, fc.string({ minLength: 1 }), async (user, password) => {
        const original = parseHTPasswd('existing:hashvalue');
        const withUser = await addUserToHTPasswd('existing:hashvalue', user, password, hashConfig);
        expect(Object.keys(parseHTPasswd(withUser))).toContain(user);
        const without = removeUserFromHTPasswd(withUser, user);
        expect(Object.keys(parseHTPasswd(without)).sort()).toEqual(Object.keys(original).sort());
      }),
      { numRuns: 30 }
    );
  });

  test('a freshly added password verifies against its stored hash', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeUser,
        fc.string({ minLength: 1, maxLength: 60 }),
        async (user, password) => {
          const body = await addUserToHTPasswd('', user, password, hashConfig);
          const hash = parseHTPasswd(body)[user];
          expect(typeof hash).toBe('string');
          expect(await verifyPassword(password, hash)).toBe(true);
          // the wrong password must not verify
          expect(await verifyPassword(`${password}x`, hash)).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });

  test('non-uri-safe usernames are always rejected with conflict', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((s) => s !== encodeURIComponent(s)),
        async (user) => {
          await expect(addUserToHTPasswd('', user, 'pw', hashConfig)).rejects.toMatchObject({
            status: 409,
          });
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('fuzz: sanityCheck', () => {
  const noopVerify = () => Promise.resolve(false);

  test('never throws on arbitrary users and user maps', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.string(),
        fc.dictionary(fc.string(), fc.string()),
        async (user, password, users) => {
          const result = await sanityCheck(user, password, noopVerify, users, 1000);
          expect(result === null || result instanceof Error).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('magic property names do not masquerade as existing users', async () => {
    for (const user of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
      // none of these own the map, so an empty map must allow registration
      const result = await sanityCheck(user, 'password-1', noopVerify, {}, 1000);
      expect(result).toBeNull();
    }
  });
});
