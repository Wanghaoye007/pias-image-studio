import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requirePermission, type AuthContext, type AuthRole } from '../auth/authPolicy';
import {
  hashPassword,
  verifyTotpCode,
  type AuthUser,
} from '../auth/identityService';
import type { PiasDatabase } from '../persistence/sqliteDatabase';

export type OrganizationProject = {
  id: string;
  tenantId: string;
  name: string;
  defaultBrand?: string;
  defaultSku?: string;
  ownerUserId: string;
  reviewRequired: boolean;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type OrganizationInvitation = {
  id: string;
  tenantId: string;
  email: string;
  displayName?: string;
  role: Exclude<AuthRole, 'owner' | 'platform_operator'>;
  projectIds: string[];
  status: 'pending' | 'accepted' | 'canceled' | 'expired';
  deliveryStatus: 'pending_configuration' | 'queued' | 'sent' | 'failed';
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  canceledAt?: string;
};

export type CreatedOrganizationInvitation = {
  invitation: OrganizationInvitation;
  acceptToken: string;
};

export type OrganizationInvitationPreview = Pick<
  OrganizationInvitation,
  'email' | 'displayName' | 'role' | 'expiresAt'
> & {
  projectIds: string[];
};

export type OrganizationMember = Omit<AuthUser, 'passwordHash' | 'mfaSecret' | 'role'> & {
  role: Exclude<AuthRole, 'owner' | 'platform_operator'>;
  createdAt: string;
  updatedAt: string;
  firstLoginAt?: string;
};

export type OrganizationAuditEvent = {
  id: string;
  tenantId: string;
  type: 'project.created' | 'member.invited' | 'member.invitation_accepted'
    | 'member.invitation_canceled' | 'member.invitation_expired'
    | 'member.invitation_resent'
    | 'member.invitation_delivery_succeeded' | 'member.invitation_delivery_failed'
    | 'member.status_changed' | 'member.role_changed' | 'member.projects_changed'
    | 'auth.login_succeeded';
  actorUserId: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export class OrganizationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OrganizationError';
  }
}

type OrganizationServiceOptions = {
  now?: () => string;
  userEmailExists?: (email: string) => boolean;
  invitationDelivery?: OrganizationInvitationDelivery;
};

export type OrganizationInvitationDelivery = {
  enqueue(invitation: OrganizationInvitation, acceptToken: string, at: string): void;
  cancel(invitationId: string, at: string): void;
};

