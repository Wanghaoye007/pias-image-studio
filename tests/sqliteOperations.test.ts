import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { initialStudioState } from '../src/shared/domain';
import { createScopedFalQueuePersistence } from '../src/worker/fal/falJobPersistence';
import { createSqliteFalQueuePersistence } from '../src/worker/fal/falSqlitePersistence';
import type { PersistedFalJob } from '../src/worker/fal/falQueueService';
import { openPiasDatabase, scopeStorageKey } from '../src/server/persistence/sqliteDatabase';
import {
  createScopedStudioStatePersistence,
  createSqliteStudioStatePersistence,
} from '../src/server/studio/studioStatePersistence';

const directories: string[] = [];
const scope = { tenantId: 'tenant-a', projectId: 'project-a' };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('PIAS SQLite operations', () => {
  it('backs up with integrity evidence and restores with a rollback copy', async () => {
    const directory = await temporaryDirectory('pias-db-ops-');
    const databasePath = join(directory, 'pias.sqlite');
    const backupPath = join(directory, 'backups', 'pias-001.sqlite');
    let database = openPiasDatabase(databasePath);
    let persistence = createSqliteStudioStatePersistence(database, scope);
    await persistence.save(0, { ...initialStudioState(), workspaceName: 'backup-version' });
    database.close();

    const backedUp = run([
      'scripts/pias-database.mjs', 'backup',
      '--database', databasePath,
      '--output', backupPath,
    ]);
    expect(backedUp.status).toBe(0);
    const backupResult = parseOutput(backedUp.stdout) as {
      integrity: string;
      manifest: string;
      sha256: string;
    };
    expect(backupResult).toMatchObject({ integrity: 'ok', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(stat(backupPath)).resolves.toBeDefined();
    await expect(readFile(backupResult.manifest, 'utf8')).resolves.toContain(backupResult.sha256);

    database = openPiasDatabase(databasePath);
    persistence = createSqliteStudioStatePersistence(database, scope);
    await persistence.save(1, { ...initialStudioState(), workspaceName: 'newer-version' });
    database.close();

    const dryRun = run([
      'scripts/pias-database.mjs', 'restore',
      '--database', databasePath,
      '--backup', backupPath,
    ]);
    expect(dryRun.status).toBe(0);
    expect(parseOutput(dryRun.stdout)).toMatchObject({ mode: 'dry-run', integrity: 'ok' });
    database = openPiasDatabase(databasePath);
    persistence = createSqliteStudioStatePersistence(database, scope);
    await expect(persistence.load()).resolves.toMatchObject({ revision: 2 });
    database.close();

    const restored = run([
      'scripts/pias-database.mjs', 'restore',
      '--database', databasePath,
      '--backup', backupPath,
      '--apply',
    ]);
    expect(restored.status).toBe(0);
    const restoreResult = parseOutput(restored.stdout) as { rollback: string; integrity: string };
    expect(restoreResult.integrity).toBe('ok');
    await expect(stat(restoreResult.rollback)).resolves.toBeDefined();
    database = openPiasDatabase(databasePath);
    persistence = createSqliteStudioStatePersistence(database, scope);
    await expect(persistence.load()).resolves.toMatchObject({
      revision: 1,
      state: { workspaceName: 'backup-version' },
    });
    database.close();
  });

  it('migrates scoped JSON snapshots transactionally without deleting sources', async () => {
    const directory = await temporaryDirectory('pias-db-migrate-');
    const sourceRoot = join(directory, 'studio-scopes');
    const falRoot = join(directory, 'fal-scopes');
    const databasePath = join(directory, 'pias.sqlite');
    const source = createScopedStudioStatePersistence(sourceRoot, scope);
    await source.save(0, { ...initialStudioState(), workspaceName: 'legacy-scoped' });
    const falSource = createScopedFalQueuePersistence(falRoot, scope);
    await falSource.save([legacyFalJob()]);
    const args = [
      'scripts/migrate-to-sqlite.mjs',
      '--studio-root', sourceRoot,
      '--fal-root', falRoot,
      '--database', databasePath,
    ];

    const dryRun = run(args);
    expect(dryRun.status).toBe(0);
    expect(parseOutput(dryRun.stdout)).toMatchObject({
      mode: 'dry-run',
      studioStates: 1,
      falJobs: 1,
    });
    await expect(stat(databasePath)).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = run([...args, '--apply']);
    expect(applied.status).toBe(0);
    expect(parseOutput(applied.stdout)).toMatchObject({
      mode: 'applied',
      studioStates: 1,
      falJobs: 1,
    });
    const rawDatabase = new DatabaseSync(databasePath);
    expect(rawDatabase.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(rawDatabase.prepare('PRAGMA table_info(organization_email_outbox)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'token_ciphertext' })]));
    expect(rawDatabase.prepare('PRAGMA table_info(organization_users)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'first_login_at' })]));
    rawDatabase.close();
    const database = openPiasDatabase(databasePath);
    const migrated = createSqliteStudioStatePersistence(database, scope);
    await expect(migrated.load()).resolves.toMatchObject({
      revision: 1,
      state: { workspaceName: 'legacy-scoped' },
    });
    await expect(createSqliteFalQueuePersistence(database, scope).load())
      .resolves.toEqual([legacyFalJob()]);
    database.close();

    const sourceSnapshotPath = join(sourceRoot, scopeStorageKey(scope), 'studio-state.json');
    await expect(stat(sourceSnapshotPath)).resolves.toBeDefined();
    await expect(stat(join(falRoot, scopeStorageKey(scope), 'fal-queue-state.json')))
      .resolves.toBeDefined();
    const duplicate = run([...args, '--apply']);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain('数据库已存在目标范围');
  });
});

function legacyFalJob(): PersistedFalJob {
  return {
    id: 'fal-local-legacy',
    createdBy: 'legacy-user',
    profileId: 'generate',
    modelId: 'fal-ai/bria/product-shot',
    request: {
      profileId: 'generate',
      imageUrls: [],
      prompt: '',
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    },
    plan: { modelId: 'fal-ai/bria/product-shot', invocations: [] },
    children: [{
      modelId: 'fal-ai/bria/product-shot',
      requestId: 'upstream-legacy',
      status: 'queued',
    }],
    nextUpscaleFactorIndex: 1,
    directionalLightFinalStarted: false,
    canceled: false,
  };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function run(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function parseOutput(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}
