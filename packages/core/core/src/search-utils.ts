import type { SearchPackageBody as _SearchPackageBody } from '@verdaccio/types';

export type SearchMetrics = {
  quality: number;
  popularity: number;
  maintenance: number;
};
export type UnStable = {
  flags?: {
    // if is false is not be included in search results (majority are stable)
    unstable?: boolean;
  };
};
export type SearchItemPkg = {
  name: string;
  scoped?: string;
  path?: string;
  time?: number | Date;
};

type PrivatePackage = {
  // note: prefixed to avoid external conflicts

  // the package is published as private
  verdaccioPrivate?: boolean;
  // if the package is not private but is cached
  verdaccioPkgCached?: boolean;
  // packument-level visibility flag, only local packages can carry it
  visibility?: string;
};

export interface SearchItem extends UnStable, PrivatePackage {
  package: SearchItemPkg;
  score: Score;
}

export type Score = {
  final: number;
  detail: SearchMetrics;
};

export type SearchResults = {
  objects: SearchItemPkg[];
  total: number;
  time: string;
};

export type SearchPackageBody = _SearchPackageBody;

export interface SearchPackageItem extends UnStable, PrivatePackage {
  package: SearchPackageBody;
  score: Score;
  searchScore?: number;
}

export const UNSCOPED = 'unscoped';

export type SearchQuery = {
  text: string;
  size?: number;
  from?: number;
} & SearchMetrics;

/**
 * npm-style quality heuristic: documentation surface, declared metadata and
 * semantic-release shape contribute equally weighted signals in [0, 1].
 */
export function computeQuality(pkg: SearchPackageBody): number {
  let score = 0;
  if (typeof pkg.description === 'string' && pkg.description.length > 0) {
    score += 0.2;
  }
  const keywords = pkg.keywords;
  if (Array.isArray(keywords) ? keywords.length > 0 : typeof keywords === 'string' && keywords) {
    score += 0.2;
  }
  if (typeof pkg.license === 'string' && pkg.license.length > 0) {
    score += 0.2;
  }
  if (pkg.links && (pkg.links.repository || pkg.links.homepage)) {
    score += 0.2;
  }
  if (
    (pkg.maintainers?.length ?? 0) > 0 ||
    pkg.author !== undefined ||
    pkg.publisher !== undefined
  ) {
    score += 0.1;
  }
  if (typeof pkg.version === 'string' && /^\d+\.\d+\.\d+$/.test(pkg.version)) {
    score += 0.1;
  }
  return Math.min(1, score);
}

/**
 * Popularity in [0, 1]: log-scaled download share against the most-downloaded
 * package in the set, so a private registry's modest numbers still spread.
 */
export function computePopularity(downloads: number, maxDownloads: number): number {
  if (downloads <= 0 || maxDownloads <= 0) {
    return 0;
  }
  return Math.log1p(downloads) / Math.log1p(maxDownloads);
}

/**
 * Maintenance in [0, 1]: recency decay with a one-year half-life; a package
 * without a date scores neutrally rather than being punished.
 */
export function computeMaintenance(date: string | undefined, now: number = Date.now()): number {
  const parsed = date ? Date.parse(date) : NaN;
  if (Number.isNaN(parsed)) {
    return 0.5;
  }
  // day granularity: two publishes on the same day tie so ranking stays
  // stable for batches published together
  const ageDays = Math.max(0, Math.floor((now - parsed) / (24 * 60 * 60 * 1000)));
  return Math.exp(-(ageDays / 365) * Math.LN2);
}

/**
 * Weights come from npm's `quality`/`popularity`/`maintenance` query params;
 * absent or malformed params fall back to equal thirds and are clamped so a
 * crafted query cannot dominate or invert the ranking.
 */
export function normalizeSearchWeights(query: {
  quality?: unknown;
  popularity?: unknown;
  maintenance?: unknown;
}): SearchMetrics {
  const read = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 1) : null;
  };
  const quality = read(query.quality);
  const popularity = read(query.popularity);
  const maintenance = read(query.maintenance);
  if (quality === null && popularity === null && maintenance === null) {
    return { quality: 1 / 3, popularity: 1 / 3, maintenance: 1 / 3 };
  }
  return {
    quality: quality ?? 0,
    popularity: popularity ?? 0,
    maintenance: maintenance ?? 0,
  };
}
