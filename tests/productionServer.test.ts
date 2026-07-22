import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/identityService';
import { openPiasDatabase } from '../src/persistence/sqliteDatabase';
import { createProductionServer } from '../src/server/productionServer';

const directories: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('standalone production server', () => {
  it('serves health, hashed assets and SPA routes without Vite', async () => {
    const fixture = await createFixture();
    const application = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    });
    servers.push(application);
    const { origin } = await application.start();

    const live = await fetch(`${origin}/api/health/live`);
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toMatchObject({
      status: 'ok',
      version: '0.1.0',
      revision: 'abc1234',
    });
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({ status: 'ready' });

    const spa = await fetch(`${origin}/projects/project-a/workbench`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<main>PIAS production</main>');
    expect(spa.headers.get('cache-control')).toBe('no-store');
    expect(spa.headers.get('x-frame-options')).toBe('DENY');

    const asset = await fetch(`${origin}/assets/app.abcdef12.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('window.PIAS=true;');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('preserves the auth guard for unknown APIs instead of returning the SPA shell', async () => {
    const fixture = await createFixture();
    const application = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    });
    servers.push(application);
    const { origin } = await application.start();

    const response = await fetch(`${origin}/api/unknown`);

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AUTH_SESSION_INVALID' },
    });
  });

  it('fails closed before binding when production safeguards are absent', async () => {
    await expect(createProductionServer({
      env: { NODE_ENV: 'development', PIAS_SECURE_COOKIES: 'false' },
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    })).rejects.toThrow('PRODUCTION_MODE_REQUIRED');
  });

  it('stops accepting connections after graceful close', async () => {
    const fixture = await createFixture();
    const application = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    });
    const { origin } = await application.start();

    await application.close();

    await expect(fetch(`${origin}/api/health/live`)).rejects.toThrow();
  });

  it('reports a port conflict without interrupting the active instance', async () => {
    const fixture = await createFixture();
    const active = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    });
    servers.push(active);
    const { origin } = await active.start();
    const port = Number(new URL(origin).port);
    const conflicting = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port,
      logger: () => undefined,
    });

    await expect(conflicting.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await expect(fetch(`${origin}/api/health/live`).then((response) => response.status))
      .resolves.toBe(200);
  });
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pias-production-server-'));
  directories.push(directory);
  const databaseFile = join(directory, 'pias.sqlite');
  const database = openPiasDatabase(databaseFile);
  database.close();
  const assetDirectory = join(directory, 'assets');
  const artifactDirectory = join(directory, 'dist');
  await mkdir(assetDirectory, { mode: 0o700 });
  await mkdir(join(artifactDirectory, 'assets'), { recursive: true, mode: 0o700 });
  await writeFile(
    join(artifactDirectory, 'index.html'),
    '<!doctype html><main>PIAS production</main>',
    { mode: 0o600 },
  );
  await writeFile(
    join(artifactDirectory, 'assets', 'app.abcdef12.js'),
    'window.PIAS=true;',
    { mode: 0o600 },
  );
  await writeFile(join(artifactDirectory, 'release.json'), JSON.stringify({
    schemaVersion: 1,
    service: 'pias-image-studio',
    version: '0.1.0',
    revision: 'abc1234',
    dirty: false,
    builtAt: '2026-07-22T00:45:00.000Z',
  }), { mode: 0o644 });
  const authConfigFile = join(directory, 'auth.json');
  await writeFile(authConfigFile, JSON.stringify({
    schemaVersion: 1,
    users: [{
      id: 'user-owner',
      tenantId: 'tenant-a',
      email: 'owner@pias.test',
      displayName: 'Owner',
      passwordHash: await hashPassword('PIAS-release-2026!'),
      role: 'owner',
      status: 'active',
      projectIds: ['project-a'],
      mfaEnabled: true,
      mfaSecret: 'JBSWY3DPEHPK3PXP',
    }],
  }), { mode: 0o600 });

  return {
    env: {
      NODE_ENV: 'production',
      PIAS_SECURE_COOKIES: 'true',
      PIAS_PERSISTENCE_BACKEND: 'sqlite',
      PIAS_DATABASE_FILE: databaseFile,
      PIAS_ASSET_DIR: assetDirectory,
      PIAS_RELEASE_ARTIFACT_DIR: artifactDirectory,
      PIAS_AUTH_CONFIG_FILE: authConfigFile,
    },
  };
}
