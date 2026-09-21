export enum Route {
  ROOT = '/',
  DETAIL = '/-/web/detail/',
  SCOPE_PACKAGE = '/-/web/detail/:scope/:package',
  SCOPE_PACKAGE_VERSION = '/-/web/detail/:scope/:package/v/:version',
  PACKAGE = '/-/web/detail/:package',
  PACKAGE_VERSION = '/-/web/detail/:package/v/:version',
  // Security UI routes
  LOGIN = '/-/web/login',
  SUCCESS = '/-/web/success',
  ADD_USER = '/-/web/add-user',
  CHANGE_PASSWORD = '/-/web/change-password',
  SETUP = '/-/web/setup',
  TWO_FACTOR = '/-/web/two-factor',
  // Staged publish workflow (`npm stage`), behind the `stage` flag
  STAGE = '/-/web/stage',
  STAGE_DETAIL = '/-/web/stage/:stageId',
  // Security API routes
  LOGIN_API = '/-/v1/login_cli',
  CHANGE_PASSWORD_API = '/-/npm/v1/user',
}

// Example API request:
// http://localhost:8000/-/verdaccio/data/package/readme/jquery
export enum APIRoute {
  LOGIN = '/-/verdaccio/sec/login',
  SIGNUP = '/-/verdaccio/sec/signup',
  RESET_PASSWORD = '/-/verdaccio/sec/reset_password',
  SETUP = '/-/verdaccio/sec/setup',
  SETUP_STATUS = '/-/verdaccio/sec/setup/status',
  PROFILE = '/-/npm/v1/user',
  // served by the oidc plugin when the middleware is enabled; a 404 or network
  // error just hides the SSO button
  OIDC_CONFIG = '/-/oauth/config',
  CONFIG = '/-/verdaccio/packages',
  PACKAGES = '/-/verdaccio/data/packages',
  SEARCH = '/-/verdaccio/data/search/', // :value
  SIDEBAR = '/-/verdaccio/data/sidebar/', // :packageName?v=version
  README = '/-/verdaccio/data/package/readme/', // :packageName?v=version
  VISIBILITY = '/-/verdaccio/data/package/visibility/', // :packageName
  // served by the registry router, not the web one, like CHANGE_PASSWORD_API
  STAGE = '/-/stage',
}
