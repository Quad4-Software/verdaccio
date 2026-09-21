import { describe, expect, test } from 'vitest';

import { authUtils } from '../src';

describe('Auth Utilities', () => {
  describe('createSessionToken', () => {
    test('should generate session token', () => {
      expect(authUtils.createSessionToken()).toHaveProperty('expires');
      expect(authUtils.createSessionToken().expires).toBeInstanceOf(Date);
    });
  });

  describe('getAuthenticatedMessage', () => {
    test('should generate user message token', () => {
      expect(authUtils.getAuthenticatedMessage('foo')).toEqual("you are authenticated as 'foo'");
    });
  });

  describe('buildUserBuffer', () => {
    test('should build user buffer', () => {
      expect(authUtils.buildUserBuffer('foo', 'bar')).toEqual(Buffer.from('foo:bar'));
    });
  });

  describe('buildToken', () => {
    test('should build Basic token', () => {
      expect(authUtils.buildToken('basic', 'foo')).toEqual('Basic foo');
    });
    test('should build Bearer token', () => {
      expect(authUtils.buildToken('bearer', 'foo')).toEqual('Bearer foo');
    });
  });

  describe('getMatchedPackagesSpec', () => {
    test('should test basic config', () => {
      const packages = {
        react: {
          access: 'admin',
          publish: 'admin',
          proxy: 'facebook',
        },
        angular: {
          access: 'admin',
          publish: 'admin',
          proxy: 'google',
        },
        '@*/*': {
          access: '$all',
          publish: '$authenticated',
          proxy: 'npmjs',
        },
        '**': {
          access: '$all',
          publish: '$authenticated',
          proxy: 'npmjs',
        },
      };
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('react', packages).proxy).toMatch('facebook');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('angular', packages).proxy).toMatch('google');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('vue', packages).proxy).toMatch('npmjs');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('@scope/vue', packages).proxy).toMatch('npmjs');
    });

    test('should test no ** wildcard on config', () => {
      const packages = {
        react: {
          access: 'admin',
          publish: 'admin',
          proxy: 'facebook',
        },
        angular: {
          access: 'admin',
          publish: 'admin',
          proxy: 'google',
        },
        '@fake/*': {
          access: '$all',
          publish: '$authenticated',
          proxy: 'npmjs',
        },
      };
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('react', packages).proxy).toMatch('facebook');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('angular', packages).proxy).toMatch('google');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('@fake/angular', packages).proxy).toMatch('npmjs');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('vue', packages)).toBeUndefined();
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('@scope/vue', packages)).toBeUndefined();
    });

    test('should match a rule regardless of package name casing', () => {
      const packages = {
        lodash: {
          access: 'admin',
          publish: 'admin',
          proxy: 'custom',
        },
        '@scope/*': {
          access: 'admin',
          publish: 'admin',
          proxy: 'custom',
        },
        '**': {
          access: '$all',
          publish: '$all',
          proxy: 'npmjs',
        },
      };
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('lodash', packages).proxy).toMatch('custom');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('Lodash', packages).proxy).toMatch('custom');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('LODASH', packages).proxy).toMatch('custom');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('@Scope/Pkg', packages).proxy).toMatch('custom');
    });

    test('should return multiple uplinks in given order', () => {
      const packages = {
        react: {
          access: 'admin',
          publish: 'admin',
          proxy: 'github npmjs',
        },
        angular: {
          access: 'admin',
          publish: 'admin',
          proxy: 'npmjs gitlab',
        },
        '@fake/*': {
          access: '$all',
          publish: '$authenticated',
          proxy: 'npmjs gitlab github',
        },
      };
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('react', packages).proxy).toMatch('github npmjs');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('angular', packages).proxy).toMatch('npmjs gitlab');
      // @ts-expect-error
      expect(authUtils.getMatchedPackagesSpec('@fake/angular', packages).proxy).toMatch(
        'npmjs gitlab github'
      );
    });
  });

  describe('matchPackagePatterns', () => {
    test('unscoped tokens match any package', () => {
      expect(authUtils.matchPackagePatterns('foo')).toBe(true);
      expect(authUtils.matchPackagePatterns('foo', [])).toBe(true);
      expect(authUtils.matchPackagePatterns('foo', undefined)).toBe(true);
    });

    test('exact and wildcard patterns', () => {
      expect(authUtils.matchPackagePatterns('foo', ['foo'])).toBe(true);
      expect(authUtils.matchPackagePatterns('foo', ['bar', 'foo'])).toBe(true);
      expect(authUtils.matchPackagePatterns('foo', ['bar'])).toBe(false);
      expect(authUtils.matchPackagePatterns('@scope/pkg', ['@scope/*'])).toBe(true);
      expect(authUtils.matchPackagePatterns('@other/pkg', ['@scope/*'])).toBe(false);
      expect(authUtils.matchPackagePatterns('foo-bar', ['foo-*'])).toBe(true);
    });

    test('matching is case-insensitive like packages rules', () => {
      expect(authUtils.matchPackagePatterns('Foo', ['foo'])).toBe(true);
      expect(authUtils.matchPackagePatterns('@Scope/Pkg', ['@scope/*'])).toBe(true);
    });

    test('invalid patterns never match', () => {
      expect(authUtils.matchPackagePatterns('foo', ['[invalid'])).toBe(false);
      expect(authUtils.matchPackagePatterns('foo', ['[invalid', 'foo'])).toBe(true);
    });
  });
});
