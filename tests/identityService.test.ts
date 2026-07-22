import { describe, expect, it } from 'vitest';
import {
  IdentityError,
  IdentityService,
  generateTotp,
  hashPassword,
  validatePasswordPolicy,
  type AuthUser,
} from '../src/auth/identityService';

const strongPassword = 'PIAS-release-2026!';
const totpSecret = 'JBSWY3DPEHPK3PXP';

async function createUser(overrides: Partial<AuthUser> = {}): Promise<AuthUser> {
  return {
    id: 'user-owner',
    tenantId: 'tenant-a',
    email: 'owner@pias.test',
    displayName: 'PIAS Owner',
    passwordHash: await hashPassword(strongPassword),
    role: 'owner',
    status: 'active',
    projectIds: ['project-a'],
    mfaEnabled: true,
    mfaSecret: totpSecret,
    ...overrides,
  };
}

describe('identity service', () => {
  it('rejects short and common passwords', () => {
    expect(validatePasswordPolicy('short')).toContain('密码至少 12 位');
    expect(validatePasswordPolicy('password123456')).toContain('不能使用常见密码');
    expect(validatePasswordPolicy(strongPassword)).toEqual([]);
  });

  it('requires TOTP MFA for privileged users and returns a trusted context', async () => {
    const now = Date.parse('2026-07-22T03:00:00.000Z');
    const service = new IdentityService([await createUser()], { now: () => now });

    const login = await service.beginLogin('OWNER@PIAS.TEST', strongPassword);
    expect(login.status).toBe('mfa_required');
    if (login.status !== 'mfa_required') throw new Error('mfa challenge missing');

    const completed = service.completeMfa(login.challengeToken, generateTotp(totpSecret, now));
    expect(completed.csrfToken).toHaveLength(43);
    expect(service.authenticateSession(completed.sessionToken)).toMatchObject({
      userId: 'user-owner',
      tenantId: 'tenant-a',
      role: 'owner',
      mfaVerified: true,
    });
    expect(() => service.verifyCsrf(completed.sessionToken, 'wrong-csrf-token'))
      .toThrowError(expect.objectContaining({ code: 'AUTH_CSRF_INVALID' }));
    expect(() => service.verifyCsrf(completed.sessionToken, completed.csrfToken)).not.toThrow();
  });

  it('prevents reuse of a TOTP time step', async () => {
    const now = Date.parse('2026-07-22T03:00:00.000Z');
    const service = new IdentityService([await createUser()], { now: () => now });
    const first = await service.beginLogin('owner@pias.test', strongPassword);
    if (first.status !== 'mfa_required') throw new Error('mfa challenge missing');
    service.completeMfa(first.challengeToken, generateTotp(totpSecret, now));

    const second = await service.beginLogin('owner@pias.test', strongPassword);
    if (second.status !== 'mfa_required') throw new Error('mfa challenge missing');
    expect(() => service.completeMfa(second.challengeToken, generateTotp(totpSecret, now)))
      .toThrowError(expect.objectContaining({ code: 'AUTH_MFA_REPLAYED' }));
  });

  it('progressively locks an account after five failed passwords', async () => {
    let now = Date.parse('2026-07-22T03:00:00.000Z');
    const service = new IdentityService([await createUser()], { now: () => now });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(service.beginLogin('owner@pias.test', 'wrong-password-value'))
        .rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    await expect(service.beginLogin('owner@pias.test', 'wrong-password-value'))
      .rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED' });
    await expect(service.beginLogin('owner@pias.test', strongPassword))
      .rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED' });

    now += 61_000;
    await expect(service.beginLogin('owner@pias.test', strongPassword)).resolves.toMatchObject({
      status: 'mfa_required',
    });
  });

  it('invalidates idle, absolute-expired, revoked, and disabled-member sessions', async () => {
    let now = Date.parse('2026-07-22T03:00:00.000Z');
    const viewer = await createUser({
      id: 'user-viewer',
      email: 'viewer@pias.test',
      role: 'viewer',
      mfaEnabled: false,
      mfaSecret: undefined,
    });
    const service = new IdentityService([viewer], { now: () => now });

    const idleLogin = await service.beginLogin(viewer.email, strongPassword);
    if (idleLogin.status !== 'authenticated') throw new Error('session missing');
    now += 30 * 60_000 + 1;
    expect(() => service.authenticateSession(idleLogin.sessionToken))
      .toThrowError(expect.objectContaining({ code: 'AUTH_SESSION_EXPIRED' }));

    now += 1;
    const revokedLogin = await service.beginLogin(viewer.email, strongPassword);
    if (revokedLogin.status !== 'authenticated') throw new Error('session missing');
    service.revokeSession(revokedLogin.sessionToken);
    expect(() => service.authenticateSession(revokedLogin.sessionToken))
      .toThrowError(expect.objectContaining({ code: 'AUTH_SESSION_INVALID' }));

    const disabledLogin = await service.beginLogin(viewer.email, strongPassword);
    if (disabledLogin.status !== 'authenticated') throw new Error('session missing');
    service.updateUserStatus(viewer.id, 'disabled');
    expect(() => service.authenticateSession(disabledLogin.sessionToken))
      .toThrowError(expect.objectContaining({ code: 'AUTH_SESSION_INVALID' }));

    service.updateUserStatus(viewer.id, 'active');
    const absoluteLogin = await service.beginLogin(viewer.email, strongPassword);
    if (absoluteLogin.status !== 'authenticated') throw new Error('session missing');
    for (let interval = 0; interval < 24; interval += 1) {
      now += 29 * 60_000;
      service.authenticateSession(absoluteLogin.sessionToken);
    }
    now += 25 * 60_000 + 1;
    expect(() => service.authenticateSession(absoluteLogin.sessionToken))
      .toThrowError(expect.objectContaining({ code: 'AUTH_SESSION_EXPIRED' }));
  });

  it('uses a stable safe error type', () => {
    expect(new IdentityError('x', 'AUTH_INVALID_CREDENTIALS', 401)).toMatchObject({
      name: 'IdentityError',
      code: 'AUTH_INVALID_CREDENTIALS',
      statusCode: 401,
    });
  });

  it('merges persisted project memberships into sessions and public profiles', async () => {
    const user = await createUser({ role: 'viewer', mfaEnabled: false, mfaSecret: undefined });
    const service = new IdentityService([user]);
    service.setProjectAccessResolver((tenantId, userId) => (
      tenantId === 'tenant-a' && userId === user.id ? ['project-created'] : []
    ));
    const login = await service.beginLogin(user.email, strongPassword);
    if (login.status !== 'authenticated') throw new Error('session missing');

    expect(service.authenticateSession(login.sessionToken).projectIds)
      .toEqual(['project-a', 'project-created']);
    expect(service.getUserProfile(user.id).projectIds)
      .toEqual(['project-a', 'project-created']);
  });

  it('authenticates persisted organization users through an external resolver', async () => {
    const member = await createUser({
      id: 'user-persisted',
      email: 'persisted@pias.test',
      role: 'reviewer',
      mfaEnabled: false,
      mfaSecret: undefined,
      projectIds: [],
    });
    const service = new IdentityService([]);
    service.setUserResolver({
      findByEmail: (email) => email === member.email ? member : undefined,
      findById: (userId) => userId === member.id ? member : undefined,
    });
    service.setProjectAccessResolver((_tenantId, userId) => (
      userId === member.id ? ['project-persisted'] : []
    ));

    const login = await service.beginLogin('PERSISTED@PIAS.TEST', strongPassword);
    expect(login.status).toBe('authenticated');
    if (login.status !== 'authenticated') throw new Error('session missing');
    expect(service.authenticateSession(login.sessionToken)).toMatchObject({
      userId: member.id,
      role: 'reviewer',
      projectIds: ['project-persisted'],
    });
    expect(service.hasUserEmail(member.email)).toBe(true);
  });

  it('records every successful session creation without recording failed credentials', async () => {
    const viewer = await createUser({
      id: 'user-audited',
      email: 'audited@pias.test',
      role: 'viewer',
      mfaEnabled: false,
      mfaSecret: undefined,
    });
    const service = new IdentityService([viewer], {
      now: () => Date.parse('2026-07-22T09:00:00.000Z'),
    });
    const recorded: Array<{ userId: string; at: string }> = [];
    service.setLoginAuditRecorder((user, at) => recorded.push({ userId: user.id, at }));

    await expect(service.beginLogin(viewer.email, 'wrong-password-value')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    await service.beginLogin(viewer.email, strongPassword);
    await service.beginLogin(viewer.email, strongPassword);

    expect(recorded).toEqual([
      { userId: viewer.id, at: '2026-07-22T09:00:00.000Z' },
      { userId: viewer.id, at: '2026-07-22T09:00:00.000Z' },
    ]);
  });
});
