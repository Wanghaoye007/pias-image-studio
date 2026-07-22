import { describe, expect, it } from 'vitest';
import {
  authorize,
  requirePermission,
  type AuthContext,
  type Permission,
} from '../src/server/auth/authPolicy';

function context(role: AuthContext['role'], projectIds = ['project-a']): AuthContext {
  return {
    userId: `user-${role}`,
    tenantId: 'tenant-a',
    role,
    projectIds,
    mfaVerified: role === 'owner' || role === 'admin' || role === 'platform_operator',
  };
}

describe('authorization policy', () => {
  it('matches the PRD role matrix for sensitive actions', () => {
    const expectations: Array<[AuthContext['role'], Permission, boolean]> = [
      ['owner', 'member.manage', true],
      ['admin', 'member.manage', true],
      ['creator', 'asset.edit', true],
      ['creator', 'job.create', true],
      ['creator', 'review.decide', false],
      ['reviewer', 'review.decide', true],
      ['reviewer', 'job.create', false],
      ['viewer', 'project.view', true],
      ['viewer', 'asset.edit', false],
      ['platform_operator', 'project.view', false],
    ];

    expectations.forEach(([role, permission, allowed]) => {
      expect(authorize(context(role), permission, {
        tenantId: 'tenant-a',
        projectId: 'project-a',
      }).allowed).toBe(allowed);
    });
  });

  it('hides cross-tenant resources without disclosing their existence', () => {
    expect(authorize(context('owner'), 'project.view', {
      tenantId: 'tenant-b',
      projectId: 'project-secret',
    })).toEqual({ allowed: false, reason: 'not_found' });
  });

  it('requires project membership for scoped roles', () => {
    expect(authorize(context('creator'), 'project.view', {
      tenantId: 'tenant-a',
      projectId: 'project-private',
    })).toEqual({ allowed: false, reason: 'not_found' });
    expect(authorize(context('admin', []), 'project.view', {
      tenantId: 'tenant-a',
      projectId: 'project-private',
    }).allowed).toBe(true);
  });

  it('requires MFA for privileged roles before any tenant action', () => {
    const owner = { ...context('owner'), mfaVerified: false };

    expect(authorize(owner, 'project.view', {
      tenantId: 'tenant-a',
      projectId: 'project-a',
    })).toEqual({ allowed: false, reason: 'mfa_required' });
  });

  it('throws a stable authorization error for API guards', () => {
    expect(() => requirePermission(context('viewer'), 'job.create', {
      tenantId: 'tenant-a',
      projectId: 'project-a',
    })).toThrowError(expect.objectContaining({ code: 'AUTH_FORBIDDEN', statusCode: 403 }));
  });
});
