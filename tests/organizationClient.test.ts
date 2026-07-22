import { afterEach, describe, expect, it, vi } from 'vitest';
import { setActiveProjectId } from '../src/client/auth/authClient';
import {
  acceptInvitation,
  createInvitation,
  createProject,
  listProjects,
  listMembers,
  OrganizationClientError,
  previewInvitation,
  resendInvitation,
  revokeInvitation,
  updateMember,
} from '../src/client/organization/organizationClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const project = {
  id: 'project-autumn',
  tenantId: 'tenant-a',
  name: '2026 秋季发布',
  ownerUserId: 'user-owner',
  reviewRequired: true,
  status: 'active',
  createdAt: '2026-07-22T06:30:00.000Z',
  updatedAt: '2026-07-22T06:30:00.000Z',
};

describe('企业管理浏览器客户端', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'content_studio_csrf=; Max-Age=0; Path=/';
    setActiveProjectId('');
  });

  it('携带 CSRF 保护创建项目并严格解析返回数据', async () => {
    document.cookie = 'content_studio_csrf=csrf-token; Path=/';
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ project }, 201));
    vi.stubGlobal('fetch', fetcher);

    await expect(createProject({
      name: '2026 秋季发布',
      defaultBrand: '',
      defaultSku: '',
      reviewRequired: true,
    })).resolves.toMatchObject({ id: 'project-autumn', name: '2026 秋季发布' });
    expect(fetcher).toHaveBeenCalledWith('/api/organization/projects', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: '2026 秋季发布', defaultBrand: '', defaultSku: '', reviewRequired: true,
      }),
      headers: expect.any(Headers),
    }));
    expect((fetcher.mock.calls[0][1].headers as Headers).get('x-content-studio-csrf')).toBe('csrf-token');
  });

  it('保留邀请的未投递状态，不把保存写成发送成功', async () => {
    const acceptToken = 'a'.repeat(43);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      invitation: {
        id: 'invitation-1', tenantId: 'tenant-a', email: 'reviewer@studio.test',
        role: 'reviewer', projectIds: ['project-autumn'], status: 'pending',
        deliveryStatus: 'pending_configuration', createdBy: 'user-owner',
        createdAt: '2026-07-22T06:30:00.000Z', expiresAt: '2026-07-29T06:30:00.000Z',
      },
      acceptToken,
    }, 201)));

    await expect(createInvitation({
      email: 'reviewer@studio.test', displayName: '', role: 'reviewer', projectIds: ['project-autumn'],
    })).resolves.toMatchObject({
      invitation: { status: 'pending', deliveryStatus: 'pending_configuration' },
      acceptUrl: expect.stringContaining(`#/accept-invitation?token=${acceptToken}`),
    });
  });

  it('公开预览和接受邀请，但撤销请求携带 CSRF 保护', async () => {
    document.cookie = 'content_studio_csrf=csrf-token; Path=/';
    const token = 'b'.repeat(43);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        invitation: {
          email: 'member@studio.test', role: 'viewer', projectIds: ['project-autumn'],
          expiresAt: '2026-07-29T06:30:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        member: {
          id: 'user-member', tenantId: 'tenant-a', email: 'member@studio.test',
          displayName: '成员', role: 'viewer', status: 'active',
          projectIds: ['project-autumn'], mfaEnabled: false,
          createdAt: '2026-07-22T06:30:00.000Z', updatedAt: '2026-07-22T06:30:00.000Z',
        },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        invitation: {
          id: 'invitation-11111111-1111-1111-1111-111111111111', tenantId: 'tenant-a',
          email: 'member@studio.test', role: 'viewer', projectIds: ['project-autumn'],
          status: 'canceled', deliveryStatus: 'pending_configuration', createdBy: 'user-owner',
          createdAt: '2026-07-22T06:30:00.000Z', expiresAt: '2026-07-29T06:30:00.000Z',
          canceledAt: '2026-07-22T07:00:00.000Z',
        },
      }));
    vi.stubGlobal('fetch', fetcher);

    await expect(previewInvitation(token)).resolves.toMatchObject({ email: 'member@studio.test' });
    await expect(acceptInvitation({ token, password: 'Studio-member-2026!' }))
      .resolves.toMatchObject({ id: 'user-member', projectIds: ['project-autumn'] });
    await expect(revokeInvitation('invitation-11111111-1111-1111-1111-111111111111'))
      .resolves.toMatchObject({ status: 'canceled' });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect((fetcher.mock.calls[0][1].headers as Headers).get('x-content-studio-csrf')).toBeNull();
    expect((fetcher.mock.calls[2][1].headers as Headers).get('x-content-studio-csrf')).toBe('csrf-token');
  });

  it('重新签发邀请并返回新的单次链接', async () => {
    document.cookie = 'content_studio_csrf=csrf-token; Path=/';
    const invitationId = 'invitation-11111111-1111-1111-1111-111111111111';
    const acceptToken = 'c'.repeat(43);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      invitation: {
        id: 'invitation-22222222-2222-2222-2222-222222222222', tenantId: 'tenant-a',
        email: 'resent@studio.test', role: 'viewer', projectIds: ['project-autumn'],
        status: 'pending', deliveryStatus: 'pending_configuration', createdBy: 'user-owner',
        createdAt: '2026-07-22T07:00:00.000Z', expiresAt: '2026-07-29T07:00:00.000Z',
      },
      acceptToken,
    }, 201));
    vi.stubGlobal('fetch', fetcher);

    await expect(resendInvitation(invitationId)).resolves.toMatchObject({
      invitation: { id: 'invitation-22222222-2222-2222-2222-222222222222' },
      acceptUrl: expect.stringContaining(`#/accept-invitation?token=${acceptToken}`),
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/organization/invitations/${invitationId}/resend`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect((fetcher.mock.calls[0][1].headers as Headers).get('x-content-studio-csrf')).toBe('csrf-token');
  });

  it('strictly parses member lists and protects member updates with CSRF', async () => {
    document.cookie = 'content_studio_csrf=csrf-token; Path=/';
    const member = {
      id: 'user-11111111-1111-1111-1111-111111111111', tenantId: 'tenant-a',
      email: 'managed@studio.test', displayName: '受管成员', role: 'creator', status: 'active',
      projectIds: ['project-autumn'], mfaEnabled: false,
      createdAt: '2026-07-22T06:30:00.000Z', updatedAt: '2026-07-22T06:30:00.000Z',
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ members: [member] }))
      .mockResolvedValueOnce(jsonResponse({
        member: { ...member, role: 'reviewer', status: 'disabled' },
      }));
    vi.stubGlobal('fetch', fetcher);

    await expect(listMembers()).resolves.toEqual([expect.objectContaining({ id: member.id })]);
    await expect(updateMember(member.id, { role: 'reviewer', status: 'disabled' }))
      .resolves.toMatchObject({ role: 'reviewer', status: 'disabled' });
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/organization/members', { method: 'GET' });
    expect(fetcher.mock.calls[1][0]).toBe(`/api/organization/members/${member.id}`);
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ role: 'reviewer', status: 'disabled' }),
    });
    expect((fetcher.mock.calls[1][1].headers as Headers).get('x-content-studio-csrf')).toBe('csrf-token');
  });

  it('拒绝无效成功响应并保留服务端安全错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ projects: [{ id: 'broken' }] })));
    await expect(listProjects()).rejects.toMatchObject({
      name: 'OrganizationClientError', code: 'ORG_RESPONSE_INVALID', status: 502,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
      error: { code: 'AUTH_FORBIDDEN', message: '没有执行该操作的权限' },
    }, 403)));
    await expect(listProjects()).rejects.toEqual(expect.objectContaining<Partial<OrganizationClientError>>({
      message: '没有执行该操作的权限', code: 'AUTH_FORBIDDEN', status: 403,
    }));
  });
});
