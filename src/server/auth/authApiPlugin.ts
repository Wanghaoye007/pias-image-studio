import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  AuthorizationError,
  requirePermission,
  type AuthContext,
  type Permission,
} from './authPolicy';
import {
  IdentityError,
  type IdentityService,
  type LoginResult,
} from './identityService';

const loginPath = '/api/auth/login';
const mfaPath = '/api/auth/mfa';
const sessionPath = '/api/auth/session';
const logoutPath = '/api/auth/logout';
const sessionCookieName = 'content_studio_session';
const mfaCookieName = 'content_studio_mfa';
const csrfCookieName = 'content_studio_csrf';
const projectCookieName = 'content_studio_project';
const projectHeaderName = 'x-content-studio-project-id';
const maxBodyBytes = 8 * 1024;
const requestAuthContext = Symbol('content-studio.auth-context');
const requestProjectScope = Symbol('content-studio.project-scope');

export type RequestProjectScope = {
  tenantId: string;
  projectId: string;
};

type AuthenticatedRequest = IncomingMessage & {
  [requestAuthContext]?: AuthContext;
  [requestProjectScope]?: RequestProjectScope;
};

type AuthApiOptions = {
  secureCookies: boolean;
};

export function createAuthApiMiddleware(
  identity: IdentityService | null,
  options: AuthApiOptions,
): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (![loginPath, mfaPath, sessionPath, logoutPath].includes(url.pathname)) {
      next();
      return;
    }
    if (!identity) {
      writeError(response, new IdentityError('身份服务尚未配置', 'AUTH_NOT_CONFIGURED', 503));
      return;
    }

    try {
      if (url.pathname === loginPath && request.method === 'POST') {
        const body = asRecord(await readJsonBody(request));
        const email = requireString(body.email, '邮箱');
        const password = requireString(body.password, '密码');
        const result = await identity.beginLogin(email, password);
        writeLoginResult(response, identity, result, options);
        return;
      }

      if (url.pathname === mfaPath && request.method === 'POST') {
        const challengeToken = readCookies(request)[mfaCookieName];
        if (!challengeToken) {
          throw new IdentityError('MFA 挑战无效', 'AUTH_MFA_CHALLENGE_INVALID', 401);
        }
        const body = asRecord(await readJsonBody(request));
        const code = requireString(body.code, '验证码');
        const result = identity.completeMfa(challengeToken, code);
        writeLoginResult(response, identity, result, options, true);
        return;
      }

      if (url.pathname === sessionPath && request.method === 'GET') {
        const sessionToken = requireSessionCookie(request);
        const context = identity.authenticateSession(sessionToken);
        writeJson(response, 200, { user: identity.getUserProfile(context.userId) });
        return;
      }

      if (url.pathname === logoutPath && request.method === 'POST') {
        const cookies = readCookies(request);
        const sessionToken = cookies[sessionCookieName];
        const csrfToken = readHeader(request, 'x-content-studio-csrf');
        if (!sessionToken || !csrfToken || !cookies[csrfCookieName]) {
          throw new IdentityError('请求验证失败', 'AUTH_CSRF_INVALID', 403);
        }
        identity.authenticateSession(sessionToken);
        identity.verifyCsrf(sessionToken, csrfToken);
        identity.verifyCsrf(sessionToken, cookies[csrfCookieName]);
        identity.revokeSession(sessionToken);
        response.statusCode = 204;
        response.setHeader('set-cookie', clearAuthCookies(options.secureCookies));
        response.setHeader('x-content-type-options', 'nosniff');
        response.end();
        return;
      }

      writeJson(response, 405, {
        error: { code: 'AUTH_METHOD_NOT_ALLOWED', message: '请求方法不受支持' },
      });
    } catch (error) {
      writeError(response, normalizeIdentityError(error));
    }
  };
}

