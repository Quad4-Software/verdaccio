import supertest from 'supertest';
import { beforeAll, describe, expect, test } from 'vitest';

import { HEADERS, HTTP_STATUS, TOKEN_BEARER } from '@verdaccio/core';

import {
  buildToken,
  getNewToken,
  initializeServerWithContext,
  publishVersion,
  publishVersionWithToken,
} from './_helper';

describe('package visibility', () => {
  describe('visibility group list in packages rules', () => {
    let app;
    let maintainerToken: string;

    beforeAll(async () => {
      ({ app } = await initializeServerWithContext('visibility.yaml'));
      maintainerToken = await getNewToken(app, {
        name: 'maintainer',
        password: 'strongPass123',
      });
      await publishVersionWithToken(app, 'hidden-pkg', '1.0.0', maintainerToken).expect(
        HTTP_STATUS.CREATED
      );
      await publishVersion(app, 'open-pkg', '1.0.0').expect(HTTP_STATUS.CREATED);
    });

    test('an anonymous request gets 404 on a hidden package even though access allows it', async () => {
      const response = await supertest(app).get('/hidden-pkg').set(HEADERS.ACCEPT, HEADERS.JSON);
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
      expect(response.body?.name).toBeUndefined();
    });

    test('an anonymous request gets 404 on a hidden package tarball', async () => {
      const response = await supertest(app)
        .get('/hidden-pkg/-/hidden-pkg-1.0.0.tgz')
        .set(HEADERS.ACCEPT, HEADERS.JSON);
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    test('an authenticated user outside the visibility list still gets 404', async () => {
      const otherToken = await getNewToken(app, { name: 'reader', password: 'strongPass123' });
      const response = await supertest(app)
        .get('/hidden-pkg')
        .set(HEADERS.ACCEPT, HEADERS.JSON)
        .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, otherToken));
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    test('a user in the visibility list reads the package', async () => {
      const response = await supertest(app)
        .get('/hidden-pkg')
        .set(HEADERS.ACCEPT, HEADERS.JSON)
        .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, maintainerToken))
        .expect(HTTP_STATUS.OK);
      expect(response.body.name).toBe('hidden-pkg');
    });

    test('packages outside the rule are unaffected', async () => {
      await supertest(app)
        .get('/open-pkg')
        .set(HEADERS.ACCEPT, HEADERS.JSON)
        .expect(HTTP_STATUS.OK);
    });
  });

  describe('packument visibility flag', () => {
    let app;
    let storage;
    let maintainerToken: string;

    beforeAll(async () => {
      ({ app, storage } = await initializeServerWithContext('visibility.yaml'));
      maintainerToken = await getNewToken(app, { name: 'maintainer', password: 'strongPass123' });
      await publishVersionWithToken(app, 'locked-pkg', '1.0.0', maintainerToken).expect(
        HTTP_STATUS.CREATED
      );
    });

    test('a private package returns 404 for users without publish rights', async () => {
      await storage.setPackageVisibility('locked-pkg', 'private');

      const response = await supertest(app).get('/locked-pkg').set(HEADERS.ACCEPT, HEADERS.JSON);
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    test('a private package tarball returns 404 for users without publish rights', async () => {
      await storage.setPackageVisibility('locked-pkg', 'private');

      const response = await supertest(app)
        .get('/locked-pkg/-/locked-pkg-1.0.0.tgz')
        .set(HEADERS.ACCEPT, HEADERS.JSON);
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    test('the publisher still reads a private package', async () => {
      await storage.setPackageVisibility('locked-pkg', 'private');

      const response = await supertest(app)
        .get('/locked-pkg')
        .set(HEADERS.ACCEPT, HEADERS.JSON)
        .set(HEADERS.AUTHORIZATION, buildToken(TOKEN_BEARER, maintainerToken))
        .expect(HTTP_STATUS.OK);
      expect(response.body.visibility).toBe('private');
    });

    test('clearing the flag restores access', async () => {
      await storage.setPackageVisibility('locked-pkg', 'public');

      await supertest(app)
        .get('/locked-pkg')
        .set(HEADERS.ACCEPT, HEADERS.JSON)
        .expect(HTTP_STATUS.OK);
    });
  });
});