export function createOrganizationService(
  database: PiasDatabase,
  options: OrganizationServiceOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const userEmailExists = options.userEmailExists ?? (() => false);
  const invitationDelivery = options.invitationDelivery;
  const { connection } = database;

  return {
    createProject(context: AuthContext, input: {
      name: string;
      defaultBrand?: string;
      defaultSku?: string;
      reviewRequired: boolean;
    }): OrganizationProject {
      requirePermission(context, 'project.edit', { tenantId: context.tenantId });
      const name = boundedText(input.name, 2, 80, '项目名称', 'ORG_PROJECT_INVALID');
      const defaultBrand = optionalText(input.defaultBrand, 100, '默认品牌', 'ORG_PROJECT_INVALID');
      const defaultSku = optionalText(input.defaultSku, 100, '默认 SKU', 'ORG_PROJECT_INVALID');
      if (typeof input.reviewRequired !== 'boolean') {
        invalidProject('审核策略无效');
      }
      const at = now();
      const project: OrganizationProject = {
        id: `project-${randomUUID()}`,
        tenantId: context.tenantId,
        name,
        ...(defaultBrand ? { defaultBrand } : {}),
        ...(defaultSku ? { defaultSku } : {}),
        ownerUserId: context.userId,
        reviewRequired: input.reviewRequired,
        status: 'active',
        createdAt: at,
        updatedAt: at,
      };
      transaction(connection, () => {
        connection.prepare(`
          INSERT INTO organization_projects (
            tenant_id, project_id, name, default_brand, default_sku, owner_user_id,
            review_required, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          project.tenantId,
          project.id,
          project.name,
          project.defaultBrand ?? null,
          project.defaultSku ?? null,
          project.ownerUserId,
          project.reviewRequired ? 1 : 0,
          project.status,
          project.createdAt,
          project.updatedAt,
        );
        connection.prepare(`
          INSERT INTO organization_project_members (tenant_id, project_id, user_id, created_at)
          VALUES (?, ?, ?, ?)
        `).run(project.tenantId, project.id, context.userId, at);
        insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'project.created',
          actorUserId: context.userId,
          targetId: project.id,
          details: { name: project.name },
          createdAt: at,
        });
      });
      return project;
    },

    listProjects(context: AuthContext): OrganizationProject[] {
      requirePermission(context, 'project.view', { tenantId: context.tenantId });
      const privileged = context.role === 'owner' || context.role === 'admin';
      const rows = privileged
        ? connection.prepare(`
            SELECT * FROM organization_projects
            WHERE tenant_id = ? ORDER BY updated_at DESC, project_id ASC
          `).all(context.tenantId)
        : connection.prepare(`
            SELECT project.* FROM organization_projects AS project
            INNER JOIN organization_project_members AS member
              ON member.tenant_id = project.tenant_id AND member.project_id = project.project_id
            WHERE project.tenant_id = ? AND member.user_id = ?
            ORDER BY project.updated_at DESC, project.project_id ASC
          `).all(context.tenantId, context.userId);
      return rows.map(parseProjectRow);
    },

    projectIdsForUser(tenantId: string, userId: string): string[] {
      return connection.prepare(`
        SELECT project_id FROM organization_project_members
        WHERE tenant_id = ? AND user_id = ? ORDER BY project_id ASC
      `).all(tenantId, userId).map((row) => String((row as Record<string, unknown>).project_id));
    },

    createInvitation(context: AuthContext, input: {
      email: string;
      displayName?: string;
      role: AuthRole;
      projectIds: string[];
    }): CreatedOrganizationInvitation {
      requirePermission(context, 'member.manage', { tenantId: context.tenantId });
      const email = input.email.trim().toLocaleLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalidInvitation('成员邮箱无效');
      const displayName = optionalText(input.displayName, 80, '成员姓名', 'ORG_INVITATION_INVALID');
      if (!['admin', 'creator', 'reviewer', 'viewer'].includes(input.role)) {
        invalidInvitation('邀请角色无效');
      }
      const projectIds = [...new Set(input.projectIds)];
      if (
        projectIds.length === 0
        || projectIds.length > 100
        || projectIds.some((id) => !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id))
      ) invalidInvitation('必须分配至少一个有效项目');
      for (const projectId of projectIds) {
        const known = connection.prepare(`
          SELECT 1 FROM organization_projects WHERE tenant_id = ? AND project_id = ?
        `).get(context.tenantId, projectId);
        if (!known) {
          invalidInvitation('邀请项目不存在或无权访问');
        }
      }
      if (userEmailExists(email) || findUserByEmail(connection, email)) {
        throw new OrganizationError('该邮箱已是企业成员', 'ORG_MEMBER_DUPLICATE', 409);
      }
      const duplicate = connection.prepare(`
        SELECT invitation_id FROM organization_invitations
        WHERE tenant_id = ? AND email = ? AND status = 'pending'
      `).get(context.tenantId, email);
      if (duplicate) {
        throw new OrganizationError('该邮箱已有待处理邀请', 'ORG_INVITATION_DUPLICATE', 409);
      }
      const createdAt = now();
      const acceptToken = randomBytes(32).toString('base64url');
      const tokenHash = hashInvitationToken(acceptToken);
      const invitation: OrganizationInvitation = {
        id: `invitation-${randomUUID()}`,
        tenantId: context.tenantId,
        email,
        ...(displayName ? { displayName } : {}),
        role: input.role as OrganizationInvitation['role'],
        projectIds,
        status: 'pending',
        deliveryStatus: invitationDelivery ? 'queued' : 'pending_configuration',
        createdBy: context.userId,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60_000).toISOString(),
      };
      transaction(connection, () => {
        connection.prepare(`
          INSERT INTO organization_invitations (
            invitation_id, tenant_id, email, display_name, role, project_ids_json,
            status, delivery_status, token_hash, created_by, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          invitation.id,
          invitation.tenantId,
          invitation.email,
          invitation.displayName ?? null,
          invitation.role,
          JSON.stringify(invitation.projectIds),
          invitation.status,
          invitation.deliveryStatus,
          tokenHash,
          invitation.createdBy,
          invitation.createdAt,
          invitation.expiresAt,
        );
        invitationDelivery?.enqueue(invitation, acceptToken, createdAt);
        insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'member.invited',
          actorUserId: context.userId,
          targetId: invitation.id,
          details: { email: invitation.email, role: invitation.role, projectIds },
          createdAt,
        });
      });
      return { invitation, acceptToken };
    },

    listInvitations(context: AuthContext): OrganizationInvitation[] {
      requirePermission(context, 'member.manage', { tenantId: context.tenantId });
      expirePendingInvitations(connection, context.tenantId, now(), invitationDelivery);
      return connection.prepare(`
        SELECT * FROM organization_invitations
        WHERE tenant_id = ? ORDER BY created_at DESC, invitation_id ASC
      `).all(context.tenantId).map(parseInvitationRow);
    },

    resendInvitation(
      context: AuthContext,
      invitationId: string,
    ): CreatedOrganizationInvitation {
      requirePermission(context, 'member.manage', { tenantId: context.tenantId });
      if (!/^invitation-[a-f0-9-]{36}$/.test(invitationId)) invalidInvitation('邀请编号无效');
      const value = connection.prepare(`
        SELECT * FROM organization_invitations WHERE tenant_id = ? AND invitation_id = ?
      `).get(context.tenantId, invitationId);
      if (!value) throw new OrganizationError('邀请不存在', 'ORG_INVITATION_NOT_FOUND', 404);
      const source = parseInvitationRow(value);
      if (source.status === 'accepted') {
        throw new OrganizationError(
          '已接受的邀请不能重新签发',
          'ORG_INVITATION_NOT_RESENDABLE',
          409,
        );
      }
      if (findUserByEmail(connection, source.email) || userEmailExists(source.email)) {
        throw new OrganizationError('该邮箱已是企业成员', 'ORG_MEMBER_DUPLICATE', 409);
      }
      const duplicate = connection.prepare(`
        SELECT invitation_id FROM organization_invitations
        WHERE tenant_id = ? AND email = ? AND status = 'pending' AND invitation_id <> ?
      `).get(context.tenantId, source.email, source.id);
      if (duplicate) {
        throw new OrganizationError('该邮箱已有待处理邀请', 'ORG_INVITATION_DUPLICATE', 409);
      }
      for (const projectId of source.projectIds) {
        const active = connection.prepare(`
          SELECT 1 FROM organization_projects
          WHERE tenant_id = ? AND project_id = ? AND status = 'active'
        `).get(context.tenantId, projectId);
        if (!active) invalidInvitation('邀请项目不存在或已归档');
      }
      const createdAt = now();
      const acceptToken = randomBytes(32).toString('base64url');
      const replacement: OrganizationInvitation = {
        ...source,
        id: `invitation-${randomUUID()}`,
        status: 'pending',
        deliveryStatus: invitationDelivery ? 'queued' : 'pending_configuration',
        createdBy: context.userId,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60_000).toISOString(),
      };
      delete replacement.acceptedAt;
      delete replacement.canceledAt;
      transaction(connection, () => {
        if (source.status === 'pending') {
          connection.prepare(`
            UPDATE organization_invitations SET status = 'canceled', canceled_at = ?
            WHERE tenant_id = ? AND invitation_id = ? AND status = 'pending'
          `).run(createdAt, context.tenantId, source.id);
        }
        invitationDelivery?.cancel(source.id, createdAt);
        connection.prepare(`
          INSERT INTO organization_invitations (
            invitation_id, tenant_id, email, display_name, role, project_ids_json,
            status, delivery_status, token_hash, created_by, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          replacement.id,
          replacement.tenantId,
          replacement.email,
          replacement.displayName ?? null,
          replacement.role,
          JSON.stringify(replacement.projectIds),
          replacement.status,
          replacement.deliveryStatus,
          hashInvitationToken(acceptToken),
          replacement.createdBy,
          replacement.createdAt,
          replacement.expiresAt,
        );
        invitationDelivery?.enqueue(replacement, acceptToken, createdAt);
        insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'member.invitation_resent',
          actorUserId: context.userId,
          targetId: replacement.id,
          details: {
            previousInvitationId: source.id,
            email: replacement.email,
            role: replacement.role,
            projectIds: replacement.projectIds,
          },
          createdAt,
        });
      });
      return { invitation: replacement, acceptToken };
    },

    previewInvitation(token: string): OrganizationInvitationPreview {
      const invitation = resolveInvitationByToken(connection, token);
      assertInvitationPending(connection, invitation, now(), invitationDelivery);
      return {
        email: invitation.email,
        ...(invitation.displayName ? { displayName: invitation.displayName } : {}),
        role: invitation.role,
        projectIds: [...invitation.projectIds],
        expiresAt: invitation.expiresAt,
      };
    },

    async acceptInvitation(input: {
      token: string;
      password: string;
      displayName?: string;
      mfaSecret?: string;
      mfaCode?: string;
    }): Promise<OrganizationMember> {
      const invitation = resolveInvitationByToken(connection, input.token);
      const acceptedAt = now();
      assertInvitationPending(connection, invitation, acceptedAt, invitationDelivery);
      if (userEmailExists(invitation.email) || findUserByEmail(connection, invitation.email)) {
        throw new OrganizationError('该邮箱已是企业成员', 'ORG_MEMBER_DUPLICATE', 409);
      }
      const displayName = optionalText(
        input.displayName,
        80,
        '成员姓名',
        'ORG_INVITATION_INVALID',
      ) ?? invitation.displayName ?? invitation.email.split('@')[0];
      const privileged = invitation.role === 'admin';
      const mfaSecret = privileged
        ? validateMfaSetup(input.mfaSecret, input.mfaCode, Date.parse(acceptedAt))
        : undefined;
      const passwordHash = await hashPassword(input.password);
      const user: AuthUser = {
        id: `user-${randomUUID()}`,
        tenantId: invitation.tenantId,
        email: invitation.email,
        displayName,
        passwordHash,
        role: invitation.role,
        status: 'active',
        projectIds: [],
        mfaEnabled: privileged,
        ...(mfaSecret ? { mfaSecret } : {}),
      };
      transaction(connection, () => {
        const current = connection.prepare(`
          SELECT * FROM organization_invitations WHERE token_hash = ?
        `).get(hashInvitationToken(input.token));
        if (!current) invalidInvitationToken();
        const currentInvitation = parseInvitationRow(current);
        if (currentInvitation.status !== 'pending') {
          throw new OrganizationError('邀请已处理，不能重复接受', 'ORG_INVITATION_NOT_PENDING', 409);
        }
        if (Date.parse(currentInvitation.expiresAt) <= Date.parse(acceptedAt)) {
          throw new OrganizationError('邀请已过期', 'ORG_INVITATION_EXPIRED', 410);
        }
        if (findUserByEmail(connection, invitation.email)) {
          throw new OrganizationError('该邮箱已是企业成员', 'ORG_MEMBER_DUPLICATE', 409);
        }
        connection.prepare(`
          INSERT INTO organization_users (
            user_id, tenant_id, email, display_name, password_hash, role, status,
            mfa_enabled, mfa_secret, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
        `).run(
          user.id,
          user.tenantId,
          user.email,
          user.displayName,
          user.passwordHash,
          user.role,
          user.mfaEnabled ? 1 : 0,
          user.mfaSecret ?? null,
          acceptedAt,
          acceptedAt,
        );
        for (const projectId of invitation.projectIds) {
          connection.prepare(`
            INSERT INTO organization_project_members (tenant_id, project_id, user_id, created_at)
            VALUES (?, ?, ?, ?)
          `).run(invitation.tenantId, projectId, user.id, acceptedAt);
        }
        const updated = connection.prepare(`
          UPDATE organization_invitations SET status = 'accepted', accepted_at = ?
          WHERE invitation_id = ? AND status = 'pending'
        `).run(acceptedAt, invitation.id);
        if (updated.changes !== 1) {
          throw new OrganizationError('邀请已处理，不能重复接受', 'ORG_INVITATION_NOT_PENDING', 409);
        }
        insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: invitation.tenantId,
          type: 'member.invitation_accepted',
          actorUserId: user.id,
          targetId: invitation.id,
          details: { email: invitation.email, role: invitation.role, projectIds: invitation.projectIds },
          createdAt: acceptedAt,
        });
      });
      return toOrganizationMember(user, acceptedAt, invitation.projectIds);
    },

    revokeInvitation(context: AuthContext, invitationId: string): OrganizationInvitation {
      requirePermission(context, 'member.manage', { tenantId: context.tenantId });
      if (!/^invitation-[a-f0-9-]{36}$/.test(invitationId)) invalidInvitation('邀请编号无效');
      const value = connection.prepare(`
        SELECT * FROM organization_invitations WHERE tenant_id = ? AND invitation_id = ?
      `).get(context.tenantId, invitationId);
      if (!value) throw new OrganizationError('邀请不存在', 'ORG_INVITATION_NOT_FOUND', 404);
      const invitation = parseInvitationRow(value);
      if (invitation.status === 'canceled') return invitation;
      if (invitation.status !== 'pending') {
        throw new OrganizationError('邀请已处理，不能撤销', 'ORG_INVITATION_NOT_PENDING', 409);
      }
      const canceledAt = now();
      transaction(connection, () => {
        connection.prepare(`
          UPDATE organization_invitations SET status = 'canceled', canceled_at = ?
          WHERE tenant_id = ? AND invitation_id = ? AND status = 'pending'
        `).run(canceledAt, context.tenantId, invitationId);
        invitationDelivery?.cancel(invitationId, canceledAt);
        insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'member.invitation_canceled',
          actorUserId: context.userId,
          targetId: invitationId,
          details: { email: invitation.email },
          createdAt: canceledAt,
        });
      });
      return { ...invitation, status: 'canceled', canceledAt };
    },

    listMembers(context: AuthContext): OrganizationMember[] {
      requirePermission(context, 'member.manage', { tenantId: context.tenantId });
      return connection.prepare(`
        SELECT * FROM organization_users
        WHERE tenant_id = ? ORDER BY created_at ASC, user_id ASC
      `).all(context.tenantId).map((row) => parseMemberRow(connection, row));
    },

    updateMember(context: AuthContext, userId: string, input: {
      role?: AuthRole;
      status?: AuthUser['status'];
      projectIds?: string[];
    }): OrganizationMember {
      requirePermission(context, 'member.manage', { tenantId: context.tenantId });
      if (!/^user-[a-f0-9-]{36}$/.test(userId)) invalidMember('成员编号无效');
      const row = connection.prepare(`
        SELECT * FROM organization_users WHERE tenant_id = ? AND user_id = ?
      `).get(context.tenantId, userId);
      if (!row) throw new OrganizationError('成员不存在', 'ORG_MEMBER_NOT_FOUND', 404);
      const current = parseMemberRow(connection, row);
      if (input.status !== undefined && !['active', 'disabled'].includes(input.status)) {
        invalidMember('成员状态无效');
      }
      if (input.status === 'disabled' && context.userId === userId) {
        throw new OrganizationError('不能停用当前登录成员', 'ORG_MEMBER_SELF_DISABLE', 409);
      }
      if (input.role !== undefined && !['admin', 'creator', 'reviewer', 'viewer'].includes(input.role)) {
        invalidMember('成员角色无效');
      }
      if (input.role === 'admin' && !current.mfaEnabled) {
        throw new OrganizationError('成员启用多因素认证后才能设为管理员', 'ORG_MEMBER_MFA_REQUIRED', 409);
      }
      const nextProjectIds = input.projectIds === undefined
        ? current.projectIds
        : validateMemberProjects(connection, context.tenantId, input.projectIds);
      if (input.role === undefined && input.status === undefined && input.projectIds === undefined) {
        invalidMember('至少需要修改一个成员字段');
      }
      const nextRole = (input.role ?? current.role) as OrganizationMember['role'];
      const nextStatus = input.status ?? current.status;
      const roleChanged = nextRole !== current.role;
      const statusChanged = nextStatus !== current.status;
      const projectsChanged = !sameStringSet(nextProjectIds, current.projectIds);
      if (!roleChanged && !statusChanged && !projectsChanged) return current;
      const updatedAt = now();
      transaction(connection, () => {
        connection.prepare(`
          UPDATE organization_users SET role = ?, status = ?, updated_at = ?
          WHERE tenant_id = ? AND user_id = ?
        `).run(nextRole, nextStatus, updatedAt, context.tenantId, userId);
        if (projectsChanged) {
          connection.prepare(`
            DELETE FROM organization_project_members WHERE tenant_id = ? AND user_id = ?
          `).run(context.tenantId, userId);
          for (const projectId of nextProjectIds) {
            connection.prepare(`
              INSERT INTO organization_project_members (tenant_id, project_id, user_id, created_at)
              VALUES (?, ?, ?, ?)
            `).run(context.tenantId, projectId, userId, updatedAt);
          }
        }
        if (roleChanged) insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'member.role_changed',
          actorUserId: context.userId,
          targetId: userId,
          details: { from: current.role, to: nextRole },
          createdAt: updatedAt,
        });
        if (projectsChanged) insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'member.projects_changed',
          actorUserId: context.userId,
          targetId: userId,
          details: { from: current.projectIds, to: nextProjectIds },
          createdAt: updatedAt,
        });
        if (statusChanged) insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: context.tenantId,
          type: 'member.status_changed',
          actorUserId: context.userId,
          targetId: userId,
          details: { from: current.status, to: nextStatus },
          createdAt: updatedAt,
        });
      });
      return {
        ...current,
        role: nextRole,
        status: nextStatus,
        projectIds: [...nextProjectIds],
        updatedAt,
      };
    },

    recordSuccessfulLogin(user: AuthUser, at = now()): void {
      const row = connection.prepare(`
        SELECT first_login_at FROM organization_users
        WHERE tenant_id = ? AND user_id = ?
      `).get(user.tenantId, user.id) as { first_login_at?: string | null } | undefined;
      transaction(connection, () => {
        const firstLogin = row
          ? connection.prepare(`
            UPDATE organization_users SET first_login_at = ?, updated_at = ?
            WHERE tenant_id = ? AND user_id = ? AND first_login_at IS NULL
          `).run(at, at, user.tenantId, user.id).changes === 1
          : !connection.prepare(`
              SELECT 1 FROM organization_audit_events
              WHERE tenant_id = ? AND event_type = 'auth.login_succeeded' AND target_id = ?
              LIMIT 1
            `).get(user.tenantId, user.id);
        insertAudit(connection, {
          id: `org-event-${randomUUID()}`,
          tenantId: user.tenantId,
          type: 'auth.login_succeeded',
          actorUserId: user.id,
          targetId: user.id,
          details: { firstLogin },
          createdAt: at,
        });
      });
    },

    findUserByEmail(email: string): AuthUser | undefined {
      return findUserByEmail(connection, email);
    },

    findUserById(userId: string): AuthUser | undefined {
      const row = connection.prepare(`
        SELECT * FROM organization_users WHERE user_id = ?
      `).get(userId);
      return row ? parseUserRow(row) : undefined;
    },

    listAuditEvents(context: AuthContext): OrganizationAuditEvent[] {
      requirePermission(context, 'audit.view', { tenantId: context.tenantId });
      return connection.prepare(`
        SELECT * FROM organization_audit_events
        WHERE tenant_id = ? ORDER BY created_at ASC, event_id ASC
      `).all(context.tenantId).map(parseAuditRow);
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;

function parseProjectRow(value: unknown): OrganizationProject {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.project_id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    ...(row.default_brand ? { defaultBrand: String(row.default_brand) } : {}),
    ...(row.default_sku ? { defaultSku: String(row.default_sku) } : {}),
    ownerUserId: String(row.owner_user_id),
    reviewRequired: row.review_required === 1,
    status: String(row.status) as OrganizationProject['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseInvitationRow(value: unknown): OrganizationInvitation {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.invitation_id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    ...(row.display_name ? { displayName: String(row.display_name) } : {}),
    role: String(row.role) as OrganizationInvitation['role'],
    projectIds: JSON.parse(String(row.project_ids_json)) as string[],
    status: String(row.status) as OrganizationInvitation['status'],
    deliveryStatus: String(row.delivery_status) as OrganizationInvitation['deliveryStatus'],
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    ...(row.accepted_at ? { acceptedAt: String(row.accepted_at) } : {}),
    ...(row.canceled_at ? { canceledAt: String(row.canceled_at) } : {}),
  };
}

function parseUserRow(value: unknown): AuthUser {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.user_id),
    tenantId: String(row.tenant_id),
    email: String(row.email),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
    role: String(row.role) as AuthUser['role'],
    status: String(row.status) as AuthUser['status'],
    projectIds: [],
    mfaEnabled: row.mfa_enabled === 1,
    ...(row.mfa_secret ? { mfaSecret: String(row.mfa_secret) } : {}),
  };
}

function findUserByEmail(
  connection: PiasDatabase['connection'],
  emailInput: string,
): AuthUser | undefined {
  const row = connection.prepare(`
    SELECT * FROM organization_users WHERE email = ? COLLATE NOCASE
  `).get(emailInput.trim().toLocaleLowerCase());
  return row ? parseUserRow(row) : undefined;
}

function toOrganizationMember(
  user: AuthUser,
  createdAt: string,
  projectIds: string[],
): OrganizationMember {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    displayName: user.displayName,
    role: user.role as OrganizationMember['role'],
    status: user.status,
    projectIds: [...projectIds],
    mfaEnabled: user.mfaEnabled,
    createdAt,
    updatedAt: createdAt,
  };
}

function parseMemberRow(
  connection: PiasDatabase['connection'],
  value: unknown,
): OrganizationMember {
  const row = value as Record<string, unknown>;
  const user = parseUserRow(row);
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    displayName: user.displayName,
    role: user.role as OrganizationMember['role'],
    status: user.status,
    projectIds: connection.prepare(`
      SELECT project_id FROM organization_project_members
      WHERE tenant_id = ? AND user_id = ? ORDER BY project_id ASC
    `).all(user.tenantId, user.id).map((projectRow) => (
      String((projectRow as Record<string, unknown>).project_id)
    )),
    mfaEnabled: user.mfaEnabled,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.first_login_at ? { firstLoginAt: String(row.first_login_at) } : {}),
  };
}

function validateMemberProjects(
  connection: PiasDatabase['connection'],
  tenantId: string,
  input: string[],
): string[] {
  const projectIds = [...new Set(input)];
  if (
    projectIds.length === 0
    || projectIds.length > 100
    || projectIds.some((id) => !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id))
  ) invalidMember('必须分配至少一个有效项目');
  for (const projectId of projectIds) {
    const project = connection.prepare(`
      SELECT 1 FROM organization_projects
      WHERE tenant_id = ? AND project_id = ? AND status = 'active'
    `).get(tenantId, projectId);
    if (!project) invalidMember('成员项目不存在或已归档');
  }
  return projectIds.sort();
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

function resolveInvitationByToken(
  connection: PiasDatabase['connection'],
  token: string,
): OrganizationInvitation {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) invalidInvitationToken();
  const row = connection.prepare(`
    SELECT * FROM organization_invitations WHERE token_hash = ?
  `).get(hashInvitationToken(token));
  if (!row) invalidInvitationToken();
  return parseInvitationRow(row);
}

function assertInvitationPending(
  connection: PiasDatabase['connection'],
  invitation: OrganizationInvitation,
  at: string,
  invitationDelivery?: OrganizationInvitationDelivery,
): void {
  if (invitation.status !== 'pending') {
    throw new OrganizationError('邀请已处理，不能重复使用', 'ORG_INVITATION_NOT_PENDING', 409);
  }
  if (Date.parse(invitation.expiresAt) > Date.parse(at)) return;
  expireInvitation(connection, invitation, at, invitationDelivery);
  throw new OrganizationError('邀请已过期', 'ORG_INVITATION_EXPIRED', 410);
}

function expirePendingInvitations(
  connection: PiasDatabase['connection'],
  tenantId: string,
  at: string,
  invitationDelivery?: OrganizationInvitationDelivery,
): void {
  const rows = connection.prepare(`
    SELECT * FROM organization_invitations
    WHERE tenant_id = ? AND status = 'pending' AND expires_at <= ?
  `).all(tenantId, at);
  for (const row of rows) {
    expireInvitation(connection, parseInvitationRow(row), at, invitationDelivery);
  }
}

function expireInvitation(
  connection: PiasDatabase['connection'],
  invitation: OrganizationInvitation,
  at: string,
  invitationDelivery?: OrganizationInvitationDelivery,
): void {
  transaction(connection, () => {
    const result = connection.prepare(`
      UPDATE organization_invitations SET status = 'expired'
      WHERE invitation_id = ? AND status = 'pending'
    `).run(invitation.id);
    if (result.changes !== 1) return;
    invitationDelivery?.cancel(invitation.id, at);
    insertAudit(connection, {
      id: `org-event-${randomUUID()}`,
      tenantId: invitation.tenantId,
      type: 'member.invitation_expired',
      actorUserId: 'system',
      targetId: invitation.id,
      details: { email: invitation.email },
      createdAt: at,
    });
  });
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function validateMfaSetup(
  secretInput: string | undefined,
  codeInput: string | undefined,
  at: number,
): string {
  const secret = secretInput?.trim().toUpperCase() ?? '';
  const code = codeInput?.trim() ?? '';
  if (!/^[A-Z2-7]{16,128}$/.test(secret) || !verifyTotpCode(secret, code, at)) {
    throw new OrganizationError(
      '管理员必须配置有效的多因素认证',
      'ORG_INVITATION_MFA_INVALID',
      400,
    );
  }
  return secret;
}

function invalidInvitationToken(): never {
  throw new OrganizationError('邀请链接无效', 'ORG_INVITATION_TOKEN_INVALID', 404);
}

function parseAuditRow(value: unknown): OrganizationAuditEvent {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.event_id),
    tenantId: String(row.tenant_id),
    type: String(row.event_type) as OrganizationAuditEvent['type'],
    actorUserId: String(row.actor_user_id),
    targetId: String(row.target_id),
    details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

function insertAudit(connection: PiasDatabase['connection'], event: OrganizationAuditEvent): void {
  connection.prepare(`
    INSERT INTO organization_audit_events (
      event_id, tenant_id, event_type, actor_user_id, target_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.tenantId,
    event.type,
    event.actorUserId,
    event.targetId,
    JSON.stringify(event.details),
    event.createdAt,
  );
}

function transaction(connection: PiasDatabase['connection'], action: () => void): void {
  connection.exec('BEGIN IMMEDIATE');
  try {
    action();
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

function boundedText(
  input: string,
  minimum: number,
  maximum: number,
  label: string,
  code: 'ORG_PROJECT_INVALID' | 'ORG_INVITATION_INVALID',
): string {
  const value = input.trim();
  if (value.length < minimum || value.length > maximum) {
    throw new OrganizationError(`${label}必须为 ${minimum}-${maximum} 个字符`, code, 400);
  }
  return value;
}

function optionalText(
  input: string | undefined,
  maximum: number,
  label: string,
  code: 'ORG_PROJECT_INVALID' | 'ORG_INVITATION_INVALID',
): string | undefined {
  if (input === undefined) return undefined;
  const value = input.trim();
  if (value.length > maximum) {
    throw new OrganizationError(`${label}不能超过 ${maximum} 个字符`, code, 400);
  }
  return value || undefined;
}

function invalidProject(message: string): never {
  throw new OrganizationError(message, 'ORG_PROJECT_INVALID', 400);
}

function invalidInvitation(message: string): never {
  throw new OrganizationError(message, 'ORG_INVITATION_INVALID', 400);
}

function invalidMember(message: string): never {
  throw new OrganizationError(message, 'ORG_MEMBER_INVALID', 400);
}
