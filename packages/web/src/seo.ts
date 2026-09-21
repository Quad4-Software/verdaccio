import buildDebug from 'debug';

import type { Auth } from '@verdaccio/auth';
import { createAnonymousRemoteUser } from '@verdaccio/config';
import { reqUtils } from '@verdaccio/core';
import type { $RequestExtend, PackageSeoResolver, SeoMeta } from '@verdaccio/middleware';
import { getRequestOptions, packageJsonLd } from '@verdaccio/middleware';
import type { Storage } from '@verdaccio/store';
import { assertManifestVisibility } from '@verdaccio/store';
import { getPublicUrl, isURLhasValidProtocol } from '@verdaccio/url';
import type { Config, Manifest, RemoteUser } from '@verdaccio/types';

import { resolveScopedName } from './api/scoped-access';
import { hasLogin } from './web-utils';

const debug = buildDebug('verdaccio:web:seo');

/**
 * Builds the detail-page meta resolver injected into the web renderer. Returns
 * undefined when the package is missing or not visible to the requester, so a
 * crawler never learns more than the generic page would show.
 */
export function buildPackageSeoResolver(
  storage: Storage,
  auth: Auth,
  config: Config
): PackageSeoResolver {
  const isLoginEnabled = hasLogin(config);
  return async (req: $RequestExtend): Promise<SeoMeta | undefined> => {
    const name = resolveScopedName(req.params.scope, req.params.package);
    if (!name) {
      return undefined;
    }
    const remoteUser: RemoteUser = isLoginEnabled ? req.remote_user : createAnonymousRemoteUser();
    const allowed = await new Promise<boolean>((resolve) => {
      auth.allow_access({ packageName: name }, remoteUser, (err, ok) => resolve(!err && !!ok));
    });
    if (!allowed) {
      return undefined;
    }
    const requestOptions = getRequestOptions(req);
    const manifest = (await storage.getPackageByOptions({
      name,
      uplinksLook: true,
      keepUpLinkData: false,
      requestOptions,
    })) as Manifest;
    await assertManifestVisibility(auth, manifest, remoteUser);

    const requestedVersion =
      reqUtils.paramToString(req.params.view) === 'v'
        ? reqUtils.paramToString(req.params.version)
        : '';
    const resolvedVersion =
      requestedVersion && manifest.versions?.[requestedVersion]
        ? requestedVersion
        : (manifest['dist-tags']?.['latest'] as string | undefined);
    const versionData = resolvedVersion ? manifest.versions?.[resolvedVersion] : undefined;
    const base = getPublicUrl(config.url_prefix, requestOptions);
    const url = `${base}-/web/detail/${name}${
      resolvedVersion && requestedVersion ? `/v/${encodeURIComponent(resolvedVersion)}` : ''
    }`;
    const logo = config.web?.logo;
    debug('resolved seo meta for %s', name);
    return {
      title: `${resolvedVersion ? `${name}@${resolvedVersion}` : name} - ${
        config.web?.title ?? 'Registry'
      }`,
      description: versionData?.description ?? manifest.description ?? `${name} package`,
      url,
      image: logo && isURLhasValidProtocol(logo) ? logo : undefined,
      jsonLd: packageJsonLd(manifest, name, resolvedVersion, url),
    };
  };
}
