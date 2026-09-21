/**
 * Enum for web urls, used on the web middleware
 */
export enum WebUrls {
  sidebar_scopped_package = '/sidebar/:scope/:package',
  sidebar_package = '/sidebar/:package',
  readme_package_scoped_version = '/package/readme/:scope/:package{/:version}',
  readme_package_version = '/package/readme/:package{/:version}',
  visibility_scoped_package = '/package/visibility/:scope/:package',
  visibility_package = '/package/visibility/:package',
  packages_all = '/packages',
  feed = '/feed',
  feed_package = '/feed/:package',
  feed_scoped_package = '/feed/:scope/:package',
  user_login = '/login',
  user_signup = '/signup',
  search = '/search/:anything',
  reset_password = '/reset_password',
  setup = '/setup',
  setup_status = '/setup/status',
  admin_status = '/admin/status',
  admin_users = '/admin/users',
  admin_user = '/admin/users/:user',
  admin_user_password = '/admin/users/:user/password',
  admin_user_tfa = '/admin/users/:user/tfa',
  admin_user_admin = '/admin/users/:user/admin',
  admin_packages = '/admin/packages',
  admin_package_visibility_scoped = '/admin/packages/visibility/:scope/:package',
  admin_package_visibility = '/admin/packages/visibility/:package',
  admin_metrics = '/admin/metrics',
  admin_audit = '/admin/audit',
  admin_retention = '/admin/retention',
}

/**
 * Enum for web urls namespace, used on the web middleware
 */
export enum WebUrlsNamespace {
  root = '/',
  static = '/-/static/{*all}',
  assets = '/-/assets/{*all}',
  endpoints = '/-/verdaccio/',
  web = '/-/web/{*all}',
  data = '/data/',
  sec = '/sec/',
}
