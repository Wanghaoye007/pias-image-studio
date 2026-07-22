import { readFileSync, statSync } from 'node:fs';
import { IdentityError, IdentityService, type AuthUser } from './identityService';
import type { AuthRole } from './authPolicy';

const roles = new Set<AuthRole>([
  'owner', 'admin', 'creator', 'reviewer', 'viewer', 'platform_operator',
]);

export function loadIdentityServiceFromConfig(filePath?: string): IdentityService | null {
  if (!filePath?.trim()) return null;
  try {
    const stats = statSync(filePath);
    if ((stats.mode & 0o077) !== 0) {
      throw new IdentityError('身份配置文件权限必须为 0600', 'AUTH_CONFIG_PERMISSIONS_INVALID', 500);
    }
    const document = asRecord(JSON.parse(readFileSync(filePath, 'utf8')), '配置');
    if (document.schemaVersion !== 1 || !Array.isArray(document.users)) {
      throw new IdentityError('身份配置格式无效', 'AUTH_CONFIG_INVALID', 500);
    }
    const users = document.users.map((value, index) => parseUser(value, index));
    if (users.length === 0) {
      throw new IdentityError('身份配置至少需要一个用户', 'AUTH_CONFIG_INVALID', 500);
    }
    return new IdentityService(users);
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('无法加载身份配置', 'AUTH_CONFIG_INVALID', 500);
  }
}

function parseUser(value: unknown, index: number): AuthUser {
  const record = asRecord(value, `users[${index}]`);
  if ('password' in record) {
    throw new IdentityError('身份配置禁止保存明文密码', 'AUTH_CONFIG_PLAINTEXT_PASSWORD', 500);
  }
  const role = requireString(record.role, 'role') as AuthRole;
  if (!roles.has(role)) throw new IdentityError('用户角色无效', 'AUTH_CONFIG_INVALID', 500);
  const status = requireString(record.status, 'status');
  if (status !== 'active' && status !== 'disabled') {
    throw new IdentityError('用户状态无效', 'AUTH_CONFIG_INVALID', 500);
  }
  const passwordHash = requireString(record.passwordHash, 'passwordHash');
  if (!/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(passwordHash)) {
    throw new IdentityError('密码哈希格式无效', 'AUTH_CONFIG_INVALID', 500);
  }
  if (
    !Array.isArray(record.projectIds)
    || record.projectIds.some((item) => (
      typeof item !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(item)
    ))
    || new Set(record.projectIds).size !== record.projectIds.length
  ) {
    throw new IdentityError('项目范围无效', 'AUTH_CONFIG_INVALID', 500);
  }
  if (role !== 'platform_operator' && record.projectIds.length === 0) {
    throw new IdentityError('业务用户必须至少分配一个项目', 'AUTH_CONFIG_INVALID', 500);
  }
  if (typeof record.mfaEnabled !== 'boolean') {
    throw new IdentityError('MFA 配置无效', 'AUTH_CONFIG_INVALID', 500);
  }
  const mfaSecret = record.mfaSecret === undefined ? undefined : requireString(record.mfaSecret, 'mfaSecret');
  if (record.mfaEnabled && (!mfaSecret || !/^[A-Z2-7]+=*$/i.test(mfaSecret))) {
    throw new IdentityError('MFA Secret 格式无效', 'AUTH_CONFIG_INVALID', 500);
  }
  return {
    id: requireString(record.id, 'id'),
    tenantId: requireString(record.tenantId, 'tenantId'),
    email: requireString(record.email, 'email'),
    displayName: requireString(record.displayName, 'displayName'),
    passwordHash,
    role,
    status,
    projectIds: [...record.projectIds] as string[],
    mfaEnabled: record.mfaEnabled,
    ...(mfaSecret ? { mfaSecret } : {}),
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IdentityError(`${label}必须是对象`, 'AUTH_CONFIG_INVALID', 500);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IdentityError(`${label}不能为空`, 'AUTH_CONFIG_INVALID', 500);
  }
  return value.trim();
}
