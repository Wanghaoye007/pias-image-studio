import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

describe('PIAS Image Studio app', () => {
  it('renders Chinese labels without exposing internal task or review enums', async () => {
    vi.useFakeTimers();
    const { container } = render(<App />);

    expect(screen.getByRole('heading', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片工作台' })).toBeInTheDocument();
    expect(screen.getByText('最近操作')).toBeInTheDocument();
    expect(screen.getByText('PIAS 日本')).toBeInTheDocument();
    expect(screen.getAllByText('审核已通过').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '创建生成任务' }));
    expect(screen.getAllByText('等待中').length).toBeGreaterThan(0);
    expect(container).not.toHaveTextContent('queued');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getAllByText('生成中').length).toBeGreaterThan(0);
    expect(container).not.toHaveTextContent('running');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('草稿').length).toBeGreaterThan(0);
    expect(container).not.toHaveTextContent('succeeded');
    expect(container).not.toHaveTextContent('draft');

    fireEvent.click(container.querySelector('.result-tile button[title="提交审核"]')!);
    expect(screen.getAllByText('待审核').length).toBeGreaterThan(0);
    expect(container).not.toHaveTextContent('submitted');

    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));
    expect(screen.getAllByText('审核已通过').length).toBeGreaterThan(0);
    expect(container).not.toHaveTextContent('approved');
    vi.useRealTimers();
  });

  it('renders the Chinese workbench and enterprise governance surfaces', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByText('项目')).toBeInTheDocument();
    expect(screen.getByText('审核')).toBeInTheDocument();
    expect(screen.getByText('用量')).toBeInTheDocument();
    expect(screen.getByText('企业管理')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
    expect(screen.getByText('SKU 素材')).toBeInTheDocument();
  });

  it('provides accessible names for product imagery and primary navigation', () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));

    container.querySelectorAll('img').forEach((image) => {
      expect(image.getAttribute('alt')).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: '图片工作台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '素材库' })).toBeInTheDocument();
  });

  it('creates one job and one result batch per click in strict mode', async () => {
    vi.useFakeTimers();
    const { container } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '创建生成任务' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(container.querySelectorAll('.job-row')).toHaveLength(2);
    expect(container.querySelectorAll('.result-tile')).toHaveLength(3);
    expect(container.querySelectorAll('a[download]')).toHaveLength(0);

    fireEvent.click(container.querySelector('.result-tile button[title="提交审核"]')!);
    fireEvent.click(screen.getByRole('button', { name: '审核' }));
    expect(screen.getByText('1 项待审核')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));
    fireEvent.click(screen.getByRole('button', { name: '图片工作台' }));
    expect(container.querySelectorAll('a[download]')).toHaveLength(1);
    vi.useRealTimers();
  });
});
