import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initialStudioState } from '../src/shared/domain';
import {
  openPiasDatabase,
  type PiasDatabase,
} from '../src/server/persistence/sqliteDatabase';
import {
  createSqliteStudioStatePersistence,
  StudioStateConflictError,
  StudioStateStorageError,
} from '../src/server/studio/studioStatePersistence';

const temporaryDirectories: string[] = [];
const databases: PiasDatabase[] = [];

afterEach(async () => {
  while (databases.length > 0) databases.pop()?.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pias-sqlite-'));
  temporaryDirectories.push(directory);
  return join(directory, 'pias.sqlite');
}

function open(filePath: string): PiasDatabase {
  const database = openPiasDatabase(filePath);
  databases.push(database);
  return database;
}

describe('SQLite StudioState persistence', () => {
  it('keeps identical project ids isolated by tenant scope', async () => {
    const filePath = await databasePath();
    const database = open(filePath);
    const tenantA = createSqliteStudioStatePersistence(database, {
      tenantId: 'tenant-a', projectId: 'project-shared',
    });
    const tenantB = createSqliteStudioStatePersistence(database, {
      tenantId: 'tenant-b', projectId: 'project-shared',
    });
    const stateA = { ...initialStudioState(), projectName: 'Tenant A Project' };
    const stateB = { ...initialStudioState(), projectName: 'Tenant B Project' };

    await tenantA.save(0, stateA);
    await tenantB.save(0, stateB);

    await expect(tenantA.load()).resolves.toMatchObject({ revision: 1, state: stateA });
    await expect(tenantB.load()).resolves.toMatchObject({ revision: 1, state: stateB });
  });

  it('serializes optimistic revision checks across independent connections', async () => {
    const filePath = await databasePath();
    const first = createSqliteStudioStatePersistence(open(filePath), {
      tenantId: 'tenant-a', projectId: 'project-a',
    });
    const second = createSqliteStudioStatePersistence(open(filePath), {
      tenantId: 'tenant-a', projectId: 'project-a',
    });
    await first.save(0, initialStudioState());

    const results = await Promise.allSettled([
      first.save(1, { ...initialStudioState(), workspaceName: 'writer-one' }),
      second.save(1, { ...initialStudioState(), workspaceName: 'writer-two' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejection?.reason).toBeInstanceOf(StudioStateConflictError);
    expect(rejection?.reason).toMatchObject({ expectedRevision: 1, actualRevision: 2 });
  });

  it('recovers a committed snapshot after every connection is closed', async () => {
    const filePath = await databasePath();
    const firstDatabase = open(filePath);
    const persistence = createSqliteStudioStatePersistence(firstDatabase, {
      tenantId: 'tenant-a', projectId: 'project-a',
    });
    await persistence.save(0, { ...initialStudioState(), workspaceName: 'committed' });
    firstDatabase.close();
    databases.splice(databases.indexOf(firstDatabase), 1);

    const reopened = createSqliteStudioStatePersistence(open(filePath), {
      tenantId: 'tenant-a', projectId: 'project-a',
    });
    await expect(reopened.load()).resolves.toMatchObject({
      revision: 1,
      state: { workspaceName: 'committed' },
    });
  });

  it('returns a safe storage error when persisted JSON is corrupted', async () => {
    const filePath = await databasePath();
    const database = open(filePath);
    const persistence = createSqliteStudioStatePersistence(database, {
      tenantId: 'tenant-a', projectId: 'project-a',
    });
    await persistence.save(0, initialStudioState());
    database.connection.prepare(
      'UPDATE studio_states SET state_json = ? WHERE scope_key = ?',
    ).run('{broken', database.scopeKey({ tenantId: 'tenant-a', projectId: 'project-a' }));

    await expect(persistence.load()).rejects.toBeInstanceOf(StudioStateStorageError);
  });
});
