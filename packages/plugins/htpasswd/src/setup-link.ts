import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { parseHTPasswd } from './utils';

export const SETUP_TTL_MS = 15 * 60 * 1000;
export const SETUP_PASSWORD_MIN_LENGTH = 12;
const TOKEN_BYTES = 32;

export type SetupInspect =
  | { state: 'ok'; expires: number }
  | { state: 'invalid' }
  | { state: 'admin-exists' };

export type SetupConsume = 'ok' | 'invalid' | 'admin-exists';

type SetupFile = {
  hash: string;
  expires: number;
};

export function setupFilePath(htpasswdFile: string): string {
  return `${htpasswdFile}.setup`;
}

export function formatSetupLink(token: string, urlPrefix?: string): string {
  const route = `/-/web/setup#${encodeURIComponent(token)}`;
  const prefix =
    typeof urlPrefix === 'string' && urlPrefix !== '' && urlPrefix !== '/'
      ? urlPrefix.replace(/\/$/, '')
      : '';
  const path = `${prefix}${route}`;
  const pub = process.env.VERDACCIO_PUBLIC_URL;
  if (typeof pub === 'string' && /^https?:\/\//.test(pub)) {
    return pub.replace(/\/$/, '') + path;
  }
  return path;
}

export function validateSetupAccount(user: string, password: string): string | null {
  if (!user || !password) {
    return 'username and password are required';
  }
  if (!/^[-a-zA-Z0-9_.!~*'()@]{2,}$/.test(user) || user !== encodeURIComponent(user)) {
    return 'username must contain only url-safe characters';
  }
  if (password.length < SETUP_PASSWORD_MIN_LENGTH) {
    return `password must be at least ${SETUP_PASSWORD_MIN_LENGTH} characters`;
  }
  return null;
}

export function htpasswdHasUsers(htpasswdFile: string): boolean {
  try {
    const body = readFileSync(htpasswdFile, 'utf8');
    return Object.keys(parseHTPasswd(body)).length > 0;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function removeSetupFile(htpasswdFile: string): void {
  try {
    unlinkSync(setupFilePath(htpasswdFile));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function isSetupToken(token: string): boolean {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function readSetupFile(htpasswdFile: string): SetupFile | null {
  try {
    const parsed = JSON.parse(readFileSync(setupFilePath(htpasswdFile), 'utf8'));
    if (typeof parsed?.hash !== 'string' || typeof parsed?.expires !== 'number') {
      return null;
    }
    return { hash: parsed.hash, expires: parsed.expires };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

function tokenState(record: SetupFile | null, token: string): 'match' | 'expired' | 'invalid' {
  if (!record || !isSetupToken(token)) {
    return 'invalid';
  }
  const expected = Buffer.from(record.hash, 'hex');
  const actual = hashToken(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return 'invalid';
  }
  if (Date.now() > record.expires) {
    return 'expired';
  }
  return 'match';
}

export function issueSetupLink(
  htpasswdFile: string,
  urlPrefix?: string
): { link: string; expires: number } | null {
  if (htpasswdHasUsers(htpasswdFile)) {
    removeSetupFile(htpasswdFile);
    return null;
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expires = Date.now() + SETUP_TTL_MS;
  const body = JSON.stringify({ hash: hashToken(token).toString('hex'), expires });
  const file = setupFilePath(htpasswdFile);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return { link: formatSetupLink(token, urlPrefix), expires };
}

export function inspectSetupLink(htpasswdFile: string, token: string): SetupInspect {
  const record = readSetupFile(htpasswdFile);
  const state = tokenState(record, token);
  if (htpasswdHasUsers(htpasswdFile)) {
    if (state === 'match') {
      removeSetupFile(htpasswdFile);
      return { state: 'admin-exists' };
    }
    return { state: 'invalid' };
  }
  if (state === 'expired') {
    removeSetupFile(htpasswdFile);
    return { state: 'invalid' };
  }
  if (state !== 'match' || !record) {
    return { state: 'invalid' };
  }
  return { state: 'ok', expires: record.expires };
}

export function consumeSetupLink(htpasswdFile: string, token: string): SetupConsume {
  const file = setupFilePath(htpasswdFile);
  const record = readSetupFile(htpasswdFile);
  const state = tokenState(record, token);
  if (htpasswdHasUsers(htpasswdFile)) {
    if (state === 'match') {
      removeSetupFile(htpasswdFile);
      return 'admin-exists';
    }
    return 'invalid';
  }
  if (state !== 'match') {
    if (state === 'expired') {
      removeSetupFile(htpasswdFile);
    }
    return 'invalid';
  }

  const claimed = `${file}.${randomBytes(8).toString('hex')}.claim`;
  try {
    renameSync(file, claimed);
  } catch {
    return 'invalid';
  }
  try {
    const owned = JSON.parse(readFileSync(claimed, 'utf8')) as SetupFile;
    if (tokenState(owned, token) !== 'match') {
      return 'invalid';
    }
    return 'ok';
  } finally {
    try {
      unlinkSync(claimed);
    } catch {
      // the claim file is the spent token
    }
  }
}
