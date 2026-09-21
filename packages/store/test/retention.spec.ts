import { describe, expect, test } from 'vitest';

import type { Manifest } from '@verdaccio/types';

import { computePrunableVersions } from '../src/lib/retention';

function manifestWith(versions: string[], tags: Record<string, string> = {}): Manifest {
  const now = Date.now();
  const manifest: Manifest = {
    name: 'foo',
    'dist-tags': { latest: versions[versions.length - 1], ...tags },
    versions: {},
    time: {},
  } as any;
  versions.forEach((version, index) => {
    manifest.versions[version] = { name: 'foo', version } as any;
    manifest.time![version] = new Date(now - (versions.length - index) * 86400000).toISOString();
  });
  return manifest;
}

describe('retention', () => {
  test('keeps newest max_versions and never removes latest', () => {
    const manifest = manifestWith(['1.0.0', '1.1.0', '2.0.0', '2.1.0']);
    const removals = computePrunableVersions(manifest, { enabled: true, max_versions: 2 });
    const removedVersions = removals.map((r) => r.version);
    // latest is 2.1.0 and is always protected, so excess is taken from the oldest
    expect(removedVersions).toContain('1.0.0');
    expect(removedVersions).not.toContain('2.1.0');
  });

  test('keeps tagged versions when keep_tagged is on', () => {
    const manifest = manifestWith(['1.0.0', '1.1.0', '2.0.0'], { beta: '1.0.0' });
    const removals = computePrunableVersions(manifest, {
      enabled: true,
      max_versions: 1,
      keep_tagged: true,
    });
    expect(removals.map((r) => r.version)).toEqual(['1.1.0']);
  });

  test('removes by age', () => {
    const manifest = manifestWith(['1.0.0', '2.0.0']);
    manifest.time!['1.0.0'] = new Date(Date.now() - 400 * 86400000).toISOString();
    const removals = computePrunableVersions(manifest, { enabled: true, max_age_days: 30 });
    expect(removals.map((r) => r.version)).toEqual(['1.0.0']);
    expect(removals[0].reason).toBe('max_age_days');
  });

  test('never empties a package', () => {
    const manifest = manifestWith(['1.0.0']);
    manifest.time!['1.0.0'] = new Date(Date.now() - 400 * 86400000).toISOString();
    expect(computePrunableVersions(manifest, { enabled: true, max_age_days: 1 })).toEqual([]);
  });
});
