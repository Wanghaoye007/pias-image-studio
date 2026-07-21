import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { getAuditTargetLabel } from '../src/SecondaryViews';
import { initialStudioState } from '../src/domain';
import { createDemoStudioState } from '../src/studio/demoState';

const deliveryMocks = vi.hoisted(() => ({
  downloadProductionDelivery: vi.fn(() => Promise.resolve(['result.png', 'manifest.csv', 'manifest.json'])),
  downloadWatermarkedPreview: vi.fn(() => Promise.resolve('result-preview.png')),
}));

const falClientMocks = vi.hoisted(() => ({
  runFalImageJob: vi.fn(),
}));

const stateClientMocks = vi.hoisted(() => ({
  loadStudioState: vi.fn(),
  saveStudioState: vi.fn(),
}));

vi.mock('../src/exportDelivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/exportDelivery')>()),
  ...deliveryMocks,
}));

vi.mock('../src/fal/falImageClient', () => falClientMocks);
vi.mock('../src/studio/studioStateClient', () => stateClientMocks);

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

describe('PIAS 中文应用框架', () => {
  beforeEach(() => {
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
    falClientMocks.runFalImageJob.mockReset();
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
    const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

    expect(styles).toMatch(
      /\.context-panel\[data-placement="left"\]\s*\{[^}]*left:\s*76px;[^}]*right:\s*auto;/s,
    );
    expect(styles).toMatch(
      /\.context-panel\[data-placement="right"\]\s*\{[^}]*right:\s*76px;[^}]*left:\s*auto;/s,
    );
  });

  it('移动端样式明确隐藏新增节点编辑控件', () => {
    const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    const mobileRules = styles.slice(styles.indexOf('@media (max-width: 767px)'));

    expect(mobileRules).toMatch(
      /\.react-flow__handle\.node-create-handle,\s*\.node-type-picker,\s*\.draft-task-node\s*\{\s*display:\s*none;/,
    );
    expect(mobileRules).toMatch(/\.result-compare-backdrop\s*\{\s*display:\s*none;/);
  });

  it('默认打开节点画布，并提供中文全局导航', async () => {
    await renderApp();

    expect(screen.getByLabelText('节点画布')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片工作台' })).toBeInTheDocument();
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
      fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
        target: { value: '白色棚拍背景' },
      });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      fireEvent.click(screen.getByRole('button', { name: /任务队列，1 个进行中任务，展开/ }));
      expect(screen.getAllByText('等待中')).toHaveLength(1);
      expect(screen.getAllByText('等待调度')).toHaveLength(2);

      await act(async () => startRequest?.());
      expect(screen.getAllByText('生成中')).toHaveLength(1);
      expect(screen.getAllByText('正在生成')).toHaveLength(2);

      await act(async () => completeRequest?.());

      await waitFor(() => expect(screen.queryAllByText('已完成')).not.toHaveLength(0));
      ['queued', 'running', 'succeeded', 'failed', 'canceled', 'draft', 'submitted', 'approved', 'returned'].forEach((status) => {
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

    expect(pendingRow).toHaveTextContent('已退回');
    expect(pendingRow).toHaveTextContent('请调整构图与光影后重新提交');
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
    expect(pendingRow).toHaveTextContent('PIAS-SF-001');

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
    expect(within(dashboard).getByText('融图场景 · PIAS-SF-001')).toBeInTheDocument();
    expect(within(dashboard).getByText('生成 1')).toBeInTheDocument();
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

  it('恢复完成前不渲染工作台，也不会保存演示状态', () => {
    const pendingLoad = deferred<unknown>();
    stateClientMocks.loadStudioState.mockReturnValue(pendingLoad.promise);

    render(<App />);

    expect(screen.getByRole('heading', { name: '正在恢复工作台' })).toBeInTheDocument();
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
