import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { AuthContext } from './authPolicy';
import type { AuthRole, PublicAuthUser } from '../../shared/auth/types';

export type { PublicAuthUser } from '../../shared/auth/types';

export type AuthUserStatus = 'active' | 'disabled';

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: AuthRole;
  status: AuthUserStatus;
  projectIds: string[];
  mfaEnabled: boolean;
  mfaSecret?: string;
};

export type LoginResult =
  | { status: 'mfa_required'; challengeToken: string; expiresAt: string }
  | { status: 'authenticated'; sessionToken: string; csrfToken: string; expiresAt: string };

export type IdentityUserResolver = {
  findByEmail(email: string): AuthUser | undefined;
  findById(userId: string): AuthUser | undefined;
};

export type LoginAuditRecorder = (user: AuthUser, at: string) => void;

type SessionRecord = {
  tokenHash: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  mfaVerified: boolean;
  csrfTokenHash: string;
};

type ChallengeRecord = {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
};

type FailureRecord = {
  attempts: number;
  lockedUntil: number;
};

const passwordSaltBytes = 16;
const passwordKeyBytes = 32;
const scryptN = 16_384;
const scryptR = 8;
const scryptP = 1;
const mfaChallengeLifetimeMs = 5 * 60_000;
const sessionIdleLifetimeMs = 30 * 60_000;
const sessionAbsoluteLifetimeMs = 12 * 60 * 60_000;
const totpStepMs = 30_000;
const privilegedRoles = new Set<AuthRole>(['owner', 'admin', 'platform_operator']);
const commonPasswords = new Set([
  'password123456',
  '123456789012',
  'qwerty123456',
  'admin12345678',
  'pias12345678',
]);

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

export function validatePasswordPolicy(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push('密码至少 12 位');
  if (commonPasswords.has(password.toLocaleLowerCase())) errors.push('不能使用常见密码');
  return errors;
}

