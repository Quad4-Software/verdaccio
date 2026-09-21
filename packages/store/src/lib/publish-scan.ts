import buildDebug from 'debug';
import gunzipMaybe from 'gunzip-maybe';
import { Readable, Writable } from 'node:stream';
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
const NATIVE_FILE_PATTERN = /\.(node|so|dll|exe|dylib)$|(^|\/)binding\.gyp$/i;
const DEFAULT_OSV_URL = 'https://api.osv.dev';
const DEFAULT_OSV_TIMEOUT_MS = 5000;
// bound the scan so a hostile tarball with millions of entries cannot
// exhaust memory; listing beyond the cap is reported as a finding
const MAX_SCAN_ENTRIES = 50_000;
// package.json inside the tarball is what npm actually installs from; cap it
// so a giant embedded manifest cannot exhaust memory either
const MAX_MANIFEST_BYTES = 512 * 1024;
const SCAN_TIMEOUT_MS = 30_000;
const MAX_OSV_BODY_BYTES = 512 * 1024;
const MAX_OSV_FINDINGS = 50;
const MAX_FINDING_MESSAGE = 300;
const SCAN_POLICIES = ['allow', 'warn', 'deny'];

/**
 * List file entries inside a (possibly gzipped) tarball buffer and capture
 * the embedded package.json — that manifest, not the request metadata, is
 * what package managers install. Errors on any stream stage reject the
 * promise; a hard timeout bounds the whole operation.
 */
function listTarballEntries(
  buffer: Buffer
): Promise<{ names: string[]; truncated: boolean; manifest: any }> {
  const names: string[] = [];
  let truncated = false;
  let manifest: any = null;
  const readable = Readable.from(buffer);
  const gunzip = gunzipMaybe();
  // the ExtractEvents typing hides the writable-stream surface
  const extract = tarStream.extract() as tarStream.Extract & Writable;

  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      readable.destroy();
      gunzip.destroy();
      extract.destroy();
      if (err) {
        reject(err);
      } else {
        resolve({ names, truncated, manifest });
      }
    };
    const timer = setTimeout(() => done(new Error('tarball scan timed out')), SCAN_TIMEOUT_MS);

    extract.on('entry', (header, stream, next) => {
      const entryName = String(header.name ?? '')
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '');
      if (header.type === 'file' || header.type === 'symlink') {
        if (names.length < MAX_SCAN_ENTRIES) {
          names.push(entryName);
        } else {
          truncated = true;
        }
      }
      if (entryName === 'package/package.json') {
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_MANIFEST_BYTES) {
            chunks.push(chunk);
          }
        });
        stream.on('end', () => {
          try {
            manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            debug('embedded package.json is not valid json');
          }
          next();
        });
        stream.on('error', next);
        return;
      }
      stream.resume();
      next();
    });
    extract.on('finish', () => done());
    // errors on the source, gunzip or extractor all abort the scan
    readable.on('error', done);
    gunzip.on('error', done);
    extract.on('error', done);
    readable.pipe(gunzip).pipe(extract);
  });
}

/**
 * Split an SPDX expression into candidate license ids so deny/allow lists
 * match `MIT OR Apache-2.0` and `(GPL-3.0)` as well as plain strings.
 */
