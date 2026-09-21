import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  authUtils,
  cryptoUtils,
  errorUtils,
  pkgUtils,
  reqUtils,
  stringUtils,
  validationUtils,
} from '../src';

// names that must never pass validation (traversal, reserved words, separators)
const BLOCKED_NAMES = [
  '__proto__',
  '..',
  '../etc/passwd',
  '..\\..\\windows',
  'a/b/c',
  '@scope/',
  '/name',
  'name\x00.tgz',
  'node_modules',
  'favicon.ico',
  '.hidden',
  '%2e%2e%2f',
  ' ',
  '',
];

// additional hostile corpus entries that may legitimately validate
const HOSTILE_NAMES = [
  ...BLOCKED_NAMES,
  'constructor',
  'prototype',
  'toString',
  '@scope',
  'a'.repeat(4096),
  '\u{1f480}',
  'ÿþ',
];

const arbitraryText = fc.string({ maxLength: 300 });
const maybeText = fc.oneof(arbitraryText, fc.constantFrom(...HOSTILE_NAMES));

describe('fuzz: validation utils', () => {
  test('validatePackage never throws and bounds segment count', () => {
    fc.assert(
      fc.property(maybeText, (name) => {
        const valid = validationUtils.validatePackage(name);
        expect(typeof valid).toBe('boolean');
        if (valid) {
          expect(name.split('/').length).toBeLessThanOrEqual(2);
          expect(BLOCKED_NAMES.includes(name)).toBe(false);
        }
      })
    );
  });

  test('validateName never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        // @ts-expect-error the point of the fuzz is off-contract input
        expect(typeof validationUtils.validateName(input)).toBe('boolean');
      })
    );
  });

  test('a scoped package is valid only when both parts are', () => {
    fc.assert(
      fc.property(maybeText, maybeText, (scope, name) => {
        const full = `@${scope}/${name}`;
        if (validationUtils.validatePackage(full)) {
          expect(validationUtils.validateName(scope)).toBe(true);
          expect(validationUtils.validateName(name)).toBe(true);
        }
      })
    );
  });

  test('validatePassword never throws, even on arbitrary policy strings', () => {
    fc.assert(
      fc.property(maybeText, fc.string(), (password, policy) => {
        expect(typeof validationUtils.validatePassword(password, policy)).toBe('boolean');
      })
    );
  });
});

describe('fuzz: auth utils', () => {
  const arbitraryUser = fc.record(
    {
      name: fc.oneof(fc.string(), fc.constant(undefined)),
      groups: fc.oneof(fc.array(fc.string()), fc.constant(undefined)),
    },
    { requiredKeys: [] }
  );

  test('isUserInGroups never throws on arbitrary users and lists', () => {
    fc.assert(
      fc.property(arbitraryUser, fc.array(fc.string()), (user, groups) => {
        // @ts-expect-error fuzz feeds off-contract shapes
        expect(typeof authUtils.isUserInGroups(user, groups)).toBe('boolean');
      })
    );
  });

  test('isAdmin never throws, and nameless users are never admin', () => {
    fc.assert(
      fc.property(arbitraryUser, fc.array(fc.string()), (user, admins) => {
        // @ts-expect-error fuzz feeds off-contract shapes
        const result = authUtils.isAdmin(user, admins);
        expect(typeof result).toBe('boolean');
        if (typeof user.name !== 'string' || user.name === '') {
          expect(result).toBe(false);
        }
      })
    );
  });

  test('buildToken output always round-trips the token after the type prefix', () => {
    fc.assert(
      fc.property(
        // the type is a fixed scheme word in practice; spaces would shift the split
        fc.string({
          unit: fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
          ),
        }),
        fc.string(),
        (type, token) => {
          const built = authUtils.buildToken(type, token);
          expect(built.split(' ').slice(1).join(' ')).toBe(token);
        }
      )
    );
  });
});

describe('fuzz: metadata and request helpers', () => {
  test('normalizeMetadata is idempotent and always yields the packument shape', () => {
    fc.assert(
      fc.property(fc.record({ name: fc.string() }, { requiredKeys: ['name'] }), (manifest: any) => {
        const once = validationUtils.normalizeMetadata(manifest, manifest.name);
        const twice = validationUtils.normalizeMetadata(once, manifest.name);
        expect(twice).toEqual(once);
        for (const key of ['dist-tags', 'maintainers', 'versions', 'time']) {
          expect(once[key]).toBeDefined();
        }
      })
    );
  });

  test('paramToString always returns a string', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.array(fc.string()), fc.constant(undefined)), (p) => {
        expect(typeof reqUtils.paramToString(p)).toBe('string');
      })
    );
  });

  test('getByQualityPriorityValue never throws on accept headers', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null)), (header) => {
        expect(typeof stringUtils.getByQualityPriorityValue(header)).toBe('string');
      })
    );
  });

  test('semverSanitize never throws on arbitrary versions', () => {
    fc.assert(
      fc.property(arbitraryText, (version) => {
        expect(typeof pkgUtils.semverSanitize(version)).toBe('string');
      })
    );
  });
});

describe('fuzz: crypto and error utils', () => {
  test('stringToMD5 is deterministic and hex-shaped', () => {
    fc.assert(
      fc.property(arbitraryText, (input) => {
        const hash = cryptoUtils.stringToMD5(input);
        expect(hash).toMatch(/^[0-9a-f]{32}$/);
        expect(cryptoUtils.stringToMD5(input)).toBe(hash);
      })
    );
  });

  test('mask keeps the first and last characters of long inputs', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 8 }), (input) => {
        const masked = cryptoUtils.mask(input);
        expect(masked).toBe(`${input.slice(0, 3)}...${input.slice(-3)}`);
      })
    );
    // short inputs get padded, never crash
    fc.assert(
      fc.property(fc.string({ maxLength: 7 }), (input) => {
        expect(typeof cryptoUtils.mask(input)).toBe('string');
      })
    );
  });

  test('getCode always produces an error carrying its status', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 599 }), arbitraryText, (status, message) => {
        const err = errorUtils.getCode(status, message);
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(status);
      })
    );
  });
});
