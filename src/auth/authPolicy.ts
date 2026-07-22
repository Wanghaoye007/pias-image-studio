export type AuthRole =
  | 'owner'
  | 'admin'
  | 'creator'
  | 'reviewer'
  | 'viewer'
  | 'platform_operator';

export type Permission =
  | 'tenant.manage'
  | 'tenant.delete'
  | 'member.manage'
  | 'project.view'
  | 'project.edit'
  | 'asset.view'
  | 'asset.edit'
  | 'job.create'
  | 'job.cancel_own'
  | 'job.cancel_any'
  | 'review.submit'
  | 'review.decide'
  | 'export.preview'
  | 'export.production'
  | 'usage.view'
  | 'audit.view';

export type AuthContext = {
  userId: string;
  tenantId: string;
  role: AuthRole;
  projectIds: string[];
  mfaVerified: boolean;
};

export type ResourceScope = {
  tenantId: string;
  projectId?: string;
};

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: 'forbidden' | 'mfa_required' | 'not_found' };

const privilegedRoles = new Set<AuthRole>(['owner', 'admin', 'platform_operator']);

const rolePermissions: Record<AuthRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    'tenant.manage', 'tenant.delete', 'member.manage', 'project.view', 'project.edit',
    'asset.view', 'asset.edit', 'job.create', 'job.cancel_own', 'job.cancel_any',
    'review.submit', 'review.decide', 'export.preview', 'export.production',
    'usage.view', 'audit.view',
  ]),
  admin: new Set<Permission>([
    'member.manage', 'project.view', 'project.edit', 'asset.view', 'asset.edit',
    'job.create', 'job.cancel_own', 'job.cancel_any', 'review.submit', 'review.decide',
    'export.preview', 'export.production', 'usage.view', 'audit.view',
  ]),
  creator: new Set<Permission>([
    'project.view', 'project.edit', 'asset.view', 'asset.edit', 'job.create',
    'job.cancel_own', 'review.submit', 'export.preview', 'export.production', 'usage.view',
  ]),
  reviewer: new Set<Permission>([
    'project.view', 'asset.view', 'review.decide', 'export.preview', 'export.production', 'usage.view',
  ]),
  viewer: new Set<Permission>(['project.view', 'asset.view', 'export.preview']),
  platform_operator: new Set<Permission>([]),
};

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly code: 'AUTH_FORBIDDEN' | 'AUTH_MFA_REQUIRED' | 'AUTH_RESOURCE_NOT_FOUND',
    readonly statusCode: 403 | 404,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export function authorize(
  context: AuthContext,
  permission: Permission,
  scope: ResourceScope,
): AuthorizationDecision {
  if (context.tenantId !== scope.tenantId) {
    return { allowed: false, reason: 'not_found' };
  }
  if (privilegedRoles.has(context.role) && !context.mfaVerified) {
    return { allowed: false, reason: 'mfa_required' };
  }
  if (!rolePermissions[context.role].has(permission)) {
    return { allowed: false, reason: 'forbidden' };
  }
  if (
    scope.projectId
    && context.role !== 'owner'
    && context.role !== 'admin'
    && !context.projectIds.includes(scope.projectId)
  ) {
    return { allowed: false, reason: 'not_found' };
  }
  return { allowed: true };
}

export function requirePermission(
  context: AuthContext,
  permission: Permission,
  scope: ResourceScope,
): void {
  const decision = authorize(context, permission, scope);
  if (decision.allowed) return;
  if (decision.reason === 'not_found') {
    throw new AuthorizationError('资源不存在或无权访问', 'AUTH_RESOURCE_NOT_FOUND', 404);
  }
  if (decision.reason === 'mfa_required') {
    throw new AuthorizationError('需要完成多因素认证', 'AUTH_MFA_REQUIRED', 403);
  }
  throw new AuthorizationError('没有执行该操作的权限', 'AUTH_FORBIDDEN', 403);
}
