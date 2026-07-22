import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { PiasDatabase } from '../persistence/sqliteDatabase';
import type {
  OrganizationInvitation,
  OrganizationInvitationDelivery,
} from './organizationService';

export type InvitationEmailConfig = {
  publicBaseUrl: string;
  from: string;
  webhookUrl: string;
  webhookKey: string;
  encryptionKey: Buffer;
};

export type InvitationEmailCycleReport = {
  inspected: number;
  sent: number;
  failed: number;
};

export class InvitationEmailConfigError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'InvitationEmailConfigError';
  }
}

export type InvitationEmailDeliveryOptions = {
  fetcher?: typeof fetch;
  now?: () => string;
  workerId?: string;
  intervalMs?: number;
  leaseTtlMs?: number;
};

type ClaimedMessage = {
  messageId: string;
  tenantId: string;
  invitationId: string;
  recipientEmail: string;
  senderEmail: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
  attemptCount: number;
  displayName?: string;
  role: OrganizationInvitation['role'];
  expiresAt: string;
};

export type InvitationEmailDelivery = OrganizationInvitationDelivery & {
  runOnce(): Promise<InvitationEmailCycleReport>;
  start(): void;
  stop(): Promise<void>;
};

export function createInvitationEmailDelivery(
  database: PiasDatabase,
  config: InvitationEmailConfig,
  options: InvitationEmailDeliveryOptions = {},
): InvitationEmailDelivery {
  validateRuntimeConfig(config);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const workerId = options.workerId ?? `pias-email-${process.pid}-${randomUUID()}`;
  const intervalMs = Math.max(500, options.intervalMs ?? 5_000);
  const leaseTtlMs = Math.max(5_000, options.leaseTtlMs ?? 30_000);
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<InvitationEmailCycleReport> | undefined;
  let stopped = false;

  const delivery: InvitationEmailDelivery = {
    enqueue(invitation, acceptToken, at) {
      const encrypted = encryptToken(
        acceptToken,
        config.encryptionKey,
        tokenAssociatedData(invitation.tenantId, invitation.id, invitation.email),
      );
      database.connection.prepare(`
        INSERT INTO organization_email_outbox (
          message_id, tenant_id, invitation_id, recipient_email, sender_email,
          token_ciphertext, token_iv, token_tag, status, attempt_count,
          next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
      `).run(
        `email-${randomUUID()}`,
        invitation.tenantId,
        invitation.id,
        invitation.email,
        config.from,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        at,
        at,
        at,
      );
    },

    cancel(invitationId, at) {
      database.connection.prepare(`
        UPDATE organization_email_outbox
        SET status = 'canceled', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE invitation_id = ? AND status NOT IN ('sent', 'canceled')
      `).run(at, invitationId);
    },

    runOnce() {
      if (active) return active;
      active = runCycle(database, config, {
        fetcher,
        now,
        workerId,
        leaseTtlMs,
      }).finally(() => { active = undefined; });
      return active;
    },

    start() {
      if (timer) return;
      stopped = false;
      void delivery.runOnce();
      timer = setInterval(() => {
        if (!stopped) void delivery.runOnce();
      }, intervalMs);
      timer.unref?.();
    },

    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await active;
    },
  };
  return delivery;
}

export function loadInvitationEmailConfig(
  env: Record<string, string | undefined> = process.env,
): InvitationEmailConfig | null {
  const values = {
    publicBaseUrl: env.PIAS_PUBLIC_BASE_URL?.trim() ?? '',
    from: env.PIAS_EMAIL_FROM?.trim() ?? '',
    webhookUrl: env.PIAS_EMAIL_WEBHOOK_URL?.trim() ?? '',
    webhookKeyFile: env.PIAS_EMAIL_WEBHOOK_KEY_FILE?.trim() ?? '',
    encryptionKeyFile: env.PIAS_INVITATION_ENCRYPTION_KEY_FILE?.trim() ?? '',
  };
  if (Object.values(values).every((value) => !value)) return null;
  if (Object.values(values).some((value) => !value)) {
    throw new InvitationEmailConfigError(
      '邀请邮件配置不完整',
      'ORG_EMAIL_CONFIG_INCOMPLETE',
    );
  }
  const webhookKey = readSecretFile(values.webhookKeyFile);
  const encryptionKey = parseEncryptionKey(readSecretFile(values.encryptionKeyFile));
  const config: InvitationEmailConfig = {
    publicBaseUrl: values.publicBaseUrl,
    from: values.from,
    webhookUrl: values.webhookUrl,
    webhookKey,
    encryptionKey,
  };
  validateRuntimeConfig(config);
  return config;
}

