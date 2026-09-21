import buildDebug from 'debug';

import type { TemplateUIOptions } from '@verdaccio/types';

import type { Manifest } from './manifest';
import { getManifestValue } from './manifest';
import type { SeoMeta } from './seo';
import { escapeHtml, renderSeoTags } from './seo';

const debug = buildDebug('verdaccio:web:render:template');

export type Template = {
  manifest: Manifest;
  options: TemplateUIOptions;
  metaScripts?: string[];
  scriptsBodyAfter?: string[];
  scriptsBodyBefore?: string[];
  seo?: SeoMeta;
};

export interface AssetManifest {
  [key: string]: string;
}

export default function renderTemplate(template: Template, manifest: AssetManifest) {
  debug('template %o', template);
  debug('manifest %o', manifest);

  return `
    <!DOCTYPE html>
      <html lang="${escapeHtml(template?.options?.language ?? 'en-us')}">
      <head>
        <meta charset="utf-8">
        <base href="${template?.options.base}">
        <title>${escapeHtml(template?.seo?.title ?? template?.options?.title ?? '')}</title>
        <link rel="icon" href="${template?.options.base}-/static/favicon.ico">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${renderSeoTags(template?.seo, template?.options?.title ?? '')}
        <link rel="alternate" type="application/rss+xml" title="${escapeHtml(
          template?.options?.title ?? ''
        )} feed" href="${template?.options.base}-/verdaccio/data/feed">
        <script src="${template?.options.base}-/static/ui-options.js"></script>
        ${
          template.manifest.css?.length
            ? getManifestValue(template.manifest.css, manifest, template?.options.base)
                .map((item) => `<link rel="stylesheet" href="${item}">`)
                .join('\n        ')
            : ''
        }
        ${template?.metaScripts ? template.metaScripts.join('') : ''}
      </head>
      <body class="body">
        ${template?.scriptsBodyBefore ? template.scriptsBodyBefore.join('') : ''}
        <div id="root"></div>
        ${getManifestValue(template.manifest.js, manifest, template?.options.base)
          .map((item) => `<script type="module" src="${item}"></script>`)
          .join(`\n        `)}
        ${template?.scriptsBodyAfter ? template.scriptsBodyAfter.join('') : ''}
      </body>
    </html>
  `;
}
