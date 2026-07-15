import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

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

  it('严格模式下每次开始生成只创建一个任务', async () => {
    vi.useFakeTimers();

    try {
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );

      fireEvent.click(screen.getByRole('button', { name: '生成' }));
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
      });

      fireEvent.click(screen.getByRole('button', { name: /任务队列，0 个进行中任务，展开/ }));
      expect(screen.getAllByText('已完成')).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('批准已提交审核的结果后开放下载', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    expect(screen.getByText('待审核')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));

    expect(screen.getAllByRole('link', { name: '下载结果' })).toHaveLength(2);
  });
});
