import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApiAuthGuard,
  createAuthApiMiddleware,
  createAuthMiddlewareStack,
  getRequestAuthContext,
  getRequestProjectScope,
} from '../src/server/auth/authApiPlugin';
import {
  IdentityService,
  generateTotp,
  hashPassword,
  type AuthUser,
} from '../src/server/auth/identityService';

const password = 'PIAS-release-2026!';
const secret = 'JBSWY3DPEHPK3PXP';
const now = Date.parse('2026-07-22T03:00:00.000Z');

type InvokeOptions = {
  body?: unknown;
  headers?: Record<string, string>;
};

async function invoke(
  middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
  method: string,
  url: string,
  options: InvokeOptions = {},
) {
  const request = new EventEmitter() as IncomingMessage;
  request.method = method;
  request.url = url;
  request.headers = options.headers ?? {};
  request.destroy = vi.fn() as never;
  let responseBody = '';
  const responseHeaders = new Map<string, string | string[]>();
  let resolveResponse: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string | number | readonly string[]) => {
      responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? [...value] : String(value));
    },
    end: (value = '') => {
      responseBody = String(value);
      resolveResponse();
    },
  } as unknown as ServerResponse;
  const next = vi.fn(() => resolveResponse());

  middleware(request, response, next);
  queueMicrotask(() => {
    if (options.body !== undefined) request.emit('data', Buffer.from(JSON.stringify(options.body)));
    request.emit('end');
  });
  await completed;

  return {
    request,
    statusCode: response.statusCode,
    body: responseBody ? JSON.parse(responseBody) as Record<string, unknown> : undefined,
    headers: responseHeaders,
    next,
  };
}

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`cookie missing: ${name}`);
  return cookie.slice(name.length + 1).split(';', 1)[0];
}

