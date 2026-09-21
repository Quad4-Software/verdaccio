import { describe, expect, test } from 'vitest';

import { PLUGIN_CATEGORY } from '@verdaccio/core';
import { verifyPlugin } from '@verdaccio/plugin-verifier';

describe('Plugin loading verification', () => {
  test('should be loadable by verdaccio as an authentication plugin', async () => {
    const result = await verifyPlugin({
      pluginPath: 'oidc',
      category: PLUGIN_CATEGORY.AUTHENTICATION,
    });

    expect(result.success).toBe(true);
    expect(result.pluginsLoaded).toBe(1);
  });

  test('should be loadable by verdaccio as a middleware plugin', async () => {
    const result = await verifyPlugin({
      pluginPath: 'oidc',
      category: PLUGIN_CATEGORY.MIDDLEWARE,
    });

    expect(result.success).toBe(true);
    expect(result.pluginsLoaded).toBe(1);
  });
});