export async function hashPassword(password: string): Promise<string> {
  const policyErrors = validatePasswordPolicy(password);
  if (policyErrors.length > 0) {
    throw new IdentityError(policyErrors.join('；'), 'AUTH_PASSWORD_POLICY_FAILED', 400);
  }
  const salt = randomBytes(passwordSaltBytes);
  const hash = derivePasswordKey(password, salt);
  return `scrypt$${scryptN}$${scryptR}$${scryptP}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function generateTotp(secret: string, now = Date.now()): string {
  return totpForCounter(secret, Math.floor(now / totpStepMs));
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()): boolean {
  return findTotpCounter(secret, code, now) !== null;
}

export class IdentityService {
  private readonly usersById = new Map<string, AuthUser>();
  private readonly userIdsByEmail = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly failures = new Map<string, FailureRecord>();
  private readonly lastTotpCounter = new Map<string, number>();
  private readonly now: () => number;
  private projectAccessResolver: ((tenantId: string, userId: string) => string[]) | null = null;
  private userResolver: IdentityUserResolver | null = null;
  private loginAuditRecorder: LoginAuditRecorder | null = null;

  constructor(users: AuthUser[], options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    for (const input of users) {
      const user = { ...input, email: normalizeEmail(input.email), projectIds: [...input.projectIds] };
      if (this.usersById.has(user.id) || this.userIdsByEmail.has(user.email)) {
        throw new IdentityError('用户 ID 或邮箱重复', 'AUTH_CONFIG_INVALID', 500);
      }
      this.usersById.set(user.id, user);
      this.userIdsByEmail.set(user.email, user.id);
    }
  }

  async beginLogin(emailInput: string, password: string): Promise<LoginResult> {
    const email = normalizeEmail(emailInput);
    const now = this.now();
    const failure = this.failures.get(email);
    if (failure && failure.lockedUntil > now) {
      throw new IdentityError('登录尝试过多，请稍后再试', 'AUTH_RATE_LIMITED', 429);
    }

    const user = this.resolveUserByEmail(email);
    const passwordValid = verifyPassword(password, user?.passwordHash ?? fakePasswordHash);
    if (!user || user.status !== 'active' || !passwordValid) {
      this.recordFailure(email, now);
      const nextFailure = this.failures.get(email);
      if (nextFailure && nextFailure.lockedUntil > now) {
        throw new IdentityError('登录尝试过多，请稍后再试', 'AUTH_RATE_LIMITED', 429);
      }
      throw new IdentityError('邮箱或密码不正确', 'AUTH_INVALID_CREDENTIALS', 401);
    }

    this.failures.delete(email);
    const requiresMfa = privilegedRoles.has(user.role) || user.mfaEnabled;
    if (requiresMfa) {
      if (!user.mfaEnabled || !user.mfaSecret) {
        throw new IdentityError('账户必须先配置多因素认证', 'AUTH_MFA_SETUP_REQUIRED', 403);
      }
      const challengeToken = createToken();
      const expiresAt = now + mfaChallengeLifetimeMs;
      const tokenHash = hashToken(challengeToken);
      this.challenges.set(tokenHash, {
        tokenHash,
        userId: user.id,
        createdAt: now,
        expiresAt,
        attempts: 0,
      });
      return {
        status: 'mfa_required',
        challengeToken,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    }

    return this.createSession(user, false);
  }

  completeMfa(challengeToken: string, code: string): Extract<LoginResult, { status: 'authenticated' }> {
    const tokenHash = hashToken(challengeToken);
    const challenge = this.challenges.get(tokenHash);
    const now = this.now();
    if (!challenge) {
      throw new IdentityError('MFA 挑战无效', 'AUTH_MFA_CHALLENGE_INVALID', 401);
    }
    if (now > challenge.expiresAt) {
      this.challenges.delete(tokenHash);
      throw new IdentityError('MFA 挑战已过期', 'AUTH_MFA_CHALLENGE_EXPIRED', 401);
    }
    const user = this.resolveUserById(challenge.userId);
    if (!user || user.status !== 'active' || !user.mfaSecret || !user.mfaEnabled) {
      this.challenges.delete(tokenHash);
      throw new IdentityError('MFA 挑战无效', 'AUTH_MFA_CHALLENGE_INVALID', 401);
    }

    const counter = findTotpCounter(user.mfaSecret, code, now);
    if (counter === null) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) this.challenges.delete(tokenHash);
      throw new IdentityError('验证码不正确', 'AUTH_MFA_CODE_INVALID', 401);
    }
    const lastCounter = this.lastTotpCounter.get(user.id);
    if (lastCounter !== undefined && counter <= lastCounter) {
      this.challenges.delete(tokenHash);
      throw new IdentityError('验证码已使用', 'AUTH_MFA_REPLAYED', 401);
    }

    this.lastTotpCounter.set(user.id, counter);
    this.challenges.delete(tokenHash);
    return this.createSession(user, true);
  }

  authenticateSession(sessionToken: string): AuthContext {
    const tokenHash = hashToken(sessionToken);
    const session = this.sessions.get(tokenHash);
    const now = this.now();
    if (!session) {
      throw new IdentityError('会话无效', 'AUTH_SESSION_INVALID', 401);
    }
    if (now > session.expiresAt || now - session.lastSeenAt > sessionIdleLifetimeMs) {
      this.sessions.delete(tokenHash);
      throw new IdentityError('会话已过期', 'AUTH_SESSION_EXPIRED', 401);
    }
    const user = this.resolveUserById(session.userId);
    if (!user || user.status !== 'active') {
      this.sessions.delete(tokenHash);
      throw new IdentityError('会话无效', 'AUTH_SESSION_INVALID', 401);
    }

    session.lastSeenAt = now;
    return {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      projectIds: this.effectiveProjectIds(user),
      mfaVerified: session.mfaVerified,
    };
  }

  setProjectAccessResolver(
    resolver: ((tenantId: string, userId: string) => string[]) | null,
  ): void {
    this.projectAccessResolver = resolver;
  }

  setUserResolver(resolver: IdentityUserResolver | null): void {
    this.userResolver = resolver;
  }

  setLoginAuditRecorder(recorder: LoginAuditRecorder | null): void {
    this.loginAuditRecorder = recorder;
  }

  hasUserEmail(emailInput: string): boolean {
    return this.resolveUserByEmail(normalizeEmail(emailInput)) !== undefined;
  }

  revokeSession(sessionToken: string): void {
    this.sessions.delete(hashToken(sessionToken));
  }

  verifyCsrf(sessionToken: string, csrfToken: string): void {
    const session = this.sessions.get(hashToken(sessionToken));
    if (!session || !secureHashMatch(session.csrfTokenHash, hashToken(csrfToken))) {
      throw new IdentityError('请求验证失败', 'AUTH_CSRF_INVALID', 403);
    }
  }

  getUserProfile(userId: string): PublicAuthUser {
    const user = this.resolveUserById(userId);
    if (!user || user.status !== 'active') {
      throw new IdentityError('用户不存在', 'AUTH_USER_NOT_FOUND', 404);
    }
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      projectIds: this.effectiveProjectIds(user),
      mfaEnabled: user.mfaEnabled,
    };
  }

  revokeAllSessions(userId: string): void {
    for (const [tokenHash, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(tokenHash);
    }
  }

  updateUserStatus(userId: string, status: AuthUserStatus): void {
    const user = this.usersById.get(userId);
    if (!user) throw new IdentityError('用户不存在', 'AUTH_USER_NOT_FOUND', 404);
    user.status = status;
    if (status === 'disabled') this.revokeAllSessions(userId);
  }

  private effectiveProjectIds(user: AuthUser): string[] {
    const dynamic = this.projectAccessResolver?.(user.tenantId, user.id) ?? [];
    return [...new Set([...user.projectIds, ...dynamic])].filter((projectId) => (
      /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(projectId)
    ));
  }

  private resolveUserByEmail(email: string): AuthUser | undefined {
    const staticUserId = this.userIdsByEmail.get(email);
    if (staticUserId) return this.usersById.get(staticUserId);
    return this.userResolver?.findByEmail(email);
  }

  private resolveUserById(userId: string): AuthUser | undefined {
    return this.usersById.get(userId) ?? this.userResolver?.findById(userId);
  }

  private createSession(
    user: AuthUser,
    mfaVerified: boolean,
  ): Extract<LoginResult, { status: 'authenticated' }> {
    const now = this.now();
    const sessionToken = createToken();
    const csrfToken = createToken();
    const tokenHash = hashToken(sessionToken);
    const expiresAt = now + sessionAbsoluteLifetimeMs;
    this.loginAuditRecorder?.(user, new Date(now).toISOString());
    this.sessions.set(tokenHash, {
      tokenHash,
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      mfaVerified,
      csrfTokenHash: hashToken(csrfToken),
    });
    return {
      status: 'authenticated',
      sessionToken,
      csrfToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  private recordFailure(email: string, now: number): void {
    const previous = this.failures.get(email);
    const attempts = (previous?.attempts ?? 0) + 1;
    const lockMinutes = attempts >= 5 ? Math.min(15, 2 ** (attempts - 5)) : 0;
    this.failures.set(email, {
      attempts,
      lockedUntil: lockMinutes > 0 ? now + lockMinutes * 60_000 : 0,
    });
  }
}

const fakePasswordHash = (() => {
  const salt = Buffer.alloc(passwordSaltBytes, 7);
  const hash = derivePasswordKey('invalid-password-value', salt);
  return `scrypt$${scryptN}$${scryptR}$${scryptP}$${salt.toString('hex')}$${hash.toString('hex')}`;
})();

function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (n !== scryptN || r !== scryptR || p !== scryptP) return false;
  try {
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    const actual = derivePasswordKey(password, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function derivePasswordKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, passwordKeyBytes, {
    N: scryptN,
    r: scryptR,
    p: scryptP,
    maxmem: 64 * 1024 * 1024,
  });
}

function createToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function secureHashMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

function findTotpCounter(secret: string, code: string, now: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentCounter = Math.floor(now / totpStepMs);
  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    const expected = totpForCounter(secret, counter);
    if (timingSafeEqual(Buffer.from(code), Buffer.from(expected))) return counter;
  }
  return null;
}

function totpForCounter(secret: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new IdentityError('MFA Secret 格式无效', 'AUTH_CONFIG_INVALID', 500);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}
