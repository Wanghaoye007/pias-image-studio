import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

function WorkbenchHarness({ initialState = initialStudioState() }: { initialState?: StudioState }) {
  const [state, setState] = useState(initialState);
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

  it('allows failed tasks to be retried from the task tray', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    const failed = failJob(queued, queued.jobs[0].id, '图像服务暂时不可用');
    render(<WorkbenchHarness initialState={failed} />);

    fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));
    expect(screen.getAllByText('图像服务暂时不可用')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '重试任务' })[0]);

    expect(screen.getAllByText('等待中')).toHaveLength(3);
  });
});
