import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthBoundary } from '../src/auth/AuthBoundary';

const authClientMocks = vi.hoisted(() => ({
  completeMfa: vi.fn(),
  getPreferredProjectId: vi.fn(),
  loadAuthSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  setActiveProjectId: vi.fn(),
}));

vi.mock('../src/auth/authClient', () => authClientMocks);

const user = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'admin@pias.test',
  displayName: '田中管理员',
  role: 'admin' as const,
  projectIds: ['project-1'],
  mfaEnabled: true,
};

describe('应用认证边界', () => {
  beforeEach(() => {
    authClientMocks.completeMfa.mockReset();
    authClientMocks.getPreferredProjectId.mockReset();
    authClientMocks.getPreferredProjectId.mockImplementation((projectIds: string[]) => projectIds[0] ?? '');
    authClientMocks.loadAuthSession.mockReset();
    authClientMocks.login.mockReset();
    authClientMocks.logout.mockReset();
    authClientMocks.setActiveProjectId.mockReset();
  });

  it('身份服务未配置时进入明确标记的本机模式', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue({ status: 'disabled' });
    render(
      <AuthBoundary>
        {({ session }) => <div>工作台-{session.status}</div>}
      </AuthBoundary>,
    );

    expect(await screen.findByText('工作台-disabled')).toBeInTheDocument();
  });

  it('匿名用户完成密码和 MFA 后才挂载业务工作台', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue({ status: 'anonymous' });
    authClientMocks.login.mockResolvedValue({
      status: 'mfa_required',
      expiresAt: '2026-07-22T04:00:00.000Z',
    });
    authClientMocks.completeMfa.mockResolvedValue({
      status: 'authenticated',
      expiresAt: '2026-07-22T15:00:00.000Z',
      user,
    });
    render(
      <AuthBoundary>
        {({ session }) => <div>工作台-{session.status}</div>}
      </AuthBoundary>,
    );

    expect(await screen.findByRole('heading', { name: '登录 PIAS' })).toBeInTheDocument();
    expect(screen.queryByText(/工作台-/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '邮箱' }), {
      target: { value: 'admin@pias.test' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(await screen.findByRole('heading', { name: '验证身份' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '六位验证码' }), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));

    expect(await screen.findByText('工作台-authenticated')).toBeInTheDocument();
    expect(authClientMocks.login).toHaveBeenCalledWith('admin@pias.test', 'correct horse battery');
    expect(authClientMocks.completeMfa).toHaveBeenCalledWith('123456');
  });

  it('登录失败时保留邮箱并显示服务端安全错误', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue({ status: 'anonymous' });
    authClientMocks.login.mockRejectedValue(new Error('邮箱或密码不正确'));
    render(
      <AuthBoundary>
        {({ session }) => <div>工作台-{session.status}</div>}
      </AuthBoundary>,
    );

    const email = await screen.findByRole('textbox', { name: '邮箱' });
    fireEvent.change(email, { target: { value: 'admin@pias.test' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码不正确');
    expect(email).toHaveValue('admin@pias.test');
    await waitFor(() => expect(screen.getByRole('button', { name: '继续' })).toBeEnabled());
  });

  it('恢复会话时暴露已验证的当前项目并支持后续切换', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue({
      status: 'authenticated',
      user: { ...user, projectIds: ['project-1', 'project-2'] },
    });
    authClientMocks.getPreferredProjectId.mockReturnValue('project-2');
    render(
      <AuthBoundary>
        {({ activeProjectId, activateProject }) => (
          <button onClick={() => activateProject('project-1')} type="button">
            当前-{activeProjectId}
          </button>
        )}
      </AuthBoundary>,
    );

    const current = await screen.findByRole('button', { name: '当前-project-2' });
    expect(authClientMocks.setActiveProjectId).toHaveBeenLastCalledWith('project-2');
    fireEvent.click(current);
    expect(await screen.findByRole('button', { name: '当前-project-1' })).toBeInTheDocument();
    expect(authClientMocks.setActiveProjectId).toHaveBeenLastCalledWith('project-1');
  });
});
