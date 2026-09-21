import buildDebug from 'debug';
import gunzipMaybe from 'gunzip-maybe';
import { Readable } from 'node:stream';
import * as tarStream from 'tar-stream';

import type {
  Logger,
  PackageScanFinding,
  PackageScanResult,
  ScanConfig,
  Version,
} from '@verdaccio/types';

const debug = buildDebug('verdaccio:storage:scan');

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const NATIVE_FILE_PATTERN = /\.(node|so|dll|exe|dylib)$|(^|\/)binding\.gyp$/;
const DEFAULT_OSV_URL = 'https://api.osv.dev';
const DEFAULT_OSV_TIMEOUT_MS = 5000;
// bound the scan so a hostile tarball with millions of entries cannot
// exhaust memory; listing beyond the cap is reported as a finding
const MAX_SCAN_ENTRIES = 50_000;

/**
 * List entry names inside a (possibly gzipped) tarball buffer.
 */
async function listTarballEntries(
  buffer: Buffer
): Promise<{ names: string[]; truncated: boolean }> {
  const names: string[] = [];
  let truncated = false;
  const readable = Readable.from(buffer);
  const extract = tarStream.extract();
  return new Promise((resolve, reject) => {
    readable
      .pipe(gunzipMaybe())
      .pipe(extract)
      .on('entry', (header, stream, next) => {
        // drain every entry but stop storing past the cap
        if (names.length < MAX_SCAN_ENTRIES) {
          names.push(header.name);
        } else {
          truncated = true;
        }
        stream.resume();
        next();
      })
      .on('finish', () => resolve({ names, truncated }))
      .on('error', reject);
  });
}

function normalizeLicenses(version: Version): string[] {
  const licenses: string[] = [];
  if (typeof version.license === 'string' && version.license.trim() !== '') {
    licenses.push(version.license.trim());
  }
  const legacy = (version as any).licenses;
  if (Array.isArray(legacy)) {
    for (const entry of legacy) {
      if (typeof entry === 'string') {
        licenses.push(entry.trim());
      } else if (entry && typeof entry.type === 'string') {
        licenses.push(entry.type.trim());
      }
    }
  }
  return licenses.filter((l) => l.length > 0);
}

async function queryOsv(
  name: string,
  version: string,
  osv: NonNullable<ScanConfig['osv']>,
  logger: Logger
): Promise<PackageScanFinding[]> {
  const url = `${osv.url ?? DEFAULT_OSV_URL}/v1/query`;
  const timeout = osv.timeout_ms ?? DEFAULT_OSV_TIMEOUT_MS;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version, package: { name, ecosystem: 'npm' } }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      logger.warn(
        { name, version, status: response.status },
        'osv lookup failed for @{name}@@{version}: @{status}'
      );
      return [];
    }
    const body = (await response.json()) as {
      vulns?: { id?: string; summary?: string; aliases?: string[] }[];
    };
    return (body.vulns ?? []).map((vuln) => ({
      type: 'osv' as const,
      severity: 'critical' as const,
      message: `osv:${vuln.id ?? 'unknown'} ${vuln.summary ?? ''}`.trim(),
    }));
  } catch (err: any) {
    logger.warn({ name, version, err }, 'osv lookup error for @{name}@@{version}: @{err.message}');
    return [];
  }
}

/**
 * Scan a publish payload before it is stored. Every check is pure and local
 * except the optional OSV lookup, which is disabled unless configured and
 * never blocks a publish on network failure.
 */
export async function scanPublish(
  name: string,
  version: Version,
  tarball: Buffer,
  scan: ScanConfig | undefined,
  logger: Logger
): Promise<PackageScanResult | null> {
  if (scan?.enabled !== true) {
    return null;
  }
  const findings: PackageScanFinding[] = [];

  const licenses = normalizeLicenses(version);
  const licensePolicy = scan.licenses;
  if (licensePolicy) {
    if (licensePolicy.required === true && licenses.length === 0) {
      findings.push({
        type: 'license',
        severity: 'warning',
        message: 'package does not declare a license',
      });
    }
    for (const license of licenses) {
      if (licensePolicy.deny?.includes(license)) {
        findings.push({
          type: 'license',
          severity: 'critical',
          message: `license '${license}' is on the deny list`,
        });
      }
      if (
        Array.isArray(licensePolicy.allow) &&
        licensePolicy.allow.length > 0 &&
        !licensePolicy.allow.includes(license)
      ) {
        findings.push({
          type: 'license',
          severity: 'critical',
          message: `license '${license}' is not on the allow list`,
        });
      }
    }
  }

  const installPolicy = scan.install_scripts ?? 'warn';
  if (installPolicy !== 'allow') {
    const scripts = version.scripts ?? {};
    const hits = LIFECYCLE_SCRIPTS.filter((key) => typeof scripts[key] === 'string');
    if (hits.length > 0) {
      findings.push({
        type: 'install-script',
        severity: installPolicy === 'deny' ? 'critical' : 'warning',
        message: `lifecycle scripts present: ${hits.join(', ')}`,
      });
    }
  }

  const nativePolicy = scan.native_code ?? 'warn';
  if (nativePolicy !== 'allow') {
    try {
      const { names, truncated } = await listTarballEntries(tarball);
      const native = names.filter((entry) => NATIVE_FILE_PATTERN.test(entry));
      if (truncated) {
        findings.push({
          type: 'policy',
          severity: 'warning',
          message: `tarball entry listing truncated at ${MAX_SCAN_ENTRIES} entries`,
        });
      }
      if (native.length > 0) {
        findings.push({
          type: 'native-code',
          severity: nativePolicy === 'deny' ? 'critical' : 'warning',
          message: `native or binary payloads: ${native.slice(0, 10).join(', ')}`,
        });
      }
    } catch (err: any) {
      debug('tarball listing failed during scan: %o', err?.message);
      findings.push({
        type: 'policy',
        severity: 'info',
        message: 'tarball content listing failed during scan',
      });
    }
  }

  if (scan.osv?.enabled === true) {
    findings.push(...(await queryOsv(name, version.version, scan.osv, logger)));
  }

  const status = findings.some((f) => f.severity === 'critical')
    ? 'fail'
    : findings.some((f) => f.severity === 'warning')
      ? 'warn'
      : 'pass';
  return { status, findings, at: new Date().toISOString() };
}