async function runCycle(
  database: PiasDatabase,
  config: InvitationEmailConfig,
  options: {
    fetcher: typeof fetch;
    now: () => string;
    workerId: string;
    leaseTtlMs: number;
  },
): Promise<InvitationEmailCycleReport> {
  const report: InvitationEmailCycleReport = { inspected: 0, sent: 0, failed: 0 };
  while (true) {
    const at = options.now();
    const message = claimNextMessage(database, options.workerId, at, options.leaseTtlMs);
    if (!message) return report;
    report.inspected += 1;
    try {
      const token = decryptToken(
        message,
        config.encryptionKey,
        tokenAssociatedData(message.tenantId, message.invitationId, message.recipientEmail),
      );
      const response = await options.fetcher(config.webhookUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.webhookKey}`,
          'content-type': 'application/json',
          'idempotency-key': message.messageId,
        },
        body: JSON.stringify({
          messageId: message.messageId,
          template: 'pias-member-invitation-v1',
          from: message.senderEmail,
          to: message.recipientEmail,
          subject: 'PIAS 企业工作台邀请',
          variables: {
            displayName: message.displayName ?? message.recipientEmail.split('@')[0],
            role: message.role,
            acceptUrl: invitationUrl(config.publicBaseUrl, token),
            expiresAt: message.expiresAt,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new WebhookDeliveryError(`WEBHOOK_HTTP_${response.status}`);
      markSent(database, message, options.workerId, at);
      report.sent += 1;
    } catch (error) {
      markFailed(
        database,
        message,
        options.workerId,
        at,
        safeDeliveryErrorCode(error),
      );
      report.failed += 1;
    }
  }
}

function claimNextMessage(
  database: PiasDatabase,
  workerId: string,
  at: string,
  leaseTtlMs: number,
): ClaimedMessage | undefined {
  const nowMs = Date.parse(at);
  database.connection.exec('BEGIN IMMEDIATE');
  try {
    const row = database.connection.prepare(`
      SELECT outbox.*, invitation.display_name, invitation.role, invitation.expires_at
      FROM organization_email_outbox AS outbox
      INNER JOIN organization_invitations AS invitation
        ON invitation.invitation_id = outbox.invitation_id
      WHERE invitation.status = 'pending'
        AND invitation.expires_at > ?
        AND outbox.next_attempt_at <= ?
        AND (
          outbox.status IN ('queued', 'failed')
          OR (outbox.status = 'sending' AND outbox.lease_expires_at <= ?)
        )
      ORDER BY outbox.next_attempt_at ASC, outbox.created_at ASC
      LIMIT 1
    `).get(at, at, nowMs) as Record<string, unknown> | undefined;
    if (!row) {
      database.connection.exec('COMMIT');
      return undefined;
    }
    const updated = database.connection.prepare(`
      UPDATE organization_email_outbox
      SET status = 'sending', lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE message_id = ?
    `).run(workerId, nowMs + leaseTtlMs, at, String(row.message_id));
    if (updated.changes !== 1) {
      database.connection.exec('ROLLBACK');
      return undefined;
    }
    database.connection.prepare(`
      UPDATE organization_invitations SET delivery_status = 'queued'
      WHERE invitation_id = ? AND status = 'pending'
    `).run(String(row.invitation_id));
    database.connection.exec('COMMIT');
    return parseClaimedMessage(row);
  } catch (error) {
    database.connection.exec('ROLLBACK');
    throw error;
  }
}

function markSent(
  database: PiasDatabase,
  message: ClaimedMessage,
  workerId: string,
  at: string,
): void {
  transaction(database, () => {
    const updated = database.connection.prepare(`
      UPDATE organization_email_outbox
      SET status = 'sent', attempt_count = attempt_count + 1, sent_at = ?, updated_at = ?,
          lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL
      WHERE message_id = ? AND status = 'sending' AND lease_owner = ?
    `).run(at, at, message.messageId, workerId);
    if (updated.changes !== 1) return;
    database.connection.prepare(`
      UPDATE organization_invitations SET delivery_status = 'sent'
      WHERE invitation_id = ? AND status = 'pending'
    `).run(message.invitationId);
    insertDeliveryAudit(database, {
      tenantId: message.tenantId,
      type: 'member.invitation_delivery_succeeded',
      targetId: message.invitationId,
      details: { messageId: message.messageId, attempt: message.attemptCount + 1 },
      at,
    });
  });
}

function markFailed(
  database: PiasDatabase,
  message: ClaimedMessage,
  workerId: string,
  at: string,
  errorCode: string,
): void {
  const attempt = message.attemptCount + 1;
  const retryDelayMs = Math.min(60 * 60_000, 60_000 * (2 ** Math.min(attempt - 1, 6)));
  const nextAttemptAt = new Date(Date.parse(at) + retryDelayMs).toISOString();
  transaction(database, () => {
    const updated = database.connection.prepare(`
      UPDATE organization_email_outbox
      SET status = 'failed', attempt_count = attempt_count + 1, next_attempt_at = ?,
          updated_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error_code = ?
      WHERE message_id = ? AND status = 'sending' AND lease_owner = ?
    `).run(nextAttemptAt, at, errorCode, message.messageId, workerId);
    if (updated.changes !== 1) return;
    database.connection.prepare(`
      UPDATE organization_invitations SET delivery_status = 'failed'
      WHERE invitation_id = ? AND status = 'pending'
    `).run(message.invitationId);
    insertDeliveryAudit(database, {
      tenantId: message.tenantId,
      type: 'member.invitation_delivery_failed',
      targetId: message.invitationId,
      details: {
        messageId: message.messageId,
        attempt,
        errorCode,
        nextAttemptAt,
      },
      at,
    });
  });
}

function encryptToken(token: string, key: Buffer, aad: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptToken(message: ClaimedMessage, key: Buffer, aad: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(message.tokenIv, 'base64'));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(message.tokenTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(message.tokenCiphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function tokenAssociatedData(tenantId: string, invitationId: string, email: string): Buffer {
  return Buffer.from(`${tenantId}\0${invitationId}\0${email}`, 'utf8');
}

function parseClaimedMessage(row: Record<string, unknown>): ClaimedMessage {
  return {
    messageId: String(row.message_id),
    tenantId: String(row.tenant_id),
    invitationId: String(row.invitation_id),
    recipientEmail: String(row.recipient_email),
    senderEmail: String(row.sender_email),
    tokenCiphertext: String(row.token_ciphertext),
    tokenIv: String(row.token_iv),
    tokenTag: String(row.token_tag),
    attemptCount: Number(row.attempt_count),
    ...(row.display_name ? { displayName: String(row.display_name) } : {}),
    role: String(row.role) as OrganizationInvitation['role'],
    expiresAt: String(row.expires_at),
  };
}

function readSecretFile(filePath: string): string {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) throw new Error('not a file');
    if ((stats.mode & 0o077) !== 0) {
      throw new InvitationEmailConfigError(
        '邀请邮件密钥文件权限必须为 0600',
        'ORG_EMAIL_CONFIG_PERMISSIONS_INVALID',
      );
    }
    const value = readFileSync(filePath, 'utf8').trim();
    if (!value || value.length > 4096) throw new Error('invalid secret');
    return value;
  } catch (error) {
    if (error instanceof InvitationEmailConfigError) throw error;
    throw new InvitationEmailConfigError(
      '无法读取邀请邮件密钥文件',
      'ORG_EMAIL_CONFIG_SECRET_INVALID',
    );
  }
}

function parseEncryptionKey(value: string): Buffer {
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new InvitationEmailConfigError(
      '邀请令牌加密密钥必须为 32 字节',
      'ORG_EMAIL_CONFIG_KEY_INVALID',
    );
  }
  return key;
}

function validateRuntimeConfig(config: InvitationEmailConfig): void {
  if (config.encryptionKey.length !== 32) {
    throw new InvitationEmailConfigError(
      '邀请令牌加密密钥必须为 32 字节',
      'ORG_EMAIL_CONFIG_KEY_INVALID',
    );
  }
  validateHttpsUrl(config.publicBaseUrl, '公开访问地址');
  validateHttpsUrl(config.webhookUrl, '邮件 Webhook 地址');
  if (!config.webhookKey || config.webhookKey.length > 4096) {
    throw new InvitationEmailConfigError('邮件 Webhook 密钥无效', 'ORG_EMAIL_CONFIG_INVALID');
  }
  if (!config.from || config.from.length > 320 || /[\r\n]/.test(config.from)) {
    throw new InvitationEmailConfigError('邀请发件人无效', 'ORG_EMAIL_CONFIG_INVALID');
  }
}

function validateHttpsUrl(value: string, label: string): void {
  let url: URL;
  try { url = new URL(value); }
  catch {
    throw new InvitationEmailConfigError(`${label}无效`, 'ORG_EMAIL_CONFIG_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new InvitationEmailConfigError(`${label}必须使用 HTTPS`, 'ORG_EMAIL_CONFIG_INVALID');
  }
}

function invitationUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.hash = `/accept-invitation?token=${encodeURIComponent(token)}`;
  return url.toString();
}

function safeDeliveryErrorCode(error: unknown): string {
  if (error instanceof WebhookDeliveryError) return error.code;
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'WEBHOOK_TIMEOUT';
  return 'WEBHOOK_NETWORK_ERROR';
}

class WebhookDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function transaction(database: PiasDatabase, action: () => void): void {
  database.connection.exec('BEGIN IMMEDIATE');
  try {
    action();
    database.connection.exec('COMMIT');
  } catch (error) {
    database.connection.exec('ROLLBACK');
    throw error;
  }
}

function insertDeliveryAudit(database: PiasDatabase, event: {
  tenantId: string;
  type: 'member.invitation_delivery_succeeded' | 'member.invitation_delivery_failed';
  targetId: string;
  details: Record<string, unknown>;
  at: string;
}): void {
  database.connection.prepare(`
    INSERT INTO organization_audit_events (
      event_id, tenant_id, event_type, actor_user_id, target_id, details_json, created_at
    ) VALUES (?, ?, ?, 'system', ?, ?, ?)
  `).run(
    `org-event-${randomUUID()}`,
    event.tenantId,
    event.type,
    event.targetId,
    JSON.stringify(event.details),
    event.at,
  );
}
