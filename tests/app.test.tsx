import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/client/App';
import { getAuditTargetLabel } from '../src/client/pages/SecondaryViews';
import { initialStudioState } from '../src/shared/domain';
import { createDemoStudioState } from '../src/client/studio/demoState';

const deliveryMocks = vi.hoisted(() => ({
  downloadProductionDelivery: vi.fn(() => Promise.resolve(['result.png', 'manifest.csv', 'manifest.json'])),
  downloadWatermarkedPreview: vi.fn(() => Promise.resolve('result-preview.png')),
}));

const falClientMocks = vi.hoisted(() => ({
  cancelFalImageJob: vi.fn(() => Promise.resolve()),
  FAL_LIFECYCLE_ABORT_REASON: 'content-studio:lifecycle-unmount',
  resumeFalImageJob: vi.fn(),
  runFalImageJob: vi.fn(),
}));

const stateClientMocks = vi.hoisted(() => ({
  loadStudioState: vi.fn(),
  saveStudioState: vi.fn(),
}));

const assetImageClientMocks = vi.hoisted(() => ({
  uploadAssetImage: vi.fn(),
}));

const authClientMocks = vi.hoisted(() => ({
  completeMfa: vi.fn(),
  getPreferredProjectId: vi.fn(),
  loadAuthSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  setActiveProjectId: vi.fn(),
}));

const organizationClientMocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  createInvitation: vi.fn(),
  createProject: vi.fn(),
  listInvitations: vi.fn(),
  listMembers: vi.fn(),
  listProjects: vi.fn(),
  previewInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  updateMember: vi.fn(),
}));

vi.mock('../src/client/export/exportDelivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client/export/exportDelivery')>()),
  ...deliveryMocks,
}));

vi.mock('../src/client/fal/falImageClient', () => falClientMocks);
vi.mock('../src/client/assets/assetImageClient', () => assetImageClientMocks);
vi.mock('../src/client/studio/studioStateClient', () => stateClientMocks);
vi.mock('../src/client/auth/authClient', () => authClientMocks);
vi.mock('../src/client/organization/organizationClient', () => organizationClientMocks);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function renderApp(element = <App />) {
  render(element);
  await screen.findByLabelText('节点画布');
}

function authenticatedOwner() {
  return {
    status: 'authenticated' as const,
    user: {
      id: 'user-owner',
      tenantId: 'tenant-a',
      email: 'owner@studio.test',
      displayName: 'Content Studio Owner',
      role: 'owner' as const,
      projectIds: ['project-a'],
      mfaEnabled: true,
    },
  };
}

