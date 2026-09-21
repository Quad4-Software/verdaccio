import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import type { pluginUtils } from '@verdaccio/core';

import HTPasswd from '../src/htpasswd';
import {
  SETUP_TTL_MS,
  consumeSetupLink,
  formatSetupLink,
  inspectSetupLink,
  issueSetupLink,
  validateSetupAccount,
} from '../src/setup-link';

const dirs: string[] = [];

function tempHtpasswd(body = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'verdaccio-setup-'));
  dirs.push(dir);
  const file = join(dir, 'htpasswd');
  if (body) {
    writeFileSync(file, body);
  }
  return file;
}

function tokenFromLink(link: string): string {
  const hash = link.split('#')[1];
  return decodeURIComponent(hash);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.VERDACCIO_PUBLIC_URL;
});

describe('setup link', () => {
  test('prints a one-time link and then rejects it', () => {
    const file = tempHtpasswd();
    const issued = issueSetupLink(file);
    expect(issued).not.toBeNull();
    const token = tokenFromLink(issued!.link);
    expect(issued!.link.startsWith('/-/web/setup#')).toBe(true);
    expect(issued!.expires - Date.now()).toBeLessThanOrEqual(SETUP_TTL_MS);
    expect(inspectSetupLink(file, token)).toMatchObject({ state: 'ok' });
    expect(consumeSetupLink(file, token)).toBe('ok');
    expect(consumeSetupLink(file, token)).toBe('invalid');
    expect(inspectSetupLink(file, token).state).toBe('invalid');
  });

  test('uses the public origin when it is set', () => {
    process.env.VERDACCIO_PUBLIC_URL = 'https://registry.example.com';
    expect(formatSetupLink('abc')).toBe('https://registry.example.com/-/web/setup#abc');
  });

  test('rejects an expired link', () => {
    const file = tempHtpasswd();
    const issued = issueSetupLink(file);
    const token = tokenFromLink(issued!.link);
    const setupFile = `${file}.setup`;
    const parsed = JSON.parse(readFileSync(setupFile, 'utf8'));
    parsed.expires = Date.now() - 1000;
    writeFileSync(setupFile, JSON.stringify(parsed));
    expect(inspectSetupLink(file, token).state).toBe('invalid');
    expect(consumeSetupLink(file, 'not-a-token')).toBe('invalid');
  });

  test('refuses to issue a link when an account exists', () => {
    const file = tempHtpasswd('admin:$argon2id$stub\n');
    expect(issueSetupLink(file)).toBeNull();
  });

  test('does not accept a matching link after an account exists', () => {
    const file = tempHtpasswd();
    const issued = issueSetupLink(file);
    const token = tokenFromLink(issued!.link);
    writeFileSync(file, 'admin:$argon2id$stub\n');
    expect(consumeSetupLink(file, token)).toBe('admin-exists');
    expect(inspectSetupLink(file, token).state).toBe('invalid');
  });

  test('rejects a short password', () => {
    expect(validateSetupAccount('admin', 'short')).toMatch(/12/);
    expect(validateSetupAccount('admin', 'long-enough-password')).toBeNull();
    expect(validateSetupAccount('bad name', 'long-enough-password')).toMatch(/url-safe/);
  });

  test('creates the first admin when signup is disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verdaccio-setup-'));
    dirs.push(dir);
    const file = join(dir, 'htpasswd');
    const wrapper = new HTPasswd({ file, max_users: -1 } as any, {
      logger: { info() {}, warn() {}, error() {} },
      config: { configPath: join(dir, 'config.yaml') },
    } as unknown as pluginUtils.PluginOptions);

    await new Promise<void>((resolve, reject) => {
      wrapper.bootstrapAdmin('admin', 'long-enough-password', (err, ok) => {
        if (err || !ok) {
          reject(err ?? new Error('bootstrap failed'));
          return;
        }
        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      wrapper.authenticate('admin', 'long-enough-password', (err, groups) => {
        if (err) {
          reject(err);
          return;
        }
        expect(groups).toContain('admin');
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      wrapper.bootstrapAdmin('other', 'long-enough-password', (err) => {
        expect(err).toBeTruthy();
        resolve();
      });
    });
  });
});
