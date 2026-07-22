import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeMfa,
  getPreferredProjectId,
  loadAuthSession,
  login,
  logout,
  setActiveProjectId,
  withCsrfProtection,
} from '../src/client/auth/authClient';

const user = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'reviewer@pias.test',
  displayName: '青井审核员',
  role: 'reviewer' as const,
  projectIds: ['project-1'],
  mfaEnabled: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('认证浏览器客户端', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveProjectId('');
    document.cookie = 'pias_csrf=; Max-Age=0; Path=/';
  });

  it('将未配置身份服务识别为受控本机模式', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'AUTH_NOT_CONFIGURED', message: '身份服务尚未配置' },
    }, 503)));

    await expect(loadAuthSession()).resolves.toEqual({ status: 'disabled' });
  });

  it('将无效会话识别为匿名状态并保留稳定错误边界', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'AUTH_SESSION_INVALID', message: '会话无效' },
    }, 401)));

    await expect(loadAuthSession()).resolves.toEqual({ status: 'anonymous' });
  });

  it('完成密码与 MFA 两阶段登录且不要求浏览器读取令牌', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'mfa_required', expiresAt: '2026-07-22T04:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'authenticated',
        expiresAt: '2026-07-22T15:00:00.000Z',
        user,
      }));
    vi.stubGlobal('fetch', fetcher);

    await expect(login(' reviewer@pias.test ', 'correct horse battery')).resolves.toEqual({
      status: 'mfa_required',
      expiresAt: '2026-07-22T04:00:00.000Z',
    });
    await expect(completeMfa('123456')).resolves.toEqual({
      status: 'authenticated',
      expiresAt: '2026-07-22T15:00:00.000Z',
      user,
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'reviewer@pias.test', password: 'correct horse battery' }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/auth/mfa', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    }));
  });

  it('仅为写请求注入双提交 CSRF 请求头并在退出时使用它', async () => {
    document.cookie = 'pias_csrf=csrf%20value; Path=/';
    setActiveProjectId('project-1');
    const protectedRequest = withCsrfProtection({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
    });
    const readRequest = withCsrfProtection({ method: 'GET' });

    expect(new Headers(protectedRequest.headers).get('x-pias-csrf')).toBe('csrf value');
    expect(new Headers(protectedRequest.headers).get('x-pias-project-id')).toBe('project-1');
    expect(new Headers(protectedRequest.headers).get('content-type')).toBe('application/json');
    expect(new Headers(readRequest.headers).has('x-pias-csrf')).toBe(false);
    expect(new Headers(readRequest.headers).get('x-pias-project-id')).toBe('project-1');
    expect(new Headers(readRequest.headers).has('x-pias-tenant-id')).toBe(false);
    expect(document.cookie).toContain('pias_project=project-1');

    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await logout();
    expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      method: 'POST',
      headers: expect.any(Headers),
    }));
    expect((fetcher.mock.calls[0][1].headers as Headers).get('x-pias-csrf')).toBe('csrf value');
  });

  it('刷新后仅恢复会话仍有权访问的当前项目', () => {
    document.cookie = 'pias_project=project-2; Path=/';
    expect(getPreferredProjectId(['project-1', 'project-2'])).toBe('project-2');
    expect(getPreferredProjectId(['project-1'])).toBe('project-1');
    expect(getPreferredProjectId([])).toBe('');
  });
});
