import type { MMRegExp } from 'minimatch';
import { minimatch } from 'minimatch';

import type { PackageAccess, PackageList, RemoteUser } from '@verdaccio/types';

import { ROLES } from './constants';

export interface CookieSessionToken {
  expires: Date;
}

export function createSessionToken(): CookieSessionToken {
  const tenHoursTime = 10 * 60 * 60 * 1000;

  return {
    // npmjs.org sets 10h expire
    expires: new Date(Date.now() + tenHoursTime),
  };
}

export function getAuthenticatedMessage(user: string): string {
  return `you are authenticated as '${user}'`;
}

export function buildUserBuffer(name: string, password: string): Buffer {
  return Buffer.from(`${name}:${password}`, 'utf8');
}

export function buildToken(type: string, token: string): string {
  return `${capitalize(type)} ${token}`;
}

/**
 * Same membership rule the built-in acl plugin applies: the user name itself
 * or any of its groups must appear in the list. Magic groups such as $all or
 * $anonymous work because remote users carry them in groups.
 */
export function isUserInGroups(user: RemoteUser, groupsList: string[]): boolean {
  const groups = Array.isArray(user?.groups) ? user.groups : [];
  return groupsList.some((group) => user?.name === group || groups.includes(group));
}

/**
 * The only manifest flag that hides a package; any other value is public.
 */
export function isPrivateVisibility(visibility: unknown): boolean {
  return visibility === 'private';
}

/**
 * An admin is a logged user carrying the $admin group (auth plugins attach it)
 * or matching the security.admins list from the configuration.
 */
export function isAdmin(user: RemoteUser | undefined, adminsList?: string[]): boolean {
  if (typeof user?.name !== 'string' || user.name === '') {
    return false;
  }
  if (Array.isArray(user.groups) && user.groups.includes(ROLES.$ADMIN)) {
    return true;
  }
  return Array.isArray(adminsList) && isUserInGroups(user, adminsList);
}

export function getMatchedPackagesSpec(
  pkgName: string,
  packages: PackageList
): PackageAccess | void {
  for (const i in packages) {
    // match case-insensitively, npm package names are case-insensitive
    if ((minimatch.makeRe(i, { nocase: true }) as MMRegExp).exec(pkgName)) {
      return packages[i];
    }
  }
  return;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
