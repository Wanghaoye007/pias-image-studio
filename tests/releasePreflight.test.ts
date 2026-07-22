import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runReleasePreflight } from '../scripts/release-preflight-core.mjs';
import { openContentStudioDatabase } from '../src/server/persistence/sqliteDatabase';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('production release preflight', () => {
  it('rejects an incomplete environment with stable machine-readable blockers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-release-preflight-empty-'));
    directories.push(directory);
    const report = await runReleasePreflight({
      env: {
        CONTENT_STUDIO_RELEASE_ARTIFACT_DIR: join(directory, 'missing-dist'),
        CONTENT_STUDIO_RELEASE_SERVER_FILE: join(directory, 'missing-server.mjs'),
      },
      nodeVersion: 'v22.0.0',
      billingCheck: async () => ({ ok: false, status: 403, reason: 'billing_access_denied' }),
    });

    expect(report.ok).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'NODE_VERSION_UNSUPPORTED',
      'PRODUCTION_MODE_REQUIRED',
      'SECURE_COOKIES_REQUIRED',
      'SQLITE_BACKEND_REQUIRED',
      'PUBLIC_HTTPS_URL_REQUIRED',
      'DATABASE_REQUIRED',
      'RELEASE_BACKUP_REQUIRED',
      'AUTH_CONFIG_REQUIRED',
      'FAL_KEY_FILES_REQUIRED',
      'EMAIL_CONFIG_REQUIRED',
      'ASSET_STORAGE_REQUIRED',
      'BUILD_ARTIFACT_REQUIRED',
      'SERVER_ARTIFACT_REQUIRED',
      'BILLING_ACCESS_DENIED',
    ]));
    expect(JSON.stringify(report)).not.toContain('undefined');
  });

  it('passes only with a private, rollback-ready production configuration', async () => {
    const fixture = await createValidFixture();
    const report = await runReleasePreflight({
      env: fixture.env,
      nodeVersion: 'v24.13.0',
      billingCheck: async () => ({
        ok: true, status: 200, reason: 'billing_access_confirmed',
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime.node', status: 'pass' }),
      expect.objectContaining({ id: 'database.integrity', status: 'pass' }),
      expect.objectContaining({ id: 'database.rollback', status: 'pass' }),
      expect.objectContaining({ id: 'identity.config', status: 'pass' }),
      expect.objectContaining({ id: 'email.config', status: 'pass' }),
      expect.objectContaining({ id: 'fal.billing', status: 'pass' }),
      expect.objectContaining({ id: 'build.artifact', status: 'pass' }),
      expect.objectContaining({ id: 'server.artifact', status: 'pass' }),
    ]));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('inference-secret');
    expect(serialized).not.toContain('billing-secret');
    expect(serialized).not.toContain('webhook-secret');
    expect(serialized).not.toContain(fixture.directory);
  });

  it('rejects raw environment secrets even when private key files are present', async () => {
    const fixture = await createValidFixture();
    let billingEnv: NodeJS.ProcessEnv | undefined;
    const report = await runReleasePreflight({
      env: {
        ...fixture.env,
        FAL_KEY: 'raw-inference-secret',
        FAL_ADMIN_KEY: 'raw-admin-secret',
      },
      nodeVersion: 'v24.13.0',
      billingCheck: async ({ env }: { env: NodeJS.ProcessEnv }) => {
        billingEnv = env;
        return { ok: true, status: 200, reason: 'billing_access_confirmed' };
      },
    });

    expect(report.ok).toBe(false);
    expect(report.blockers).toContain('RAW_SECRET_ENV_FORBIDDEN');
    expect(billingEnv).toBeDefined();
    expect(billingEnv?.FAL_KEY).toBeUndefined();
    expect(billingEnv?.FAL_ADMIN_KEY).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('raw-inference-secret');
    expect(JSON.stringify(report)).not.toContain('raw-admin-secret');
  });

  it('rejects a valid backup that does not belong to the release database', async () => {
    const fixture = await createValidFixture();
    const manifestFile = `${fixture.env.CONTENT_STUDIO_RELEASE_BACKUP_FILE}.manifest.json`;
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>;
    await writePrivate(manifestFile, JSON.stringify({
      ...manifest,
      source: join(fixture.directory, 'different.sqlite'),
    }));

    const report = await runReleasePreflight({
      env: fixture.env,
      nodeVersion: 'v24.13.0',
      billingCheck: async () => ({
        ok: true, status: 200, reason: 'billing_access_confirmed',
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.blockers).toContain('RELEASE_BACKUP_INVALID');
  });

  it('rejects a build produced from a dirty worktree', async () => {
    const fixture = await createValidFixture();
    await writeFile(join(fixture.env.CONTENT_STUDIO_RELEASE_ARTIFACT_DIR, 'release.json'), JSON.stringify({
      schemaVersion: 1,
      service: 'content-studio',
      version: '0.1.0',
      revision: 'abc1234',
      dirty: true,
      builtAt: '2026-07-22T00:30:00.000Z',
    }), { mode: 0o644 });

    const report = await runReleasePreflight({
      env: fixture.env,
      nodeVersion: 'v24.13.0',
      billingCheck: async () => ({
        ok: true, status: 200, reason: 'billing_access_confirmed',
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.blockers).toContain('BUILD_METADATA_DIRTY');
  });

  it('exposes a report-only CLI that fails closed without production configuration', () => {
    const execution = spawnSync(process.execPath, [
      'scripts/release-preflight.mjs',
      '--report-only',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME ?? '',
        PATH: process.env.PATH ?? '',
      },
    });

    expect(execution.status).toBe(0);
    const report = JSON.parse(execution.stdout) as { ok: boolean; blockers: string[] };
    expect(report.ok).toBe(false);
    expect(report.blockers).toContain('PRODUCTION_MODE_REQUIRED');
    expect(execution.stdout).not.toContain(process.env.HOME ?? '/Users');
  });
});

async function createValidFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'content-studio-release-preflight-'));
  directories.push(directory);
  const databaseFile = join(directory, 'content-studio.sqlite');
  const database = openContentStudioDatabase(databaseFile);
  database.close();
  const backupFile = join(directory, 'content-studio-backup.sqlite');
  await copyFile(databaseFile, backupFile);
  const backupDigest = createHash('sha256').update(await readFile(backupFile)).digest('hex');
  await writePrivate(`${backupFile}.manifest.json`, JSON.stringify({
    schemaVersion: 1,
    source: databaseFile,
    sha256: backupDigest,
    integrity: 'ok',
  }));
  const authConfigFile = join(directory, 'auth.json');
  await writePrivate(authConfigFile, JSON.stringify({
    schemaVersion: 1,
    users: [{
      id: 'user-owner',
      tenantId: 'tenant-a',
      email: 'owner@studio.test',
      displayName: 'Owner',
      passwordHash: `scrypt$16384$8$1$${'0'.repeat(32)}$${'0'.repeat(64)}`,
      role: 'owner',
      status: 'active',
      projectIds: ['project-a'],
      mfaEnabled: true,
      mfaSecret: 'JBSWY3DPEHPK3PXP',
    }],
  }));
  const falKeyFile = join(directory, 'fal.key');
  const falAdminKeyFile = join(directory, 'fal-admin.key');
  const webhookKeyFile = join(directory, 'mail-webhook.key');
  const encryptionKeyFile = join(directory, 'invitation-encryption.key');
  await writePrivate(falKeyFile, 'inference-secret');
  await writePrivate(falAdminKeyFile, 'billing-secret');
  await writePrivate(webhookKeyFile, 'webhook-secret');
  await writePrivate(encryptionKeyFile, Buffer.alloc(32, 5).toString('base64'));
  const assetDirectory = join(directory, 'assets');
  await mkdir(assetDirectory, { mode: 0o700 });
  const artifactDirectory = join(directory, 'dist');
  await mkdir(artifactDirectory, { mode: 0o700 });
  await writeFile(join(artifactDirectory, 'index.html'), '<!doctype html>', { mode: 0o600 });
  await writeFile(join(artifactDirectory, 'release.json'), JSON.stringify({
    schemaVersion: 1,
    service: 'content-studio',
    version: '0.1.0',
    revision: 'abc1234',
    dirty: false,
    builtAt: '2026-07-22T00:30:00.000Z',
  }), { mode: 0o644 });
  const serverDirectory = join(directory, 'dist-server');
  await mkdir(serverDirectory, { mode: 0o700 });
  const serverFile = join(serverDirectory, 'server.mjs');
  await writeFile(serverFile, 'export const server = true;', { mode: 0o600 });

  return {
    directory,
    env: {
      NODE_ENV: 'production',
      CONTENT_STUDIO_SECURE_COOKIES: 'true',
      CONTENT_STUDIO_PERSISTENCE_BACKEND: 'sqlite',
      CONTENT_STUDIO_PUBLIC_BASE_URL: 'https://studio.studio.test',
      CONTENT_STUDIO_DATABASE_FILE: databaseFile,
      CONTENT_STUDIO_RELEASE_BACKUP_FILE: backupFile,
      CONTENT_STUDIO_AUTH_CONFIG_FILE: authConfigFile,
      CONTENT_STUDIO_ASSET_DIR: assetDirectory,
      CONTENT_STUDIO_RELEASE_ARTIFACT_DIR: artifactDirectory,
      CONTENT_STUDIO_RELEASE_SERVER_FILE: serverFile,
      FAL_KEY_FILE: falKeyFile,
      FAL_ADMIN_KEY_FILE: falAdminKeyFile,
      CONTENT_STUDIO_EMAIL_FROM: 'Content Studio <no-reply@studio.test>',
      CONTENT_STUDIO_EMAIL_WEBHOOK_URL: 'https://mail-relay.studio.test/v1/send',
      CONTENT_STUDIO_EMAIL_WEBHOOK_KEY_FILE: webhookKeyFile,
      CONTENT_STUDIO_INVITATION_ENCRYPTION_KEY_FILE: encryptionKeyFile,
    },
  };
}

async function writePrivate(filePath: string, value: string) {
  await writeFile(filePath, value, { mode: 0o600 });
}
