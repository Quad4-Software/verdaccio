import { Command, Option } from 'clipanion';
import { dirname, resolve } from 'node:path';

import { findConfigFile, parseConfigFile } from '@verdaccio/config';
import { issueSetupLink } from 'verdaccio-htpasswd';

export class SetupLinkCommand extends Command {
  public static paths = [[`setup-link`]];

  static usage = Command.Usage({
    description: `print a one-time link that creates the first admin account`,
    details: `
      Refuses when an admin account already exists.

      The link works once and expires after 15 minutes. The running server
      reads the new link without a restart.
    `,
    examples: [[`Print a new setup link`, `verdaccio setup-link`]],
  });

  private config = Option.String('-c,--config', {
    description: 'use this configuration file (default: ./config.yaml)',
  });

  public async execute(): Promise<number> {
    const configPathLocation = findConfigFile(this.config as string);
    const configParsed = parseConfigFile(configPathLocation);
    const file = configParsed?.auth?.htpasswd?.file;
    if (typeof file !== 'string' || file.length === 0) {
      this.context.stdout.write('auth.htpasswd.file is not set\n');
      return 1;
    }

    const htpasswdFile = resolve(dirname(configPathLocation), file);
    const urlPrefix = typeof configParsed.url_prefix === 'string' ? configParsed.url_prefix : '';
    const issued = issueSetupLink(htpasswdFile, urlPrefix);
    if (!issued) {
      this.context.stdout.write('an admin account already exists\n');
      return 1;
    }

    const expires = new Date(issued.expires).toISOString();
    this.context.stdout.write(
      `setup link expires at ${expires} and works once\n${issued.link}\n`
    );
    return 0;
  }
}
