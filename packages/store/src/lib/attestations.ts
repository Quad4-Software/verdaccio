import buildDebug from 'debug';

import type { AttachMents, RegistryAttestation } from '@verdaccio/types';

const debug = buildDebug('verdaccio:storage:attestations');

export const SIGSTORE_ATTACHMENT_SUFFIX = '.sigstore';

export function isSigstoreAttachment(fileName: string, contentType?: string): boolean {
  return (
    fileName.endsWith(SIGSTORE_ATTACHMENT_SUFFIX) ||
    (typeof contentType === 'string' && contentType.includes('dev.sigstore.bundle'))
  );
}

/**
 * npm sends the Sigstore bundle as a second `_attachments` entry when
 * publishing with `--provenance`; pick the real tarball separately. The
 * canonical `<name>-<version>.tgz` name wins, then any non-sigstore entry.
 */
export function pickTarballAttachmentKey(
  attachments: AttachMents,
  name?: string,
  version?: string
): string | undefined {
  const keys = Object.keys(attachments);
  const candidates = keys.filter(
    (key) => !isSigstoreAttachment(key, attachments[key]?.content_type)
  );
  if (candidates.length === 0) {
    return undefined;
  }
  if (name && version) {
    const scopeName = name.startsWith('@') ? name.split('/')[1] : name;
    const expected = `${scopeName}-${version}.tgz`;
    const exact = candidates.find((key) => key === expected || key.endsWith(`/${expected}`));
    if (exact) {
      return exact;
    }
  }
  return candidates.find((key) => /\.t(ar\.)?gz$/.test(key)) ?? candidates[0];
}

/**
 * Extract the in-toto predicateType from a Sigstore bundle, or null when the
 * bundle cannot prove DSSE structure. The bundle's DSSE envelope carries a
 * base64 in-toto Statement whose `predicateType` is what
 * `dist.attestations[].provenance.predicateType` advertises; storing bundles
 * that fail this check would let a publisher attach arbitrary JSON and have
 * it advertised as provenance.
 */
export function predicateTypeFromBundle(bundle: any): string | null {
  try {
    const envelope = bundle?.dsseEnvelope;
    if (
      typeof envelope?.payload !== 'string' ||
      Array.isArray(envelope?.signatures) === false ||
      envelope.signatures.length === 0
    ) {
      return null;
    }
    const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    return typeof statement?.predicateType === 'string' ? statement.predicateType : null;
  } catch {
    debug('could not decode dsse payload');
    return null;
  }
}

/**
 * Decode the in-toto Statement inside a DSSE envelope; null when missing.
 */
function statementFromBundle(bundle: any): any {
  try {
    return JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * A bundle only counts as provenance for this publish when its statement
 * subjects point at the tarball being stored: the sha512 digest must match
 * the uploaded bytes and the subject name must reference the same package
 * and version. Statements without subjects cannot be bound at all.
 */
function subjectMatches(
  statement: any,
  expected: { name: string; version: string; sha512: string }
): boolean {
  const subjects = statement?.subject;
  if (Array.isArray(subjects) === false || subjects.length === 0) {
    return false;
  }
  return subjects.some((subject: any) => {
    const digest = subject?.digest?.sha512;
    const subjectName = typeof subject?.name === 'string' ? subject.name : '';
    return (
      typeof digest === 'string' &&
      digest.toLowerCase() === expected.sha512.toLowerCase() &&
      (subjectName === `pkg:npm/${expected.name}@${expected.version}` ||
        subjectName === `${expected.name}@${expected.version}` ||
        subjectName === expected.name)
    );
  });
}

/**
 * Pull the `.sigstore` attachments out of a publish body and return them as
 * attestations keyed by the version they belong to. Returns null when the
 * publish carries no provenance. When `expected` is provided, bundles whose
 * statement subjects do not match the stored tarball are dropped instead of
 * being advertised as provenance for the wrong artifact.
 */
export function extractAttestations(
  attachments: AttachMents | undefined,
  version: string,
  expected?: { name: string; sha512: string }
): Record<string, RegistryAttestation[]> | null {
  if (!attachments) {
    return null;
  }
  const collected: RegistryAttestation[] = [];
  for (const [fileName, attachment] of Object.entries(attachments)) {
    if (!isSigstoreAttachment(fileName, attachment?.content_type)) {
      continue;
    }
    try {
      const bundle = JSON.parse(attachment.data as string);
      const predicateType = predicateTypeFromBundle(bundle);
      if (predicateType === null) {
        debug('sigstore attachment %o is not a dsse bundle, skipped', fileName);
        continue;
      }
      if (expected) {
        const statement = statementFromBundle(bundle);
        if (subjectMatches(statement, { ...expected, version }) === false) {
          debug('sigstore attachment %o subject does not match publish, skipped', fileName);
          continue;
        }
      }
      collected.push({ predicateType, bundle });
    } catch (err: any) {
      debug('sigstore attachment %o is not valid json: %o', fileName, err?.message);
    }
  }
  return collected.length > 0 ? { [version]: collected } : null;
}
