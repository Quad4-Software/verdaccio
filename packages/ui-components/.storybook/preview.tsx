import type { Preview, StoryFn } from '@storybook/react-vite';
import { isCommonAssetRequest } from 'msw';
import { setupWorker } from 'msw/browser';
import { mswLoader } from 'msw-storybook-addon/csf3';
import React from 'react';

import {
  AppConfigurationProvider,
  PersistenceSettingProvider,
  StyleBaseline,
  ThemeProvider,
  TranslatorProvider,
} from '../src';
import { AuthProvider } from '../src/providers';
import i18n, { listLanguages } from './i18n';

// preview-head file contains the __VERDACCIO_BASENAME_UI_OPTIONS
// required by AppConfigurationProvider
export const withMuiTheme = (Story: StoryFn) => (
  <TranslatorProvider onMount={() => ({})} i18n={i18n} listLanguages={listLanguages}>
    <PersistenceSettingProvider>
      <AppConfigurationProvider>
        <ThemeProvider>
          <>
            <StyleBaseline />
            <AuthProvider>
              <Story />
            </AuthProvider>
          </>
        </ThemeProvider>
      </AppConfigurationProvider>
    </PersistenceSettingProvider>
  </TranslatorProvider>
);

/*
 * Initializes MSW: start the worker once and hand it to the addon loader.
 */
const setupMsw = async () => {
  const worker = setupWorker();
  await worker.start({
    quiet: true,
    onUnhandledRequest(request, print) {
      if (
        isCommonAssetRequest(request) ||
        /sb-common-assets|sb-vite|@vite|@react-refresh|iframe.html|\.stories\./.test(request.url)
      ) {
        return;
      }
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith('/my-specific-api-path')) {
        console.error(`Unhandled ${request.method} request to ${request.url}.

          This exception has been only logged in the console, however, it's strongly recommended to resolve this error as you don't want unmocked data in Storybook stories.

          If you wish to mock an error response, please refer to this guide: https://mswjs.io/docs/recipes/mocking-error-responses
        `);
        return;
      }
      print.warning();
    },
  });
  return worker;
};

/*
 * Setup the preview
 */
const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
  },
  decorators: [withMuiTheme],
  loaders: [mswLoader(setupMsw)],
};

export default preview;
