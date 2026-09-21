import { logger } from '@verdaccio/logger';

export function displaySecurityWarnings(config) {
  const api = config?.security?.api;
  if (api?.jwt == null && api?.legacy !== false) {
    // legacy is the default; with no jwt section credentials stay inside
    // every request token
    logger.warn(
      'security.api.legacy token mode is in effect: credentials stay inside every request token. Consider security.api.jwt for stateless signed tokens instead'
    );
  }
  if (api?.jwt != null && api?.legacy === true) {
    logger.warn('both security.api.legacy and security.api.jwt are set; jwt takes precedence');
  }
}

export function displayExperimentsInfoBox(flags) {
  if (!flags) {
    return;
  }

  const experimentList = Object.keys(flags);
  if (experimentList.length >= 1) {
    logger.warn(
      `experiments are enabled, it is recommended do not use experiments in production comment out this section to disable it`
    );
    experimentList.forEach((experiment) => {
      logger.info(
        `support for experiment [${experiment}] ${
          flags[experiment] ? 'is enabled' : ' is disabled'
        }`
      );
    });
  }
}
