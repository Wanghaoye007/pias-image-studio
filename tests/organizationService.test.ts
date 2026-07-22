import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/server/auth/authPolicy';
import { generateTotp, IdentityService } from '../src/server/auth/identityService';
import {
  OrganizationError,
  createOrganizationService,
} from '../src/server/organization/organizationService';
import { openPiasDatabase } from '../src/server/persistence/sqliteDatabase';

const directories: string[] = [];
const now = '2026-07-22T06:30:00.000Z';

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('organization service', () => {
  it('persists a created project, creator membership, and tenant audit across reopen', async () => {
    const { databasePath, service, close } = await setup();
    const created = service.createProject(creatorContext(), {
      name: '2026 秋季新品',
      defaultBrand: 'PIAS',
      defaultSku: 'PIAS-AW-001',
      reviewRequired: true,
    });

    expect(created).toMatchObject({
      tenantId: 'tenant-a',
      name: '2026 秋季新品',
      ownerUserId: 'user-creator',
      status: 'active',
    });
    expect(service.projectIdsForUser('tenant-a', 'user-creator')).toContain(created.id);
    close();

    const reopenedDatabase = openPiasDatabase(databasePath);
    const reopened = createOrganizationService(reopenedDatabase, { now: () => now });
    expect(reopened.listProjects(creatorContext())).toEqual([
      expect.objectContaining({ id: created.id, name: '2026 秋季新品' }),
    ]);
    expect(reopened.listAuditEvents(ownerContext())).toEqual([
      expect.objectContaining({ type: 'project.created', actorUserId: 'user-creator' }),
    ]);
    reopenedDatabase.close();
  });

  it('creates a truthful pending invitation and rejects duplicate or unauthorized invitations', async () => {
    const { service, close } = await setup();
    const project = service.createProject(creatorContext(), {
      name: '秋季新品',
      reviewRequired: true,
    });

    const created = service.createInvitation(ownerContext(), {
      email: ' Reviewer@PIAS.TEST ',
      displayName: '秋季审核员',
      role: 'reviewer',
      projectIds: [project.id],
    });
    const { invitation } = created;
    expect(invitation).toMatchObject({
      email: 'reviewer@pias.test',
      deliveryStatus: 'pending_configuration',
      role: 'reviewer',
      status: 'pending',
    });
    expect(created.acceptToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(service.listInvitations(ownerContext())).toHaveLength(1);

    expect(() => service.createInvitation(ownerContext(), {
      email: 'reviewer@pias.test',
      role: 'reviewer',
      projectIds: [project.id],
    })).toThrow(expect.objectContaining({ code: 'ORG_INVITATION_DUPLICATE' }));
    expect(() => service.createInvitation(creatorContext(), {
      email: 'other@pias.test',
      role: 'viewer',
      projectIds: [project.id],
    })).toThrow(expect.objectContaining({ code: 'AUTH_FORBIDDEN' }));
    close();
  });

  it('stores only an invitation token hash and consumes it once into a persistent member', async () => {
    const { database, databasePath, service, close } = await setup();
    const project = service.createProject(creatorContext(), {
      name: '持久成员项目',
      reviewRequired: true,
    });
    const created = service.createInvitation(ownerContext(), {
      email: 'member@pias.test',
      displayName: '持久成员',
      role: 'reviewer',
      projectIds: [project.id],
    });
    const stored = database.connection.prepare(`
      SELECT token_hash FROM organization_invitations WHERE invitation_id = ?
    `).get(created.invitation.id) as { token_hash: string };
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.token_hash).not.toContain(created.acceptToken);
    expect(JSON.stringify(service.listInvitations(ownerContext())))
      .not.toContain(created.acceptToken);

    const accepted = await service.acceptInvitation({
      token: created.acceptToken,
      password: strongPassword,
    });
    expect(accepted).toMatchObject({
      email: 'member@pias.test',
      displayName: '持久成员',
      role: 'reviewer',
      projectIds: [project.id],
    });
    await expect(service.acceptInvitation({
      token: created.acceptToken,
      password: strongPassword,
    })).rejects.toMatchObject({ code: 'ORG_INVITATION_NOT_PENDING' });
    close();

    const reopenedDatabase = openPiasDatabase(databasePath);
    const reopened = createOrganizationService(reopenedDatabase, { now: () => now });
    const identity = new IdentityService([]);
    identity.setUserResolver({
      findByEmail: reopened.findUserByEmail,
      findById: reopened.findUserById,
    });
    identity.setProjectAccessResolver(reopened.projectIdsForUser);
    const login = await identity.beginLogin('member@pias.test', strongPassword);
    expect(login.status).toBe('authenticated');
    if (login.status !== 'authenticated') throw new Error('session missing');
    expect(identity.authenticateSession(login.sessionToken).projectIds).toEqual([project.id]);
    reopenedDatabase.close();
  });

  it('revokes pending invitations idempotently and expires stale tokens', async () => {
    let currentNow = now;
    const { service, close } = await setup({ now: () => currentNow });
    const project = service.createProject(creatorContext(), {
      name: '邀请状态项目',
      reviewRequired: true,
    });
    const revoked = service.createInvitation(ownerContext(), {
      email: 'revoked@pias.test', role: 'viewer', projectIds: [project.id],
    });
    expect(service.revokeInvitation(ownerContext(), revoked.invitation.id).status).toBe('canceled');
    expect(service.revokeInvitation(ownerContext(), revoked.invitation.id).status).toBe('canceled');
    await expect(service.acceptInvitation({
      token: revoked.acceptToken, password: strongPassword,
    })).rejects.toMatchObject({ code: 'ORG_INVITATION_NOT_PENDING' });

    const stale = service.createInvitation(ownerContext(), {
      email: 'expired@pias.test', role: 'viewer', projectIds: [project.id],
    });
    currentNow = '2026-07-30T06:30:00.000Z';
    await expect(service.acceptInvitation({
      token: stale.acceptToken, password: strongPassword,
    })).rejects.toMatchObject({ code: 'ORG_INVITATION_EXPIRED' });
    expect(service.listInvitations(ownerContext()).find((item) => item.id === stale.invitation.id)?.status)
      .toBe('expired');
    close();
  });

  it('reissues an invitation atomically and makes the previous token unusable', async () => {
    const { service, close } = await setup();
    const project = service.createProject(creatorContext(), {
      name: '邀请重发项目',
      reviewRequired: true,
    });
    const original = service.createInvitation(ownerContext(), {
      email: 'resend@pias.test', role: 'viewer', projectIds: [project.id],
    });

    const replacement = service.resendInvitation(ownerContext(), original.invitation.id);

    expect(replacement.invitation).toMatchObject({
      email: original.invitation.email,
      role: original.invitation.role,
      projectIds: original.invitation.projectIds,
      status: 'pending',
    });
    expect(replacement.invitation.id).not.toBe(original.invitation.id);
    expect(replacement.acceptToken).not.toBe(original.acceptToken);
    expect(() => service.previewInvitation(original.acceptToken))
      .toThrow(expect.objectContaining({ code: 'ORG_INVITATION_NOT_PENDING' }));
    expect(service.previewInvitation(replacement.acceptToken)).toMatchObject({
      email: 'resend@pias.test',
    });
    expect(service.listInvitations(ownerContext())).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.invitation.id, status: 'canceled' }),
      expect.objectContaining({ id: replacement.invitation.id, status: 'pending' }),
    ]));
    expect(service.listAuditEvents(ownerContext())).toContainEqual(expect.objectContaining({
      type: 'member.invitation_resent',
      targetId: replacement.invitation.id,
      details: expect.objectContaining({ previousInvitationId: original.invitation.id }),
    }));
    close();
  });

  it('does not reissue an accepted invitation', async () => {
    const { service, close } = await setup();
    const project = service.createProject(creatorContext(), {
      name: '已接受邀请项目', reviewRequired: true,
    });
    const created = service.createInvitation(ownerContext(), {
      email: 'accepted-resend@pias.test', role: 'viewer', projectIds: [project.id],
    });
    await service.acceptInvitation({ token: created.acceptToken, password: strongPassword });

    expect(() => service.resendInvitation(ownerContext(), created.invitation.id))
      .toThrow(expect.objectContaining({ code: 'ORG_INVITATION_NOT_RESENDABLE' }));
    close();
  });

  it('opens organization schema version 7 with member login and email outbox fields', async () => {
    const { database, close } = await setup();
    expect(database.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    const tables = database.connection.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((row) => String((row as { name: string }).name));
    expect(tables).toContain('organization_users');
    const columns = database.connection.prepare('PRAGMA table_info(organization_invitations)')
      .all().map((row) => String((row as { name: string }).name));
    expect(columns).toEqual(expect.arrayContaining(['token_hash', 'accepted_at', 'canceled_at']));
    const userColumns = database.connection.prepare('PRAGMA table_info(organization_users)')
      .all().map((row) => String((row as { name: string }).name));
    expect(userColumns).toContain('first_login_at');
    const outboxColumns = database.connection.prepare('PRAGMA table_info(organization_email_outbox)')
      .all().map((row) => String((row as { name: string }).name));
    expect(outboxColumns).toEqual(expect.arrayContaining([
      'token_ciphertext', 'token_iv', 'token_tag', 'lease_owner', 'next_attempt_at',
    ]));
    close();
  });

  it('upgrades an existing v4 invitation table without losing rows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pias-org-v4-'));
    directories.push(directory);
    const databasePath = join(directory, 'pias.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE organization_invitations (
        invitation_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT,
        role TEXT NOT NULL,
        project_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        delivery_status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO organization_invitations VALUES (
        'invitation-legacy', 'tenant-a', 'legacy@pias.test', NULL, 'viewer', '["project-a"]',
        'pending', 'pending_configuration', 'user-owner', '${now}', '2026-07-29T06:30:00.000Z'
      );
      PRAGMA user_version = 4;
    `);
    legacy.close();

    const upgraded = openPiasDatabase(databasePath);
    expect(upgraded.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(upgraded.connection.prepare(`
      SELECT email, token_hash FROM organization_invitations WHERE invitation_id = 'invitation-legacy'
    `).get()).toEqual({ email: 'legacy@pias.test', token_hash: null });
    upgraded.close();
  });

  it('upgrades v5 members to v6 without losing existing rows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pias-org-v5-'));
    directories.push(directory);
    const databasePath = join(directory, 'pias.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE organization_invitations (
        invitation_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL,
        display_name TEXT, role TEXT NOT NULL, project_ids_json TEXT NOT NULL,
        status TEXT NOT NULL, delivery_status TEXT NOT NULL, token_hash TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        accepted_at TEXT, canceled_at TEXT
      ) STRICT;
      CREATE TABLE organization_users (
        user_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL,
        status TEXT NOT NULL, mfa_enabled INTEGER NOT NULL, mfa_secret TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO organization_users VALUES (
        'user-legacy', 'tenant-a', 'legacy-member@pias.test', '旧成员', 'hash', 'viewer',
        'active', 0, NULL, '${now}', '${now}'
      );
      PRAGMA user_version = 5;
    `);
    legacy.close();

    const upgraded = openPiasDatabase(databasePath);
    expect(upgraded.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(upgraded.connection.prepare(`
      SELECT email, first_login_at FROM organization_users WHERE user_id = 'user-legacy'
    `).get()).toEqual({ email: 'legacy-member@pias.test', first_login_at: null });
    upgraded.close();
  });

  it('requires a verified TOTP setup when an invited administrator accepts', async () => {
    const { service, close } = await setup();
    const project = service.createProject(creatorContext(), {
      name: '管理员项目', reviewRequired: true,
    });
    const created = service.createInvitation(ownerContext(), {
      email: 'admin-member@pias.test', role: 'admin', projectIds: [project.id],
    });
    await expect(service.acceptInvitation({
      token: created.acceptToken, password: strongPassword,
    })).rejects.toMatchObject({ code: 'ORG_INVITATION_MFA_INVALID' });
    const secret = 'JBSWY3DPEHPK3PXP';
    await expect(service.acceptInvitation({
      token: created.acceptToken,
      password: strongPassword,
      mfaSecret: secret,
      mfaCode: generateTotp(secret, Date.parse(now)),
    })).resolves.toMatchObject({ role: 'admin', mfaEnabled: true });
    close();
  });

  it('validates project and invitation business fields before writing', async () => {
    const { service, close } = await setup();
    expect(() => service.createProject(creatorContext(), {
      name: 'A',
      reviewRequired: true,
    })).toThrow(expect.objectContaining({ code: 'ORG_PROJECT_INVALID' }));
    expect(() => service.createInvitation(ownerContext(), {
      email: 'not-an-email',
      role: 'owner',
      projectIds: [],
    })).toThrow(OrganizationError);
    close();
  });

  it('lists members and applies role, project, and status changes with immutable audit events', async () => {
    const { service, close } = await setup();
    const firstProject = service.createProject(creatorContext(), {
      name: '成员项目一', reviewRequired: true,
    });
    const secondProject = service.createProject(creatorContext(), {
      name: '成员项目二', reviewRequired: false,
    });
    const created = service.createInvitation(ownerContext(), {
      email: 'managed@pias.test', role: 'creator', projectIds: [firstProject.id],
    });
    const member = await service.acceptInvitation({
      token: created.acceptToken, password: strongPassword, displayName: '受管成员',
    });

    expect(service.listMembers(ownerContext())).toEqual([
      expect.objectContaining({
        id: member.id,
        role: 'creator',
        status: 'active',
        projectIds: [firstProject.id],
      }),
    ]);
    const changed = service.updateMember(ownerContext(), member.id, {
      role: 'reviewer',
      projectIds: [secondProject.id],
      status: 'disabled',
    });
    expect(changed).toMatchObject({
      role: 'reviewer',
      status: 'disabled',
      projectIds: [secondProject.id],
    });
    expect(service.projectIdsForUser('tenant-a', member.id)).toEqual([secondProject.id]);
    expect(service.listAuditEvents(ownerContext()).map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'member.role_changed',
        'member.projects_changed',
        'member.status_changed',
      ]),
    );
    expect(() => service.updateMember(creatorContext(), member.id, { status: 'active' }))
      .toThrow(expect.objectContaining({ code: 'AUTH_FORBIDDEN' }));
    close();
  });

  it('invalidates an active persisted-member session and refreshes role and project scope', async () => {
    const { service, close } = await setup();
    const firstProject = service.createProject(creatorContext(), {
      name: '会话项目一', reviewRequired: true,
    });
    const secondProject = service.createProject(creatorContext(), {
      name: '会话项目二', reviewRequired: true,
    });
    const created = service.createInvitation(ownerContext(), {
      email: 'session-member@pias.test', role: 'creator', projectIds: [firstProject.id],
    });
    const member = await service.acceptInvitation({
      token: created.acceptToken, password: strongPassword,
    });
    const identity = new IdentityService([]);
    identity.setUserResolver({
      findByEmail: service.findUserByEmail,
      findById: service.findUserById,
    });
    identity.setProjectAccessResolver(service.projectIdsForUser);
    const login = await identity.beginLogin(member.email, strongPassword);
    if (login.status !== 'authenticated') throw new Error('session missing');

    service.updateMember(ownerContext(), member.id, {
      role: 'reviewer', projectIds: [secondProject.id],
    });
    expect(identity.authenticateSession(login.sessionToken)).toMatchObject({
      role: 'reviewer', projectIds: [secondProject.id],
    });
    service.updateMember(ownerContext(), member.id, { status: 'disabled' });
    expect(() => identity.authenticateSession(login.sessionToken))
      .toThrow(expect.objectContaining({ code: 'AUTH_SESSION_INVALID' }));
    close();
  });

  it('records first and subsequent successful member logins without secrets', async () => {
    const { service, close } = await setup();
    const project = service.createProject(creatorContext(), {
      name: '登录审计项目', reviewRequired: true,
    });
    const created = service.createInvitation(ownerContext(), {
      email: 'audit-login@pias.test', role: 'viewer', projectIds: [project.id],
    });
    const member = await service.acceptInvitation({
      token: created.acceptToken, password: strongPassword,
    });

    service.recordSuccessfulLogin(service.findUserById(member.id)!, now);
    service.recordSuccessfulLogin(service.findUserById(member.id)!, '2026-07-22T07:30:00.000Z');

    expect(service.listMembers(ownerContext())[0]).toMatchObject({ firstLoginAt: now });
    const loginEvents = service.listAuditEvents(ownerContext())
      .filter((event) => event.type === 'auth.login_succeeded');
    expect(loginEvents).toEqual([
      expect.objectContaining({ actorUserId: member.id, details: { firstLogin: true } }),
      expect.objectContaining({ actorUserId: member.id, details: { firstLogin: false } }),
    ]);
    expect(JSON.stringify(loginEvents)).not.toContain(strongPassword);
    close();
  });
});

const strongPassword = 'PIAS-member-2026!';

async function setup(options: { now?: () => string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pias-org-'));
  directories.push(directory);
  const databasePath = join(directory, 'pias.sqlite');
  const database = openPiasDatabase(databasePath);
  return {
    database,
    databasePath,
    service: createOrganizationService(database, { now: options.now ?? (() => now) }),
    close: () => database.close(),
  };
}

function creatorContext(): AuthContext {
  return {
    userId: 'user-creator',
    tenantId: 'tenant-a',
    role: 'creator',
    projectIds: ['project-a'],
    mfaVerified: false,
  };
}

function ownerContext(): AuthContext {
  return {
    userId: 'user-owner',
    tenantId: 'tenant-a',
    role: 'owner',
    projectIds: ['project-a'],
    mfaVerified: true,
  };
}
