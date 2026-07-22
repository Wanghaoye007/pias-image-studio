import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../src/server/auth/authPolicy';
import { IdentityService } from '../src/server/auth/identityService';
import {
  createInvitationEmailDelivery,
  loadInvitationEmailConfig,
} from '../src/worker/organization/invitationEmailDelivery';
import { createOrganizationService } from '../src/server/organization/organizationService';
import { organizationPlugin } from '../src/server/organization/organizationPlugin';
import { openPiasDatabase } from '../src/server/persistence/sqliteDatabase';

const directories: string[] = [];
const baseNow = '2026-07-22T08:00:00.000Z';
const owner: AuthContext = {
  userId: 'user-owner', tenantId: 'tenant-a', role: 'owner',
  projectIds: ['project-a'], mfaVerified: true,
};
const creator: AuthContext = {
  userId: 'user-creator', tenantId: 'tenant-a', role: 'creator',
  projectIds: ['project-a'], mfaVerified: false,
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('invitation email delivery', () => {
  it('stores only encrypted tokens and marks delivery sent after an idempotent webhook succeeds', async () => {
    const { database, close } = await setupDatabase();
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    const delivery = createInvitationEmailDelivery(database, emailConfig(), {
      fetcher,
      now: () => baseNow,
      workerId: 'worker-a',
    });
    const service = createOrganizationService(database, {
      now: () => baseNow,
      invitationDelivery: delivery,
    });
    const project = service.createProject(creator, { name: '邮件邀请项目', reviewRequired: true });
    const created = service.createInvitation(owner, {
      email: 'mail-member@pias.test', role: 'viewer', projectIds: [project.id],
    });

    expect(created.invitation.deliveryStatus).toBe('queued');
    const stored = database.connection.prepare(`
      SELECT token_ciphertext, token_iv, token_tag, status, attempt_count
      FROM organization_email_outbox WHERE invitation_id = ?
    `).get(created.invitation.id) as Record<string, unknown>;
    expect(stored).toMatchObject({ status: 'queued', attempt_count: 0 });
    expect(String(stored.token_ciphertext)).not.toContain(created.acceptToken);
    expect(JSON.stringify(stored)).not.toContain(created.acceptToken);

    await expect(delivery.runOnce()).resolves.toMatchObject({ inspected: 1, sent: 1, failed: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mail-relay.pias.test/v1/send');
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer webhook-secret');
    expect(new Headers(request.headers).get('idempotency-key')).toMatch(/^email-/);
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      template: 'pias-member-invitation-v1',
      from: 'PIAS <no-reply@pias.test>',
      to: 'mail-member@pias.test',
    });
    expect(JSON.stringify(body)).toContain(
      `https://studio.pias.test/#/accept-invitation?token=${created.acceptToken}`,
    );
    expect(database.connection.prepare(`
      SELECT status, attempt_count FROM organization_email_outbox WHERE invitation_id = ?
    `).get(created.invitation.id)).toEqual({ status: 'sent', attempt_count: 1 });
    expect(service.listInvitations(owner)[0].deliveryStatus).toBe('sent');
    expect(service.listAuditEvents(owner)).toContainEqual(expect.objectContaining({
      type: 'member.invitation_delivery_succeeded',
      targetId: created.invitation.id,
    }));
    await expect(delivery.runOnce()).resolves.toMatchObject({ inspected: 0, sent: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    close();
  });

  it('retries transient webhook failures after backoff without persisting response details', async () => {
    let currentNow = baseNow;
    const { database, close } = await setupDatabase();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('provider secret failure text', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 202 }));
    const delivery = createInvitationEmailDelivery(database, emailConfig(), {
      fetcher,
      now: () => currentNow,
      workerId: 'worker-retry',
    });
    const service = createOrganizationService(database, {
      now: () => currentNow,
      invitationDelivery: delivery,
    });
    const project = service.createProject(creator, { name: '邮件重试项目', reviewRequired: true });
    const created = service.createInvitation(owner, {
      email: 'retry@pias.test', role: 'reviewer', projectIds: [project.id],
    });

    await expect(delivery.runOnce()).resolves.toMatchObject({ failed: 1, sent: 0 });
    const failed = database.connection.prepare(`
      SELECT status, attempt_count, last_error_code, next_attempt_at
      FROM organization_email_outbox WHERE invitation_id = ?
    `).get(created.invitation.id) as Record<string, unknown>;
    expect(failed).toMatchObject({
      status: 'failed', attempt_count: 1, last_error_code: 'WEBHOOK_HTTP_503',
    });
    expect(JSON.stringify(failed)).not.toContain('provider secret failure text');
    expect(service.listInvitations(owner)[0].deliveryStatus).toBe('failed');
    expect(service.listAuditEvents(owner)).toContainEqual(expect.objectContaining({
      type: 'member.invitation_delivery_failed',
      targetId: created.invitation.id,
      details: expect.objectContaining({ errorCode: 'WEBHOOK_HTTP_503' }),
    }));
    await expect(delivery.runOnce()).resolves.toMatchObject({ inspected: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    currentNow = '2026-07-22T08:01:01.000Z';
    await expect(delivery.runOnce()).resolves.toMatchObject({ inspected: 1, sent: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(service.listInvitations(owner)[0].deliveryStatus).toBe('sent');
    close();
  });

  it('cancels queued mail when an invitation is revoked', async () => {
    const { database, close } = await setupDatabase();
    const fetcher = vi.fn();
    const delivery = createInvitationEmailDelivery(database, emailConfig(), {
      fetcher,
      now: () => baseNow,
      workerId: 'worker-cancel',
    });
    const service = createOrganizationService(database, {
      now: () => baseNow,
      invitationDelivery: delivery,
    });
    const project = service.createProject(creator, { name: '撤销邮件项目', reviewRequired: true });
    const created = service.createInvitation(owner, {
      email: 'cancel@pias.test', role: 'viewer', projectIds: [project.id],
    });

    service.revokeInvitation(owner, created.invitation.id);

    expect(database.connection.prepare(`
      SELECT status FROM organization_email_outbox WHERE invitation_id = ?
    `).get(created.invitation.id)).toEqual({ status: 'canceled' });
    await expect(delivery.runOnce()).resolves.toMatchObject({ inspected: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    close();
  });

  it('cancels the previous outbox row when an invitation is reissued or expires', async () => {
    let currentNow = baseNow;
    const { database, close } = await setupDatabase();
    const delivery = createInvitationEmailDelivery(database, emailConfig(), {
      fetcher: vi.fn(), now: () => currentNow, workerId: 'worker-state',
    });
    const service = createOrganizationService(database, {
      now: () => currentNow, invitationDelivery: delivery,
    });
    const project = service.createProject(creator, { name: '邮件状态项目', reviewRequired: true });
    const original = service.createInvitation(owner, {
      email: 'mail-state@pias.test', role: 'viewer', projectIds: [project.id],
    });

    const replacement = service.resendInvitation(owner, original.invitation.id);
    expect(database.connection.prepare(`
      SELECT status FROM organization_email_outbox WHERE invitation_id = ?
    `).get(original.invitation.id)).toEqual({ status: 'canceled' });
    expect(database.connection.prepare(`
      SELECT status FROM organization_email_outbox WHERE invitation_id = ?
    `).get(replacement.invitation.id)).toEqual({ status: 'queued' });

    currentNow = '2026-07-30T08:00:00.000Z';
    expect(service.listInvitations(owner).find((item) => item.id === replacement.invitation.id)?.status)
      .toBe('expired');
    expect(database.connection.prepare(`
      SELECT status FROM organization_email_outbox WHERE invitation_id = ?
    `).get(replacement.invitation.id)).toEqual({ status: 'canceled' });
    close();
  });

  it('loads secrets only from 0600 files and rejects partial mail configuration', async () => {
    const directory = await temporaryDirectory('pias-mail-config-');
    const encryptionKeyFile = join(directory, 'encryption-key');
    const webhookKeyFile = join(directory, 'webhook-key');
    await writeFile(encryptionKeyFile, Buffer.alloc(32, 7).toString('base64'), { mode: 0o600 });
    await writeFile(webhookKeyFile, 'webhook-secret\n', { mode: 0o600 });

    expect(loadInvitationEmailConfig({
      PIAS_PUBLIC_BASE_URL: 'https://studio.pias.test',
      PIAS_EMAIL_FROM: 'PIAS <no-reply@pias.test>',
      PIAS_EMAIL_WEBHOOK_URL: 'https://mail-relay.pias.test/v1/send',
      PIAS_EMAIL_WEBHOOK_KEY_FILE: webhookKeyFile,
      PIAS_INVITATION_ENCRYPTION_KEY_FILE: encryptionKeyFile,
    })).toMatchObject({
      publicBaseUrl: 'https://studio.pias.test',
      webhookKey: 'webhook-secret',
      encryptionKey: expect.any(Buffer),
    });
    expect(loadInvitationEmailConfig({})).toBeNull();
    expect(() => loadInvitationEmailConfig({ PIAS_EMAIL_FROM: 'partial@pias.test' }))
      .toThrow(expect.objectContaining({ code: 'ORG_EMAIL_CONFIG_INCOMPLETE' }));
    await writeFile(webhookKeyFile, 'insecure', { mode: 0o644 });
    await chmod(webhookKeyFile, 0o644);
    expect(() => loadInvitationEmailConfig({
      PIAS_PUBLIC_BASE_URL: 'https://studio.pias.test',
      PIAS_EMAIL_FROM: 'no-reply@pias.test',
      PIAS_EMAIL_WEBHOOK_URL: 'https://mail-relay.pias.test/v1/send',
      PIAS_EMAIL_WEBHOOK_KEY_FILE: webhookKeyFile,
      PIAS_INVITATION_ENCRYPTION_KEY_FILE: encryptionKeyFile,
    })).toThrow(expect.objectContaining({ code: 'ORG_EMAIL_CONFIG_PERMISSIONS_INVALID' }));
  });

  it('starts the durable email worker with the organization Vite plugin', async () => {
    const directory = await temporaryDirectory('pias-mail-plugin-');
    const databasePath = join(directory, 'pias.sqlite');
    const config = emailConfig();
    const seedDatabase = openPiasDatabase(databasePath);
    const seedDelivery = createInvitationEmailDelivery(seedDatabase, config, {
      fetcher: vi.fn(), now: () => baseNow, workerId: 'seed-worker',
    });
    const seedService = createOrganizationService(seedDatabase, {
      now: () => baseNow, invitationDelivery: seedDelivery,
    });
    const project = seedService.createProject(creator, {
      name: '插件邮件项目', reviewRequired: true,
    });
    const created = seedService.createInvitation(owner, {
      email: 'plugin-mail@pias.test', role: 'viewer', projectIds: [project.id],
    });
    seedDatabase.close();
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    const identity = new IdentityService([{
      id: 'user-owner', tenantId: 'tenant-a', email: 'owner@pias.test', displayName: 'Owner',
      passwordHash: 'scrypt$16384$8$1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000',
      role: 'owner', status: 'active', projectIds: [project.id], mfaEnabled: true,
      mfaSecret: 'JBSWY3DPEHPK3PXP',
    }]);
    const plugin = organizationPlugin(identity, {
      databaseFile: databasePath,
      emailConfig: config,
      emailDeliveryOptions: {
        fetcher, now: () => baseNow, workerId: 'plugin-worker', intervalMs: 60_000,
      },
    });
    if (typeof plugin.configureServer !== 'function') throw new Error('configureServer missing');
    plugin.configureServer.call({} as never, {
      middlewares: { use: vi.fn() },
      httpServer: { once: vi.fn() },
    } as never);

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const inspected = openPiasDatabase(databasePath);
    expect(inspected.connection.prepare(`
      SELECT status FROM organization_email_outbox WHERE invitation_id = ?
    `).get(created.invitation.id)).toEqual({ status: 'sent' });
    inspected.close();
    if (typeof plugin.closeBundle === 'function') await plugin.closeBundle.call({} as never);
  });
});

function emailConfig() {
  return {
    publicBaseUrl: 'https://studio.pias.test',
    from: 'PIAS <no-reply@pias.test>',
    webhookUrl: 'https://mail-relay.pias.test/v1/send',
    webhookKey: 'webhook-secret',
    encryptionKey: Buffer.alloc(32, 9),
  };
}

async function setupDatabase() {
  const directory = await temporaryDirectory('pias-mail-outbox-');
  const database = openPiasDatabase(join(directory, 'pias.sqlite'));
  return { database, close: () => database.close() };
}

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
