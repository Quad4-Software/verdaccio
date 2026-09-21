import buildDebug from 'debug';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, dirname, normalize } from 'node:path';

import { DIST_TAGS } from '@verdaccio/core';
import type { Manifest, RetentionConfig } from '@verdaccio/types';

const debug = buildDebug('verdaccio:storage:retention');

export const RETENTION_DEFAULT_INTERVAL_MINUTES = 24 * 60;
// hard ceiling so a misconfigured policy cannot wipe a whole registry in one pass
export const MAX_REMOVALS_PER_SWEEP = 1000;

export interface RetentionRemoval {
  name: string;
  version: string;
  reason: 'max_versions' | 'max_age_days';
}

export interface RetentionReport {
  dryRun: boolean;
  removed: RetentionRemoval[];
  errors: { name: string; message: string }[];
}

export function isExcluded(name: string, patterns: string[] = []): boolean {
  return patterns.some((pattern) => {
    if (pattern === '*' || pattern === name) {
      return true;
    }
    if (pattern.endsWith('/*')) {
      return name.startsWith(pattern.slice(0, -1));
    }
    return false;
  });
}

/**
 * Decide which versions of a manifest a retention sweep may remove.
 *
 * Never removed: the `latest` dist-tag target, every other dist-tag target
 * when `keep_tagged` is on (the default), the newest version overall, and
 * enough versions to leave at least one publishable version behind.
 */
export function computePrunableVersions(
  manifest: Manifest,
  cfg: RetentionConfig
): RetentionRemoval[] {
  const versions = Object.keys(manifest.versions ?? {});
  if (versions.length <= 1) {
    return [];
  }
  const keepTagged = cfg.keep_tagged !== false;
  const tagged = new Set<string>(Object.values(manifest[DIST_TAGS] ?? {}));
  const latest = manifest[DIST_TAGS]?.latest;

  // a missing or unparseable timestamp must never count as infinitely old —
  // those versions are simply not prunable
  const ageOf = (version: string): number | null => {
    const stamp = manifest.time?.[version];
    const parsed = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
    return Number.isNaN(parsed) ? null : parsed;
  };
  // oldest first
  const sorted = [...versions].sort((a, b) => (ageOf(a) ?? Infinity) - (ageOf(b) ?? Infinity));
  const newest = sorted[sorted.length - 1];

  const removable = sorted.filter(
    (version) =>
      version !== latest &&
      version !== newest &&
      ageOf(version) !== null &&
      (!keepTagged || !tagged.has(version))
  );

  const now = Date.now();
  const byAge =
    cfg.max_age_days && cfg.max_age_days > 0
      ? new Set(
          removable.filter(
            (version) => now - ageOf(version)! > cfg.max_age_days! * 24 * 60 * 60 * 1000
          )
        )
      : new Set<string>();

  const maxVersions = cfg.max_versions ?? 0;
  const survivingCount = versions.length; // tagged/newest always survive
  let byCount = new Set<string>();
  if (maxVersions > 0) {
    const untagged = removable.filter((v) => !byAge.has(v));
    const excess = survivingCount - maxVersions;
    if (excess > 0) {
      byCount = new Set(untagged.slice(0, excess));
    }
  }

  return removable
    .filter((v) => byAge.has(v) || byCount.has(v))
    .map((version) => ({
      name: manifest.name,
      version,
      reason: byAge.has(version) ? ('max_age_days' as const) : ('max_versions' as const),
    }));
}

/**
 * Sum the size of the storage directory. Callers are expected to cache the
 * result; a full walk on every request would be too expensive.
 */
export async function measureStorageBytes(storageDir: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size;
        } catch {
          // file vanished mid-walk
        }
      }
    }
  };
  await walk(storageDir);
  debug('measured storage at %o bytes', total);
  return total;
}

export function resolveStorageDir(configPath: string, storage: string): string {
  return isAbsolute(storage) ? normalize(storage) : normalize(join(dirname(configPath), storage));
}