export function createApiAuthGuard(identity: IdentityService): Connect.NextHandleFunction {
  return (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const publicInvitationPath = url.pathname === '/api/organization/invitations/preview'
      || url.pathname === '/api/organization/invitations/accept';
    if (
      !url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/api/auth/')
      || publicInvitationPath
    ) {
      next();
      return;
    }
    try {
      const cookies = readCookies(request);
      const sessionToken = cookies[sessionCookieName];
      if (!sessionToken) {
        throw new IdentityError('会话无效', 'AUTH_SESSION_INVALID', 401);
      }
      const context = identity.authenticateSession(sessionToken);
      const tenantScoped = url.pathname.startsWith('/api/organization/');
      const projectId = tenantScoped ? '' : resolveProjectId(request, url, cookies);
      if (!tenantScoped) {
        if (!projectId || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(projectId)) {
          throw new IdentityError('必须选择有效项目', 'AUTH_PROJECT_REQUIRED', 400);
        }
        if (
          context.role !== 'owner'
          && context.role !== 'admin'
          && !context.projectIds.includes(projectId)
        ) {
          throw new IdentityError('资源不存在或无权访问', 'AUTH_RESOURCE_NOT_FOUND', 404);
        }
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET')) {
        const csrfToken = readHeader(request, 'x-content-studio-csrf');
        const csrfCookie = cookies[csrfCookieName];
        if (!csrfToken || !csrfCookie) {
          throw new IdentityError('请求验证失败', 'AUTH_CSRF_INVALID', 403);
        }
        identity.verifyCsrf(sessionToken, csrfToken);
        identity.verifyCsrf(sessionToken, csrfCookie);
      }
      const permission = permissionForRequest(request.method ?? 'GET', url.pathname);
      if (permission) {
        requirePermission(context, permission, {
          tenantId: context.tenantId,
          ...(projectId ? { projectId } : {}),
        });
      }
      (request as AuthenticatedRequest)[requestAuthContext] = context;
      if (projectId) {
        (request as AuthenticatedRequest)[requestProjectScope] = {
          tenantId: context.tenantId,
          projectId,
        };
      }
      next();
    } catch (error) {
      writeError(response, normalizeIdentityError(error));
    }
  };
}

function permissionForRequest(methodInput: string, pathname: string): Permission | null {
  const method = methodInput.toUpperCase();
  if (pathname === '/api/organization/projects') {
    return method === 'GET' ? 'project.view' : method === 'POST' ? 'project.edit' : null;
  }
  if (pathname === '/api/organization/invitations') {
    return method === 'GET' || method === 'POST' ? 'member.manage' : null;
  }
  if (/^\/api\/organization\/invitations\/invitation-[a-f0-9-]{36}\/revoke$/.test(pathname)) {
    return method === 'POST' ? 'member.manage' : null;
  }
  if (pathname === '/api/studio/state') {
    return method === 'GET' ? 'project.view' : null;
  }
  if (pathname === '/api/assets/images') {
    return method === 'POST' ? 'asset.edit' : null;
  }
  if (/^\/api\/assets\/images\//.test(pathname)) {
    return method === 'GET' ? 'asset.view' : null;
  }
  if (pathname === '/api/fal/jobs') {
    return method === 'POST' ? 'job.create' : null;
  }
  if (/^\/api\/fal\/jobs\/[^/]+\/(?:status|result)$/.test(pathname)) {
    return method === 'GET' ? 'project.view' : null;
  }
  if (/^\/api\/fal\/jobs\/[^/]+$/.test(pathname)) {
    return method === 'DELETE' ? 'job.cancel_own' : null;
  }
  return null;
}

function resolveProjectId(
  request: IncomingMessage,
  url: URL,
  cookies: Record<string, string>,
): string {
  const headerProjectId = readHeader(request, projectHeaderName).trim();
  if (headerProjectId) return headerProjectId;
  if (request.method !== 'GET') return '';
  const scopedAsset = /^\/api\/assets\/images\/([^/]+)\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.exec(url.pathname);
  if (scopedAsset) {
    try {
      return decodeURIComponent(scopedAsset[1]);
    } catch {
      return '';
    }
  }
  if (/^\/api\/assets\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(url.pathname)) {
    return cookies[projectCookieName]?.trim() ?? '';
  }
  return '';
}

export function getRequestAuthContext(request: IncomingMessage): AuthContext {
  const context = (request as AuthenticatedRequest)[requestAuthContext];
  if (!context) {
    throw new IdentityError('会话无效', 'AUTH_SESSION_INVALID', 401);
  }
  return context;
}

