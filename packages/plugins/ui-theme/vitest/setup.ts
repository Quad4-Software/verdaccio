/**
 * Setup configuration for Vitest
 * This file includes global settings for the test environment.
 */
// Use ./matchers + extend from this vitest instance: the /vitest entry imports
// its own vitest copy, whose rejects/resolves registration clobbers ours.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import 'mutationobserver-shim';
import { expect, vi } from 'vitest';
import { Headers, Request, Response, fetch } from 'whatwg-fetch';

// Override the global fetch and related APIs
global.fetch = fetch;
global.Headers = Headers;
global.Request = Request;
global.Response = Response;

expect.extend(jestDomMatchers);

// @ts-ignore : Property '__VERDACCIO_BASENAME_UI_OPTIONS' does not exist on type 'Global'.
global.__VERDACCIO_BASENAME_UI_OPTIONS = {
  base: 'http://localhost:9000/',
  protocol: 'http',
  host: 'localhost',
  primaryColor: '#4b5e40',
  url_prefix: '',
  darkMode: false,
  language: 'en-US',
  uri: 'http://localhost:9000/',
  pkgManagers: ['pnpm', 'yarn', 'npm'],
  title: 'Verdaccio Dev UI',
  scope: '',
  version: 'v1.0.0',
};

// mocking few DOM methods
// @ts-ignore : Property 'document' does not exist on type 'Global'.
if (global.document) {
  // @ts-ignore : Type 'Mock<{ selectNodeContents: () => void; }, []>' is not assignable to type '() => Range'.
  document.createRange = vi.fn((): void => ({
    selectNodeContents: (): void => {},
  }));
  document.execCommand = vi.fn();
}