describe('authentication API middleware', () => {
  let identity: IdentityService;
  let user: AuthUser;
  let viewer: AuthUser;

  beforeEach(async () => {
    user = {
      id: 'user-owner',
      tenantId: 'tenant-a',
      email: 'owner@pias.test',
      displayName: 'PIAS Owner',
      passwordHash: await hashPassword(password),
      role: 'owner',
      status: 'active',
      projectIds: ['project-a'],
      mfaEnabled: true,
      mfaSecret: secret,
    };
    viewer = {
      id: 'user-viewer',
      tenantId: 'tenant-a',
      email: 'viewer@pias.test',
      displayName: 'PIAS Viewer',
      passwordHash: await hashPassword(password),
      role: 'viewer',
      status: 'active',
      projectIds: ['project-a'],
      mfaEnabled: false,
    };
    identity = new IdentityService([user, viewer], { now: () => now });
  });

  it('keeps the MFA challenge out of JSON and sets a strict HttpOnly cookie', async () => {
    const response = await invoke(
      createAuthApiMiddleware(identity, { secureCookies: true }),
      'POST',
      '/api/auth/login',
      { body: { email: user.email, password } },
    );

    expect(response).toMatchObject({
      statusCode: 200,
      body: { status: 'mfa_required' },
    });
    expect(response.body).not.toHaveProperty('challengeToken');
    const setCookies = response.headers.get('set-cookie') as string[];
    expect(setCookies.join('\n')).toMatch(/pias_mfa=.*HttpOnly.*Secure.*SameSite=Strict/i);
  });

  it('completes MFA and exposes only protected session and CSRF cookies', async () => {
    const login = await invoke(
      createAuthApiMiddleware(identity, { secureCookies: false }),
      'POST',
      '/api/auth/login',
      { body: { email: user.email, password } },
    );
    const challengeCookie = cookieValue(login.headers.get('set-cookie') as string[], 'pias_mfa');

    const response = await invoke(
      createAuthApiMiddleware(identity, { secureCookies: false }),
      'POST',
      '/api/auth/mfa',
      {
        body: { code: generateTotp(secret, now) },
        headers: { cookie: `pias_mfa=${challengeCookie}` },
      },
    );

    expect(response).toMatchObject({
      statusCode: 200,
      body: {
        status: 'authenticated',
        user: { id: user.id, tenantId: user.tenantId, role: 'owner' },
      },
    });
    expect(response.body).not.toHaveProperty('sessionToken');
    expect(response.body).not.toHaveProperty('csrfToken');
    const setCookies = response.headers.get('set-cookie') as string[];
    expect(setCookies.find((value) => value.startsWith('pias_session='))).toMatch(/HttpOnly.*SameSite=Strict/i);
    expect(setCookies.find((value) => value.startsWith('pias_csrf='))).not.toMatch(/HttpOnly/i);
  });

  it('returns the current trusted identity and revokes it only with valid CSRF', async () => {
    const session = await authenticatedCookies(identity, user);
    const middleware = createAuthApiMiddleware(identity, { secureCookies: false });

    const current = await invoke(middleware, 'GET', '/api/auth/session', {
      headers: { cookie: session.cookieHeader },
    });
    expect(current).toMatchObject({
      statusCode: 200,
      body: { user: { id: user.id, displayName: 'PIAS Owner', role: 'owner' } },
    });

    const rejected = await invoke(middleware, 'POST', '/api/auth/logout', {
      headers: { cookie: session.cookieHeader },
    });
    expect(rejected).toMatchObject({
      statusCode: 403,
      body: { error: { code: 'AUTH_CSRF_INVALID' } },
    });

    const loggedOut = await invoke(middleware, 'POST', '/api/auth/logout', {
      headers: {
        cookie: session.cookieHeader,
        'x-pias-csrf': session.csrfToken,
      },
    });
    expect(loggedOut.statusCode).toBe(204);

    const afterLogout = await invoke(middleware, 'GET', '/api/auth/session', {
      headers: { cookie: session.cookieHeader },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('guards business APIs and attaches server-trusted context', async () => {
    const guard = createApiAuthGuard(identity);
    const anonymous = await invoke(guard, 'GET', '/api/studio/state');
    expect(anonymous).toMatchObject({
      statusCode: 401,
      body: { error: { code: 'AUTH_SESSION_INVALID' } },
    });

    const session = await authenticatedCookies(identity, user);
    const missingProject = await invoke(guard, 'GET', '/api/studio/state', {
      headers: { cookie: session.cookieHeader },
    });
    expect(missingProject).toMatchObject({
      statusCode: 400,
      body: { error: { code: 'AUTH_PROJECT_REQUIRED' } },
    });

    const accepted = await invoke(guard, 'GET', '/api/studio/state', {
      headers: {
        cookie: session.cookieHeader,
        'x-pias-project-id': 'project-a',
      },
    });
    expect(accepted.next).toHaveBeenCalledOnce();
    expect(getRequestAuthContext(accepted.request)).toMatchObject({
      userId: user.id,
      tenantId: user.tenantId,
      role: 'owner',
    });
    expect(getRequestProjectScope(accepted.request)).toEqual({
      tenantId: 'tenant-a',
      projectId: 'project-a',
    });

    const nativeImage = await invoke(
      guard,
      'GET',
      `/api/assets/images/project-a/${'a'.repeat(64)}.png`,
      { headers: { cookie: session.cookieHeader } },
    );
    expect(nativeImage.next).toHaveBeenCalledOnce();
    expect(getRequestProjectScope(nativeImage.request)).toEqual({
      tenantId: 'tenant-a',
      projectId: 'project-a',
    });

    const rejectedWrite = await invoke(guard, 'PUT', '/api/studio/state', {
      headers: {
        cookie: session.cookieHeader,
        'x-pias-project-id': 'project-a',
      },
    });
    expect(rejectedWrite).toMatchObject({
      statusCode: 403,
      body: { error: { code: 'AUTH_CSRF_INVALID' } },
    });

    const acceptedWrite = await invoke(guard, 'PUT', '/api/studio/state', {
      headers: {
        cookie: session.cookieHeader,
        'x-pias-csrf': session.csrfToken,
        'x-pias-project-id': 'project-a',
      },
    });
    expect(acceptedWrite.next).toHaveBeenCalledOnce();
  });

  it('registers the business guard only when identity is configured', () => {
    expect(createAuthMiddlewareStack(identity, { secureCookies: true })).toHaveLength(2);
    expect(createAuthMiddlewareStack(null, { secureCookies: true })).toHaveLength(1);
  });

  it('bypasses authentication only for invitation preview and acceptance', async () => {
    const guard = createApiAuthGuard(identity);
    const preview = await invoke(guard, 'POST', '/api/organization/invitations/preview');
    expect(preview.next).toHaveBeenCalledOnce();
    const accept = await invoke(guard, 'POST', '/api/organization/invitations/accept');
    expect(accept.next).toHaveBeenCalledOnce();
    const revoke = await invoke(
      guard,
      'POST',
      '/api/organization/invitations/invitation-11111111-1111-1111-1111-111111111111/revoke',
    );
    expect(revoke).toMatchObject({
      statusCode: 401,
      body: { error: { code: 'AUTH_SESSION_INVALID' } },
    });
    expect(revoke.next).not.toHaveBeenCalled();
  });

  it('enforces command permissions before protected business routes run', async () => {
    const guard = createApiAuthGuard(identity);
    const session = await authenticatedWithoutMfaCookies(identity, viewer);
    const headers = {
      cookie: session.cookieHeader,
      'x-pias-csrf': session.csrfToken,
      'x-pias-project-id': 'project-a',
    };

    const assetUpload = await invoke(guard, 'POST', '/api/assets/images', { headers });
    expect(assetUpload).toMatchObject({
      statusCode: 403,
      body: { error: { code: 'AUTH_FORBIDDEN' } },
    });
    expect(assetUpload.next).not.toHaveBeenCalled();

    const falSubmit = await invoke(guard, 'POST', '/api/fal/jobs', { headers });
    expect(falSubmit).toMatchObject({
      statusCode: 403,
      body: { error: { code: 'AUTH_FORBIDDEN' } },
    });
    expect(falSubmit.next).not.toHaveBeenCalled();

    const falCancel = await invoke(guard, 'DELETE', '/api/fal/jobs/job-a', { headers });
    expect(falCancel).toMatchObject({
      statusCode: 403,
      body: { error: { code: 'AUTH_FORBIDDEN' } },
    });
    expect(falCancel.next).not.toHaveBeenCalled();

    const assetRead = await invoke(
      guard,
      'GET',
      `/api/assets/images/project-a/${'a'.repeat(64)}.png`,
      { headers: { cookie: session.cookieHeader } },
    );
    expect(assetRead.next).toHaveBeenCalledOnce();
  });

  it('authorizes tenant organization routes without a project header', async () => {
    const guard = createApiAuthGuard(identity);
    const ownerSession = await authenticatedCookies(identity, user);
    const projects = await invoke(guard, 'GET', '/api/organization/projects', {
      headers: { cookie: ownerSession.cookieHeader },
    });
    expect(projects.next).toHaveBeenCalledOnce();
    expect(getRequestAuthContext(projects.request)).toMatchObject({ userId: user.id });

    const viewerSession = await authenticatedWithoutMfaCookies(identity, viewer);
    const invitation = await invoke(guard, 'POST', '/api/organization/invitations', {
      headers: {
        cookie: viewerSession.cookieHeader,
        'x-pias-csrf': viewerSession.csrfToken,
      },
    });
    expect(invitation).toMatchObject({
      statusCode: 403,
      body: { error: { code: 'AUTH_FORBIDDEN' } },
    });
  });
});

async function authenticatedCookies(identity: IdentityService, user: AuthUser) {
  const middleware = createAuthApiMiddleware(identity, { secureCookies: false });
  const login = await invoke(middleware, 'POST', '/api/auth/login', {
    body: { email: user.email, password },
  });
  const challenge = cookieValue(login.headers.get('set-cookie') as string[], 'pias_mfa');
  const mfa = await invoke(middleware, 'POST', '/api/auth/mfa', {
    body: { code: generateTotp(secret, now) },
    headers: { cookie: `pias_mfa=${challenge}` },
  });
  const setCookies = mfa.headers.get('set-cookie') as string[];
  const sessionToken = cookieValue(setCookies, 'pias_session');
  const csrfToken = cookieValue(setCookies, 'pias_csrf');
  return {
    csrfToken,
    cookieHeader: `pias_session=${sessionToken}; pias_csrf=${csrfToken}`,
  };
}

async function authenticatedWithoutMfaCookies(identity: IdentityService, user: AuthUser) {
  const middleware = createAuthApiMiddleware(identity, { secureCookies: false });
  const login = await invoke(middleware, 'POST', '/api/auth/login', {
    body: { email: user.email, password },
  });
  const setCookies = login.headers.get('set-cookie') as string[];
  const sessionToken = cookieValue(setCookies, 'pias_session');
  const csrfToken = cookieValue(setCookies, 'pias_csrf');
  return {
    csrfToken,
    cookieHeader: `pias_session=${sessionToken}; pias_csrf=${csrfToken}`,
  };
}
