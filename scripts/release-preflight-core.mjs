import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkFalBillingAccess } from './check-fal-billing-access.mjs';

const expectedDatabaseVersion = 7;
const packageDocument = JSON.parse(
  await readFile(join(process.cwd(), 'package.json'), 'utf8'),
);

export async function runReleasePreflight(options = {}) {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? process.version;
  const billingEnv = { ...env };
  delete billingEnv.FAL_KEY;
  delete billingEnv.FAL_ADMIN_KEY;
  const billingCheck = options.billingCheck
    ?? ((checkOptions) => checkFalBillingAccess(checkOptions));
  const checks = [];
  const add = (id, passed, code) => {
    checks.push({ id, status: passed ? 'pass' : 'fail', code: passed ? 'OK' : code });
  };

  add('runtime.node', /^v24\./.test(nodeVersion), 'NODE_VERSION_UNSUPPORTED');
  add('deployment.mode', env.NODE_ENV === 'production', 'PRODUCTION_MODE_REQUIRED');
  add('security.cookies', env.PIAS_SECURE_COOKIES === 'true', 'SECURE_COOKIES_REQUIRED');
  add(
    'security.raw_secrets',
    !env.FAL_KEY?.trim() && !env.FAL_ADMIN_KEY?.trim(),
    'RAW_SECRET_ENV_FORBIDDEN',
  );
  add(
    'deployment.persistence',
    env.PIAS_PERSISTENCE_BACKEND === 'sqlite',
    'SQLITE_BACKEND_REQUIRED',
  );
  add(
    'deployment.public_url',
    isProductionHttpsUrl(env.PIAS_PUBLIC_BASE_URL),
    'PUBLIC_HTTPS_URL_REQUIRED',
  );

  const databaseResult = await checkDatabase(env.PIAS_DATABASE_FILE);
  add('database.integrity', databaseResult.ok, databaseResult.code);
  const backupResult = await checkBackup(
    env.PIAS_RELEASE_BACKUP_FILE,
    env.PIAS_DATABASE_FILE,
  );
  add('database.rollback', backupResult.ok, backupResult.code);
  const authResult = await checkAuthConfig(env.PIAS_AUTH_CONFIG_FILE);
  add('identity.config', authResult.ok, authResult.code);
  const falKeyResult = await checkFalKeyFiles(env.FAL_KEY_FILE, env.FAL_ADMIN_KEY_FILE);
  add('fal.key_files', falKeyResult.ok, falKeyResult.code);
  const emailResult = await checkEmailConfig(env);
  add('email.config', emailResult.ok, emailResult.code);
  const storageResult = await checkPrivateDirectory(env.PIAS_ASSET_DIR);
  add('storage.assets', storageResult.ok, storageResult.ok ? 'OK' : 'ASSET_STORAGE_REQUIRED');
  const artifactResult = await checkBuildArtifact(env.PIAS_RELEASE_ARTIFACT_DIR || 'dist');
  add('build.artifact', artifactResult.ok, artifactResult.code);
  const serverArtifactResult = await checkServerArtifact(
    env.PIAS_RELEASE_SERVER_FILE || 'dist-server/server.mjs',
  );
  add('server.artifact', serverArtifactResult.ok, serverArtifactResult.code);

  let billingResult;
  try {
    billingResult = await billingCheck({ env: billingEnv });
  } catch {
    billingResult = { ok: false, reason: 'billing_api_unreachable' };
  }
  add('fal.billing', billingResult.ok === true, billingBlocker(billingResult.reason));

  const blockers = [...new Set(checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.code))];
  return {
    schemaVersion: 1,
    target: 'production',
    checkedAt: new Date().toISOString(),
    ok: blockers.length === 0,
    blockers,
    checks,
  };
}

