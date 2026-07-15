import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { getAuditTargetLabel } from '../src/SecondaryViews';
import { initialStudioState } from '../src/domain';

describe('PIAS 中文应用框架', () => {
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
      expect(screen.getByText('草稿')).toBeInTheDocument();
      expect(screen.getByText('待审核')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: '生成 2' }).closest('article')).toHaveTextContent('审核已通过');

      fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
      fireEvent.click(screen.getByRole('button', { name: '生成' }));
      fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
        target: { value: '白色棚拍背景' },
      });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      fireEvent.click(screen.getByRole('button', { name: /任务队列，1 个进行中任务，展开/ }));
      expect(screen.getAllByText('等待中')).toHaveLength(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getAllByText('生成中')).toHaveLength(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });

      expect(screen.queryAllByText('已完成')).not.toHaveLength(0);
      ['queued', 'running', 'succeeded', 'failed', 'canceled', 'draft', 'submitted', 'approved', 'returned'].forEach((status) => {
        expect(screen.queryByText(status, { exact: true })).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('批准目标待审核结果后才为该结果开放下载，并隐藏内部标识', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    const getReviewRow = (title: string) => screen.getByRole('img', { name: title }).closest('article')!;
    const pendingRow = getReviewRow('生成 1');
    const approvedRow = getReviewRow('生成 2');

    expect(pendingRow).toHaveTextContent('待审核');
    expect(within(pendingRow).queryByRole('link', { name: '下载结果' })).not.toBeInTheDocument();
    expect(within(approvedRow).getByRole('link', { name: '下载结果' })).toBeInTheDocument();
    expect(pendingRow).not.toHaveTextContent('scene-source');
    expect(pendingRow).toHaveTextContent('源场景');
    expect(pendingRow).toHaveTextContent('PIAS-SF-001');

    fireEvent.click(within(pendingRow).getByRole('button', { name: '通过审核' }));

    const approvedPendingRow = getReviewRow('生成 1');
    expect(approvedPendingRow).toHaveTextContent('审核已通过');
    expect(within(approvedPendingRow).getByRole('link', { name: '下载结果' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '用量' }));
    expect(screen.getByText('任务 01 · 生成')).toBeInTheDocument();
    expect(screen.queryByText('job-1', { exact: true })).not.toBeInTheDocument();
  });

  it('首页审计对象显示中文业务信息，不暴露内部对象 ID', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '首页' }));

    expect(screen.getAllByText('任务 01 · 生成').length).toBeGreaterThan(0);
    expect(screen.getByText('融图场景 · PIAS-SF-001')).toBeInTheDocument();
    expect(screen.getByText('生成 1')).toBeInTheDocument();
    ['job-1', 'scene-2', 'result-1'].forEach((id) => {
      expect(screen.queryByText(id, { exact: true })).not.toBeInTheDocument();
    });
  });

  it('未知审计对象显示通用中文名称', () => {
    expect(getAuditTargetLabel(initialStudioState(), 'missing-object')).toBe('操作对象');
  });
});
