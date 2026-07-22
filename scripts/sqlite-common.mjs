import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(filePath) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(filePath), 0o700);
  const database = new DatabaseSync(filePath);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = FULL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_studio_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS studio_states (
      scope_key TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      state_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS fal_jobs (
      scope_key TEXT NOT NULL,
      job_id TEXT NOT NULL,
      job_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, job_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS fal_job_leases (
      scope_key TEXT NOT NULL,
      job_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, job_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS fal_job_leases_expiry
    ON fal_job_leases (expires_at);
    CREATE TABLE IF NOT EXISTS fal_job_payloads (
      scope_key TEXT NOT NULL,
      job_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, job_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS organization_projects (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      default_brand TEXT,
      default_sku TEXT,
      owner_user_id TEXT NOT NULL,
      review_required INTEGER NOT NULL CHECK (review_required IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, project_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS organization_project_members (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, project_id, user_id),
      FOREIGN KEY (tenant_id, project_id)
        REFERENCES organization_projects (tenant_id, project_id)
        ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS organization_project_members_user
    ON organization_project_members (tenant_id, user_id);
    CREATE TABLE IF NOT EXISTS organization_invitations (
      invitation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'creator', 'reviewer', 'viewer')),
      project_ids_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'canceled', 'expired')),
      delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending_configuration', 'queued', 'sent', 'failed')),
      token_hash TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      canceled_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS organization_invitations_tenant_email
    ON organization_invitations (tenant_id, email, status);
    CREATE TABLE IF NOT EXISTS organization_users (
      user_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'creator', 'reviewer', 'viewer')),
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
      mfa_enabled INTEGER NOT NULL CHECK (mfa_enabled IN (0, 1)),
      mfa_secret TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      first_login_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS organization_audit_events (
      event_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS organization_audit_tenant_time
    ON organization_audit_events (tenant_id, created_at);
    INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
    VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
    VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
    VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
    VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    PRAGMA user_version = 4;
  `);
  migrateOrganizationSchemaV5(database);
  migrateOrganizationSchemaV6(database);
  migrateOrganizationSchemaV7(database);
  chmodSync(filePath, 0o600);
  return database;
}

function migrateOrganizationSchemaV5(database) {
  const invitationColumns = new Set(database.prepare(
    'PRAGMA table_info(organization_invitations)',
  ).all().map((row) => String(row.name)));
  database.exec('BEGIN IMMEDIATE');
  try {
    if (!invitationColumns.has('token_hash')) {
      database.exec('ALTER TABLE organization_invitations ADD COLUMN token_hash TEXT');
    }
    if (!invitationColumns.has('accepted_at')) {
      database.exec('ALTER TABLE organization_invitations ADD COLUMN accepted_at TEXT');
    }
    if (!invitationColumns.has('canceled_at')) {
      database.exec('ALTER TABLE organization_invitations ADD COLUMN canceled_at TEXT');
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS organization_users (
        user_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'creator', 'reviewer', 'viewer')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        mfa_enabled INTEGER NOT NULL CHECK (mfa_enabled IN (0, 1)),
        mfa_secret TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_token_hash
      ON organization_invitations (token_hash) WHERE token_hash IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_email
      ON organization_invitations (tenant_id, email) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS organization_users_tenant_role
      ON organization_users (tenant_id, role, status);
      INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
      VALUES (5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      PRAGMA user_version = 5;
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function migrateOrganizationSchemaV6(database) {
  const userColumns = new Set(database.prepare(
    'PRAGMA table_info(organization_users)',
  ).all().map((row) => String(row.name)));
  database.exec('BEGIN IMMEDIATE');
  try {
    if (!userColumns.has('first_login_at')) {
      database.exec('ALTER TABLE organization_users ADD COLUMN first_login_at TEXT');
    }
    database.exec(`
      INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
      VALUES (6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      PRAGMA user_version = 6;
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function migrateOrganizationSchemaV7(database) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS organization_email_outbox (
        message_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        invitation_id TEXT NOT NULL UNIQUE,
        recipient_email TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        token_ciphertext TEXT NOT NULL,
        token_iv TEXT NOT NULL,
        token_tag TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'canceled')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at INTEGER,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        FOREIGN KEY (invitation_id) REFERENCES organization_invitations (invitation_id)
          ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS organization_email_outbox_due
      ON organization_email_outbox (status, next_attempt_at, lease_expires_at);
      INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
      VALUES (7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      PRAGMA user_version = 7;
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function integrityCheck(database) {
  const row = database.prepare('PRAGMA integrity_check').get();
  const value = row?.integrity_check;
  if (value !== 'ok') throw new Error(`数据库完整性校验失败：${String(value ?? 'unknown')}`);
  return value;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function requireOption(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : '';
  if (!value || value.startsWith('--')) throw new Error(`缺少参数 ${name}`);
  return value;
}
