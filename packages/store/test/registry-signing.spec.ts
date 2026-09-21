import { createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { Config, getDefaultConfig } from '@verdaccio/config';
import { setup } from '@verdaccio/logger';
import type { Logger } from '@verdaccio/types';

import { keyIdFromPublicDer, loadOrCreateSigningKey } from '../src/lib/registry-signing';

let logger: Logger;
beforeAll(async () => {
  logger = await setup({ type: 'stdout', format: 'pretty', level: 'trace' });
});

function tmpConfig(overrides: any = {}): Config {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdaccio-signing-'));
  return new Config({
    ...getDefaultConfig(),
    storage: dir,
    configPath: path.join(dir, 'config.yaml'),
    ...overrides,
  } as any);
}

describe('registry signing', () => {
  test('returns null when disabled', () => {
    const config = tmpConfig();
    expect(loadOrCreateSigningKey(config, logger)).toBeNull();
  });

  test('generates and persists a P-256 keypair', () => {
    const config = tmpConfig({ security: { signatures: { enabled: true } } });
    const signer = loadOrCreateSigningKey(config, logger);
    expect(signer).not.toBeNull();
    expect(signer!.keyid).toMatch(/^SHA256:/);

    // a second load returns the same key, not a rotated one
    const reloaded = loadOrCreateSigningKey(config, logger);
    expect(reloaded!.keyid).toBe(signer!.keyid);
  });

  test('signs the npm signature message and it verifies', () => {
    const config = tmpConfig({ security: { signatures: { enabled: true } } });
    const signer = loadOrCreateSigningKey(config, logger)!;
    const integrity = 'sha512-deadbeef==';
    const { keyid, sig } = signer.sign('foo', '1.0.0', integrity);
    expect(keyid).toBe(signer.keyid);

    const descriptor = signer.publicKeyDescriptor();
    expect(descriptor.keytype).toBe('ecdsa-sha2-nistp256');
    expect(descriptor.expires).toBeNull();
    // the advertised key material parses as an SPKI public key
    expect(
      createPublicKey({ key: Buffer.from(descriptor.key, 'base64'), format: 'der', type: 'spki' })
        .asymmetricKeyType
    ).toBe('ec');

    const ok = verify(
      'sha256',
      Buffer.from(`foo@1.0.0:${integrity}`),
      {
        key: Buffer.from(descriptor.key, 'base64'),
        format: 'der',
        type: 'spki',
      },
      Buffer.from(sig, 'hex')
    );
    expect(ok).toBe(true);
  });

  test('keyid is sha256 of the public DER', () => {
    const pub = Buffer.from('abc').toString('base64');
    expect(keyIdFromPublicDer(pub)).toBe('SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });
});
