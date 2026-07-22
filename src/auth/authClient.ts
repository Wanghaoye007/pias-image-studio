import type { PublicAuthUser } from './identityService';

export type AuthSession =
  | { status: 'disabled' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: PublicAuthUser; expiresAt?: string };

export type AuthenticatedSession = Extract<AuthSession, { status: 'authenticated' }>;
export type ActiveAuthSession = Exclude<AuthSession, { status: 'anonymous' }>;

export type LoginResponse =
  | { status: 'mfa_required'; expiresAt: string }
  | { status: 'authenticated'; expiresAt: string; user: PublicAuthUser };

export class AuthClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AuthClientError';
  }
}

let activeProjectId = '';

export function getPreferredProjectId(projectIds: string[]): string {
  const remembered = readCookie('pias_project');
  return remembered && projectIds.includes(remembered) ? remembered : projectIds[0] ?? '';
}

export function setActiveProjectId(projectId: string): void {
  if (projectId && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(projectId)) {
    throw new AuthClientError('项目范围无效', 'AUTH_PROJECT_INVALID', 400);
  }
  activeProjectId = projectId;
  if (typeof document !== 'undefined') {
    document.cookie = projectId
      ? `pias_project=${encodeURIComponent(projectId)}; Path=/; SameSite=Strict`
      : 'pias_project=; Path=/; Max-Age=0; SameSite=Strict';
  }
}

export async function loadAuthSession(): Promise<AuthSession> {
  const response = await request('/api/auth/session', { method: 'GET' }, true);
  if (response.status === 503 && response.error?.code === 'AUTH_NOT_CONFIGURED') {
    return { status: 'disabled' };
  }
  if (response.status === 401) return { status: 'anonymous' };
  if (!response.ok) throw responseError(response);
  return { status: 'authenticated', user: parseUser(response.payload) };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return parseLoginResponse(await requiredJsonRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  }));
}

export async function completeMfa(code: string): Promise<LoginResponse> {
  return parseLoginResponse(await requiredJsonRequest('/api/auth/mfa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  }));
}

export async function logout(): Promise<void> {
  const response = await request('/api/auth/logout', withCsrfProtection({ method: 'POST' }), true);
  if (!response.ok) throw responseError(response);
}

export function withCsrfProtection(init: RequestInit = {}): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (activeProjectId) headers.set('x-pias-project-id', activeProjectId);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = readCookie('pias_csrf');
    if (token) headers.set('x-pias-csrf', token);
  }
  return { ...init, headers };
}

type RequestResult = {
  ok: boolean;
  status: number;
  payload: unknown;
  error: { code: string; message: string } | null;
};

async function requiredJsonRequest(url: string, init: RequestInit): Promise<unknown> {
  const response = await request(url, init);
  if (!response.ok) throw responseError(response);
  return response.payload;
}

async function request(url: string, init: RequestInit, allowEmpty = false): Promise<RequestResult> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new AuthClientError('无法连接身份服务', 'AUTH_NETWORK_ERROR', 0, { cause: error });
  }

  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch (error) {
      if (!allowEmpty) {
        throw new AuthClientError('身份服务返回无效', 'AUTH_RESPONSE_INVALID', 502, { cause: error });
      }
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
    error: parseError(payload),
  };
}

function parseLoginResponse(value: unknown): LoginResponse {
  const record = asRecord(value);
  const status = record.status;
  const expiresAt = requireString(record.expiresAt);
  if (status === 'mfa_required') return { status, expiresAt };
  if (status === 'authenticated') {
    return { status, expiresAt, user: parseUser(value) };
  }
  throw new AuthClientError('身份服务返回无效', 'AUTH_RESPONSE_INVALID', 502);
}

function parseUser(value: unknown): PublicAuthUser {
  const record = asRecord(value);
  const user = asRecord(record.user);
  const role = requireString(user.role) as PublicAuthUser['role'];
  if (!['owner', 'admin', 'creator', 'reviewer', 'viewer', 'platform_operator'].includes(role)) {
    throw new AuthClientError('身份服务返回无效', 'AUTH_RESPONSE_INVALID', 502);
  }
  if (!Array.isArray(user.projectIds) || user.projectIds.some((item) => typeof item !== 'string')) {
    throw new AuthClientError('身份服务返回无效', 'AUTH_RESPONSE_INVALID', 502);
  }
  if (typeof user.mfaEnabled !== 'boolean') {
    throw new AuthClientError('身份服务返回无效', 'AUTH_RESPONSE_INVALID', 502);
  }
  return {
    id: requireString(user.id),
    tenantId: requireString(user.tenantId),
    email: requireString(user.email),
    displayName: requireString(user.displayName),
    role,
    projectIds: [...user.projectIds] as string[],
    mfaEnabled: user.mfaEnabled,
  };
}

function responseError(response: RequestResult): AuthClientError {
  return new AuthClientError(
    response.error?.message ?? '身份服务暂不可用',
    response.error?.code ?? 'AUTH_REQUEST_FAILED',
    response.status,
  );
}

function parseError(value: unknown): { code: string; message: string } | null {
  const record = asRecord(value, false);
  const error = record ? asRecord(record.error, false) : null;
  return error && typeof error.code === 'string' && typeof error.message === 'string'
    ? { code: error.code, message: error.message }
    : null;
}

function asRecord(value: unknown, required = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (required) throw new AuthClientError('身份服务返回无效', 'AUTH_RESPONSE_INVALID', 502);
    return {};
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new AuthClientError('身份服务返回无效', 'AUTH_RESPONSE_INVALID', 502);
  }
  return value;
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}
