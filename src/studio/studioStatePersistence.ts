import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StudioState } from '../domain';
import type { PiasDatabase } from '../persistence/sqliteDatabase';
import { parseStudioState, StudioStateValidationError } from './studioStateSchema';

export type PersistedStudioSnapshot = {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  state: StudioState;
};

export type StudioStatePersistence = {
  load(): Promise<PersistedStudioSnapshot | null>;
  save(expectedRevision: number, state: StudioState): Promise<PersistedStudioSnapshot>;
};

export type StudioStateScope = {
  tenantId: string;
  projectId: string;
};

export class StudioStateConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`工作台状态版本冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = 'StudioStateConflictError';
  }
}

export class StudioStateStorageError extends Error {
  constructor(message = '工作台状态存储不可用', options?: ErrorOptions) {
    super(message, options);
    this.name = 'StudioStateStorageError';
  }
}

export function createFileStudioStatePersistence(
  filePath = process.env.PIAS_STUDIO_STATE_FILE
    || '/tmp/pias-image-studio/studio-state.json',
): StudioStatePersistence {
  let writeQueue: Promise<void> = Promise.resolve();

  const load = async (): Promise<PersistedStudioSnapshot | null> => {
    try {
      return await readSnapshot(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof StudioStateStorageError) throw error;
      throw new StudioStateStorageError('无法读取已保存的工作台状态', { cause: error });
    }
  };

  const save = (expectedRevision: number, state: StudioState): Promise<PersistedStudioSnapshot> => {
    const operation = writeQueue.then(async () => {
      const current = await load();
      const actualRevision = current?.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        throw new StudioStateConflictError(expectedRevision, actualRevision);
      }

      const validatedState = structuredClone(parseStudioState(state));
      const snapshot: PersistedStudioSnapshot = {
        schemaVersion: 1,
        revision: actualRevision + 1,
        updatedAt: new Date().toISOString(),
        state: validatedState,
      };
      const temporaryPath = `${filePath}.${process.pid}.${snapshot.revision}.tmp`;

      try {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(temporaryPath, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
        await rename(temporaryPath, filePath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw new StudioStateStorageError('无法保存工作台状态', { cause: error });
      }

      return snapshot;
    });

    writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return { load, save };
}

export function createScopedStudioStatePersistence(
  rootDirectory: string,
  scope: StudioStateScope,
): StudioStatePersistence {
  const scopeKey = createHash('sha256')
    .update(scope.tenantId)
    .update('\0')
    .update(scope.projectId)
    .digest('hex');
  return createFileStudioStatePersistence(join(rootDirectory, scopeKey, 'studio-state.json'));
}

export function createSqliteStudioStatePersistence(
  database: PiasDatabase,
  scope: StudioStateScope,
): StudioStatePersistence {
  const scopeKey = database.scopeKey(scope);
  const select = database.connection.prepare(`
    SELECT schema_version, revision, updated_at, state_json
    FROM studio_states
    WHERE scope_key = ?
  `);
  const upsert = database.connection.prepare(`
    INSERT INTO studio_states (
      scope_key, schema_version, revision, updated_at, state_json
    ) VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(scope_key) DO UPDATE SET
      schema_version = excluded.schema_version,
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      state_json = excluded.state_json
  `);

  const load = async (): Promise<PersistedStudioSnapshot | null> => {
    try {
      const row = select.get(scopeKey) as Record<string, unknown> | undefined;
      return row ? parseSqliteSnapshot(row) : null;
    } catch (error) {
      if (error instanceof StudioStateStorageError) throw error;
      throw new StudioStateStorageError('无法读取事务工作台状态', { cause: error });
    }
  };

  const save = async (
    expectedRevision: number,
    state: StudioState,
  ): Promise<PersistedStudioSnapshot> => {
    const validatedState = structuredClone(parseStudioState(state));
    let transactionOpen = false;
    try {
      database.connection.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const current = select.get(scopeKey) as Record<string, unknown> | undefined;
      const actualRevision = current ? requireRevision(current.revision) : 0;
      if (actualRevision !== expectedRevision) {
        throw new StudioStateConflictError(expectedRevision, actualRevision);
      }
      const snapshot: PersistedStudioSnapshot = {
        schemaVersion: 1,
        revision: actualRevision + 1,
        updatedAt: new Date().toISOString(),
        state: validatedState,
      };
      upsert.run(
        scopeKey,
        snapshot.revision,
        snapshot.updatedAt,
        JSON.stringify(snapshot.state),
      );
      database.connection.exec('COMMIT');
      transactionOpen = false;
      return snapshot;
    } catch (error) {
      if (transactionOpen) {
        try {
          database.connection.exec('ROLLBACK');
        } catch {
          // Preserve the original database error.
        }
      }
      if (error instanceof StudioStateConflictError) throw error;
      if (error instanceof StudioStateValidationError) throw error;
      throw new StudioStateStorageError('无法保存事务工作台状态', { cause: error });
    }
  };

  return { load, save };
}

async function readSnapshot(filePath: string): Promise<PersistedStudioSnapshot> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    throw new StudioStateStorageError('已保存的工作台状态文件损坏', { cause: error });
  }

  try {
    const snapshot = asRecord(value, 'snapshot');
    if (snapshot.schemaVersion !== 1) {
      throw new StudioStateStorageError('工作台状态版本不受支持');
    }
    if (!Number.isInteger(snapshot.revision) || (snapshot.revision as number) < 1) {
      throw new StudioStateStorageError('工作台状态 revision 无效');
    }
    if (typeof snapshot.updatedAt !== 'string' || !snapshot.updatedAt) {
      throw new StudioStateStorageError('工作台状态更新时间无效');
    }
    return {
      schemaVersion: 1,
      revision: snapshot.revision as number,
      updatedAt: snapshot.updatedAt,
      state: parseStudioState(snapshot.state),
    };
  } catch (error) {
    if (error instanceof StudioStateStorageError) throw error;
    if (error instanceof StudioStateValidationError) {
      throw new StudioStateStorageError(`已保存的工作台状态无效：${error.message}`, { cause: error });
    }
    throw new StudioStateStorageError('已保存的工作台状态无效', { cause: error });
  }
}

function parseSqliteSnapshot(row: Record<string, unknown>): PersistedStudioSnapshot {
  try {
    if (row.schema_version !== 1) {
      throw new StudioStateStorageError('工作台状态版本不受支持');
    }
    if (typeof row.updated_at !== 'string' || !row.updated_at) {
      throw new StudioStateStorageError('工作台状态更新时间无效');
    }
    if (typeof row.state_json !== 'string') {
      throw new StudioStateStorageError('工作台状态内容无效');
    }
    return {
      schemaVersion: 1,
      revision: requireRevision(row.revision),
      updatedAt: row.updated_at,
      state: parseStudioState(JSON.parse(row.state_json)),
    };
  } catch (error) {
    if (error instanceof StudioStateStorageError) throw error;
    throw new StudioStateStorageError('事务工作台状态损坏', { cause: error });
  }
}

function requireRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new StudioStateStorageError('工作台状态 revision 无效');
  }
  return value as number;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StudioStateStorageError(`${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}
