import buildDebug from 'debug';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { HEADERS } from '@verdaccio/core';
import { isURLhasValidProtocol } from '@verdaccio/url';

import { setSecurityWebHeaders } from './security';
import { sendFileCallback, sendFileSafe } from './utils/file-utils';
import renderHTML from './utils/renderHTML';
import type { PackageSeoResolver } from './utils/seo';
import { getUIOptions } from './utils/ui-options';
import { WebUrlsNamespace } from './web-urls';

const debug = buildDebug('verdaccio:middleware:web:render');

export function renderWebMiddleware(
  config,
  tokenMiddleware,
  pluginOptions,
  getPackageSeo?: PackageSeoResolver
) {
  const { staticPath, manifest, manifestFiles } = pluginOptions;
  debug('static path %o', staticPath);

  /* eslint new-cap:off */
  const router = express.Router();
  if (typeof tokenMiddleware === 'function') {
    router.use(tokenMiddleware);
  }

  router.use(setSecurityWebHeaders);

  // any match within the static is routed to the file system
  router.get(
    WebUrlsNamespace.static,
    function (req: express.Request<{ all: string | string[] }>, res, next) {
      const filename = Array.isArray(req.params.all) ? req.params.all.join('/') : req.params.all;
      if (filename === 'favicon.ico' && config?.web?.favicon) {
        const file = config?.web?.favicon;
        if (isURLhasValidProtocol(file)) {
          debug('redirect to favicon %s', file);
          req.url = file;
          return next();
        }
        debug('render custom favicon %o', file);
        // see sendFileSafe for the reasoning behind `dotfiles: 'allow'`
        res.sendFile(file, { dotfiles: 'allow' }, sendFileCallback(next));
        return;
      }
      debug('render static file %o', filename);
      sendFileSafe(staticPath, filename, res, next);
    }
  );

  function renderLogo(logo: string | undefined): string | undefined {
    // check the origin of the logo
    if (logo && !isURLhasValidProtocol(logo)) {
      // URI related to a local file
      const absoluteLocalFile = path.posix.resolve(logo);
      debug('serve local logo %s', absoluteLocalFile);
      try {
        // TODO: replace existsSync by async alternative
        if (
          fs.existsSync(absoluteLocalFile) &&
          typeof fs.accessSync(absoluteLocalFile, fs.constants.R_OK) === 'undefined'
        ) {
          // Note: `path.join` will break on Windows, because it transforms `/` to `\`
          // Use POSIX version `path.posix.join` instead.
          logo = `/-/static/${path.basename(logo)}`;
          router.get(logo, function (_req, res, next) {
            // @ts-ignore
            debug('serve custom logo  web:%s - local:%s', logo, absoluteLocalFile);
            res.sendFile(
              path.basename(absoluteLocalFile),
              { root: path.dirname(absoluteLocalFile), dotfiles: 'allow' },
              sendFileCallback(next)
            );
          });
          debug('enabled custom logo %s', logo);
        } else {
          logo = undefined;
          debug(`web logo is wrong, path ${absoluteLocalFile} does not exist or is not readable`);
        }
      } catch {
        logo = undefined;
        debug(`web logo is wrong, path ${absoluteLocalFile} does not exist or is not readable`);
      }
    }
    return logo;
  }

  const logo = renderLogo(config?.web?.logo);
  if (config?.web?.logo) {
    config.web.logo = logo;
  }
  const logoDark = renderLogo(config?.web?.logoDark);
  if (config?.web?.logoDark) {
    config.web.logoDark = logoDark;
  }

  // Serve external script that loads UI options
  router.get(WebUrlsNamespace.static + 'ui-options.js', function (req, res) {
    const options = getUIOptions(config, req, res);
    // escape < so a config value cannot close the script element
    const script = `window.__VERDACCIO_BASENAME_UI_OPTIONS=${JSON.stringify(options).replace(/</g, '\\u003c')};`;
    res.setHeader(HEADERS.CACHE_CONTROL, HEADERS.NO_CACHE);
    res.setHeader(HEADERS.CONTENT_TYPE, HEADERS.JAVASCRIPT_CHARSET);
    res.send(script);
  });

  // Package detail pages get package-specific meta for crawlers and link
  // previews; a resolver failure falls back to the generic meta
  const renderDetail = async function (req, res, _next) {
    const options = getUIOptions(config, req, res);
    try {
      const seo = getPackageSeo ? await getPackageSeo(req) : undefined;
      renderHTML(config, manifest, manifestFiles, options, res, seo);
    } catch (error: any) {
      debug('seo resolver failed %o', error?.message);
      renderHTML(config, manifest, manifestFiles, options, res);
    }
  };
  router.get('/-/web/detail/:package{/:view/:version}', renderDetail);
  router.get('/-/web/detail/:scope/:package{/:view/:version}', renderDetail);

  // Handle all web routes including security routes
  router.get(WebUrlsNamespace.web, function (req, res) {
    const options = getUIOptions(config, req, res);
    renderHTML(config, manifest, manifestFiles, options, res);
    debug('render html section');
  });

  router.get(WebUrlsNamespace.root, function (req, res) {
    const options = getUIOptions(config, req, res);
    renderHTML(config, manifest, manifestFiles, options, res);
    debug('render root');
  });

  // any match within the asset folder is routed to the file system
  if (config?.web?.assetFolder) {
    router.get(
      WebUrlsNamespace.assets,
      function (req: express.Request<{ all: string | string[] }>, res, next) {
        const filename = Array.isArray(req.params.all) ? req.params.all.join('/') : req.params.all;
        sendFileSafe(config.web.assetFolder, filename, res, next);
      }
    );
  }

  return router;
}
