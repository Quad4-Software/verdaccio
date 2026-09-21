import buildDebug from 'debug';
import { Router } from 'express';

import type { Auth } from '@verdaccio/auth';
import { createAnonymousRemoteUser } from '@verdaccio/config';
import { HEADERS, HTTP_STATUS } from '@verdaccio/core';
import {
  $NextFunctionVer,
  $RequestExtend,
  $ResponseExtend,
  WebUrls,
  getRequestOptions,
} from '@verdaccio/middleware';
import type { Storage } from '@verdaccio/store';
import { assertManifestVisibility, canPublish } from '@verdaccio/store';
import { getPublicUrl } from '@verdaccio/url';
import type { Config, Manifest, RemoteUser, Version } from '@verdaccio/types';

import { hasLogin } from '../web-utils';
import { scopedPackageAccess } from './scoped-access';

const debug = buildDebug('verdaccio:web:api:feed');

// feed readers only need recent history; the list is rebuilt per request
const GLOBAL_FEED_LIMIT = 50;

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRssDate(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
}

// the UI detail route takes the raw package name (/-/web/detail/@scope/name)
function detailLink(base: string, name: string): string {
  return `${base}-/web/detail/${name}`;
}

type FeedItem = {
  title: string;
  link: string;
  date: unknown;
  description: string;
};

function renderRss(
  base: string,
  channelTitle: string,
  channelDescription: string,
  selfLink: string,
  items: FeedItem[]
): string {
  const body = items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.title)}</guid>
      <pubDate>${toRssDate(item.date)}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(base)}</link>
    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(channelDescription)}</description>
${body}
  </channel>
</rss>
`;
}

function sendFeed(res: $ResponseExtend, xml: string): void {
  res.set(HEADERS.CONTENT_TYPE, 'application/rss+xml; charset=utf-8');
  res.set(HEADERS.CACHE_CONTROL, HEADERS.NO_CACHE);
  res.send(xml);
}

function addFeedWebApi(storage: Storage, auth: Auth, config: Config): Router {
  const router = Router(); /* eslint new-cap: 0 */
  const isLoginEnabled = hasLogin(config);
  const anonymousRemoteUser: RemoteUser = createAnonymousRemoteUser();

  const isVisible = async (name: string, visibility: unknown, remoteUser: RemoteUser) => {
    const accessUser = !isLoginEnabled ? anonymousRemoteUser : remoteUser;
    const allowed = await new Promise<boolean>((resolve) => {
      auth.allow_access({ packageName: name }, accessUser, (err, ok) => resolve(!err && !!ok));
    });
    if (!allowed) {
      return false;
    }
    if (visibility === 'private' && (await canPublish(auth, name, accessUser)) === false) {
      return false;
    }
    return true;
  };

  router.get(
    WebUrls.feed,
    async function (req: $RequestExtend, res: $ResponseExtend, next: $NextFunctionVer) {
      debug('global feed requested');
      try {
        const localPackages = await storage.getLocalDatabase();
        const visible: Version[] = [];
        for (const pkg of localPackages) {
          if (await isVisible(pkg.name, pkg.visibility, req.remote_user)) {
            visible.push(pkg);
          }
        }
        const base = getPublicUrl(config.url_prefix, getRequestOptions(req));
        // storage stamps the latest publish time onto the list entries
        const items: FeedItem[] = (visible as (Version & { time?: string })[])
          .sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime())
          .slice(0, GLOBAL_FEED_LIMIT)
          .map((pkg) => ({
            title: `${pkg.name}@${pkg.version}`,
            link: detailLink(base, pkg.name),
            date: pkg.time,
            description: pkg.description ?? '',
          }));

        sendFeed(
          res,
          renderRss(
            base,
            `${config.web?.title ?? 'Registry'} package updates`,
            'Recently published and updated packages',
            `${base}-/verdaccio/data${WebUrls.feed}`,
            items
          )
        );
      } catch (error: any) {
        next(error);
      }
    }
  );

  router.get(
    [WebUrls.feed_scoped_package, WebUrls.feed_package],
    scopedPackageAccess(auth, config),
    async function (req: $RequestExtend, res: $ResponseExtend, _next: $NextFunctionVer) {
      const name = (req as $RequestExtend & { scopedPackageName: string }).scopedPackageName;
      try {
        const manifest = (await storage.getPackageByOptions({
          name,
          uplinksLook: true,
          keepUpLinkData: true,
          requestOptions: getRequestOptions(req),
        })) as Manifest;
        await assertManifestVisibility(auth, manifest, req.remote_user);

        const time = manifest.time ?? {};
        const base = getPublicUrl(config.url_prefix, getRequestOptions(req));
        const items: FeedItem[] = Object.keys(manifest.versions ?? {})
          .sort((a, b) => new Date(time[b] ?? 0).getTime() - new Date(time[a] ?? 0).getTime())
          .map((version) => ({
            title: `${name}@${version}`,
            link: `${base}-/web/detail/${name}/v/${encodeURIComponent(version)}`,
            date: time[version],
            description: manifest.versions[version]?.description ?? manifest.description ?? '',
          }));

        sendFeed(
          res,
          renderRss(
            base,
            `${name} releases`,
            manifest.description ?? `Releases of ${name}`,
            `${base}-/verdaccio/data${WebUrls.feed}/${name}`,
            items
          )
        );
      } catch {
        res.status(HTTP_STATUS.NOT_FOUND);
        res.end();
      }
    }
  );

  return router;
}

export default addFeedWebApi;
