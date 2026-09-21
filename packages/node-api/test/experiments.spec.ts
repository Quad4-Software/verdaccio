import { beforeEach, describe, expect, test, vi } from 'vitest';

import { logger } from '@verdaccio/logger';

import { displayExperimentsInfoBox, displaySecurityWarnings } from '../src/experiments';

vi.mock('@verdaccio/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('displayExperimentsInfoBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  test('should do nothing when flags is undefined', () => {
    displayExperimentsInfoBox(undefined);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('should do nothing when flags is null', () => {
    displayExperimentsInfoBox(null);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('should do nothing when flags is empty', () => {
    displayExperimentsInfoBox({});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('should warn and log enabled experiments', () => {
    displayExperimentsInfoBox({ token: true, search: true });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('token'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('is enabled'));
  });

  test('should log disabled experiments', () => {
    displayExperimentsInfoBox({ token: false });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('is disabled'));
  });
});

describe('displaySecurityWarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('warns when no security section is configured (legacy default)', () => {
    displaySecurityWarnings({});
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('security.api.legacy'));
  });

  test('warns when legacy is explicit without jwt', () => {
    displaySecurityWarnings({ security: { api: { legacy: true } } });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('security.api.legacy'));
  });

  test('stays quiet when jwt mode is configured', () => {
    displaySecurityWarnings({ security: { api: { jwt: { sign: {} } } } });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('warns when legacy and jwt are both set', () => {
    displaySecurityWarnings({ security: { api: { legacy: true, jwt: { sign: {} } } } });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('takes precedence'));
  });
});
