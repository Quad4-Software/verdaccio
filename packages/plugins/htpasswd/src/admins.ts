import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function adminsFilePath(htpasswdFile: string): string {
  return `${htpasswdFile}.admins`;
}

export function readAdmins(htpasswdFile: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(adminsFilePath(htpasswdFile), 'utf8'));
    return Array.isArray(parsed?.admins)
      ? parsed.admins.filter((name) => typeof name === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeAdmins(htpasswdFile: string, admins: string[]): void {
  const file = adminsFilePath(htpasswdFile);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify({ admins }), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/**
 * Add or drop a user from the admins list. Returns the updated list.
 */
export function setAdmin(htpasswdFile: string, user: string, enabled: boolean): string[] {
  const admins = readAdmins(htpasswdFile);
  const next = enabled
    ? Array.from(new Set([...admins, user]))
    : admins.filter((name) => name !== user);
  writeAdmins(htpasswdFile, next);
  return next;
}
