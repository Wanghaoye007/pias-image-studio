import { StrictMode } from 'react';
// Vitest executes this source-level CSS assertion in Node; production code stays browser-only.
// @ts-expect-error The project intentionally does not ship Node types.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { getAuditTargetLabel } from '../src/SecondaryViews';
import { initialStudioState } from '../src/domain';

const deliveryMocks = vi.hoisted(() => ({
  downloadProductionDelivery: vi.fn(() => Promise.resolve(['result.png', 'manifest.csv', 'manifest.json'])),
  downloadWatermarkedPreview: vi.fn(() => Promise.resolve('result-preview.png')),
}));

vi.mock('../src/exportDelivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/exportDelivery')>()),
  ...deliveryMocks,
}));

declare const process: { cwd: () => string };

describe('PIAS 中文应用框架', () => {
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

  it('默认打开节点画布，并提供中文全局导航', () => {
    render(<App />);

    expect(screen.getByLabelText('节点画布')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片工作台' })).toBeInTheDocument();
  });

  it('不显示旧版英文导航标签', () => {
    render(<App />);

    ['Dashboard', 'Projects', 'Assets', 'Reviews', 'Usage', 'Admin', 'Image Studio'].forEach((label) => {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    });
  });

  it('实际状态流转只显示中文状态，不泄露内部枚举', async () => {
    vi.useFakeTimers();

    try {
      render(
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(screen.getAllByText('生成中')).toHaveLength(1);
      expect(screen.getAllByText('正在生成')).toHaveLength(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5500);
      });

      expect(screen.queryAllByText('已完成')).not.toHaveLength(0);
      ['queued', 'running', 'succeeded', 'failed', 'canceled', 'draft', 'submitted', 'approved', 'returned'].forEach((status) => {
        expect(screen.queryByText(status, { exact: true })).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('在任务运行中切换页面后仍会完成结算并释放冻结额度', async () => {
    vi.useFakeTimers();

    try {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: '生成' }));
      fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
        target: { value: '导航切换回归测试' },
      });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      fireEvent.click(screen.getByRole('button', { name: '用量' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5500);
      });

      const summary = screen.getByLabelText('工作区摘要');
      expect(within(summary).getByText('冻结').closest('.metric')).toHaveTextContent('0');
      expect(screen.getByText('任务 02 · 生成').closest('.ledger-row')).toHaveTextContent('已完成');
      fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
      expect(screen.getByLabelText('节点画布')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('审核员可以退回结果并显示退回原因', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    const pendingRow = screen.getByRole('img', { name: '生成 1' }).closest('article')!;

    fireEvent.click(within(pendingRow).getByRole('button', { name: '退回修改' }));

    expect(pendingRow).toHaveTextContent('已退回');
    expect(pendingRow).toHaveTextContent('请调整构图与光影后重新提交');
  });

  it('批准目标待审核结果后才开放受审计的生产导出，并隐藏内部标识', async () => {
    render(<App />);

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

  it('首页审计对象显示中文业务信息，不暴露内部对象 ID', () => {
    render(<App />);

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
    render(<App />);

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
});
