import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { integrityCheck, requireOption, sha256 } from './sqlite-common.mjs';

const args = process.argv.slice(2);
const command = args[0];

try {
  if (command === 'backup') await backupCommand(args.slice(1));
  else if (command === 'restore') await restoreCommand(args.slice(1));
  else throw new Error('命令必须是 backup 或 restore');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function backupCommand(commandArgs) {
  const databasePath = requireOption(commandArgs, '--database');
  const outputPath = requireOption(commandArgs, '--output');
  await requireFile(databasePath, '数据库不存在');
  await rejectExisting(outputPath, '备份目标已存在');
  await rejectExisting(`${outputPath}.manifest.json`, '备份清单已存在');
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const source = new DatabaseSync(databasePath);
  try {
    source.exec('PRAGMA busy_timeout = 5000');
    source.exec('PRAGMA wal_checkpoint(FULL)');
    integrityCheck(source);
    await sqliteBackup(source, temporaryPath);
  } finally {
    source.close();
  }
  const copied = new DatabaseSync(temporaryPath);
  try {
    integrityCheck(copied);
  } finally {
    copied.close();
  }
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, outputPath);
  const digest = sha256(await readFile(outputPath));
  const manifestPath = `${outputPath}.manifest.json`;
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: databasePath,
    backup: outputPath,
    sha256: digest,
    integrity: 'ok',
  }, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    mode: 'backup',
    database: databasePath,
    output: outputPath,
    manifest: manifestPath,
    sha256: digest,
    integrity: 'ok',
  })}\n`);
}

async function restoreCommand(commandArgs) {
  const databasePath = requireOption(commandArgs, '--database');
  const backupPath = requireOption(commandArgs, '--backup');
  const apply = commandArgs.includes('--apply');
  await requireFile(backupPath, '备份文件不存在');
  const backupDatabase = new DatabaseSync(backupPath);
  try {
    integrityCheck(backupDatabase);
  } finally {
    backupDatabase.close();
  }
  const digest = sha256(await readFile(backupPath));
  const manifestPath = `${backupPath}.manifest.json`;
  if (await exists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.sha256 !== digest) throw new Error('备份 SHA-256 与清单不一致');
  }
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      mode: 'dry-run',
      database: databasePath,
      backup: backupPath,
      sha256: digest,
      integrity: 'ok',
    })}\n`);
    return;
  }

  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackPath = `${databasePath}.rollback-${suffix}`;
  const temporaryPath = `${databasePath}.${process.pid}.restore.tmp`;
  const moved = [];
  try {
    for (const sidecar of ['', '-wal', '-shm']) {
      const source = `${databasePath}${sidecar}`;
      if (!await exists(source)) continue;
      const target = `${rollbackPath}${sidecar}`;
      await rename(source, target);
      moved.push({ source, target });
    }
    await copyFile(backupPath, temporaryPath);
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, databasePath);
    const restored = new DatabaseSync(databasePath);
    try {
      integrityCheck(restored);
    } finally {
      restored.close();
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await rm(databasePath, { force: true }).catch(() => undefined);
    for (const entry of moved.reverse()) {
      await rename(entry.target, entry.source).catch(() => undefined);
    }
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    mode: 'applied',
    database: databasePath,
    backup: backupPath,
    rollback: moved.length > 0 ? rollbackPath : null,
    sha256: digest,
    integrity: 'ok',
  })}\n`);
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

async function requireFile(filePath, message) {
  if (!await exists(filePath)) throw new Error(message);
}

async function rejectExisting(filePath, message) {
  if (await exists(filePath)) throw new Error(message);
}
