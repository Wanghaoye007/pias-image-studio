import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { openDatabase, requireOption } from './sqlite-common.mjs';

const args = process.argv.slice(2);
const studioRoot = requireOption(args, '--studio-root');
const falRoot = optionalOption(args, '--fal-root');
const databasePath = requireOption(args, '--database');
const apply = args.includes('--apply');
let databaseExisted = false;

try {
  databaseExisted = await exists(databasePath);
  const rows = await loadStudioRows(studioRoot);
  const falRows = falRoot ? await loadFalRows(falRoot) : [];
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      mode: 'dry-run',
      database: databasePath,
      studioRoot,
      studioStates: rows.length,
      falJobs: falRows.length,
      sourcesRetained: true,
    })}\n`);
  } else {
    const database = openDatabase(databasePath);
    let transactionOpen = false;
    try {
      database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const existsStatement = database.prepare(
        'SELECT 1 AS present FROM studio_states WHERE scope_key = ?',
      );
      for (const row of rows) {
        if (existsStatement.get(row.scopeKey)) {
          throw new Error(`数据库已存在目标范围：${row.scopeKey}`);
        }
      }
      const falExistsStatement = database.prepare(`
        SELECT 1 AS present
        FROM fal_jobs
        WHERE scope_key = ? AND job_id = ?
      `);
      for (const row of falRows) {
        if (falExistsStatement.get(row.scopeKey, row.jobId)) {
          throw new Error(`数据库已存在 Fal 任务：${row.scopeKey}/${row.jobId}`);
        }
      }
      const insert = database.prepare(`
        INSERT INTO studio_states (
          scope_key, schema_version, revision, updated_at, state_json
        ) VALUES (?, 1, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(row.scopeKey, row.revision, row.updatedAt, row.stateJson);
      }
      const insertFalJob = database.prepare(`
        INSERT INTO fal_jobs (scope_key, job_id, job_json, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      const migratedAt = new Date().toISOString();
      for (const row of falRows) {
        insertFalJob.run(row.scopeKey, row.jobId, row.jobJson, migratedAt);
      }
      database.exec('COMMIT');
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) database.exec('ROLLBACK');
      throw error;
    } finally {
      database.close();
    }
    process.stdout.write(`${JSON.stringify({
      mode: 'applied',
      database: databasePath,
      studioRoot,
      studioStates: rows.length,
      falJobs: falRows.length,
      sourcesRetained: true,
    })}\n`);
  }
} catch (error) {
  if (!databaseExisted && apply) {
    await Promise.all(['', '-wal', '-shm'].map((suffix) => rm(`${databasePath}${suffix}`, {
      force: true,
    }).catch(() => undefined)));
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function loadStudioRows(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('StudioState 范围目录不存在', { cause: error });
    throw error;
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const source = `${root}/${entry.name}/studio-state.json`;
    if (!await exists(source)) continue;
    const snapshot = JSON.parse(await readFile(source, 'utf8'));
    validateSnapshot(snapshot, source);
    rows.push({
      scopeKey: entry.name,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      stateJson: JSON.stringify(snapshot.state),
    });
  }
  rows.sort((left, right) => left.scopeKey.localeCompare(right.scopeKey));
  if (rows.length === 0) throw new Error('未发现可迁移的 StudioState 范围快照');
  return rows;
}

async function loadFalRows(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Fal 队列范围目录不存在', { cause: error });
    throw error;
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const source = `${root}/${entry.name}/fal-queue-state.json`;
    if (!await exists(source)) continue;
    const queue = JSON.parse(await readFile(source, 'utf8'));
    if (!queue || typeof queue !== 'object' || queue.version !== 1 || !Array.isArray(queue.jobs)) {
      throw new Error(`Fal 队列快照无效：${source}`);
    }
    for (const job of queue.jobs) {
      validateFalJob(job, source);
      rows.push({
        scopeKey: entry.name,
        jobId: job.id,
        jobJson: JSON.stringify(job),
      });
    }
  }
  rows.sort((left, right) => (
    left.scopeKey.localeCompare(right.scopeKey) || left.jobId.localeCompare(right.jobId)
  ));
  return rows;
}

function validateSnapshot(snapshot, source) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error(`状态快照无效：${source}`);
  }
  if (snapshot.schemaVersion !== 1) throw new Error(`状态版本无效：${source}`);
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
    throw new Error(`状态 revision 无效：${source}`);
  }
  if (typeof snapshot.updatedAt !== 'string' || !snapshot.updatedAt) {
    throw new Error(`状态更新时间无效：${source}`);
  }
  if (!snapshot.state || typeof snapshot.state !== 'object' || Array.isArray(snapshot.state)) {
    throw new Error(`状态内容无效：${source}`);
  }
}

function validateFalJob(job, source) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new Error(`Fal 任务无效：${source}`);
  }
  if (
    typeof job.id !== 'string'
    || !job.id
    || typeof job.profileId !== 'string'
    || typeof job.modelId !== 'string'
    || !Array.isArray(job.children)
    || !job.request
    || typeof job.request !== 'object'
    || !job.plan
    || typeof job.plan !== 'object'
  ) {
    throw new Error(`Fal 任务字段无效：${source}`);
  }
}

function optionalOption(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : '';
  return value && !value.startsWith('--') ? value : '';
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
