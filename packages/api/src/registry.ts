import buildDebug from 'debug';
import { timingSafeEqual } from 'node:crypto';
import type { Router } from 'express';

import type { Auth } from '@verdaccio/auth';
import { API_ERROR, HTTP_STATUS, errorUtils, reqUtils } from '@verdaccio/core';
import {
  REGISTRY_API_ENDPOINTS,
  getRegistryMetrics,
  getRequestMetrics,
} from '@verdaccio/middleware';
import { Storage, assertPackageVisibility, canPublish } from '@verdaccio/store';
import type { Config, Logger } from '@verdaccio/types';

import type { $NextFunctionVer, $RequestExtend, $ResponseExtend } from '../types/custom';

const debug = buildDebug('verdaccio:api:registry');

const DAY = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// npm bulk download queries are capped on the public registry too
const MAX_RANGE_DAYS = 366;

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY) {
    days.push(toDay(new Date(t)));
  }
  return days;
}

function pointRange(period: string): { start: string; end: string } | null {
  const spans: Record<string, number> = {
    'last-day': 1,
    'last-week': 7,
    'last-month': 30,
    'last-year': 365,
  };
  const days = spans[period];
  if (!days) {
    return null;
  }
  const end = toDay(new Date());
  const start = toDay(new Date(Date.now() - (days - 1) * DAY));
  return { start, end };
}

function parseRange(period: string): { start: string; end: string } | null {
  const match = period.match(/^(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?$/);
  if (!match) {
    return null;
  }
  const start = match[1];
  const end = match[2] ?? match[1];
  if (Date.parse(`${end}T00:00:00Z`) < Date.parse(`${start}T00:00:00Z`)) {
    return null;
  }
  return { start, end };
}

function bearerMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || !provided.startsWith('Bearer ')) {
    return false;
  }
  const token = provided.slice(7);
  if (token.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/**
 * Prometheus scrape endpoint. The bearer token is not a registry credential,
 * so this must be mounted before the JWT middleware — the middleware answers
 * a hard 401 on foreign bearer tokens before the route could check its own
 * token (same reason the OIDC exchange mounts early).
 */
export function metrics(route: Router, config: Config, storage: Storage, logger: Logger): void {
  route.get(
    REGISTRY_API_ENDPOINTS.prometheus_metrics,
    async function (
      req: $RequestExtend,
      res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const metricsConfig = config.metrics;
        if (metricsConfig?.enabled !== true) {
          throw errorUtils.getNotFound();
        }
        if (
          typeof metricsConfig?.token === 'string' &&
          metricsConfig.token !== '' &&
          bearerMatches(req.get('authorization'), metricsConfig.token) === false
        ) {
          throw errorUtils.getUnauthorized('metrics token required');
        }
        const requests = getRequestMetrics();
        const events = getRegistryMetrics();
        const packages = await storage.getLocalDatabase().catch(() => []);
        const downloads = await storage.getAllPackageDownloads().catch(() => ({}));
        const totalDownloads = Object.values(downloads).reduce(
          (sum, stats) => sum + Object.values(stats).reduce((s, n) => s + n, 0),
          0
        );
        const lines = [
          '# HELP verdaccio_http_requests_total Finished HTTP responses.',
          '# TYPE verdaccio_http_requests_total counter',
          `verdaccio_http_requests_total ${requests.total}`,
          '# HELP verdaccio_http_responses_total Finished HTTP responses by status class.',
          '# TYPE verdaccio_http_responses_total counter',
          ...Object.entries(requests.byStatus).map(
            ([status, count]) => `verdaccio_http_responses_total{status="${status}"} ${count}`
          ),
          '# HELP verdaccio_registry_publishes_total Successful publish operations.',
          '# TYPE verdaccio_registry_publishes_total counter',
          `verdaccio_registry_publishes_total ${events.publishes}`,
          '# HELP verdaccio_registry_unpublishes_total Successful unpublish operations.',
          '# TYPE verdaccio_registry_unpublishes_total counter',
          `verdaccio_registry_unpublishes_total ${events.unpublishes}`,
          '# HELP verdaccio_registry_tarball_requests_total Tarball downloads served.',
          '# TYPE verdaccio_registry_tarball_requests_total counter',
          `verdaccio_registry_tarball_requests_total ${events.tarballDownloads}`,
          '# HELP verdaccio_registry_tarball_downloads_total Persisted tarball download count.',
          '# TYPE verdaccio_registry_tarball_downloads_total counter',
          `verdaccio_registry_tarball_downloads_total ${totalDownloads}`,
          '# HELP verdaccio_registry_packages Locally stored packages.',
          '# TYPE verdaccio_registry_packages gauge',
          `verdaccio_registry_packages ${packages.length}`,
          '# HELP verdaccio_process_uptime_seconds Registry process uptime.',
          '# TYPE verdaccio_process_uptime_seconds gauge',
          `verdaccio_process_uptime_seconds ${process.uptime().toFixed(3)}`,
          '# HELP verdaccio_process_memory_rss_bytes Resident set size.',
          '# TYPE verdaccio_process_memory_rss_bytes gauge',
          `verdaccio_process_memory_rss_bytes ${process.memoryUsage().rss}`,
        ];
        res.set('content-type', 'text/plain; version=0.0.4; charset=utf-8');
        res.status(HTTP_STATUS.OK).send(`${lines.join('\n')}\n`);
      } catch (err: any) {
        next(err);
      }
    }
  );
  logger.debug('metrics endpoint registered');
}

