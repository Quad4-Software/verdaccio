import express from 'express';

import { renderWebMiddleware } from './render-web';
import { webAPIMiddleware } from './web-api';
import { WebUrlsNamespace } from './web-urls';

export default (config, middlewares, pluginOptions): any => {
  const router = express.Router();
  const { tokenMiddleware, webEndpointsApi, getPackageSeo } = middlewares;
  // render web
  router.use(
    WebUrlsNamespace.root,
    renderWebMiddleware(config, tokenMiddleware, pluginOptions, getPackageSeo)
  );
  // web endpoints: search, packages, readme, sidebar, etc
  router.use(WebUrlsNamespace.endpoints, webAPIMiddleware(tokenMiddleware, webEndpointsApi));
  return router;
};
