import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateTotp, hashPassword } from '../src/auth/identityService';
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
  it('pins finite HTTP parser, request and keep-alive budgets', async () => {
    const module = await import('../src/server/productionServer') as unknown as {
      productionHttpLimits?: Record<string, number>;
    };

    expect(module.productionHttpLimits).toEqual({
      requestTimeout: 60_000,
      headersTimeout: 15_000,
      keepAliveTimeout: 5_000,
      connectionsCheckingInterval: 1_000,
      maxHeaderSize: 16 * 1024,
      maxHeadersCount: 100,
      maxRequestsPerSocket: 1_000,
    });
  });

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
    expect(spa.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(spa.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(spa.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(spa.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(spa.headers.get('content-security-policy')).toContain("object-src 'none'");

    const asset = await fetch(`${origin}/assets/app.abcdef12.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('window.PIAS=true;');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('prevents authenticated API state from being stored by intermediary caches', async () => {
    const fixture = await createFixture();
    const application = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    });
    servers.push(application);
    const { origin } = await application.start();
    const headers = await authenticatedHeaders(origin);

    const response = await fetch(`${origin}/api/studio/state`, { headers });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rate limits login work even when an attacker rotates email addresses', async () => {
    const fixture = await createFixture();
    const application = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    });
    servers.push(application);
    const { origin } = await application.start();

    for (let index = 0; index < 20; index += 1) {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `unknown-${index}@pias.test`,
          password: 'not-the-password',
        }),
      });
      expect(response.status).toBe(401);
    }

    const limited = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'unknown-over-limit@pias.test',
        password: 'not-the-password',
      }),
    });

    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: 'AUTH_RATE_LIMITED' },
    });
  });

  it('rejects cross-site and non-JSON login requests before credential processing', async () => {
    const fixture = await createFixture();
    const application = await createProductionServer({
      env: fixture.env,
      host: '127.0.0.1',
      port: 0,
      logger: () => undefined,
    });
    servers.push(application);
    const { origin } = await application.start();
    const credentials = JSON.stringify({
      email: 'owner@pias.test',
      password: 'PIAS-release-2026!',
    });

    const crossSite = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
      body: credentials,
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get('set-cookie')).toBeNull();
    await expect(crossSite.json()).resolves.toMatchObject({
      error: { code: 'SECURITY_ORIGIN_REJECTED' },
    });

    const wrongMediaType = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        origin: 'https://studio.pias.test',
      },
      body: credentials,
    });
    expect(wrongMediaType.status).toBe(415);
    expect(wrongMediaType.headers.get('set-cookie')).toBeNull();
    await expect(wrongMediaType.json()).resolves.toMatchObject({
      error: { code: 'SECURITY_JSON_REQUIRED' },
    });

    const bodylessCommand = await fetch(
      `${origin}/api/organization/invitations/invitation-11111111-1111-1111-1111-111111111111/revoke`,
      {
        method: 'POST',
        headers: { origin: 'https://studio.pias.test' },
      },
    );
    expect(bodylessCommand.status).toBe(401);
    await expect(bodylessCommand.json()).resolves.toMatchObject({
      error: { code: 'AUTH_SESSION_INVALID' },
    });
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

async function authenticatedHeaders(origin: string): Promise<Record<string, string>> {
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@pias.test', password: 'PIAS-release-2026!' }),
  });
  const challenge = cookieFromResponse(login, 'pias_mfa');
  const verified = await fetch(`${origin}/api/auth/mfa`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `pias_mfa=${challenge}`,
    },
    body: JSON.stringify({ code: generateTotp('JBSWY3DPEHPK3PXP') }),
  });
  const session = cookieFromResponse(verified, 'pias_session');
  return {
    cookie: `pias_session=${session}`,
    'x-pias-project-id': 'project-a',
  };
}

function cookieFromResponse(response: Response, name: string): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`(?:^|, )${name}=([^;]+)`).exec(setCookie);
  if (!match) throw new Error(`cookie missing: ${name}`);
  return match[1];
}

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
  const emailWebhookKeyFile = join(directory, 'mail-webhook.key');
  const invitationEncryptionKeyFile = join(directory, 'invitation-encryption.key');
  await writeFile(emailWebhookKeyFile, 'mail-webhook-secret', { mode: 0o600 });
  await writeFile(
    invitationEncryptionKeyFile,
    Buffer.alloc(32, 7).toString('base64'),
    { mode: 0o600 },
  );

  return {
    env: {
      NODE_ENV: 'production',
      PIAS_SECURE_COOKIES: 'true',
      PIAS_PERSISTENCE_BACKEND: 'sqlite',
      PIAS_PUBLIC_BASE_URL: 'https://studio.pias.test',
      PIAS_DATABASE_FILE: databaseFile,
      PIAS_ASSET_DIR: assetDirectory,
      PIAS_RELEASE_ARTIFACT_DIR: artifactDirectory,
      PIAS_AUTH_CONFIG_FILE: authConfigFile,
      PIAS_EMAIL_FROM: 'PIAS <no-reply@pias.test>',
      PIAS_EMAIL_WEBHOOK_URL: 'https://mail-relay.pias.test/v1/send',
      PIAS_EMAIL_WEBHOOK_KEY_FILE: emailWebhookKeyFile,
      PIAS_INVITATION_ENCRYPTION_KEY_FILE: invitationEncryptionKeyFile,
    },
  };
}