export function getRequestProjectScope(request: IncomingMessage): RequestProjectScope {
  const scope = (request as AuthenticatedRequest)[requestProjectScope];
  if (!scope) {
    throw new IdentityError('必须选择有效项目', 'AUTH_PROJECT_REQUIRED', 400);
  }
  return scope;
}

export function authApiPlugin(
  identity: IdentityService | null,
  options: AuthApiOptions,
): Plugin {
  const middlewareStack = createAuthMiddlewareStack(identity, options);
  return {
    name: 'content-studio-auth-api',
    configureServer(server) {
      middlewareStack.forEach((middleware) => server.middlewares.use(middleware));
    },
    configurePreviewServer(server) {
      middlewareStack.forEach((middleware) => server.middlewares.use(middleware));
    },
  };
}

export function createAuthMiddlewareStack(
  identity: IdentityService | null,
  options: AuthApiOptions,
): Connect.NextHandleFunction[] {
  return [
    createAuthApiMiddleware(identity, options),
    ...(identity ? [createApiAuthGuard(identity)] : []),
  ];
}

function writeLoginResult(
  response: ServerResponse,
  identity: IdentityService,
  result: LoginResult,
  options: AuthApiOptions,
  clearMfa = false,
) {
  if (result.status === 'mfa_required') {
    response.setHeader('set-cookie', [
      serializeCookie(mfaCookieName, result.challengeToken, 5 * 60, true, options.secureCookies),
      ...clearSessionCookies(options.secureCookies),
    ]);
    writeJson(response, 200, { status: result.status, expiresAt: result.expiresAt });
    return;
  }

  const context = identity.authenticateSession(result.sessionToken);
  const cookies = [
    serializeCookie(sessionCookieName, result.sessionToken, 12 * 60 * 60, true, options.secureCookies),
    serializeCookie(csrfCookieName, result.csrfToken, 12 * 60 * 60, false, options.secureCookies),
  ];
  if (clearMfa) cookies.push(clearCookie(mfaCookieName, true, options.secureCookies));
  response.setHeader('set-cookie', cookies);
  writeJson(response, 200, {
    status: result.status,
    expiresAt: result.expiresAt,
    user: identity.getUserProfile(context.userId),
  });
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        settled = true;
        reject(new IdentityError('请求内容过大', 'AUTH_BODY_TOO_LARGE', 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new IdentityError('请求内容不是有效 JSON', 'AUTH_INVALID_JSON', 400));
      }
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function readCookies(request: IncomingMessage): Record<string, string> {
  const header = readHeader(request, 'cookie');
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function requireSessionCookie(request: IncomingMessage): string {
  const token = readCookies(request)[sessionCookieName];
  if (!token) throw new IdentityError('会话无效', 'AUTH_SESSION_INVALID', 401);
  return token;
}

function readHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function serializeCookie(
  name: string,
  value: string,
  maxAge: number,
  httpOnly: boolean,
  secure: boolean,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    httpOnly ? 'HttpOnly' : '',
    secure ? 'Secure' : '',
    'SameSite=Strict',
  ].filter(Boolean).join('; ');
}

function clearCookie(name: string, httpOnly: boolean, secure: boolean): string {
  return serializeCookie(name, '', 0, httpOnly, secure);
}

function clearSessionCookies(secure: boolean): string[] {
  return [
    clearCookie(sessionCookieName, true, secure),
    clearCookie(csrfCookieName, false, secure),
  ];
}

function clearAuthCookies(secure: boolean): string[] {
  return [
    ...clearSessionCookies(secure),
    clearCookie(mfaCookieName, true, secure),
  ];
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IdentityError(`${label}不能为空`, 'AUTH_INPUT_INVALID', 400);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IdentityError('请求内容必须是对象', 'AUTH_INPUT_INVALID', 400);
  }
  return value as Record<string, unknown>;
}

function normalizeIdentityError(error: unknown): IdentityError {
  if (error instanceof IdentityError) return error;
  if (error instanceof AuthorizationError) {
    return new IdentityError(error.message, error.code, error.statusCode);
  }
  return new IdentityError('身份服务暂不可用', 'AUTH_SERVICE_FAILED', 500);
}

function writeError(response: ServerResponse, error: IdentityError) {
  writeJson(response, error.statusCode, {
    error: { code: error.code, message: error.message },
  });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}
