import type { PiasDatabase, DatabaseScope } from '../../server/persistence/sqliteDatabase';
import type {
  FalJobLeaseStore,
  FalJobPayloadStore,
  FalJobRecoveryPayload,
  FalQueuePersistence,
  PersistedFalJob,
} from './falQueueService';

export function createSqliteFalJobPayloadStore(
  database: PiasDatabase,
  scope: DatabaseScope,
): FalJobPayloadStore {
  return createSqliteFalJobPayloadStoreForScopeKey(database, database.scopeKey(scope));
}

export function createSqliteFalJobPayloadStoreForScopeKey(
  database: PiasDatabase,
  scopeKey: string,
): FalJobPayloadStore {
  const select = database.connection.prepare(`
    SELECT payload_json
    FROM fal_job_payloads
    WHERE scope_key = ? AND job_id = ?
  `);
  const upsert = database.connection.prepare(`
    INSERT INTO fal_job_payloads (scope_key, job_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_key, job_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const remove = database.connection.prepare(`
    DELETE FROM fal_job_payloads
    WHERE scope_key = ? AND job_id = ?
  `);
  return {
    async load(jobId) {
      const row = select.get(scopeKey, jobId) as { payload_json: string } | undefined;
      return row ? JSON.parse(row.payload_json) as FalJobRecoveryPayload : undefined;
    },
    async save(jobId, payload) {
      upsert.run(scopeKey, jobId, JSON.stringify(payload), new Date().toISOString());
    },
    async delete(jobId) {
      remove.run(scopeKey, jobId);
    },
  };
}

export function createSqliteFalQueuePersistence(
  database: PiasDatabase,
  scope: DatabaseScope,
): FalQueuePersistence {
  return createSqliteFalQueuePersistenceForScopeKey(database, database.scopeKey(scope));
}

export function createSqliteFalQueuePersistenceForScopeKey(
  database: PiasDatabase,
  scopeKey: string,
): FalQueuePersistence {
  const select = database.connection.prepare(`
    SELECT job_json
    FROM fal_jobs
    WHERE scope_key = ?
    ORDER BY updated_at ASC, job_id ASC
  `);
  const upsert = database.connection.prepare(`
    INSERT INTO fal_jobs (scope_key, job_id, job_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_key, job_id) DO UPDATE SET
      job_json = excluded.job_json,
      updated_at = excluded.updated_at
  `);
  return {
    mergeWrites: true,
    async load() {
      const rows = select.all(scopeKey) as Array<{ job_json: string }>;
      return rows.map((row) => JSON.parse(row.job_json) as PersistedFalJob);
    },
    async save(jobs) {
      let transactionOpen = false;
      try {
        database.connection.exec('BEGIN IMMEDIATE');
        transactionOpen = true;
        const updatedAt = new Date().toISOString();
        for (const job of jobs.slice(-100)) {
          upsert.run(scopeKey, job.id, JSON.stringify(job), updatedAt);
        }
        database.connection.exec('COMMIT');
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) database.connection.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function createSqliteFalJobLeaseStore(
  database: PiasDatabase,
  scope: DatabaseScope,
): FalJobLeaseStore {
  return createSqliteFalJobLeaseStoreForScopeKey(database, database.scopeKey(scope));
}

export function createSqliteFalJobLeaseStoreForScopeKey(
  database: PiasDatabase,
  scopeKey: string,
): FalJobLeaseStore {
  const acquire = database.connection.prepare(`
    INSERT INTO fal_job_leases (
      scope_key, job_id, owner_id, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope_key, job_id) DO UPDATE SET
      owner_id = excluded.owner_id,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
    WHERE fal_job_leases.expires_at < ?
       OR fal_job_leases.owner_id = excluded.owner_id
  `);
  const renew = database.connection.prepare(`
    UPDATE fal_job_leases
    SET expires_at = ?, updated_at = ?
    WHERE scope_key = ? AND job_id = ? AND owner_id = ?
  `);
  const release = database.connection.prepare(`
    DELETE FROM fal_job_leases
    WHERE scope_key = ? AND job_id = ? AND owner_id = ?
  `);
  return {
    async acquire(jobId, ownerId, nowMs, ttlMs) {
      const expiresAt = nowMs + ttlMs;
      const result = acquire.run(
        scopeKey,
        jobId,
        ownerId,
        expiresAt,
        new Date(nowMs).toISOString(),
        nowMs,
      );
      return Number(result.changes) === 1;
    },
    async renew(jobId, ownerId, nowMs, ttlMs) {
      const result = renew.run(
        nowMs + ttlMs,
        new Date(nowMs).toISOString(),
        scopeKey,
        jobId,
        ownerId,
      );
      return Number(result.changes) === 1;
    },
    async release(jobId, ownerId) {
      release.run(scopeKey, jobId, ownerId);
    },
  };
}

export function listSqliteFalScopeKeys(database: PiasDatabase): string[] {
  const rows = database.connection.prepare(`
    SELECT DISTINCT scope_key
    FROM fal_jobs
    ORDER BY scope_key ASC
  `).all() as Array<{ scope_key: string }>;
  return rows.map((row) => row.scope_key);
}
