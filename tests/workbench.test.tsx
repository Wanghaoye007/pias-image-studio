import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
import { buildCanvasGraph, getOperationLabel } from '../src/workbench/graph';
import { SceneRail } from '../src/workbench/SceneRail';
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
    expect(graph.nodes.find((node) => node.id === `job:${settled.jobs[0].id}`)).toMatchObject({
      data: { previewImageUrl: settled.scenes[0].imageUrl },
    });
    expect(graph.edges[0]).toMatchObject({
      source: 'scene:scene-source',
      target: `job:${settled.jobs[0].id}`,
    });
    expect(graph.edges[1]).toMatchObject({
      source: `job:${settled.jobs[0].id}`,
      target: `result:${settled.results[0].id}`,
    });
  });

  it('projects a transient draft task and edge without mutating studio state', () => {
    const state = initialStudioState();
    const graph = buildCanvasGraph(state, 'scene:scene-source', 'blend', {}, {
      mode: 'configuring-draft-node',
      parameters: {},
      ratio: '1:1',
      onParameterChange: vi.fn(),
      draftNode: {
        sourceNodeId: 'scene:scene-source',
        screenPosition: { x: 640, y: 360 },
        canvasPosition: { x: 860, y: 420 },
        placement: 'right',
        selectedTool: 'blend',
      },
    });

    expect(graph.nodes.find((node) => node.id === 'draft:task')).toMatchObject({
      type: 'draft-task',
      position: { x: 860, y: 420 },
      data: { tool: 'blend', sourceNodeId: 'scene:scene-source' },
    });
    expect(graph.edges.find((edge) => edge.id === 'draft-edge')).toMatchObject({
      source: 'scene:scene-source',
      target: 'draft:task',
      animated: true,
    });
    expect(state.jobs).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
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

  it('localizes legacy operation names in derived scene nodes and edges', () => {
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
      operation: 'Directional Light',
    });

    const graph = buildCanvasGraph(derived, 'scene:scene-2', 'light');
    const legacyScene = graph.nodes.find((node) => node.id === 'scene:scene-2');
    const derivedEdge = graph.edges.find((edge) => edge.id === 'edge-1');

    expect(legacyScene).toMatchObject({
      data: { scene: { operation: '定向光', title: '定向光场景' } },
    });
    expect(derivedEdge).toMatchObject({ label: '定向光' });
    expect(legacyScene).not.toMatchObject({
      data: { scene: { operation: 'Directional Light', title: 'Directional Light场景' } },
    });

    expect(Object.fromEntries([
      'Generate',
      'Blend',
      'Directional Light',
      'Quick Angle',
      'Expand',
      'Upscale',
      'Remove',
      'Extract',
    ].map((operation) => [operation, getOperationLabel(operation)]))).toEqual({
      Generate: '生成',
      Blend: '融图',
      'Directional Light': '定向光',
      'Quick Angle': '快速视角',
      Expand: '扩图',
      Upscale: '超分',
      Remove: '去除',
      Extract: '抠图',
    });
    expect(getOperationLabel('Retouch Beta')).toBe('其他处理');
    expect(getOperationLabel('レタッチ')).toBe('其他处理');
    expect(getOperationLabel('拡張')).toBe('其他处理');
    expect(getOperationLabel('확장')).toBe('其他处理');
    expect(getOperationLabel('Ретушь')).toBe('其他处理');
    expect(getOperationLabel('商品素材')).toBe('商品素材');
  });

  it('localizes legacy scene titles in the scene rail and its accessible names', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1,
      actualCredits: 15,
    });
    const state = createDerivedScene(settled, {
      parentSceneId: 'scene-source',
      sourceResultId: settled.results[0].id,
      operation: 'Directional Light',
    });

    render(
      <SceneRail
        collapsed={false}
        onSelectScene={vi.fn()}
        onToggleCollapsed={vi.fn()}
        state={state}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '场景' }));

    expect(screen.getByRole('button', { name: '定向光场景，PIAS-SF-001' })).toBeInTheDocument();
    expect(screen.queryByText('Directional Light场景')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Directional Light场景/ })).not.toBeInTheDocument();
  });

  it('provides Chinese labels for canvas node states', () => {
    expect(getJobStatusLabel('queued')).toBe('等待中');
    expect(getJobStatusLabel('running')).toBe('生成中');
    expect(getJobStatusLabel('succeeded')).toBe('已完成');
    expect(getReviewStatusLabel('submitted')).toBe('待审核');
  });

  it('renders selected light controls and an expansion grid only in their editing modes', () => {
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
            interactionMode: 'editing-light',
            parameters: { lightDirection: 'top-right' },
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
            interactionMode: 'editing-expand',
            parameters: { expandScale: 72 },
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

  it('opens a searchable reference-material picker from blend settings', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '融图' }));
    fireEvent.click(screen.getByRole('button', { name: '选择参考素材' }));

    const picker = screen.getByRole('dialog', { name: '选择参考素材' });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索参考素材' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: /活动参考，PIAS-REF-SEA/ })).toBeInTheDocument();
  });

  it('synchronizes the light direction overlay with the tool controls', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '定向光' }));
    fireEvent.click(screen.getByRole('button', { name: '左下光' }));

    expect(screen.getByLabelText('定向光控制点')).toHaveAttribute('data-direction', 'bottom-left');
    expect(screen.getByLabelText('定向光控制')).toHaveStyle({
      '--light-angle': '135deg',
    });
    expect(screen.getByLabelText('定向光控制').querySelectorAll('.light-overlay__ray')).toHaveLength(5);
  });

  it('exposes stable state hooks for visual frame comparison', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '定向光' }));

    const panel = screen.getByRole('dialog', { name: '定向光参数' });
    const overlay = screen.getByLabelText('定向光控制');
    expect(panel).toHaveAttribute('data-placement', 'right');
    expect(panel).toHaveAttribute('data-tool', 'light');
    expect(overlay).toHaveAttribute('data-overlay', 'light');
    expect(overlay.closest('.canvas-node')).toHaveAttribute('data-interaction-mode', 'editing-light');
  });

  it('shows an image boundary and nine-cell grid only while expanding', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '扩图' }));
    expect(screen.getByLabelText('扩图构图区域')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭参数面板' }));
    expect(screen.queryByLabelText('扩图构图区域')).not.toBeInTheDocument();
  });

  it('renders accessible result actions, hides locked downloads, and enables real approved downloads', () => {
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
    expect(screen.queryByRole('link', { name: '下载结果' })).not.toBeInTheDocument();

    deriveButton.click();
    reviewButton.click();
    expect(onDerive).toHaveBeenCalledWith(result);
    expect(onSubmitReview).toHaveBeenCalledWith(result.id);

    const approved = { ...result, reviewStatus: 'approved' as const };
    render(
      <ReactFlowProvider>
        <ResultCanvasNode
          data={{ kind: 'result', result: approved, selected: false, actions: {} }}
          id="result:result-approved"
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
    expect(screen.getByRole('link', { name: '下载结果' })).toHaveAttribute('href', '/result.png');
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

  it('shows a compact workbench status bar without non-functional controls', () => {
    render(<WorkbenchHarness />);

    const statusBar = screen.getByLabelText('工作台状态');
    expect(statusBar).toHaveTextContent('2026 夏季 SKU 上新');
    expect(statusBar).toHaveTextContent('已自动保存');
    expect(statusBar).toHaveTextContent('可用点数 2000');
    expect(statusBar).toHaveTextContent('任务 0');
    expect(within(statusBar).queryByRole('button')).not.toBeInTheDocument();
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

  it('binds an asset as a blend reference when it is dropped on an existing image node', () => {
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);
    const asset = screen.getByRole('button', { name: /护肤套装，PIAS-SK-014/ });
    const sourceImage = screen.getByAltText('源场景');
    const dataTransfer = createDataTransfer('asset-pack');

    fireEvent.dragStart(asset, { dataTransfer });
    fireEvent.dragOver(sourceImage, { dataTransfer });
    fireEvent.drop(sourceImage, {
      clientX: 240,
      clientY: 180,
      dataTransfer,
    });

    expect(latestState.scenes).toHaveLength(1);
    expect(latestState.selectedTool).toBe('blend');
    const panel = screen.getByRole('dialog', { name: '融图参数' });
    expect(within(panel).getByRole('button', { name: '选择参考素材' })).toHaveTextContent('护肤套装');
    expect(screen.getByRole('status', { name: '画布操作反馈' })).toHaveTextContent('已绑定护肤套装');
  });

  it('creates, duplicates, renames, and deletes unused scenes from the canvas command bar', () => {
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '新建空白场景' }));
    expect(latestState.scenes.at(-1)).toMatchObject({ title: '未命名场景', imageUrl: '' });

    fireEvent.click(screen.getByRole('button', { name: '复制选中节点' }));
    expect(latestState.scenes.at(-1)).toMatchObject({ title: '未命名场景 副本' });

    fireEvent.click(screen.getByRole('button', { name: '重命名选中节点' }));
    const renameDialog = screen.getByRole('dialog', { name: '重命名场景' });
    fireEvent.change(within(renameDialog).getByRole('textbox', { name: '场景名称' }), {
      target: { value: '主视觉备选' },
    });
    fireEvent.click(within(renameDialog).getByRole('button', { name: '保存场景名称' }));
    expect(latestState.scenes.at(-1)?.title).toBe('主视觉备选');

    fireEvent.click(screen.getByRole('button', { name: '删除选中节点' }));
    const deleteDialog = screen.getByRole('dialog', { name: '删除场景' });
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '确认删除场景' }));

    expect(latestState.scenes.map((scene) => scene.title)).toEqual(['源场景', '未命名场景']);
    expect(screen.getByRole('status', { name: '画布操作反馈' })).toHaveTextContent('已删除主视觉备选');
  });

  it('closes a node command dialog when the selected scene changes', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '新建空白场景' }));
    fireEvent.click(screen.getByRole('button', { name: '重命名选中节点' }));
    expect(screen.getByRole('dialog', { name: '重命名场景' })).toBeInTheDocument();

    fireEvent.click(screen.getByAltText('源场景'));

    expect(screen.queryByRole('dialog', { name: '重命名场景' })).not.toBeInTheDocument();
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

    expect(screen.getAllByText('等待中')).toHaveLength(1);
    expect(screen.getAllByText('等待调度')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '取消任务' })).toBeInTheDocument();
  });

  it('closes tool layers on submit and focuses the source plus task placeholder', () => {
    render(<WorkbenchHarness />);
    reactFlowMocks.fitView.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(screen.queryByRole('dialog', { name: '生成参数' })).not.toBeInTheDocument();
    expect(reactFlowMocks.fitView).toHaveBeenCalledWith(expect.objectContaining({ duration: 320 }));
  });

  it('moves through queue, generation, detail, and completion stages', async () => {
    vi.useFakeTimers();

    try {
      render(<WorkbenchHarness />);
      fireEvent.click(screen.getByRole('button', { name: '生成' }));
      fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
      expect(screen.getAllByText('等待调度').length).toBeGreaterThan(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(screen.getAllByText('正在生成').length).toBeGreaterThan(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2700);
      });
      expect(screen.getAllByText('优化细节').length).toBeGreaterThan(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2800);
      });
      expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a derived branch and snapshots inputs when a tool runs from a selected result', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    let latestState = settled;
    render(<WorkbenchHarness initialState={settled} onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByAltText('生成 1'));
    fireEvent.click(screen.getByRole('button', { name: '定向光' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
      target: { value: '右上方柔光，保留瓶身标签' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '画面比例' }), {
      target: { value: '4:5' },
    });
    fireEvent.change(screen.getByRole('slider', { name: '光线强度' }), {
      target: { value: '72' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    const branchScene = latestState.scenes.at(-1)!;
    const branchJob = latestState.jobs.at(-1)!;
    expect(branchScene).toMatchObject({
      parentSceneId: 'scene-source',
      sourceResultId: settled.results[0].id,
      operation: '定向光',
    });
    expect(branchJob).toMatchObject({
      sceneId: branchScene.id,
      inputSnapshot: {
        inputKind: 'result',
        inputNodeId: settled.results[0].id,
        sourceResultId: settled.results[0].id,
        prompt: '右上方柔光，保留瓶身标签',
        ratio: '4:5',
        parameters: { lightIntensity: 72 },
      },
    });
    expect(branchJob.inputSnapshot.parameters).toEqual({
      lightDirection: 'top-right',
      lightIntensity: 72,
      lightTemperature: 5200,
    });
  });

  it('offers a keyboard-click path for adding an asset to the canvas', () => {
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: /护肤套装，PIAS-SK-014/ }));

    expect(latestState.scenes.at(-1)).toMatchObject({ sourceAssetId: 'asset-pack' });
  });

  it('renders an actionable mobile result preview alongside the desktop canvas', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });

    render(<WorkbenchHarness initialState={settled} />);

    const preview = screen.getByLabelText('移动端结果预览');
    expect(preview).toHaveTextContent('移动端预览');
    expect(within(preview).getByRole('button', { name: '提交审核' })).toBeInTheDocument();
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
        await vi.advanceTimersByTimeAsync(6400);
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
        await vi.advanceTimersByTimeAsync(6400);
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

    expect(screen.getAllByText('等待中')).toHaveLength(1);
    expect(screen.getAllByText('等待调度')).toHaveLength(2);
    expect(latestState.jobs).toHaveLength(2);
    expect(latestState.jobs[0]).toMatchObject({ id: queued.jobs[0].id, status: 'failed' });
    expect(latestState.jobs[1]).toMatchObject({ status: 'queued' });
    expect(latestState.jobs[1].id).not.toBe(queued.jobs[0].id);
  });
});