function licenseIds(expression: string): string[] {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+|\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeLicenses(version: Version): string[] {
  const licenses: string[] = [];
  // real-world manifests sometimes carry the legacy {type, url} object form
  const declared: unknown = version.license;
  if (typeof declared === 'string' && declared.trim() !== '') {
    licenses.push(declared.trim());
  } else if (
    declared !== null &&
    typeof declared === 'object' &&
    typeof (declared as { type?: unknown }).type === 'string'
  ) {
    licenses.push((declared as { type: string }).type.trim());
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
  const timeout = osv.timeout_ms && osv.timeout_ms > 0 ? osv.timeout_ms : DEFAULT_OSV_TIMEOUT_MS;
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
    const text = await response.text();
    if (text.length > MAX_OSV_BODY_BYTES) {
      logger.warn({ name, version }, 'osv response too large for @{name}@@{version}, skipped');
      return [];
    }
    const body = JSON.parse(text) as {
      vulns?: { id?: string; summary?: string; aliases?: string[] }[];
    };
    return (body.vulns ?? []).slice(0, MAX_OSV_FINDINGS).map((vuln) => ({
      type: 'osv' as const,
      severity: 'critical' as const,
      message: `osv:${vuln.id ?? 'unknown'} ${vuln.summary ?? ''}`
        .trim()
        .slice(0, MAX_FINDING_MESSAGE),
    }));
  } catch (err: any) {
    logger.warn({ name, version, err }, 'osv lookup error for @{name}@@{version}: @{err.message}');
    return [];
  }
}

/**
 * A configured policy value that is not allow/warn/deny is treated as warn
 * so a typo cannot silently disable a check.
 */
function policyOf(value: unknown): 'allow' | 'warn' | 'deny' {
  return SCAN_POLICIES.includes(value as string) ? (value as 'allow') : 'warn';
}

/**
 * Scan a publish payload before it is stored. Lifecycle scripts and license
 * fields are read from the manifest embedded in the tarball — the request
 * metadata is cosmetic and can claim anything. The OSV lookup stays optional
 * and never blocks a publish on network failure.
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

  let entries: { names: string[]; truncated: boolean; manifest: any } | null = null;
  try {
    entries = await listTarballEntries(tarball);
  } catch (err: any) {
    debug('tarball listing failed during scan: %o', err?.message);
    findings.push({
      type: 'policy',
      severity: 'info',
      message: 'tarball content listing failed during scan',
    });
  }

  // the embedded package.json wins over the publish body; a clean-looking
  // manifest must not mask hostile lifecycle scripts inside the tarball
  const effectiveManifest =
    entries?.manifest && typeof entries.manifest === 'object' ? entries.manifest : version;

  const licenses = normalizeLicenses(effectiveManifest);
  const licensePolicy = scan.licenses;
  if (licensePolicy) {
    const deny = new Set((licensePolicy.deny ?? []).map((l) => l.toLowerCase()));
    const allow = new Set((licensePolicy.allow ?? []).map((l) => l.toLowerCase()));
    if (licensePolicy.required === true && licenses.length === 0) {
      findings.push({
        type: 'license',
        severity: 'warning',
        message: 'package does not declare a license',
      });
    }
    for (const license of licenses) {
      const ids = licenseIds(license).map((l) => l.toLowerCase());
      if (ids.some((id) => deny.has(id))) {
        findings.push({
          type: 'license',
          severity: 'critical',
          message: `license '${license}' is on the deny list`,
        });
      }
      if (allow.size > 0 && ids.length > 0 && ids.every((id) => allow.has(id)) === false) {
        findings.push({
          type: 'license',
          severity: 'critical',
          message: `license '${license}' is not on the allow list`,
        });
      }
    }
  }

  const installPolicy = policyOf(scan.install_scripts ?? 'warn');
  if (installPolicy !== 'allow') {
    const scripts =
      effectiveManifest.scripts && typeof effectiveManifest.scripts === 'object'
        ? effectiveManifest.scripts
        : {};
    const hits = LIFECYCLE_SCRIPTS.filter((key) => typeof scripts[key] === 'string');
    if (hits.length > 0) {
      findings.push({
        type: 'install-script',
        severity: installPolicy === 'deny' ? 'critical' : 'warning',
        message: `lifecycle scripts present: ${hits.join(', ')}`,
      });
    }
  }

  const nativePolicy = policyOf(scan.native_code ?? 'warn');
  if (nativePolicy !== 'allow' && entries !== null) {
    const native = entries.names.filter((entry) => NATIVE_FILE_PATTERN.test(entry));
    if (entries.truncated) {
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
