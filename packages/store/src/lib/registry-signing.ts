import buildDebug from 'debug';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';

import type { Config, Logger, Signatures } from '@verdaccio/types';

const debug = buildDebug('verdaccio:storage:signing');

const KEY_FILE_NAME = '.registry-signing-key.json';
const KEY_TYPE = 'ecdsa-sha2-nistp256';

export interface RegistryPublicKey {
  expires: string | null;
  keyid: string;
  keytype: string;
  scheme: string;
  key: string;
}

interface StoredKey {
  publicKey: string;
  privateKey: string;
}

function storageRoot(config: Config): string {
  const storage = config.storage;
  if (typeof storage !== 'string' || storage === '' || typeof config.configPath !== 'string') {
    throw new Error('registry signing requires storage and configPath in the configuration');
  }
  return isAbsolute(storage)
    ? normalize(storage)
    : normalize(join(dirname(config.configPath), storage));
}

/**
 * Compute the npm-style keyid: `SHA256:` + base64 sha256 of the DER SPKI.
 */
export function keyIdFromPublicDer(publicKeyDerB64: string): string {
  const der = Buffer.from(publicKeyDerB64, 'base64');
  return `SHA256:${createHash('sha256').update(der).digest('base64')}`;
}

/**
 * npm `audit signatures` verifies `dist.signatures` with `crypto.verify` using
 * the SHA-256 over `${name}@${version}:${dist.integrity}` and the public keys
 * published at `/-/npm/v1/keys`. Signatures are DER-encoded ECDSA P-256.
 */
export class RegistrySigner {
  private readonly privateKeyDer: Buffer;
  private readonly publicKeyDerB64: string;
  public readonly keyid: string;

  public constructor(privateKeyDer: Buffer, publicKeyDerB64: string) {
    this.privateKeyDer = privateKeyDer;
    this.publicKeyDerB64 = publicKeyDerB64;
    this.keyid = keyIdFromPublicDer(publicKeyDerB64);
  }

  public sign(name: string, version: string, integrity: string): Signatures {
    const message = `${name}@${version}:${integrity}`;
    const key = createPrivateKey({ key: this.privateKeyDer, format: 'der', type: 'pkcs8' });
    // npm CLI verifies with default dsaEncoding ('der')
    const sig = sign('sha256', Buffer.from(message), key).toString('hex');
    return { keyid: this.keyid, sig };
  }

  public publicKeyDescriptor(): RegistryPublicKey {
    return {
      expires: null,
      keyid: this.keyid,
      keytype: KEY_TYPE,
      scheme: KEY_TYPE,
      key: this.publicKeyDerB64,
    };
  }
}

/**
 * Load the persisted signing key or create a fresh P-256 keypair under the
 * storage directory. The private key is written with mode 0600; losing or
 * rotating it makes previously served `dist.signatures` unverifiable, which
 * matches how a key rotation would behave on npmjs (keyid mismatch errors).
 */
export function loadOrCreateSigningKey(config: Config, logger: Logger): RegistrySigner | null {
  if (config.security?.signatures?.enabled !== true) {
    return null;
  }
  const keyPath = join(storageRoot(config), KEY_FILE_NAME);
  try {
    const raw = readFileSync(keyPath, 'utf8');
    const stored = JSON.parse(raw) as StoredKey;
    // sanity check the pair actually matches before trusting it
    const derived = createPublicKey(
      createPrivateKey({
        key: Buffer.from(stored.privateKey, 'base64'),
        format: 'der',
        type: 'pkcs8',
      })
    )
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    if (derived !== stored.publicKey) {
      throw new Error('stored signing key pair does not match');
    }
    const signer = new RegistrySigner(Buffer.from(stored.privateKey, 'base64'), stored.publicKey);
    debug('loaded registry signing key %o', signer.keyid);
    return signer;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      logger.error(
        { err },
        'registry signing key is unreadable, refusing to rotate silently: @{err.message}'
      );
      throw err;
    }
  }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const stored: StoredKey = {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, JSON.stringify(stored), { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // best effort on platforms without POSIX permissions
  }
  const signer = new RegistrySigner(Buffer.from(stored.privateKey, 'base64'), stored.publicKey);
  logger.info({ keyid: signer.keyid }, 'generated registry signing key @{keyid}');
  return signer;
}