export default function (
  route: Router,
  auth: Auth,
  config: Config,
  storage: Storage,
  logger: Logger
): void {
  // npm audit signatures fetches the registry key set; 404 means unsigned
  route.get(
    REGISTRY_API_ENDPOINTS.signing_keys,
    function (_req: $RequestExtend, _res: $ResponseExtend, next: $NextFunctionVer): void {
      const keys = storage.getRegistryPublicKeys();
      if (keys === null) {
        return next(errorUtils.getNotFound('registry signing is disabled'));
      }
      next({ keys });
    }
  );

  route.get(
    REGISTRY_API_ENDPOINTS.attestations,
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        // express already decodes each wildcard segment; decoding again would
        // corrupt names containing a literal '%'
        const spec = [req.params.spec ?? []].flat().join('/');
        const at = spec.lastIndexOf('@');
        if (at <= 0) {
          throw errorUtils.getBadRequest(API_ERROR.UNSUPORTED_REGISTRY_CALL);
        }
        const name = spec.slice(0, at);
        const version = spec.slice(at + 1);
        debug('attestations for %o@%o', name, version);
        await assertPackageVisibility(auth, storage, name, req.remote_user);
        const attestations = await storage.getAttestations(name, version);
        if (attestations.length === 0) {
          throw errorUtils.getNotFound(`no attestations for ${name}@${version}`);
        }
        next({ attestations });
      } catch (err: any) {
        next(err);
      }
    }
  );

  // CouchDB-compat view npm <=10 stars queries
  route.get(
    REGISTRY_API_ENDPOINTS.starred_by_user,
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const raw = req.query.key;
        if (typeof raw !== 'string') {
          throw errorUtils.getBadRequest('key query parameter is required');
        }
        let username: unknown;
        try {
          username = JSON.parse(raw);
        } catch {
          throw errorUtils.getBadRequest('key must be a JSON-encoded username');
        }
        if (typeof username !== 'string' || username === '') {
          throw errorUtils.getBadRequest('key must be a JSON-encoded username');
        }
        const packages = await storage.getLocalDatabase();
        const rows: { value: string }[] = [];
        for (const pkg of packages) {
          if ((pkg as any).users?.[username as string] !== true) {
            continue;
          }
          // a starred private package must not leak its name to a caller who
          // could not publish it — same rule the search endpoint applies
          if (
            (pkg as any).visibility === 'private' &&
            (await canPublish(auth, pkg.name, req.remote_user)) === false
          ) {
            continue;
          }
          rows.push({ value: pkg.name });
        }
        next({ rows });
      } catch (err: any) {
        next(err);
      }
    }
  );

  route.get(
    REGISTRY_API_ENDPOINTS.downloads,
    async function (
      req: $RequestExtend,
      _res: $ResponseExtend,
      next: $NextFunctionVer
    ): Promise<void> {
      try {
        const kind = reqUtils.paramToString(req.params.kind);
        const period = reqUtils.paramToString(req.params.period);
        const packageName = req.params.package
          ? reqUtils.paramToString(req.params.package)
          : undefined;

        if (kind !== 'point' && kind !== 'range') {
          throw errorUtils.getNotFound();
        }
        // npm accepts both named spans and explicit date ranges for point
        const range =
          kind === 'point' ? (pointRange(period) ?? parseRange(period)) : parseRange(period);
        if (range === null || !DATE_RE.test(range.start) || !DATE_RE.test(range.end)) {
          throw errorUtils.getBadRequest(`invalid period ${period}`);
        }
        const days = eachDay(range.start, range.end);
        if (days.length > MAX_RANGE_DAYS) {
          throw errorUtils.getBadRequest(`period exceeds ${MAX_RANGE_DAYS} days`);
        }

        if (typeof packageName === 'string') {
          await assertPackageVisibility(auth, storage, packageName, req.remote_user);
          const stats = await storage.getPackageDownloads(packageName);
          if (kind === 'point') {
            const downloads = days.reduce((sum, day) => sum + (stats[day] ?? 0), 0);
            return next({ downloads, start: range.start, end: range.end, package: packageName });
          }
          return next({
            downloads: days.map((day) => ({ downloads: stats[day] ?? 0, day })),
            start: range.start,
            end: range.end,
            package: packageName,
          });
        }

        // bulk queries aggregate over packages the caller may see
        const allStats = await storage.getAllPackageDownloads();
        const visible: Record<string, Record<string, number>> = {};
        for (const name of Object.keys(allStats)) {
          try {
            await assertPackageVisibility(auth, storage, name, req.remote_user);
            visible[name] = allStats[name];
          } catch {
            // not visible to this caller
          }
        }
        if (kind === 'point') {
          return next({
            downloads: Object.entries(visible).map(([pkgName, stats]) => ({
              downloads: days.reduce((sum, day) => sum + (stats[day] ?? 0), 0),
              package: pkgName,
            })),
            start: range.start,
            end: range.end,
          });
        }
        return next({
          downloads: days.map((day) => ({
            downloads: Object.values(visible).reduce((sum, stats) => sum + (stats[day] ?? 0), 0),
            day,
          })),
          start: range.start,
          end: range.end,
        });
      } catch (err: any) {
        next(err);
      }
    }
  );

  logger.debug('registry parity endpoints registered');
}
