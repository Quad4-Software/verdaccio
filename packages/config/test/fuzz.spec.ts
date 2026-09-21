import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { normalisePackageAccess, normalizeUserList } from '../src/package-access';

const whitespaceFree = fc.string({ minLength: 1 }).filter((s) => !/\s/.test(s));

describe('fuzz: normalizeUserList', () => {
  test('string input always produces a flat string array', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normalizeUserList(input);
        expect(Array.isArray(result)).toBe(true);
        for (const item of result) {
          expect(typeof item).toBe('string');
          // splitting on whitespace can only yield whitespace-free tokens
          expect(/\s/.test(item)).toBe(false);
        }
      })
    );
  });

  test('space-separated tokens appear in the result', () => {
    fc.assert(
      fc.property(fc.array(whitespaceFree, { minLength: 1 }), (tokens) => {
        const result = normalizeUserList(tokens.join(' '));
        for (const token of tokens) {
          expect(result).toContain(token);
        }
      })
    );
  });

  test('array input returns a flattened copy and never mutates the input', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (input) => {
        const snapshot = JSON.stringify(input);
        const result = normalizeUserList(input);
        expect(JSON.stringify(input)).toBe(snapshot);
        for (const item of result) {
          expect(typeof item).toBe('string');
        }
      })
    );
  });

  test('only non-empty objects throw; primitives and nil return an empty list', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.dictionary(fc.string(), fc.string(), { minKeys: 1 })
        ),
        (input) => {
          if (input !== null && typeof input === 'object') {
            expect(() => normalizeUserList(input)).toThrowError(/bad package acl/);
          } else {
            expect(normalizeUserList(input as any)).toEqual([]);
          }
        }
      )
    );
  });
});

describe('fuzz: normalisePackageAccess', () => {
  const accessEntry = fc.record(
    {
      access: fc.oneof(fc.string(), fc.array(fc.string()), fc.constant(undefined)),
      publish: fc.oneof(fc.string(), fc.array(fc.string()), fc.constant(undefined)),
      proxy: fc.oneof(fc.string(), fc.array(fc.string()), fc.constant(undefined)),
      unpublish: fc.oneof(fc.string(), fc.array(fc.string()), fc.constant(undefined)),
      stage: fc.oneof(fc.string(), fc.array(fc.string()), fc.constant(undefined)),
      visibility: fc.oneof(fc.string(), fc.array(fc.string()), fc.constant(undefined)),
    },
    { requiredKeys: [] }
  );

  test('every rule field normalizes to the expected shape', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom('**', '@*/*', 'a-*', 'pkg'), accessEntry),
        (packages) => {
          const normalized = normalisePackageAccess(packages);
          for (const rule of Object.values(normalized)) {
            expect(Array.isArray(rule.access)).toBe(true);
            expect(Array.isArray(rule.publish)).toBe(true);
            expect(Array.isArray(rule.proxy)).toBe(true);
            // unpublish and stage fall back to false, not an empty list
            for (const key of ['unpublish', 'stage'] as const) {
              expect(rule[key] === false || Array.isArray(rule[key])).toBe(true);
            }
            // visibility stays undefined when unset so callers can tell unset
            // from an explicitly empty list
            expect(rule.visibility === undefined || Array.isArray(rule.visibility)).toBe(true);
          }
        }
      )
    );
  });

  test('normalization is idempotent', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom('**', 'pkg'), accessEntry), (packages) => {
        const once = normalisePackageAccess(packages);
        const twice = normalisePackageAccess(once);
        expect(twice).toEqual(once);
      })
    );
  });
});