async function checkDatabase(filePath) {
  if (!filePath) return failed('DATABASE_REQUIRED');
  if (!await isPrivateFile(filePath)) return failed('DATABASE_PERMISSIONS_INVALID');
  let database;
  try {
    database = new DatabaseSync(filePath, { readOnly: true });
    const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') return failed('DATABASE_INTEGRITY_FAILED');
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== expectedDatabaseVersion) return failed('DATABASE_SCHEMA_INVALID');
    const outbox = database.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'organization_email_outbox'
    `).get();
    if (!outbox) return failed('DATABASE_SCHEMA_INVALID');
    return passed();
  } catch {
    return failed('DATABASE_INVALID');
  } finally {
    database?.close();
  }
}

async function checkBackup(filePath, databasePath) {
  if (!filePath) return failed('RELEASE_BACKUP_REQUIRED');
  if (!databasePath) return failed('RELEASE_BACKUP_INVALID');
  const manifestPath = `${filePath}.manifest.json`;
  if (!await isPrivateFile(filePath) || !await isPrivateFile(manifestPath)) {
    return failed('RELEASE_BACKUP_INVALID');
  }
  let database;
  try {
    const bytes = await readFile(filePath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (
      manifest.schemaVersion !== 1
      || manifest.integrity !== 'ok'
      || manifest.sha256 !== digest
      || typeof manifest.source !== 'string'
      || resolve(manifest.source) !== resolve(databasePath)
    ) {
      return failed('RELEASE_BACKUP_INVALID');
    }
    database = new DatabaseSync(filePath, { readOnly: true });
    if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') {
      return failed('RELEASE_BACKUP_INVALID');
    }
    const version = Number(database.prepare('PRAGMA user_version').get()?.user_version);
    if (!Number.isInteger(version) || version < 1 || version > expectedDatabaseVersion) {
      return failed('RELEASE_BACKUP_INVALID');
    }
    return passed();
  } catch {
    return failed('RELEASE_BACKUP_INVALID');
  } finally {
    database?.close();
  }
}

async function checkAuthConfig(filePath) {
  if (!filePath) return failed('AUTH_CONFIG_REQUIRED');
  if (!await isPrivateFile(filePath)) return failed('AUTH_CONFIG_INVALID');
  try {
    const document = JSON.parse(await readFile(filePath, 'utf8'));
    if (document.schemaVersion !== 1 || !Array.isArray(document.users) || document.users.length === 0) {
      return failed('AUTH_CONFIG_INVALID');
    }
    for (const user of document.users) {
      if (!user || typeof user !== 'object' || 'password' in user) return failed('AUTH_CONFIG_INVALID');
      if (!/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(user.passwordHash)) {
        return failed('AUTH_CONFIG_INVALID');
      }
      if (!Array.isArray(user.projectIds) || user.projectIds.length === 0) {
        return failed('AUTH_CONFIG_INVALID');
      }
      if (['owner', 'admin', 'platform_operator'].includes(user.role) && !user.mfaEnabled) {
        return failed('AUTH_CONFIG_INVALID');
      }
    }
    return passed();
  } catch {
    return failed('AUTH_CONFIG_INVALID');
  }
}

async function checkFalKeyFiles(inferenceFile, adminFile) {
  if (!inferenceFile || !adminFile) return failed('FAL_KEY_FILES_REQUIRED');
  if (!await isPrivateNonemptyFile(inferenceFile) || !await isPrivateNonemptyFile(adminFile)) {
    return failed('FAL_KEY_FILES_INVALID');
  }
  return passed();
}

async function checkEmailConfig(env) {
  const required = [
    env.PIAS_PUBLIC_BASE_URL,
    env.PIAS_EMAIL_FROM,
    env.PIAS_EMAIL_WEBHOOK_URL,
    env.PIAS_EMAIL_WEBHOOK_KEY_FILE,
    env.PIAS_INVITATION_ENCRYPTION_KEY_FILE,
  ];
  if (required.some((value) => !value?.trim())) return failed('EMAIL_CONFIG_REQUIRED');
  if (!isProductionHttpsUrl(env.PIAS_EMAIL_WEBHOOK_URL)) return failed('EMAIL_CONFIG_INVALID');
  if (!/^[^\r\n]{1,320}$/.test(env.PIAS_EMAIL_FROM) || !env.PIAS_EMAIL_FROM.includes('@')) {
    return failed('EMAIL_CONFIG_INVALID');
  }
  if (!await isPrivateNonemptyFile(env.PIAS_EMAIL_WEBHOOK_KEY_FILE)) {
    return failed('EMAIL_KEY_FILES_INVALID');
  }
  if (!await isPrivateFile(env.PIAS_INVITATION_ENCRYPTION_KEY_FILE)) {
    return failed('EMAIL_KEY_FILES_INVALID');
  }
  try {
    const raw = (await readFile(env.PIAS_INVITATION_ENCRYPTION_KEY_FILE, 'utf8')).trim();
    const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) return failed('EMAIL_ENCRYPTION_KEY_INVALID');
  } catch {
    return failed('EMAIL_ENCRYPTION_KEY_INVALID');
  }
  return passed();
}

async function checkBuildArtifact(directory) {
  let info;
  try {
    info = await stat(join(directory, 'index.html'));
  } catch {
    return failed('BUILD_ARTIFACT_REQUIRED');
  }
  if (!info.isFile() || info.size === 0) return failed('BUILD_ARTIFACT_REQUIRED');
  try {
    const metadata = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
    if (
      metadata.schemaVersion !== 1
      || metadata.service !== 'pias-image-studio'
      || metadata.version !== packageDocument.version
      || !/^[a-f0-9]{7,40}$/.test(metadata.revision)
      || typeof metadata.dirty !== 'boolean'
      || typeof metadata.builtAt !== 'string'
      || !Number.isFinite(Date.parse(metadata.builtAt))
    ) {
      return failed('BUILD_METADATA_INVALID');
    }
    if (metadata.dirty) return failed('BUILD_METADATA_DIRTY');
    return passed();
  } catch {
    return failed('BUILD_METADATA_INVALID');
  }
}

async function checkServerArtifact(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0
      ? passed()
      : failed('SERVER_ARTIFACT_REQUIRED');
  } catch {
    return failed('SERVER_ARTIFACT_REQUIRED');
  }
}

async function isPrivateNonemptyFile(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size === 0 || info.size > 64 * 1024) {
      return false;
    }
    return (await readFile(filePath, 'utf8')).trim().length > 0;
  } catch {
    return false;
  }
}

async function isPrivateFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && (info.mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}

async function checkPrivateDirectory(directory) {
  if (!directory) return failed('ASSET_STORAGE_REQUIRED');
  try {
    const info = await stat(directory);
    return info.isDirectory() && (info.mode & 0o777) === 0o700
      ? passed()
      : failed('ASSET_STORAGE_REQUIRED');
  } catch {
    return failed('ASSET_STORAGE_REQUIRED');
  }
}

function isProductionHttpsUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.hostname !== 'localhost'
      && url.hostname !== '127.0.0.1'
      && url.hostname !== '::1';
  } catch {
    return false;
  }
}

function billingBlocker(reason) {
  if (reason === 'billing_access_denied') return 'BILLING_ACCESS_DENIED';
  if (reason === 'admin_key_missing') return 'BILLING_ADMIN_KEY_REQUIRED';
  if (reason === 'billing_api_unreachable') return 'BILLING_API_UNREACHABLE';
  return 'BILLING_API_ERROR';
}

function passed() {
  return { ok: true, code: 'OK' };
}

function failed(code) {
  return { ok: false, code };
}
