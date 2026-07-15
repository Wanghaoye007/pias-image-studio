import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import {
  completeJob,
  createDerivedScene,
  createJob,
  failJob,
  initialStudioState,
  type Result,
  type StudioState,
} from '../src/domain';
import {
  ResultCanvasNode,
  SceneCanvasNode,
  getJobStatusLabel,
  getReviewStatusLabel,
} from '../src/workbench/CanvasNodes';
import { buildCanvasGraph } from '../src/workbench/graph';
import { Workbench } from '../src/workbench/Workbench';

const reactFlowMocks = vi.hoisted(() => ({
  fitView: vi.fn(() => Promise.resolve(true)),
  screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();

  return {
    ...actual,
    useReactFlow: () => ({
      fitView: reactFlowMocks.fitView,
      screenToFlowPosition: reactFlowMocks.screenToFlowPosition,
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
    }),
  };
});

function WorkbenchHarness({
  initialState = initialStudioState(),
  onStateChange,
}: {
  initialState?: StudioState;
  onStateChange?: (state: StudioState) => void;
}) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  return <Workbench state={state} setState={setState} />;
}

function createDataTransfer(assetId: string): DataTransfer {
  return {
    getData: (type: string) => type === 'application/x-pias-asset' ? assetId : '',
    setData: vi.fn(),
  } as unknown as DataTransfer;
}

