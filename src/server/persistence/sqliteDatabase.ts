import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type DatabaseScope = {
  tenantId: string;
  projectId: string;
};

export type ContentStudioDatabase = {
  connection: DatabaseSync;
  filePath: string;
  scopeKey(scope: DatabaseScope): string;
  close(): void;
};

type NodeSqlite = typeof import('node:sqlite');

const require = createRequire(import.meta.url);

export function openContentStudioDatabase(filePath: string): ContentStudioDatabase {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const { DatabaseSync } = require('node:sqlite') as NodeSqlite;
  const connection = new DatabaseSync(filePath);
  let closed = false;
  try {
    connection.exec('PRAGMA journal_mode = WAL');
    connection.exec('PRAGMA synchronous = FULL');
    connection.exec('PRAGMA foreign_keys = ON');
    connection.exec('PRAGMA busy_timeout = 5000');
    connection.exec(`
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
    migrateOrganizationSchemaV5(connection);
    migrateOrganizationSchemaV6(connection);
    migrateOrganizationSchemaV7(connection);
    chmodSync(filePath, 0o600);
  } catch (error) {
    connection.close();
    throw error;
  }

  return {
    connection,
    filePath,
    scopeKey: scopeStorageKey,
    close() {
      if (closed) return;
      closed = true;
      connection.close();
    },
  };
}

function migrateOrganizationSchemaV5(connection: DatabaseSync): void {
  const invitationColumns = new Set(connection.prepare(
    'PRAGMA table_info(organization_invitations)',
  ).all().map((row) => String((row as Record<string, unknown>).name)));
  connection.exec('BEGIN IMMEDIATE');
  try {
    if (!invitationColumns.has('token_hash')) {
      connection.exec('ALTER TABLE organization_invitations ADD COLUMN token_hash TEXT');
    }
    if (!invitationColumns.has('accepted_at')) {
      connection.exec('ALTER TABLE organization_invitations ADD COLUMN accepted_at TEXT');
    }
    if (!invitationColumns.has('canceled_at')) {
      connection.exec('ALTER TABLE organization_invitations ADD COLUMN canceled_at TEXT');
    }
    connection.exec(`
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
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

function migrateOrganizationSchemaV6(connection: DatabaseSync): void {
  const userColumns = new Set(connection.prepare(
    'PRAGMA table_info(organization_users)',
  ).all().map((row) => String((row as Record<string, unknown>).name)));
  connection.exec('BEGIN IMMEDIATE');
  try {
    if (!userColumns.has('first_login_at')) {
      connection.exec('ALTER TABLE organization_users ADD COLUMN first_login_at TEXT');
    }
    connection.exec(`
      INSERT OR IGNORE INTO content_studio_schema_migrations (version, applied_at)
      VALUES (6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      PRAGMA user_version = 6;
    `);
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

function migrateOrganizationSchemaV7(connection: DatabaseSync): void {
  connection.exec('BEGIN IMMEDIATE');
  try {
    connection.exec(`
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
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

export function scopeStorageKey(scope: DatabaseScope): string {
  return createHash('sha256')
    .update(scope.tenantId)
    .update('\0')
    .update(scope.projectId)
    .digest('hex');
}
