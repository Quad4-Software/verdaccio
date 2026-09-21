import * as tarStream from 'tar-stream';
import { beforeAll, describe, expect, test } from 'vitest';

import { setup } from '@verdaccio/logger';
import type { Logger, ScanConfig, Version } from '@verdaccio/types';

import { scanPublish } from '../src/lib/publish-scan';

let logger: Logger;
beforeAll(async () => {
  logger = await setup({ type: 'stdout', format: 'pretty', level: 'trace' });
});

async function tarballWith(entries: string[]): Promise<Buffer> {
  const pack = tarStream.pack();
  for (const name of entries) {
    pack.entry({ name }, 'x');
  }
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

const version = (extra: Partial<Version> = {}): Version =>
  ({ name: 'foo', version: '1.0.0', ...extra }) as Version;

const scan = (overrides: Partial<ScanConfig> = {}): ScanConfig => ({
  enabled: true,
  ...overrides,
});

describe('publish scan', () => {
  test('is a no-op when disabled', async () => {
    const result = await scanPublish('foo', version(), Buffer.from('x'), undefined, logger);
    expect(result).toBeNull();
  });

  test('flags denied licenses as critical', async () => {
    const result = await scanPublish(
      'foo',
      version({ license: 'GPL-3.0' }),
      await tarballWith(['package/index.js']),
      scan({ licenses: { deny: ['GPL-3.0'] } }),
      logger
    );
    expect(result!.status).toBe('fail');
    expect(result!.findings[0].type).toBe('license');
  });

  test('flags licenses outside the allow list', async () => {
    const result = await scanPublish(
      'foo',
      version({ license: 'MIT' }),
      await tarballWith(['package/index.js']),
      scan({ licenses: { allow: ['Apache-2.0'] } }),
      logger
    );
    expect(result!.status).toBe('fail');
  });

  test('warns on lifecycle scripts by default and fails on deny', async () => {
    const tarball = await tarballWith(['package/index.js']);
    const withScripts = version({ scripts: { postinstall: 'node x.js' } as any });
    const warnResult = await scanPublish('foo', withScripts, tarball, scan(), logger);
    expect(warnResult!.status).toBe('warn');
    const denyResult = await scanPublish(
      'foo',
      withScripts,
      tarball,
      scan({ install_scripts: 'deny' }),
      logger
    );
    expect(denyResult!.status).toBe('fail');
  });

  test('detects native payloads inside the tarball', async () => {
    const tarball = await tarballWith(['package/index.js', 'package/build/Release/addon.node']);
    const result = await scanPublish(
      'foo',
      version(),
      tarball,
      scan({ native_code: 'deny' }),
      logger
    );
    expect(result!.status).toBe('fail');
    expect(result!.findings[0].type).toBe('native-code');
  });

  test('clean packages pass', async () => {
    const tarball = await tarballWith(['package/index.js', 'package/README.md']);
    const result = await scanPublish(
      'foo',
      version({ license: 'MIT' }),
      tarball,
      scan({ licenses: { allow: ['MIT', 'ISC'] } }),
      logger
    );
    expect(result!.status).toBe('pass');
  });

  test('required license policy flags undeclared licenses', async () => {
    const tarball = await tarballWith(['package/index.js']);
    const result = await scanPublish(
      'foo',
      version(),
      tarball,
      scan({ licenses: { required: true } }),
      logger
    );
    expect(result!.status).toBe('warn');
    expect(result!.findings[0].message).toContain('does not declare');
  });
});
