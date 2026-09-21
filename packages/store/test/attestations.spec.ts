import { describe, expect, test } from 'vitest';

import {
  extractAttestations,
  isSigstoreAttachment,
  pickTarballAttachmentKey,
  predicateTypeFromBundle,
} from '../src/lib/attestations';

const bundle = {
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  dsseEnvelope: {
    payload: Buffer.from(
      JSON.stringify({ predicateType: 'https://slsa.dev/provenance/v1' })
    ).toString('base64'),
    signatures: [{ keyid: 'test', sig: 'AAAA' }],
  },
};

describe('attestations', () => {
  test('detects sigstore attachments by name or content type', () => {
    expect(isSigstoreAttachment('foo-1.0.0.sigstore')).toBe(true);
    expect(isSigstoreAttachment('x', 'application/vnd.dev.sigstore.bundle.v0.3+json')).toBe(true);
    expect(isSigstoreAttachment('foo-1.0.0.tgz', 'application/octet-stream')).toBe(false);
  });

  test('picks the tarball, never the sigstore bundle', () => {
    const attachments = {
      'foo-1.0.0.sigstore': { content_type: 'application/json', data: '{}' },
      'foo-1.0.0.tgz': { content_type: 'application/octet-stream', data: 'AAAA' },
    } as any;
    expect(pickTarballAttachmentKey(attachments, 'foo', '1.0.0')).toBe('foo-1.0.0.tgz');
  });

  test('picks the tarball even when listed second', () => {
    const attachments = {
      'foo-1.0.0.tgz': { content_type: 'application/octet-stream', data: 'AAAA' },
      'foo-1.0.0.sigstore': { content_type: 'application/json', data: '{}' },
    } as any;
    expect(pickTarballAttachmentKey(attachments, 'foo', '1.0.0')).toBe('foo-1.0.0.tgz');
  });

  test('returns undefined when only sigstore attachments exist', () => {
    const attachments = {
      'foo-1.0.0.sigstore': { content_type: 'application/json', data: '{}' },
    } as any;
    expect(pickTarballAttachmentKey(attachments, 'foo', '1.0.0')).toBeUndefined();
  });

  test('extracts the predicateType from a DSSE envelope', () => {
    expect(predicateTypeFromBundle(bundle)).toBe('https://slsa.dev/provenance/v1');
    expect(predicateTypeFromBundle({})).toBeNull();
    // a bundle without signatures must not be advertised as provenance
    expect(
      predicateTypeFromBundle({
        dsseEnvelope: { payload: bundle.dsseEnvelope.payload, signatures: [] },
      })
    ).toBeNull();
  });

  test('extractAttestations collects bundles per version', () => {
    const attachments = {
      'foo-1.0.0.tgz': { content_type: 'application/octet-stream', data: 'AAAA' },
      'foo-1.0.0.sigstore': { content_type: 'application/json', data: JSON.stringify(bundle) },
    } as any;
    const result = extractAttestations(attachments, '1.0.0');
    expect(result).not.toBeNull();
    expect(result!['1.0.0']).toHaveLength(1);
    expect(result!['1.0.0'][0].predicateType).toBe('https://slsa.dev/provenance/v1');
    expect(result!['1.0.0'][0].bundle).toEqual(bundle);
  });

  test('ignores malformed sigstore attachments', () => {
    const attachments = {
      'foo-1.0.0.tgz': { content_type: 'application/octet-stream', data: 'AAAA' },
      'foo-1.0.0.sigstore': { content_type: 'application/json', data: 'not json{' },
      'foo-2.0.0.sigstore': { content_type: 'application/json', data: '{"no":"dsse"}' },
    } as any;
    expect(extractAttestations(attachments, '1.0.0')).toBeNull();
  });
});