describe('Content Studio 中文应用框架', () => {
  beforeEach(() => {
    authClientMocks.loadAuthSession.mockReset();
    authClientMocks.loadAuthSession.mockResolvedValue({ status: 'disabled' });
    authClientMocks.login.mockReset();
    authClientMocks.completeMfa.mockReset();
    authClientMocks.getPreferredProjectId.mockReset();
    authClientMocks.getPreferredProjectId.mockImplementation((projectIds: string[]) => projectIds[0] ?? '');
    authClientMocks.logout.mockReset();
    authClientMocks.setActiveProjectId.mockReset();
    organizationClientMocks.acceptInvitation.mockReset();
    organizationClientMocks.createInvitation.mockReset();
    organizationClientMocks.createProject.mockReset();
    organizationClientMocks.listInvitations.mockReset();
    organizationClientMocks.listMembers.mockReset();
    organizationClientMocks.listProjects.mockReset();
    organizationClientMocks.previewInvitation.mockReset();
    organizationClientMocks.resendInvitation.mockReset();
    organizationClientMocks.revokeInvitation.mockReset();
    organizationClientMocks.updateMember.mockReset();
    organizationClientMocks.listInvitations.mockResolvedValue([]);
    organizationClientMocks.listMembers.mockResolvedValue([]);
    organizationClientMocks.listProjects.mockResolvedValue([]);
    window.history.replaceState({}, '', '/');
    deliveryMocks.downloadProductionDelivery.mockClear();
    deliveryMocks.downloadWatermarkedPreview.mockClear();
    stateClientMocks.loadStudioState.mockReset();
    stateClientMocks.saveStudioState.mockReset();
    stateClientMocks.loadStudioState.mockResolvedValue({
      schemaVersion: 1,
      revision: 1,
      updatedAt: '2026-07-21T16:00:00.000Z',
      state: createDemoStudioState(),
    });
    stateClientMocks.saveStudioState.mockImplementation(async (expectedRevision: number) => ({
      schemaVersion: 1,
      revision: expectedRevision + 1,
      updatedAt: '2026-07-21T16:01:00.000Z',
    }));
    assetImageClientMocks.uploadAssetImage.mockReset();
    assetImageClientMocks.uploadAssetImage.mockResolvedValue({
      imageUrl: '/api/assets/images/asset-upload.png',
      contentType: 'image/png',
      byteLength: 4,
    });
    falClientMocks.runFalImageJob.mockReset();
    falClientMocks.resumeFalImageJob.mockReset();
    falClientMocks.cancelFalImageJob.mockReset();
    falClientMocks.cancelFalImageJob.mockResolvedValue(undefined);
    falClientMocks.runFalImageJob.mockImplementation(async (_input, options) => {
      options.onExecution?.({ requestId: 'req-app-default', modelId: 'fal-ai/bria/product-shot' });
      options.onProgress?.(55);
      return {
        images: [{ url: 'https://fal.media/app-default.png', width: 1024, height: 1024 }],
        seed: 21,
        modelId: 'fal-ai/bria/product-shot',
        childRequestIds: ['req-app-child-default'],
      };
    });
  });
  it('参数面板方向与画布落点语义保持一致', () => {
    const styles = readFileSync(`${process.cwd()}/src/client/styles/styles.css`, 'utf8');

    expect(styles).toMatch(
      /\.context-panel\[data-placement="left"\]\s*\{[^}]*left:\s*76px;[^}]*right:\s*auto;/s,
    );
    expect(styles).toMatch(
      /\.context-panel\[data-placement="right"\]\s*\{[^}]*right:\s*76px;[^}]*left:\s*auto;/s,
    );
  });

  it('移动端样式明确隐藏新增节点编辑控件', () => {
    const styles = readFileSync(`${process.cwd()}/src/client/styles/styles.css`, 'utf8');
    const mobileRules = styles.slice(styles.indexOf('@media (max-width: 767px)'));

    expect(mobileRules).toMatch(
      /\.react-flow__handle\.node-create-handle,\s*\.node-type-picker,\s*\.draft-task-node\s*\{\s*display:\s*none;/,
    );
    expect(mobileRules).toMatch(/\.result-compare-backdrop\s*\{\s*display:\s*none;/);
  });

  it('选中节点拖拽时使用收敛阴影且不显示外圈亮光', () => {
    const styles = readFileSync(`${process.cwd()}/src/client/styles/soft-glass.css`, 'utf8');

    expect(styles).toMatch(
      /\.react-flow__node\.selected\.dragging \.canvas-node\s*\{[^}]*border-color:\s*rgb\(242 244 247 \/ 38%\);[^}]*box-shadow:\s*var\(--highlight-inset\),\s*0 8px 18px rgb\(0 0 0 \/ 26%\);/s,
    );
  });

  it('右侧编辑面板贯穿画布高度且 Prompt 支持纵向拖拽', () => {
    const styles = readFileSync(`${process.cwd()}/src/client/styles/soft-glass.css`, 'utf8');
    const releaseLayer = styles.slice(styles.lastIndexOf('/* Image MVP release convergence */'));

    expect(releaseLayer).toMatch(/\.context-panel\s*\{[^}]*top:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;/s);
    expect(releaseLayer).toMatch(/\.context-panel textarea\s*\{[^}]*resize:\s*vertical;/s);
    expect(releaseLayer).toMatch(/\.canvas-stage\.is-panel-open \.react-flow\s*\{[^}]*right:\s*360px;/s);
    expect(releaseLayer).toMatch(
      /\.segmented--counts button\[aria-pressed="false"\]\s*\{[^}]*background:\s*transparent;/s,
    );
    expect(releaseLayer).toMatch(
      /\.segmented--counts button\[aria-pressed="true"\]\s*\{[^}]*background:\s*rgb\(47 111 237 \/ 34%\);/s,
    );
  });

  it('结果详情位于画布节点之上并形成独立交互层', () => {
    const styles = readFileSync(`${process.cwd()}/src/client/styles/soft-glass.css`, 'utf8');
    const releaseLayer = styles.slice(styles.lastIndexOf('/* Image MVP release convergence */'));

    expect(releaseLayer).toMatch(
      /\.canvas-stage\.is-showing-result-overlay > \.react-flow\s*\{[^}]*z-index:\s*0\s*!important;[^}]*isolation:\s*isolate;/s,
    );
    expect(releaseLayer).toMatch(/\.result-inspector\s*\{[^}]*z-index:\s*1000;/s);
  });

  it('默认打开节点画布，并提供中文全局导航', async () => {
    await renderApp();

    expect(screen.getByLabelText('节点画布')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片工作台' })).toBeInTheDocument();
  });

  it('从素材库上传图片并保存为可复用素材', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(await screen.findByRole('button', { name: '上传' }));

    const dialog = screen.getByRole('dialog', { name: '上传素材' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '品牌' }), {
      target: { value: 'Content Studio' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '商品名称' }), {
      target: { value: '夏季精华' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'SKU 编码' }), {
      target: { value: 'AST-SF-009' },
    });
    fireEvent.change(within(dialog).getByLabelText('素材图片'), {
      target: { files: [new File(['content-studio'], 'summer-serum.png', { type: 'image/png' })] },
    });

    await within(dialog).findByRole('img', { name: '素材预览' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认上传' }));

    expect((await screen.findAllByText('AST-SF-009')).length).toBeGreaterThan(0);
    expect(assetImageClientMocks.uploadAssetImage).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'summer-serum.png', type: 'image/png' }),
    );
    expect(screen.getByText('Content Studio / 夏季精华')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '素材上传状态' })).toHaveTextContent('已上传 夏季精华');
    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.objectContaining({
        assets: expect.arrayContaining([
          expect.objectContaining({
            imageUrl: '/api/assets/images/asset-upload.png',
            product: '夏季精华',
            skuCode: 'AST-SF-009',
          }),
        ]),
      }),
    ));
  });

  it('本机模式明确禁用需要企业身份服务的项目与成员操作', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    expect(screen.getByRole('button', { name: '新建项目' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新建项目' })).toHaveAttribute(
      'title', '需要启用企业身份服务',
    );

    fireEvent.click(screen.getByRole('button', { name: '企业管理' }));
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '审计日志' })).not.toBeInTheDocument();
  });

  it('企业用户创建持久项目后直接进入新项目工作台', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue(authenticatedOwner());
    organizationClientMocks.createProject.mockResolvedValue({
      id: 'project-autumn', tenantId: 'tenant-a', name: '2026 秋季发布',
      ownerUserId: 'user-owner', reviewRequired: true, status: 'active',
      createdAt: '2026-07-22T06:30:00.000Z', updatedAt: '2026-07-22T06:30:00.000Z',
    });
    stateClientMocks.loadStudioState
      .mockResolvedValueOnce({
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-07-21T16:00:00.000Z',
        state: createDemoStudioState(),
      })
      .mockResolvedValueOnce(null);
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    const dialog = screen.getByRole('dialog', { name: '新建项目' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '项目名称' }), {
      target: { value: '2026 秋季发布' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建项目' }));

    await screen.findByLabelText('节点画布');
    expect(organizationClientMocks.createProject).toHaveBeenCalledWith({
      name: '2026 秋季发布', defaultBrand: '', defaultSku: '', reviewRequired: true,
    });
    expect(authClientMocks.setActiveProjectId).toHaveBeenLastCalledWith('project-autumn');
    expect(await screen.findByText('2026 秋季发布')).toBeInTheDocument();
  });

  it('在图片工作台内上传素材并直接放入画布', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '上传图片素材' }));

    const dialog = screen.getByRole('dialog', { name: '上传素材' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '商品名称' }), {
      target: { value: '画布新品' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'SKU 编码' }), {
      target: { value: 'CANVAS-001' },
    });
    fireEvent.change(within(dialog).getByLabelText('素材图片'), {
      target: { files: [new File(['canvas-image'], 'canvas-product.png', { type: 'image/png' })] },
    });
    await within(dialog).findByRole('img', { name: '素材预览' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认上传并添加到画布' }));

    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.objectContaining({
        assets: expect.arrayContaining([expect.objectContaining({ skuCode: 'CANVAS-001' })]),
        scenes: expect.arrayContaining([expect.objectContaining({
          skuCode: 'CANVAS-001',
          sourceAssetId: expect.stringMatching(/^asset-/),
        })]),
      }),
    ));
    expect(screen.getByRole('status', { name: '画布操作反馈' }))
      .toHaveTextContent('已上传并添加到画布');
  });

  it('打开企业项目时切换持久化作用域并初始化空白工作台', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue(authenticatedOwner());
    organizationClientMocks.listProjects.mockResolvedValue([{
      id: 'project-autumn', tenantId: 'tenant-a', name: '2026 秋季发布',
      defaultBrand: 'Content Studio', defaultSku: 'CS-AW-001', ownerUserId: 'user-owner',
      reviewRequired: true, status: 'active',
      createdAt: '2026-07-22T06:30:00.000Z', updatedAt: '2026-07-22T06:30:00.000Z',
    }]);
    stateClientMocks.loadStudioState
      .mockResolvedValueOnce({
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-07-21T16:00:00.000Z',
        state: createDemoStudioState(),
      })
      .mockResolvedValueOnce(null);

    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开项目 2026 秋季发布' }));

    await screen.findByLabelText('节点画布');
    expect(authClientMocks.setActiveProjectId).toHaveBeenLastCalledWith('project-autumn');
    expect(screen.getByText('2026 秋季发布')).toBeInTheDocument();
    expect(stateClientMocks.loadStudioState).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenLastCalledWith(
      0,
      expect.objectContaining({
        projectName: '2026 秋季发布',
        assets: [],
        results: [],
      }),
    ));

    fireEvent.click(screen.getByRole('button', { name: '企业管理' }));
    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
    const invitationDialog = screen.getByRole('dialog', { name: '邀请成员' });
    expect(within(invitationDialog).getByRole('option', { name: '2026 秋季发布' })).toBeInTheDocument();
    expect(within(invitationDialog).getByRole('combobox', { name: '分配项目' }))
      .toHaveValue('project-autumn');
  });

  it('企业项目首次恢复时从服务端元数据建立空白工作台而不注入演示数据', async () => {
    const session = authenticatedOwner();
    session.user.projectIds.push('project-autumn');
    authClientMocks.loadAuthSession.mockResolvedValue(session);
    authClientMocks.getPreferredProjectId.mockReturnValue('project-autumn');
    organizationClientMocks.listProjects.mockResolvedValue([{
      id: 'project-autumn', tenantId: 'tenant-a', name: '2026 秋季发布',
      defaultBrand: 'Content Studio', defaultSku: 'CS-AW-001', ownerUserId: 'user-owner',
      reviewRequired: true, status: 'active',
      createdAt: '2026-07-22T06:30:00.000Z', updatedAt: '2026-07-22T06:30:00.000Z',
    }]);
    stateClientMocks.loadStudioState.mockResolvedValue(null);

    await renderApp();

    expect(screen.getByText('2026 秋季发布')).toBeInTheDocument();
    expect(screen.queryByText('精华粉底')).not.toBeInTheDocument();
    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ projectName: '2026 秋季发布', assets: [], jobs: [], results: [] }),
    ));
  });

  it('企业管理员保存成员邀请并明确显示邮件尚未发送', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue(authenticatedOwner());
    organizationClientMocks.listProjects.mockResolvedValue([{
      id: 'project-a', tenantId: 'tenant-a', name: '主项目', ownerUserId: 'user-owner',
      reviewRequired: true, status: 'active',
      createdAt: '2026-07-22T06:30:00.000Z', updatedAt: '2026-07-22T06:30:00.000Z',
    }]);
    organizationClientMocks.createInvitation.mockResolvedValue({
      invitation: {
        id: 'invitation-1', tenantId: 'tenant-a', email: 'reviewer@studio.test',
        role: 'reviewer', projectIds: ['project-a'], status: 'pending',
        deliveryStatus: 'pending_configuration', createdBy: 'user-owner',
        createdAt: '2026-07-22T06:30:00.000Z', expiresAt: '2026-07-29T06:30:00.000Z',
      },
      acceptUrl: 'http://localhost/#/accept-invitation?token=secure-token',
    });
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '企业管理' }));
    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
    const dialog = screen.getByRole('dialog', { name: '邀请成员' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '成员邮箱' }), {
      target: { value: 'reviewer@studio.test' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: '成员角色' }), {
      target: { value: 'reviewer' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存邀请' }));

    expect(await screen.findByRole('status', { name: '成员邀请状态' }))
      .toHaveTextContent('邀请链接已生成');
    expect(screen.getByRole('textbox', { name: '一次性邀请链接' }))
      .toHaveValue('http://localhost/#/accept-invitation?token=secure-token');
    expect(organizationClientMocks.createInvitation).toHaveBeenCalledWith({
      email: 'reviewer@studio.test', displayName: '', role: 'reviewer', projectIds: ['project-a'],
    });
  });

  it('企业管理员重新签发邀请后显示新链接并替换待处理记录', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue(authenticatedOwner());
    organizationClientMocks.listProjects.mockResolvedValue([{
      id: 'project-a', tenantId: 'tenant-a', name: '主项目', ownerUserId: 'user-owner',
      reviewRequired: true, status: 'active', createdAt: '2026-07-22T06:30:00.000Z',
      updatedAt: '2026-07-22T06:30:00.000Z',
    }]);
    const original = {
      id: 'invitation-11111111-1111-1111-1111-111111111111', tenantId: 'tenant-a',
      email: 'resend-ui@studio.test', role: 'viewer' as const, projectIds: ['project-a'],
      status: 'pending' as const, deliveryStatus: 'pending_configuration' as const,
      createdBy: 'user-owner', createdAt: '2026-07-22T06:30:00.000Z',
      expiresAt: '2026-07-29T06:30:00.000Z',
    };
    organizationClientMocks.listInvitations.mockResolvedValue([original]);
    organizationClientMocks.resendInvitation.mockResolvedValue({
      invitation: {
        ...original,
        id: 'invitation-22222222-2222-2222-2222-222222222222',
        deliveryStatus: 'queued' as const,
        createdAt: '2026-07-22T07:00:00.000Z',
        expiresAt: '2026-07-29T07:00:00.000Z',
      },
      acceptUrl: 'http://localhost/#/accept-invitation?token=reissued-token',
    });

    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '企业管理' }));
    expect(await screen.findByText('resend-ui@studio.test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新签发邀请 resend-ui@studio.test' }));

    await waitFor(() => expect(organizationClientMocks.resendInvitation)
      .toHaveBeenCalledWith(original.id));
    expect(screen.getByRole('status', { name: '成员邀请状态' }))
      .toHaveTextContent('发送队列');
    expect(screen.getByRole('textbox', { name: '一次性邀请链接' }))
      .toHaveValue('http://localhost/#/accept-invitation?token=reissued-token');
  });

  it('企业管理员编辑成员角色、项目范围和启用状态', async () => {
    authClientMocks.loadAuthSession.mockResolvedValue(authenticatedOwner());
    organizationClientMocks.listProjects.mockResolvedValue([
      {
        id: 'project-a', tenantId: 'tenant-a', name: '主项目', ownerUserId: 'user-owner',
        reviewRequired: true, status: 'active', createdAt: '2026-07-22T06:30:00.000Z',
        updatedAt: '2026-07-22T06:30:00.000Z',
      },
      {
        id: 'project-b', tenantId: 'tenant-a', name: '备用项目', ownerUserId: 'user-owner',
        reviewRequired: false, status: 'active', createdAt: '2026-07-22T06:30:00.000Z',
        updatedAt: '2026-07-22T06:30:00.000Z',
      },
    ]);
    const member = {
      id: 'user-11111111-1111-1111-1111-111111111111', tenantId: 'tenant-a',
      email: 'managed@studio.test', displayName: '受管成员', role: 'creator' as const,
      status: 'active' as const, projectIds: ['project-a'], mfaEnabled: false,
      createdAt: '2026-07-22T06:30:00.000Z', updatedAt: '2026-07-22T06:30:00.000Z',
    };
    organizationClientMocks.listMembers.mockResolvedValue([member]);
    organizationClientMocks.updateMember.mockResolvedValue({
      ...member, role: 'reviewer', status: 'disabled', projectIds: ['project-b'],
    });

    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '企业管理' }));
    expect(await screen.findByText('受管成员')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑成员 managed@studio.test' }));
    const dialog = screen.getByRole('dialog', { name: '编辑成员' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: '成员角色' }), {
      target: { value: 'reviewer' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '项目范围 备用项目' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '项目范围 主项目' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '停用成员' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存成员设置' }));

    await waitFor(() => expect(organizationClientMocks.updateMember).toHaveBeenCalledWith(
      member.id,
      { role: 'reviewer', status: 'disabled', projectIds: ['project-b'] },
    ));
    expect(await screen.findByText('已停用')).toBeInTheDocument();
    expect(screen.getByText('审核员')).toBeInTheDocument();
  });

  it('通过 URL fragment 完成公开邀请接受后回到登录页', async () => {
    const token = 'c'.repeat(43);
    window.history.replaceState({}, '', `/#/accept-invitation?token=${token}`);
    authClientMocks.loadAuthSession.mockResolvedValue({ status: 'anonymous' });
    organizationClientMocks.previewInvitation.mockResolvedValue({
      email: 'member@studio.test', displayName: '新成员', role: 'viewer',
      projectIds: ['project-a'], expiresAt: '2026-07-29T06:30:00.000Z',
    });
    organizationClientMocks.acceptInvitation.mockResolvedValue({
      id: 'user-member', tenantId: 'tenant-a', email: 'member@studio.test',
      displayName: '新成员', role: 'viewer', status: 'active', projectIds: ['project-a'],
      mfaEnabled: false, createdAt: '2026-07-22T06:30:00.000Z',
      updatedAt: '2026-07-22T06:30:00.000Z',
    });

    render(<App />);
    expect(await screen.findByRole('heading', { name: '接受企业邀请' })).toBeInTheDocument();
    expect(screen.getByText('member@studio.test')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('设置密码'), {
      target: { value: 'Studio-member-2026!' },
    });
    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: 'Studio-member-2026!' },
    });
    fireEvent.click(screen.getByRole('button', { name: '接受并创建账户' }));

    expect(await screen.findByRole('heading', { name: '账户已创建' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前往登录' }));
    expect(await screen.findByRole('heading', { name: '登录 Content Studio' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('不显示旧版英文导航标签', async () => {
    await renderApp();

    ['Dashboard', 'Projects', 'Assets', 'Reviews', 'Usage', 'Admin', 'Image Studio'].forEach((label) => {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    });
  });

  it('实际状态流转只显示中文状态，不泄露内部枚举', async () => {
    let startRequest: (() => void) | undefined;
    let completeRequest: (() => void) | undefined;
    falClientMocks.runFalImageJob.mockImplementationOnce((_input, options) => new Promise((resolve) => {
      startRequest = () => {
        options.onExecution?.({ requestId: 'req-app-status', modelId: 'fal-ai/bria/product-shot' });
        options.onProgress?.(36);
      };
      completeRequest = () => resolve({
        images: [{ url: 'https://fal.media/app-status.png', width: 1024, height: 1024 }],
        seed: 31,
        modelId: 'fal-ai/bria/product-shot',
        childRequestIds: ['req-app-status-child'],
      });
    }));

      await renderApp(
        <StrictMode>
          <App />
        </StrictMode>,
      );

      fireEvent.click(screen.getByRole('button', { name: '审核' }));
      const reviewView = screen.getByRole('heading', { level: 1, name: '审核' })
        .closest<HTMLElement>('.workspace-panel')!;
      expect(within(reviewView).getByText('草稿')).toBeInTheDocument();
      expect(within(reviewView).getByText('待审核')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: '生成 2' }).closest('article')).toHaveTextContent('审核已通过');

      fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
      fireEvent.click(screen.getByRole('button', { name: '生成' }));
      fireEvent.click(screen.getByRole('button', { name: '1' }));
      fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
        target: { value: '白色棚拍背景' },
      });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      fireEvent.click(screen.getByRole('button', { name: /任务队列，1 个进行中任务，展开/ }));
      expect(screen.getAllByText('预检中')).toHaveLength(1);
      expect(screen.getAllByText('正在检查输入')).toHaveLength(2);

      await act(async () => startRequest?.());
      expect(screen.getAllByText('生成中')).toHaveLength(1);
      expect(screen.getAllByText('正在生成')).toHaveLength(2);

      await act(async () => completeRequest?.());

      await waitFor(() => expect(screen.queryAllByText('已完成')).not.toHaveLength(0));
      [
        'preflight', 'queued', 'running', 'postprocessing', 'partially_succeeded',
        'cancel_requested', 'succeeded', 'failed', 'canceled', 'expired',
        'draft', 'submitted', 'approved', 'returned',
      ].forEach((status) => {
        expect(screen.queryByText(status, { exact: true })).not.toBeInTheDocument();
      });
  });

  it('在任务运行中切换页面后仍会完成结算并释放冻结额度', async () => {
    let startRequest: (() => void) | undefined;
    let completeRequest: (() => void) | undefined;
    falClientMocks.runFalImageJob.mockImplementationOnce((_input, options) => new Promise((resolve) => {
      startRequest = () => {
        options.onExecution?.({ requestId: 'req-app-navigation', modelId: 'fal-ai/bria/product-shot' });
        options.onProgress?.(36);
      };
      completeRequest = () => resolve({
        images: [{ url: 'https://fal.media/app-navigation.png', width: 1024, height: 1024 }],
        seed: 41,
        modelId: 'fal-ai/bria/product-shot',
        childRequestIds: ['req-app-navigation-child'],
      });
    }));

      await renderApp();
      fireEvent.click(screen.getByRole('button', { name: '生成' }));
      fireEvent.click(screen.getByRole('button', { name: '1' }));
      fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
        target: { value: '导航切换回归测试' },
      });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

      await act(async () => startRequest?.());
      fireEvent.click(screen.getByRole('button', { name: '用量' }));

      await act(async () => completeRequest?.());

      const summary = screen.getByLabelText('工作区摘要');
      await waitFor(() => {
        expect(within(summary).getByText('冻结').closest('.metric')).toHaveTextContent('0');
        expect(screen.getByText('任务 02 · 生成').closest('.ledger-row')).toHaveTextContent('已完成');
      });
      fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
      expect(screen.getByLabelText('节点画布')).toBeInTheDocument();
  });

  it('审核员可以退回结果并显示退回原因', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    const pendingRow = screen.getByRole('img', { name: '生成 1' }).closest('article')!;

    fireEvent.click(within(pendingRow).getByRole('button', { name: '退回修改' }));
    const dialog = screen.getByRole('dialog', { name: '退回修改' });
    const confirm = within(dialog).getByRole('button', { name: '确认退回修改' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '审核原因' }), {
      target: { value: '请调整构图与光影后重新提交' },
    });
    fireEvent.click(confirm);

    expect(pendingRow).toHaveTextContent('已退回');
    expect(pendingRow).toHaveTextContent('请调整构图与光影后重新提交');
  });

  it('审核员可以明确拒绝结果并强制填写原因', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    const pendingRow = screen.getByRole('img', { name: '生成 1' }).closest('article')!;

    fireEvent.click(within(pendingRow).getByRole('button', { name: '拒绝审核' }));
    const dialog = screen.getByRole('dialog', { name: '拒绝审核' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '审核原因' }), {
      target: { value: '商品结构与主素材不一致' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认拒绝审核' }));

    expect(pendingRow).toHaveTextContent('已拒绝');
    expect(pendingRow).toHaveTextContent('商品结构与主素材不一致');
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    expect(screen.getByText('审核已拒绝：商品结构与主素材不一致')).toBeInTheDocument();
  });

  it('批准目标待审核结果后才开放受审计的生产导出，并隐藏内部标识', async () => {
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    const getReviewRow = (title: string) => screen.getByRole('img', { name: title }).closest('article')!;
    const pendingRow = getReviewRow('生成 1');
    const approvedRow = getReviewRow('生成 2');

    expect(pendingRow).toHaveTextContent('待审核');
    expect(within(pendingRow).queryByRole('button', { name: '生成生产导出' })).not.toBeInTheDocument();
    expect(within(approvedRow).getByRole('button', { name: '生成生产导出' })).toBeInTheDocument();
    expect(pendingRow).not.toHaveTextContent('scene-source');
    expect(pendingRow).toHaveTextContent('源场景');
    expect(pendingRow).toHaveTextContent('AST-SF-001');

    fireEvent.click(within(pendingRow).getByRole('button', { name: '通过审核' }));

    const approvedPendingRow = getReviewRow('生成 1');
    expect(approvedPendingRow).toHaveTextContent('审核已通过');
    expect(within(approvedPendingRow).getByRole('button', { name: '生成生产导出' })).toBeInTheDocument();

    fireEvent.click(within(approvedRow).getByRole('button', { name: '生成生产导出' }));
    await waitFor(() => expect(deliveryMocks.downloadProductionDelivery).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '用量' }));
    expect(screen.getByText('已导出').closest('article')).toHaveTextContent('1');
    expect(screen.getByText('任务 01 · 生成')).toBeInTheDocument();
    expect(screen.queryByText('job-1', { exact: true })).not.toBeInTheDocument();
  });

  it('首页审计对象显示中文业务信息，不暴露内部对象 ID', async () => {
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    const dashboard = screen.getByRole('heading', { level: 1, name: '首页' })
      .closest<HTMLElement>('.workspace-panel')!;

    expect(within(dashboard).getAllByText('任务 01 · 生成').length).toBeGreaterThan(0);
    expect(within(dashboard).getByText('融图场景 · AST-SF-001')).toBeInTheDocument();
    expect(within(dashboard).getAllByText('生成 1').length).toBeGreaterThan(0);
    ['job-1', 'scene-2', 'result-1'].forEach((id) => {
      expect(screen.queryByText(id, { exact: true })).not.toBeInTheDocument();
    });
  });

  it('未知审计对象显示通用中文名称', () => {
    expect(getAuditTargetLabel(initialStudioState(), 'missing-object')).toBe('操作对象');
  });

  it('从批准结果创建生产导出后同步用量统计和中文审计', async () => {
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: '用量' }));
    expect(screen.getByText('已导出').closest('article')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
    const mobilePreview = screen.getByLabelText('移动端结果预览');
    const approvedResultCard = within(mobilePreview).getByText('生成 2').closest('article')!;
    fireEvent.click(within(approvedResultCard).getByRole('button', { name: '查看结果详情' }));
    const inspector = screen.getByRole('complementary', { name: '结果详情' });
    fireEvent.click(within(inspector).getByRole('button', { name: '配置生产导出' }));
    fireEvent.click(screen.getByRole('button', { name: '生成生产导出' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '生产导出' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '用量' }));
    expect(screen.getByText('已导出').closest('article')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    expect(screen.getByText('已创建生产导出')).toBeInTheDocument();
  });

  it('恢复完成前不渲染工作台，也不会保存演示状态', async () => {
    const pendingLoad = deferred<unknown>();
    stateClientMocks.loadStudioState.mockReturnValue(pendingLoad.promise);

    render(<App />);

    expect(await screen.findByRole('heading', { name: '正在恢复工作台' })).toBeInTheDocument();
    expect(screen.queryByLabelText('节点画布')).not.toBeInTheDocument();
    expect(stateClientMocks.saveStudioState).not.toHaveBeenCalled();
  });

  it('优先渲染服务端快照而不是固定演示状态', async () => {
    const restored = createDemoStudioState();
    restored.projectName = '服务端恢复项目';
    stateClientMocks.loadStudioState.mockResolvedValue({
      schemaVersion: 1,
      revision: 7,
      updatedAt: '2026-07-21T16:00:00.000Z',
      state: restored,
    });

    await renderApp();

    expect(screen.getByText('服务端恢复项目')).toBeInTheDocument();
    expect(stateClientMocks.saveStudioState).not.toHaveBeenCalled();
  });

  it('首次运行使用演示状态并保存为 revision one', async () => {
    stateClientMocks.loadStudioState.mockResolvedValue(null);

    await renderApp();

    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ projectName: '2026 夏季 SKU 上新' }),
    ));
    await waitFor(() => expect(screen.getByRole('status', { name: '保存状态' })).toHaveTextContent('已自动保存'));
  });

  it('业务状态变化后先显示正在保存，服务端确认后才显示已自动保存', async () => {
    const pendingSave = deferred<{
      schemaVersion: 1;
      revision: number;
      updatedAt: string;
    }>();
    stateClientMocks.saveStudioState.mockReturnValue(pendingSave.promise);
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));

    await waitFor(() => expect(screen.getByRole('status', { name: '保存状态' })).toHaveTextContent('正在保存'));
    expect(screen.getByRole('status', { name: '保存状态' })).not.toHaveTextContent('已自动保存');

    pendingSave.resolve({
      schemaVersion: 1,
      revision: 2,
      updatedAt: '2026-07-21T16:02:00.000Z',
    });
    await waitFor(() => expect(screen.getByRole('status', { name: '保存状态' })).toHaveTextContent('已自动保存'));
  });

  it('存在未确认写入时阻止页面被无提示关闭', async () => {
    const pendingSave = deferred<{
      schemaVersion: 1;
      revision: number;
      updatedAt: string;
    }>();
    stateClientMocks.saveStudioState.mockReturnValue(pendingSave.promise);
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));
    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenCalled());

    const blocked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    pendingSave.resolve({
      schemaVersion: 1,
      revision: 2,
      updatedAt: '2026-07-21T16:02:00.000Z',
    });
    await waitFor(() => expect(screen.getByRole('status', { name: '保存状态' })).toHaveTextContent('已自动保存'));
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });

  it('保存进行中继续编辑时会在确认后提交最新状态', async () => {
    const firstSave = deferred<{
      schemaVersion: 1;
      revision: number;
      updatedAt: string;
    }>();
    stateClientMocks.saveStudioState
      .mockReturnValueOnce(firstSave.promise)
      .mockImplementation(async (expectedRevision: number) => ({
        schemaVersion: 1,
        revision: expectedRevision + 1,
        updatedAt: '2026-07-21T16:02:30.000Z',
      }));
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    const pendingRow = screen.getByRole('img', { name: '生成 1' }).closest('article')!;
    fireEvent.click(within(pendingRow).getByRole('button', { name: '通过审核' }));
    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenCalledTimes(1));

    const approvedRow = screen.getByRole('img', { name: '生成 1' }).closest('article')!;
    fireEvent.click(within(approvedRow).getByRole('button', { name: '生成生产导出' }));
    await waitFor(() => expect(deliveryMocks.downloadProductionDelivery).toHaveBeenCalled());
    expect(stateClientMocks.saveStudioState).toHaveBeenCalledTimes(1);

    firstSave.resolve({
      schemaVersion: 1,
      revision: 2,
      updatedAt: '2026-07-21T16:02:00.000Z',
    });

    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenCalledTimes(2));
    expect(stateClientMocks.saveStudioState).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({
        auditEvents: expect.arrayContaining([
          expect.objectContaining({ targetId: 'result-1', type: 'result.exported' }),
        ]),
      }),
    );
  });

  it('保存失败时保留状态并允许主动重试', async () => {
    stateClientMocks.saveStudioState
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        schemaVersion: 1,
        revision: 2,
        updatedAt: '2026-07-21T16:03:00.000Z',
      });
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '重试保存' })).toHaveTextContent('保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));

    await waitFor(() => expect(stateClientMocks.saveStudioState).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('status', { name: '保存状态' })).toHaveTextContent('已自动保存'));
  });

  it('版本冲突后停止自动保存并提示重新加载', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      code: 'STUDIO_STATE_CONFLICT',
      status: 409,
    });
    stateClientMocks.saveStudioState.mockRejectedValue(conflict);
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '重新加载' })).toHaveTextContent('存在更新冲突'));
    expect(screen.queryByRole('button', { name: '重试保存' })).not.toBeInTheDocument();
    expect(stateClientMocks.saveStudioState).toHaveBeenCalledTimes(1);
  });

  it('恢复失败时不显示工作台，并可重新加载', async () => {
    stateClientMocks.loadStudioState
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-07-21T16:00:00.000Z',
        state: createDemoStudioState(),
      });

    render(<App />);
    await screen.findByRole('heading', { name: '工作台恢复失败' });
    expect(screen.queryByLabelText('节点画布')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));

    await screen.findByLabelText('节点画布');
    expect(stateClientMocks.loadStudioState).toHaveBeenCalledTimes(2);
  });
});
