import buildDebug from 'debug';

import { authUtils, errorUtils } from '@verdaccio/core';
import type { Manifest, RemoteUser } from '@verdaccio/types';

import type { Storage } from './storage';

const debug = buildDebug('verdaccio:store:visibility');

export type PublishChecker = {
  allow_publish(
    pkg: { packageName: string },
    user: RemoteUser,
    callback: (err: any, allowed?: boolean) => void
  ): void;
};

export function canPublish(
  auth: PublishChecker,
  packageName: string,
  user: RemoteUser
): Promise<boolean> {
  return new Promise((resolve) => {
    auth.allow_publish({ packageName }, user, (err, allowed) => {
      resolve(err ? false : allowed === true);
    });
  });
}

/**
 * Answers whether the remote user may see a package that carries the private
 * visibility flag: only users allowed to publish it can.
 */
export async function assertManifestVisibility(
  auth: PublishChecker,
  manifest: Manifest,
  remoteUser: RemoteUser
): Promise<void> {
  if (authUtils.isPrivateVisibility(manifest?.visibility) === false) {
    return;
  }
  if ((await canPublish(auth, manifest.name, remoteUser)) === false) {
    debug('package %o is private and user %o cannot publish it', manifest.name, remoteUser.name);
    throw errorUtils.getNotFound();
  }
}

/**
 * Same check for callers that only know the package name, such as the tarball
 * route. Only local manifests can carry the flag, so a missing local manifest
 * is not an error here.
 */
export async function assertPackageVisibility(
  auth: PublishChecker,
  storage: Storage,
  packageName: string,
  remoteUser: RemoteUser
): Promise<void> {
  let manifest: Manifest | null = null;
  try {
    manifest = await storage.getPackageLocalMetadata(packageName);
  } catch {
    return;
  }
  await assertManifestVisibility(auth, manifest, remoteUser);
}
