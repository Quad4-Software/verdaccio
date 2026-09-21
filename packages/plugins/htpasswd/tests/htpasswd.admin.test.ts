import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { Config, parseConfigFile } from '@verdaccio/config';
import type { pluginUtils } from '@verdaccio/core';
import { constants, fileUtils } from '@verdaccio/core';

import type { HTPasswdConfig } from '../src/htpasswd';
import HTPasswd from '../src/htpasswd';

const options = {
  logger: { warn: vi.fn(), info: vi.fn() },
  config: new Config(parseConfigFile(path.join(import.meta.dirname, './__fixtures__/config.yaml'))),
} as any as pluginUtils.PluginOptions;

const config = {
  file: './htpasswd',
  max_users: 1000,
} as HTPasswdConfig;

describe('HTPasswd admin management', () => {
  let wrapper;
  let file: string;

  beforeEach(async () => {
    const tempPath = await fileUtils.createTempFolder('htpasswd-admin');
    file = path.join(tempPath, './htpasswd');
    wrapper = new HTPasswd({ ...config, file }, options);
    vi.clearAllMocks();
  });

  const addUser = (user: string, password: string): Promise<unknown> =>
    new Promise((resolve, reject) =>
      wrapper.adduser(user, password, (err, ok) => (err ? reject(err) : resolve(ok)))
    );

  test('the bootstrap admin is recorded and authenticates with $admin', async () => {
    const ok = await new Promise((resolve, reject) =>
      wrapper.bootstrapAdmin('root', 'long-enough-password', (err, ok) =>
        err ? reject(err) : resolve(ok)
      )
    );
    expect(ok).toBe(true);
    expect(wrapper.listAdmins()).toEqual(['root']);

    const groups = await new Promise((resolve, reject) =>
      wrapper.authenticate('root', 'long-enough-password', (err, groups) =>
        err ? reject(err) : resolve(groups)
      )
    );
    expect(groups).toEqual(expect.arrayContaining(['root', constants.ROLES.$ADMIN]));
  });

  test('a regular user does not carry $admin', async () => {
    await addUser('user', 'user-password-1');
    const groups = await new Promise((resolve, reject) =>
      wrapper.authenticate('user', 'user-password-1', (err, groups) =>
        err ? reject(err) : resolve(groups)
      )
    );
    expect(groups).toEqual(['user']);
    expect(groups).not.toContain(constants.ROLES.$ADMIN);
  });

  test('listUsers, setAdminFlag and deleteUser round trip', async () => {
    await addUser('one', 'one-password-11');
    await addUser('two', 'two-password-22');

    const users = await new Promise((resolve, reject) =>
      wrapper.listUsers((err, list) => (err ? reject(err) : resolve(list)))
    );
    expect(users).toEqual(expect.arrayContaining(['one', 'two']));

    const granted = await new Promise((resolve, reject) =>
      wrapper.setAdminFlag('one', true, (err, ok) => (err ? reject(err) : resolve(ok)))
    );
    expect(granted).toBe(true);
    expect(wrapper.listAdmins()).toContain('one');

    const removed = await new Promise((resolve, reject) =>
      wrapper.deleteUser('one', (err, ok) => (err ? reject(err) : resolve(ok)))
    );
    expect(removed).toBe(true);

    const afterDelete = await new Promise((resolve, reject) =>
      wrapper.listUsers((err, list) => (err ? reject(err) : resolve(list)))
    );
    expect(afterDelete).toEqual(['two']);
    // the admin flag must not survive the account
    expect(wrapper.listAdmins()).not.toContain('one');

    const denied = await new Promise((resolve) =>
      wrapper.authenticate('one', 'one-password-11', (_err, groups) => resolve(groups))
    );
    expect(denied).toBe(false);
  });

  test('resetPassword replaces the password without knowing the old one', async () => {
    await addUser('reset-me', 'old-password-11');
    const ok = await new Promise((resolve, reject) =>
      wrapper.resetPassword('reset-me', 'new-password-22', (err, ok) =>
        err ? reject(err) : resolve(ok)
      )
    );
    expect(ok).toBe(true);

    const groups = await new Promise((resolve, reject) =>
      wrapper.authenticate('reset-me', 'new-password-22', (err, groups) =>
        err ? reject(err) : resolve(groups)
      )
    );
    expect(groups).toEqual(['reset-me']);
  });

  test('setAdminFlag fails for a missing user', async () => {
    await expect(
      new Promise((resolve, reject) =>
        wrapper.setAdminFlag('ghost', true, (err, ok) => (err ? reject(err) : resolve(ok)))
      )
    ).rejects.toThrow(/does not exist/);
  });
});