describe('workbench canvas', () => {
  it('maps scenes, jobs, and results to separate connected canvas nodes', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1,
      actualCredits: 15,
    });

    const graph = buildCanvasGraph(settled, 'scene:scene-source', 'generate');

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'scene:scene-source',
      `job:${settled.jobs[0].id}`,
      `result:${settled.results[0].id}`,
    ]);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({
      source: 'scene:scene-source',
      target: `job:${settled.jobs[0].id}`,
    });
    expect(graph.edges[1]).toMatchObject({
      source: `job:${settled.jobs[0].id}`,
      target: `result:${settled.results[0].id}`,
    });
  });

  it('maps derivation edges from a result to its derived scene', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1,
      actualCredits: 15,
    });
    const derived = createDerivedScene(settled, {
      parentSceneId: 'scene-source',
      sourceResultId: settled.results[0].id,
      operation: '融图',
    });
    const graph = buildCanvasGraph(derived, 'scene:scene-2', 'blend');

    expect(graph.edges.at(-1)).toMatchObject({
      source: `result:${settled.results[0].id}`,
      target: 'scene:scene-2',
      label: '融图',
    });
  });

  it('provides Chinese labels for canvas node states', () => {
    expect(getJobStatusLabel('queued')).toBe('等待中');
    expect(getJobStatusLabel('running')).toBe('生成中');
    expect(getJobStatusLabel('succeeded')).toBe('已完成');
    expect(getReviewStatusLabel('submitted')).toBe('待审核');
  });

  it('renders selected light controls and an expansion grid for scene nodes', () => {
    const state = initialStudioState();
    const scene = state.scenes[0];
    const { rerender } = render(
      <ReactFlowProvider>
        <SceneCanvasNode
          data={{
            kind: 'scene',
            scene,
            results: [],
            selected: true,
            activeTool: 'light',
          }}
          id="scene:scene-source"
          type="scene"
          isConnectable
          zIndex={0}
          dragging={false}
          selected={false}
          selectable
          deletable
          draggable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByLabelText('定向光控制点')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/定向光控制柄/)).toHaveLength(8);

    rerender(
      <ReactFlowProvider>
        <SceneCanvasNode
          data={{
            kind: 'scene',
            scene,
            results: [],
            selected: true,
            activeTool: 'expand',
          }}
          id="scene:scene-source"
          type="scene"
          isConnectable
          zIndex={0}
          dragging={false}
          selected={false}
          selectable
          deletable
          draggable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByLabelText('扩图范围网格')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/扩图区域/)).toHaveLength(9);
  });

  it('renders accessible result actions and forwards domain action requests', () => {
    const result: Result = {
      id: 'result-1',
      sourceSceneId: 'scene-source',
      jobId: 'job-1',
      assetId: 'generated-result-1',
      title: '生成 1',
      imageUrl: '/result.png',
      reviewStatus: 'draft',
      x: 0,
      y: 0,
    };
    const onDerive = vi.fn();
    const onSubmitReview = vi.fn();

    render(
      <ReactFlowProvider>
        <ResultCanvasNode
          data={{
            kind: 'result',
            result,
            selected: false,
            actions: { onDerive, onSubmitReview },
          }}
          id="result:result-1"
          type="result"
          isConnectable
          zIndex={0}
          dragging={false}
          selected={false}
          selectable
          deletable
          draggable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    );

    const deriveButton = screen.getByRole('button', { name: '继续创作' });
    const reviewButton = screen.getByRole('button', { name: '提交审核' });
    expect(screen.getByAltText('生成 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载结果' })).toBeDisabled();

    deriveButton.click();
    reviewButton.click();
    expect(onDerive).toHaveBeenCalledWith(result);
    expect(onSubmitReview).toHaveBeenCalledWith(result.id);
  });

  it('opens a Chinese context panel from the floating tool palette', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '融图' }));

    expect(screen.getByRole('dialog', { name: '融图参数' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始生成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '融图' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '关闭参数面板' }));
    expect(screen.queryByRole('dialog', { name: '融图参数' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '融图' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves keyboard focus into the parameter dialog and returns it to its tool trigger on Escape', () => {
    render(<WorkbenchHarness />);
    const toolButton = screen.getByRole('button', { name: '融图' });

    toolButton.focus();
    fireEvent.click(toolButton);

    const description = screen.getByRole('textbox', { name: '创作描述' });
    expect(description).toHaveFocus();

    fireEvent.keyDown(description, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '融图参数' })).not.toBeInTheDocument();
    expect(toolButton).toHaveFocus();
  });

  it('keeps the task tray and scene library in the workbench', () => {
    render(<WorkbenchHarness />);

    expect(screen.getByRole('complementary', { name: '场景与素材' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /任务队列/ })).toBeInTheDocument();
  });

  it('creates a source node when a library asset is dropped on the canvas', () => {
    render(<WorkbenchHarness />);
    const asset = screen.getByRole('button', { name: /PIAS-SK-014/ });
    const dataTransfer = createDataTransfer('asset-pack');

    fireEvent.dragStart(asset, { dataTransfer });
    fireEvent.drop(screen.getByLabelText('节点画布'), {
      clientX: 640,
      clientY: 360,
      dataTransfer,
    });

    expect(screen.getAllByText('PIAS-SK-014')).toHaveLength(2);
  });

  it('fits the selected scene node instead of estimating a fixed center', () => {
    reactFlowMocks.fitView.mockClear();
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('tab', { name: '场景' }));
    fireEvent.click(screen.getByRole('button', { name: /源场景，PIAS-SF-001/ }));

    expect(reactFlowMocks.fitView).toHaveBeenCalledWith(expect.objectContaining({
      nodes: [{ id: 'scene:scene-source' }],
    }));
  });

  it('runs a task and exposes cancellation while it is queued', () => {
    render(<WorkbenchHarness />);
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
      target: { value: '干净的白色棚拍背景' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));

    expect(screen.getAllByText('等待中')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '取消任务' })).toBeInTheDocument();
  });

  it('reschedules an initially queued job in StrictMode and settles it exactly once', async () => {
    vi.useFakeTimers();
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    let latestState = queued;

    try {
      render(
        <StrictMode>
          <WorkbenchHarness initialState={queued} onStateChange={(state) => { latestState = state; }} />
        </StrictMode>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
      });

      expect(latestState.jobs[0]).toMatchObject({ status: 'succeeded', progress: 100 });
      expect(latestState.results).toHaveLength(1);
      expect(latestState.auditEvents.filter((event) => event.type === 'job.succeeded')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not create outputs when a canceled job reaches its delayed completion callback', async () => {
    vi.useFakeTimers();
    let latestState = initialStudioState();

    try {
      render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);
      fireEvent.click(screen.getByRole('button', { name: '生成' }));
      fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
        target: { value: '干净的白色棚拍背景' },
      });
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));
      fireEvent.click(screen.getByRole('button', { name: '取消任务' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
      });

      expect(latestState.jobs[0]).toMatchObject({ status: 'canceled' });
      expect(latestState.results).toHaveLength(0);
      expect(latestState.usage).toMatchObject({ frozenCredits: 0, spentCredits: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows failed tasks to be retried from the task tray', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    const failed = failJob(queued, queued.jobs[0].id, '图像服务暂时不可用');
    let latestState = failed;
    render(<WorkbenchHarness initialState={failed} onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));
    expect(screen.getAllByText('图像服务暂时不可用')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '重试任务' })[0]);

    expect(screen.getAllByText('等待中')).toHaveLength(3);
    expect(latestState.jobs).toHaveLength(2);
    expect(latestState.jobs[0]).toMatchObject({ id: queued.jobs[0].id, status: 'failed' });
    expect(latestState.jobs[1]).toMatchObject({ status: 'queued' });
    expect(latestState.jobs[1].id).not.toBe(queued.jobs[0].id);
  });
});
