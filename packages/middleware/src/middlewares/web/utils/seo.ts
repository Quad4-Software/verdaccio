import type { Manifest } from '@verdaccio/types';

import type { $RequestExtend } from '../../../types';

export interface SeoMeta {
  title?: string;
  description?: string;
  url?: string;
  image?: string;
  /** serialized JSON-LD object, rendered as a script tag */
  jsonLd?: Record<string, unknown>;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSeoTags(seo: SeoMeta | undefined, siteTitle: string): string {
  const description = seo?.description ?? `${siteTitle} web interface`;
  const title = seo?.title ?? siteTitle;
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeHtml(siteTitle)}">`,
    `<meta name="twitter:card" content="summary">`,
  ];
  if (seo?.url) {
    tags.push(`<link rel="canonical" href="${escapeHtml(seo.url)}">`);
    tags.push(`<meta property="og:url" content="${escapeHtml(seo.url)}">`);
  }
  if (seo?.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(seo.image)}">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(seo.image)}">`);
  }
  if (seo?.jsonLd) {
    // a raw < in JSON could close the script element; escape it
    const json = JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c');
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }
  return tags.join('\n        ');
}

/**
 * Resolves package-specific meta tags for the detail page; returns undefined
 * when the request has no access or the package does not exist, in which case
 * the generic site meta is rendered instead.
 */
export type PackageSeoResolver = (req: $RequestExtend) => Promise<SeoMeta | undefined>;

/**
 * The JSON-LD record for a package detail page, following schema.org's
 * SoftwarePackage type.
 */
export function packageJsonLd(
  manifest: Manifest,
  name: string,
  version: string | undefined,
  url: string
): Record<string, unknown> {
  const resolvedVersion = version ?? manifest?.['dist-tags']?.['latest'];
  const versionData = resolvedVersion ? manifest?.versions?.[resolvedVersion] : undefined;
  const time = manifest?.time ?? {};
  const author = versionData?.author ?? manifest?.author;
  const record: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwarePackage',
    name,
    url,
    description: versionData?.description ?? manifest?.description,
    version: resolvedVersion,
  };
  if (typeof author === 'string') {
    record.author = { '@type': 'Person', name: author };
  } else if (author?.name) {
    record.author = { '@type': 'Person', name: author.name };
  }
  if (versionData?.license ?? manifest?.license) {
    record.license = versionData?.license ?? manifest?.license;
  }
  if (time?.modified) {
    record.dateModified = time.modified;
  }
  if (resolvedVersion && time?.[resolvedVersion]) {
    record.datePublished = time[resolvedVersion];
  }
  return record;
}
