import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import {
  approveResult,
  attachExternalJob,
  completeJob,
  createDerivedScene,
  createJob,
  failJob,
  initialStudioState,
  returnResult,
  submitForReview,
  type Result,
  type StudioState,
} from '../src/shared/domain';
import {
  ResultCanvasNode,
  SceneCanvasNode,
  getJobStatusLabel,
  getReviewStatusLabel,
} from '../src/client/workbench/CanvasNodes';
import { DraftTaskNode } from '../src/client/workbench/DraftTaskNode';
import { RemoveMaskOverlay } from '../src/client/workbench/CanvasOverlays';
import { buildCanvasGraph, getOperationLabel } from '../src/client/workbench/graph';
import { NodeTypePicker } from '../src/client/workbench/NodeTypePicker';
import { ResultCompare } from '../src/client/workbench/ResultCompare';
import { SceneRail } from '../src/client/workbench/SceneRail';
import { Workbench } from '../src/client/workbench/Workbench';

const reactFlowMocks = vi.hoisted(() => ({
  fitView: vi.fn(() => Promise.resolve(true)),
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
  setViewport: vi.fn(() => Promise.resolve(true)),
  updateNodeInternals: vi.fn(),
}));

const deliveryMocks = vi.hoisted(() => ({
  downloadProductionDelivery: vi.fn(() => Promise.resolve(['result.png', 'manifest.csv', 'manifest.json'])),
  downloadWatermarkedPreview: vi.fn(() => Promise.resolve('result-preview.png')),
}));

const falClientMocks = vi.hoisted(() => ({
  cancelFalImageJob: vi.fn(() => Promise.resolve()),
  FAL_LIFECYCLE_ABORT_REASON: 'content-studio:lifecycle-unmount',
  runFalImageJob: vi.fn(async (
    _input: unknown,
    options: {
      onExecution?: (execution: { requestId: string; modelId: string }) => void;
      onProgress?: (progress: number) => void;
      signal?: AbortSignal;
    },
  ) => {
    options.onExecution?.({ requestId: 'req-default', modelId: 'model-default' });
    options.onProgress?.(55);
    return {
      images: [{ url: 'https://fal.media/default.png', width: 1024, height: 1024 }],
      seed: 7,
      modelId: 'model-default',
      childRequestIds: ['req-child-default'],
    };
  }),
  resumeFalImageJob: vi.fn(async (
    _execution: unknown,
    options: {
      onProgress?: (progress: number) => void;
      signal?: AbortSignal;
    },
  ) => {
    options.onProgress?.(94);
    return {
      images: [{ url: 'https://fal.media/resumed.png', width: 1024, height: 1024 }],
      seed: 8,
      modelId: 'model-resumed',
      childRequestIds: ['req-child-resumed'],
    };
  }),
}));

vi.mock('../src/client/export/exportDelivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client/export/exportDelivery')>()),
  ...deliveryMocks,
}));

vi.mock('../src/client/fal/falImageClient', () => falClientMocks);

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();

  return {
    ...actual,
    useUpdateNodeInternals: () => reactFlowMocks.updateNodeInternals,
    useReactFlow: () => ({
      fitView: reactFlowMocks.fitView,
      getViewport: reactFlowMocks.getViewport,
      screenToFlowPosition: reactFlowMocks.screenToFlowPosition,
      setViewport: reactFlowMocks.setViewport,
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

function ResultCompareHarness({ results }: { results: Result[] }) {
  const [open, setOpen] = useState(false);
  const [visibleResults, setVisibleResults] = useState(results);

  return (
    <ResultCompare
      onClose={() => setOpen(false)}
      onInspect={vi.fn()}
      onOpen={() => setOpen(true)}
      onRemove={(resultId) => setVisibleResults((current) => current.filter((result) => result.id !== resultId))}
      open={open}
      results={visibleResults}
    />
  );
}

function createDataTransfer(assetId: string): DataTransfer {
  return {
    getData: (type: string) => type === 'application/x-content-studio-asset' ? assetId : '',
    setData: vi.fn(),
  } as unknown as DataTransfer;
}

describe('workbench canvas', () => {
  beforeEach(() => {
    falClientMocks.cancelFalImageJob.mockReset();
    falClientMocks.cancelFalImageJob.mockResolvedValue(undefined);
    falClientMocks.runFalImageJob.mockReset();
    falClientMocks.resumeFalImageJob.mockReset();
    falClientMocks.runFalImageJob.mockImplementation(async (_input, options) => {
      options.onExecution?.({ requestId: 'req-default', modelId: 'model-default' });
      options.onProgress?.(55);
      return {
        images: [{ url: 'https://fal.media/default.png', width: 1024, height: 1024 }],
        seed: 7,
        modelId: 'model-default',
        childRequestIds: ['req-child-default'],
      };
    });
    falClientMocks.resumeFalImageJob.mockImplementation(async (_execution, options) => {
      options.onProgress?.(94);
      return {
        images: [{ url: 'https://fal.media/resumed.png', width: 1024, height: 1024 }],
        seed: 8,
        modelId: 'model-resumed',
        childRequestIds: ['req-child-resumed'],
      };
    });
  });

  it('charges only successful outputs when Fal returns a partial result', async () => {
    falClientMocks.runFalImageJob.mockImplementationOnce(async (_input, options) => {
      options.onExecution?.({ requestId: 'req-partial', modelId: 'model-partial' });
      return {
        images: [
          { url: 'https://fal.media/partial-1.png', width: 1024, height: 1024 },
          { url: 'https://fal.media/partial-2.png', width: 1024, height: 1024 },
        ],
        seed: 9,
        modelId: 'model-partial',
        childRequestIds: ['req-partial'],
      };
    });
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 4,
    });
    let latestState = queued;

    render(<WorkbenchHarness initialState={queued} onStateChange={(state) => { latestState = state; }} />);

    await waitFor(() => expect(latestState.jobs[0].status).toBe('partially_succeeded'));
    expect(latestState.jobs[0]).toMatchObject({ reservedCredits: 60, actualCredits: 30 });
    expect(latestState.usage).toMatchObject({
      availableCredits: 1970,
      frozenCredits: 0,
      spentCredits: 30,
    });
  });

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
      'Quick Angle': '多角度',
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

    expect(screen.getByRole('button', { name: '定向光场景，AST-SF-001' })).toBeInTheDocument();
    expect(screen.queryByText('Directional Light场景')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Directional Light场景/ })).not.toBeInTheDocument();
  });

  it('provides Chinese labels for canvas node states', () => {
    expect(getJobStatusLabel('preflight')).toBe('预检中');
    expect(getJobStatusLabel('queued')).toBe('等待中');
    expect(getJobStatusLabel('running')).toBe('生成中');
    expect(getJobStatusLabel('postprocessing')).toBe('后处理中');
    expect(getJobStatusLabel('partially_succeeded')).toBe('部分完成');
    expect(getJobStatusLabel('cancel_requested')).toBe('正在取消');
    expect(getJobStatusLabel('succeeded')).toBe('已完成');
    expect(getJobStatusLabel('expired')).toBe('已过期');
    expect(getReviewStatusLabel('submitted')).toBe('待审核');
  });

  it('exposes a large creation handle only on selected source-capable nodes', () => {
    const state = initialStudioState();
    const onCreateNode = vi.fn();
    reactFlowMocks.updateNodeInternals.mockClear();
    const { rerender } = render(
      <ReactFlowProvider>
        <SceneCanvasNode
          data={{
            kind: 'scene',
            scene: state.scenes[0],
            results: [],
            selected: true,
            activeTool: 'generate',
            actions: { onCreateNode },
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

    const handle = screen.getByRole('button', { name: '拖拽新增节点' });
    expect(handle).toHaveClass('node-create-handle');
    expect(handle.style.getPropertyValue('--node-create-size')).toBe('44px');
    expect(handle.style.getPropertyValue('--node-create-visual-size')).toBe('36px');
    expect(reactFlowMocks.updateNodeInternals).toHaveBeenCalledWith('scene:scene-source');
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(onCreateNode).toHaveBeenCalledWith('scene:scene-source');

    rerender(
      <ReactFlowProvider>
        <SceneCanvasNode
          data={{
            kind: 'scene',
            scene: state.scenes[0],
            results: [],
            selected: false,
            activeTool: 'generate',
            actions: { onCreateNode },
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

    expect(screen.queryByRole('button', { name: '拖拽新增节点' })).not.toBeInTheDocument();
    expect(reactFlowMocks.updateNodeInternals).toHaveBeenCalledTimes(2);
  });

  it('renders eight node choices and reports the selected tool', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <NodeTypePicker
        position={{ x: 640, y: 360 }}
        onClose={onClose}
        onSelect={onSelect}
      />,
    );

    const picker = screen.getByRole('dialog', { name: '节点类型选择器' });
    expect(within(picker).getAllByRole('button')).toHaveLength(9);
    expect(within(picker).getByRole('button', { name: '生成' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '超分' })).toBeInTheDocument();
    expect(within(picker).getAllByText('生成')).toHaveLength(1);
    expect(within(picker).queryByText('选择下一步操作')).not.toBeInTheDocument();

    fireEvent.click(within(picker).getByRole('button', { name: '融图' }));
    expect(onSelect).toHaveBeenCalledWith('blend');
    fireEvent.click(within(picker).getByRole('button', { name: '关闭节点类型选择器' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders and cancels a transient draft task card', () => {
    const onCancel = vi.fn();
    render(
      <ReactFlowProvider>
        <DraftTaskNode
          data={{
            kind: 'draft-task',
            tool: 'light',
            sourceNodeId: 'scene:scene-source',
            onCancel,
          }}
          id="draft:task"
          type="draft-task"
          isConnectable
          zIndex={0}
          dragging={false}
          selected={false}
          selectable={false}
          deletable={false}
          draggable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText('修改光影')).toBeInTheDocument();
    expect(screen.getByText('待配置')).toBeInTheDocument();
    expect(screen.queryByText('设置参数后创建任务')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消新增节点' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
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
    expect(screen.getAllByLabelText(/扩图锚点/)).toHaveLength(9);
  });

  it('selects a nine-cell expansion anchor from the image overlay', () => {
    const state = initialStudioState();
    const onParameterChange = vi.fn();
    render(
      <ReactFlowProvider>
        <SceneCanvasNode
          data={{
            kind: 'scene',
            scene: state.scenes[0],
            results: [],
            selected: true,
            activeTool: 'expand',
            interactionMode: 'editing-expand',
            parameters: { expandScale: 72, expandAnchor: 'center' },
            onParameterChange,
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

    fireEvent.click(screen.getByRole('button', { name: '扩图锚点 右下' }));
    expect(onParameterChange).toHaveBeenCalledWith('expandAnchor', 'bottom-right');
  });

  it('selects a light direction from the image overlay', () => {
    const state = initialStudioState();
    const onParameterChange = vi.fn();
    render(
      <ReactFlowProvider>
        <SceneCanvasNode
          data={{
            kind: 'scene',
            scene: state.scenes[0],
            results: [],
            selected: true,
            activeTool: 'light',
            interactionMode: 'editing-light',
            parameters: { lightDirection: 'top-right' },
            onParameterChange,
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

    fireEvent.click(screen.getByRole('button', { name: '定向光控制柄 左下光' }));
    expect(onParameterChange).toHaveBeenCalledWith('lightDirection', 'bottom-left');
  });

  it('selects a camera preset from the multiple-angle orbit', () => {
    const state = initialStudioState();
    const onParameterChange = vi.fn();
    render(
      <ReactFlowProvider>
        <SceneCanvasNode
          data={{
            kind: 'scene',
            scene: state.scenes[0],
            results: [],
            selected: true,
            activeTool: 'angle',
            interactionMode: 'editing-angle',
            parameters: { horizontalAngle: 0, verticalView: 0.5 },
            onParameterChange,
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

    expect(screen.getByText('正面 0°')).toBeInTheDocument();
    expect(screen.getByText('仰视 23°')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设置拍摄方位 90°' }));
    expect(onParameterChange).toHaveBeenCalledWith('horizontalAngle', 90);
  });

  it('draws a binary remove mask and emits a Fal-ready data URL', () => {
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineCap: '',
      lineJoin: '',
      lineWidth: 0,
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,TUFTSw==');
    const onMaskChange = vi.fn();

    render(<RemoveMaskOverlay brushSize={42} onMaskChange={onMaskChange} />);
    const canvas = screen.getByLabelText('去除蒙版画布');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 256, height: 256, right: 256, bottom: 256,
      x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.pointerDown(canvas, { clientX: 64, clientY: 64, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(canvas, { clientX: 96, clientY: 96, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 96, clientY: 96, pointerId: 1 });

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1024);
    expect(context.strokeStyle).toBe('#ffffff');
    expect(onMaskChange).toHaveBeenCalledWith('data:image/png;base64,TUFTSw==');
    getContext.mockRestore();
    toDataURL.mockRestore();
  });

  it('matches the remove mask bitmap to a non-square source image', () => {
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);

    render(
      <article className="canvas-node">
        <img alt="横版源图" src="source.png" />
        <RemoveMaskOverlay brushSize={42} />
      </article>,
    );
    const sourceImage = screen.getByAltText('横版源图');
    Object.defineProperties(sourceImage, {
      naturalWidth: { configurable: true, value: 1600 },
      naturalHeight: { configurable: true, value: 900 },
    });
    fireEvent.load(sourceImage);

    const canvas = screen.getByLabelText('去除蒙版画布');
    expect(canvas).toHaveAttribute('width', '1600');
    expect(canvas).toHaveAttribute('height', '900');
    expect(context.fillRect).toHaveBeenLastCalledWith(0, 0, 1600, 900);
    getContext.mockRestore();
  });

  it('submits the painted remove mask through the unified Fal client', async () => {
    const context = {
      fillStyle: '', strokeStyle: '', lineCap: '', lineJoin: '', lineWidth: 0,
      fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      drawImage: vi.fn(),
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,V09SS0JF TkNI'.replace(' ', ''));
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '去除' }));
    const runButton = screen.getByRole('button', { name: '开始生成' });
    expect(runButton).toBeDisabled();
    const canvas = screen.getByLabelText('去除蒙版画布');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 256, height: 256, right: 256, bottom: 256,
      x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.pointerDown(canvas, { clientX: 80, clientY: 80, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 96, clientY: 96, pointerId: 1 });
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    await waitFor(() => expect(falClientMocks.runFalImageJob).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'remove',
        outputCount: 1,
        maskImageUrl: 'data:image/png;base64,V09SS0JFTkNI',
      }),
      expect.any(Object),
    ));
    expect(latestState.jobs[0].inputSnapshot.maskImageUrl)
      .toBe('data:image/png;base64,V09SS0JFTkNI');
    getContext.mockRestore();
    toDataURL.mockRestore();
  });

  it('opens a searchable reference-material picker from blend settings', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '融图' }));
    fireEvent.click(screen.getByRole('button', { name: '选择参考素材' }));

    const picker = screen.getByRole('dialog', { name: '选择参考素材' });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索参考素材' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: /活动参考，AST-REF-SEA/ })).toBeInTheDocument();
  });

  it('shows Fal-native controls and snapshots a single multiple-angles node', () => {
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '多角度' }));

    const panel = screen.getByRole('dialog', { name: '多角度参数' });
    expect(panel).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: '节点命令' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('textbox', { name: '创作描述' })).not.toBeInTheDocument();
    expect(within(panel).getByText('模型会推断不可见区域，结果需人工复核')).toBeInTheDocument();
    expect(within(panel).getByRole('slider', { name: '水平旋转' })).toHaveAttribute('min', '-90');
    expect(within(panel).getByRole('slider', { name: '水平旋转' })).toHaveAttribute('max', '90');
    expect(within(panel).getByRole('tab', { name: '侧面视角' })).toBeInTheDocument();
    expect(within(panel).queryByRole('tab', { name: '背面视角' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('slider', { name: '镜头推进' })).toHaveAttribute('max', '10');
    expect(within(panel).getByRole('slider', { name: '垂直视角' })).toHaveAttribute('step', '0.1');
    expect(within(panel).getByRole('slider', { name: '水平旋转' })).toHaveValue('-45');
    expect(within(panel).getByRole('slider', { name: '垂直视角' })).toHaveValue('-0.7');

    fireEvent.click(within(panel).getByRole('tab', { name: '正面俯拍' }));
    expect(within(panel).getByRole('slider', { name: '水平旋转' })).toHaveValue('0');
    expect(within(panel).getByRole('slider', { name: '垂直视角' })).toHaveValue('-0.8');
    expect(within(panel).getByRole('slider', { name: '镜头推进' })).toHaveValue('2');

    fireEvent.change(within(panel).getByRole('slider', { name: '水平旋转' }), {
      target: { value: '-45' },
    });
    fireEvent.change(within(panel).getByRole('slider', { name: '镜头推进' }), {
      target: { value: '3' },
    });
    fireEvent.change(within(panel).getByRole('slider', { name: '垂直视角' }), {
      target: { value: '-0.5' },
    });
    fireEvent.click(within(panel).getByRole('checkbox', { name: '广角镜头' }));
    fireEvent.click(within(panel).getByRole('button', { name: '1' }));
    fireEvent.click(within(panel).getByRole('button', { name: '开始生成' }));

    expect(latestState.jobs).toHaveLength(1);
    expect(latestState.jobs[0]).toMatchObject({
      profileId: 'angle',
      outputCount: 1,
      inputSnapshot: {
        prompt: '',
        parameters: {
          horizontalAngle: -45,
          moveForward: 3,
          verticalView: -0.5,
          wideAngle: true,
        },
      },
    });
    expect(latestState.jobs[0].inputSnapshot.parameters).not.toHaveProperty('distance');
    expect(latestState.jobs[0].inputSnapshot.parameters).not.toHaveProperty('verticalAngle');
  });

  it('runs a non-angle image job through Fal and settles the real image once', async () => {
    falClientMocks.runFalImageJob.mockImplementationOnce(async (_input, options) => {
      options.onExecution?.({ requestId: 'req-live-1', modelId: 'fal-ai/bria/product-shot' });
      options.onProgress?.(55);
      options.onProgress?.(94);
      return {
        images: [{ url: 'https://fal.media/live-generate.png', width: 1024, height: 1280 }],
        seed: 91,
        modelId: 'fal-ai/bria/product-shot',
        childRequestIds: ['req-child-1'],
      };
    });
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(latestState.jobs[0]?.status).toBe('succeeded'));
    expect(falClientMocks.runFalImageJob).toHaveBeenCalledTimes(1);
    expect(falClientMocks.runFalImageJob).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'generate',
        imageUrls: ['/demo-assets/demo-product-source.png'],
        outputCount: 1,
        parameters: { sceneTemplate: '日光展台', quality: '精细' },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(latestState.jobs[0]).toMatchObject({
      status: 'succeeded',
      externalExecution: { requestId: 'req-live-1', modelId: 'fal-ai/bria/product-shot' },
    });
    expect(latestState.results).toEqual([
      expect.objectContaining({
        imageUrl: 'https://fal.media/live-generate.png',
        width: 1024,
        height: 1280,
        generationMetadata: expect.objectContaining({ requestId: 'req-live-1', seed: 91 }),
      }),
    ]);
  });

  it('刷新后续跑已挂载的 Fal 请求，不重新提交同一任务', async () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'upscale',
      outputCount: 1,
      parameters: { upscaleSize: '2048', detailLevel: 60 },
    });
    const resumable = attachExternalJob(queued, queued.jobs[0].id, {
      provider: 'fal',
      requestId: 'fal-local-existing',
      modelId: 'fal-ai/topaz/upscale/image',
    });
    let latestState = resumable;

    render(<WorkbenchHarness
      initialState={resumable}
      onStateChange={(state) => { latestState = state; }}
    />);

    await waitFor(() => expect(latestState.jobs[0].status).toBe('succeeded'));
    expect(falClientMocks.resumeFalImageJob).toHaveBeenCalledWith(
      resumable.jobs[0].externalExecution,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(falClientMocks.runFalImageJob).not.toHaveBeenCalled();
  });

  it('fails a rejected Fal image job and releases its reserve', async () => {
    falClientMocks.runFalImageJob.mockRejectedValueOnce(new Error('Fal 服务暂时不可用'));
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '多角度' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(latestState.jobs[0]?.status).toBe('failed'));
    expect(latestState.jobs[0].errorMessage).toBe('Fal 服务暂时不可用');
    expect(latestState.results).toHaveLength(0);
    expect(latestState.usage).toMatchObject({ frozenCredits: 0, spentCredits: 0 });
  });

  it('aborts a running Fal image request when the local task is canceled', async () => {
    falClientMocks.runFalImageJob.mockImplementationOnce((_input, options) => (
      new Promise((_resolve, reject) => {
        options.onExecution?.({ requestId: 'req-cancel-1', modelId: 'fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles' });
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('任务已取消', 'AbortError'));
        }, { once: true });
      })
    ));
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '多角度' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(latestState.jobs[0]?.externalExecution?.requestId).toBe('req-cancel-1'));
    fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));

    await waitFor(() => expect(latestState.jobs[0]?.status).toBe('canceled'));
    expect(falClientMocks.cancelFalImageJob).toHaveBeenCalledWith('req-cancel-1');
    expect(latestState.results).toHaveLength(0);
    expect(latestState.usage.frozenCredits).toBe(0);
  });

  it('供应商未确认取消时恢复任务并保留冻结额度', async () => {
    falClientMocks.runFalImageJob.mockImplementationOnce((_input, options) => (
      new Promise(() => {
        options.onExecution?.({ requestId: 'req-cancel-failed', modelId: 'provider-model' });
      })
    ));
    falClientMocks.cancelFalImageJob.mockRejectedValueOnce(
      new Error('供应商未确认取消，请稍后重试'),
    );
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '多角度' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(latestState.jobs[0]?.externalExecution?.requestId).toBe('req-cancel-failed'));
    fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));

    await waitFor(() => expect(latestState.jobs[0]).toMatchObject({
      status: 'queued',
      errorMessage: '供应商未确认取消，请稍后重试',
    }));
    expect(latestState.usage.frozenCredits).toBeGreaterThan(0);
    expect(screen.getByRole('status', { name: '画布操作反馈' }))
      .toHaveTextContent('供应商未确认取消，请稍后重试');
  });

  it('synchronizes the light direction overlay with the tool controls', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '修改光影' }));
    fireEvent.click(screen.getByRole('button', { name: '主光源 后方' }));

    expect(screen.getByLabelText('定向光控制点')).toHaveAttribute('data-direction', 'back');
    expect(screen.getByLabelText('定向光控制')).toHaveStyle({
      '--light-angle': '-90deg',
    });
    expect(screen.getByLabelText('定向光控制').querySelectorAll('.light-overlay__ray')).toHaveLength(5);
  });

  it('snapshots the advanced light switches and front key-light direction', () => {
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '修改光影' }));
    const panel = screen.getByRole('dialog', { name: '修改光影参数' });
    expect(within(panel).getByText('修改光影')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: '主光源 前方' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: '智能模式' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: '轮廓光' }));
    fireEvent.click(within(panel).getByRole('button', { name: '1' }));
    fireEvent.click(within(panel).getByRole('button', { name: '开始生成' }));

    expect(latestState.jobs[0]?.inputSnapshot.parameters).toEqual({
      lightDirection: 'front',
      lightIntensity: 50,
      lightTemperature: 5200,
      lightSmartMode: true,
      rimLight: true,
    });
  });

  it('exposes stable state hooks for visual frame comparison', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '修改光影' }));

    const panel = screen.getByRole('dialog', { name: '修改光影参数' });
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

  it('renders accessible result decisions and keeps complex delivery out of compact nodes', () => {
    const result: Result = {
      id: 'result-1',
      sourceSceneId: 'scene-source',
      jobId: 'job-1',
      assetId: 'generated-result-1',
      title: '生成 1',
      imageUrl: '/result.png',
      reviewStatus: 'draft',
      isFavorite: true,
      isAdopted: true,
      isPrimary: false,
      x: 0,
      y: 0,
    };
    const onDerive = vi.fn();
    const onSubmitReview = vi.fn();
    const onToggleFavorite = vi.fn();
    const onToggleAdoption = vi.fn();
    const onSetPrimary = vi.fn();
    const onToggleCompare = vi.fn();
    const onOpenDetails = vi.fn();

    render(
      <ReactFlowProvider>
        <ResultCanvasNode
          data={{
            kind: 'result',
            result,
            selected: false,
            compareSelected: true,
            actions: {
              onDerive,
              onSubmitReview,
              onToggleFavorite,
              onToggleAdoption,
              onSetPrimary,
              onToggleCompare,
              onOpenDetails,
            },
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
    const favoriteButton = screen.getByRole('button', { name: '取消收藏' });
    const adoptionButton = screen.getByRole('button', { name: '取消采用' });
    const primaryButton = screen.getByRole('button', { name: '设置为主结果' });
    const compareButton = screen.getByRole('button', { name: '移出对比' });
    const detailsButton = screen.getByRole('button', { name: '查看结果详情' });
    expect(screen.getByAltText('生成 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '下载结果' })).not.toBeInTheDocument();
    expect(screen.getByText('已采用')).toBeInTheDocument();

    deriveButton.click();
    reviewButton.click();
    favoriteButton.click();
    adoptionButton.click();
    primaryButton.click();
    compareButton.click();
    detailsButton.click();
    expect(onDerive).toHaveBeenCalledWith(result);
    expect(onSubmitReview).toHaveBeenCalledWith(result.id);
    expect(onToggleFavorite).toHaveBeenCalledWith(result.id);
    expect(onToggleAdoption).toHaveBeenCalledWith(result.id);
    expect(onSetPrimary).toHaveBeenCalledWith(result.id);
    expect(onToggleCompare).toHaveBeenCalledWith(result.id);
    expect(onOpenDetails).toHaveBeenCalledWith(result.id);

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
    expect(screen.queryByRole('link', { name: '下载结果' })).not.toBeInTheDocument();
  });

  it('projects selected comparison results into graph node data', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 2,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 2, actualCredits: 30,
    });

    const graph = buildCanvasGraph(settled, 'result:result-1', 'generate', {}, {
      mode: 'node-selected',
      parameters: {},
      ratio: '1:1',
      compareResultIds: ['result-1'],
      onParameterChange: vi.fn(),
    });

    expect(graph.nodes.find((node) => node.id === 'result:result-1')).toMatchObject({
      data: { compareSelected: true },
    });
    expect(graph.nodes.find((node) => node.id === 'result:result-2')).toMatchObject({
      data: { compareSelected: false },
    });
  });

  it('moves results through favorite, adoption, comparison, shared zoom, and synchronized panning', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 3,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 3, actualCredits: 45,
    });

    let latestState = settled;
    const workbench = render(
      <WorkbenchHarness initialState={settled} onStateChange={(state) => { latestState = state; }} />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: '收藏结果' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '采用结果' })[0]);
    expect(screen.getByRole('button', { name: '取消收藏' })).toBeInTheDocument();
    expect(latestState.results[0]).toMatchObject({ isFavorite: true, isAdopted: true, isPrimary: true });

    workbench.unmount();
    render(<ResultCompareHarness results={settled.results.slice(0, 2)} />);
    const compareTray = screen.getByLabelText('结果对比栏');
    expect(within(compareTray).getByText('已选 2 / 4')).toBeInTheDocument();

    fireEvent.click(within(compareTray).getByRole('button', { name: '开始对比' }));
    const compareDialog = screen.getByRole('dialog', { name: '结果对比' });
    expect(within(compareDialog).getAllByRole('img')).toHaveLength(2);
    fireEvent.change(within(compareDialog).getByRole('slider', { name: '对比缩放' }), {
      target: { value: '150' },
    });
    expect(within(compareDialog).getByText('150%')).toBeInTheDocument();
    expect(compareDialog).toHaveAttribute('aria-modal', 'true');
    expect(within(compareDialog).getByRole('button', { name: '关闭结果对比' })).toHaveFocus();

    const viewports = compareDialog.querySelectorAll<HTMLElement>('.result-compare-grid__viewport');
    viewports[0].scrollLeft = 74;
    viewports[0].scrollTop = 31;
    fireEvent.scroll(viewports[0]);
    expect(viewports[1].scrollLeft).toBe(74);
    expect(viewports[1].scrollTop).toBe(31);

    fireEvent.click(within(compareDialog).getByRole('button', { name: '关闭结果对比' }));
    expect(screen.queryByRole('dialog', { name: '结果对比' })).not.toBeInTheDocument();
  });

  it('downloads only watermarked previews before approval', async () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });

    render(<WorkbenchHarness initialState={settled} />);
    fireEvent.click(screen.getByRole('button', { name: '查看结果详情' }));
    const inspector = screen.getByRole('complementary', { name: '结果详情' });

    expect(within(inspector).queryByRole('link')).not.toBeInTheDocument();
    expect(within(inspector).getByText('预览用途')).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole('button', { name: '下载带水印预览' }));

    await waitFor(() => expect(deliveryMocks.downloadWatermarkedPreview).toHaveBeenCalledWith(settled.results[0]));
  });

  it('inspects an approved result and records a configured production export', async () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1, ratio: '4:5',
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    const approved = approveResult(
      submitForReview(settled, settled.results[0].id),
      settled.results[0].id,
      '青井审核员',
    );
    let latestState = approved;

    render(<WorkbenchHarness initialState={approved} onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: '查看结果详情' }));
    const inspector = screen.getByRole('complementary', { name: '结果详情' });
    expect(within(inspector).getByText('2048 x 2048')).toBeInTheDocument();
    expect(within(inspector).getByText('4:5')).toBeInTheDocument();
    expect(within(inspector).getByText('源场景')).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole('button', { name: '配置生产导出' }));

    const exportDialog = screen.getByRole('dialog', { name: '生产导出' });
    fireEvent.change(within(exportDialog).getByRole('combobox', { name: '文件格式' }), {
      target: { value: 'webp' },
    });
    fireEvent.change(within(exportDialog).getByRole('combobox', { name: '输出尺寸' }), {
      target: { value: '1080' },
    });
    expect(within(exportDialog).getByText(/AST-SF-001_.*\.webp/)).toBeInTheDocument();
    fireEvent.click(within(exportDialog).getByRole('button', { name: '生成生产导出' }));

    await waitFor(() => {
      expect(deliveryMocks.downloadProductionDelivery).toHaveBeenCalledWith(approved, approved.results[0], {
        format: 'webp',
        size: '1080',
        includeManifestCsv: true,
        includeManifestJson: true,
      });
      expect(latestState.auditEvents.at(-1)).toMatchObject({
        type: 'result.exported',
        targetId: 'result-1',
      });
    });
    expect(screen.getByLabelText('画布操作反馈')).toHaveTextContent('已生成 3 个交付文件');
  });

  it('opens a Chinese context panel from the floating tool palette', () => {
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '融图' }));

    expect(screen.getByRole('dialog', { name: '融图参数' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始生成' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '创作描述' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '融图' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '关闭参数面板' }));
    expect(screen.queryByRole('dialog', { name: '融图参数' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '融图' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('brings the selected node into view when an image-surface tool opens', () => {
    reactFlowMocks.fitView.mockClear();
    render(<WorkbenchHarness />);

    fireEvent.click(screen.getByRole('button', { name: '扩图' }));

    expect(reactFlowMocks.fitView).toHaveBeenCalledWith({
      duration: 260,
      maxZoom: 1,
      nodes: [{ id: 'scene:scene-source' }],
      padding: { top: '64px', right: '456px', bottom: '64px', left: '24px' },
    });
  });

  it('moves keyboard focus into the parameter dialog and returns it to its tool trigger on Escape', () => {
    render(<WorkbenchHarness />);
    const toolButton = screen.getByRole('button', { name: '融图' });

    toolButton.focus();
    fireEvent.click(toolButton);

    const referencePicker = screen.getByRole('button', { name: '选择参考素材' });
    expect(referencePicker).toHaveFocus();

    fireEvent.keyDown(referencePicker, { key: 'Escape' });

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
    const asset = screen.getByRole('button', { name: /AST-SK-014/ });
    const dataTransfer = createDataTransfer('asset-pack');

    fireEvent.dragStart(asset, { dataTransfer });
    fireEvent.drop(screen.getByLabelText('节点画布'), {
      clientX: 640,
      clientY: 360,
      dataTransfer,
    });

    expect(screen.getAllByText('AST-SK-014')).toHaveLength(2);
  });

  it('opens a node picker from the selected source creation handle and cancels the draft cleanly', async () => {
    const initialState = initialStudioState();
    let latestState = initialState;
    render(<WorkbenchHarness initialState={initialState} onStateChange={(state) => { latestState = state; }} />);

    const creationHandle = document.querySelector<HTMLElement>('.node-create-handle');
    expect(creationHandle).not.toBeNull();
    fireEvent.click(creationHandle!);
    const picker = screen.getByRole('dialog', { name: '节点类型选择器' });
    expect(within(picker).getAllByRole('button')).toHaveLength(9);

    fireEvent.click(within(picker).getByRole('button', { name: '融图' }));
    expect(screen.getByRole('dialog', { name: '融图参数' })).toBeInTheDocument();
    expect(screen.getByText('待配置')).toBeInTheDocument();
    expect(screen.getByLabelText('节点画布')).toHaveClass('is-configuring-draft');
    expect(latestState).toEqual(initialState);

    fireEvent.click(screen.getByRole('button', { name: '关闭参数面板' }));
    expect(screen.queryByText('待配置')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '融图参数' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('节点画布')).not.toHaveClass('is-configuring-draft');
    expect(latestState).toEqual(initialState);
  });

  it('submits a draft task at the creation-handle fallback position', async () => {
    const initialState = initialStudioState();
    let latestState = initialState;
    render(<WorkbenchHarness initialState={initialState} onStateChange={(state) => { latestState = state; }} />);

    const creationHandle = document.querySelector<HTMLElement>('.node-create-handle');
    expect(creationHandle).not.toBeNull();
    fireEvent.click(creationHandle!);
    const picker = screen.getByRole('dialog', { name: '节点类型选择器' });
    fireEvent.click(within(picker).getByRole('button', { name: '融图' }));
    expect(latestState).toEqual(initialState);
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(latestState.jobs).toHaveLength(1);
    expect(latestState.jobs[0]).toMatchObject({ x: 380, y: 64, profileId: 'blend' });
    expect(latestState.selectedTool).toBe('blend');
    expect(screen.queryByText('待配置')).not.toBeInTheDocument();
  });

  it('binds an asset as a blend reference when it is dropped on an existing image node', () => {
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);
    const asset = screen.getByRole('button', { name: /护肤套装，AST-SK-014/ });
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
    fireEvent.click(screen.getByRole('button', { name: /源场景，AST-SF-001/ }));

    expect(reactFlowMocks.fitView).toHaveBeenCalledWith(expect.objectContaining({
      nodes: [{ id: 'scene:scene-source' }],
    }));
  });

  it('runs a task and exposes cancellation while it is in preflight', () => {
    falClientMocks.runFalImageJob.mockImplementationOnce(() => new Promise(() => undefined));
    render(<WorkbenchHarness />);
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    fireEvent.change(screen.getByRole('textbox', { name: '创作描述' }), {
      target: { value: '干净的白色棚拍背景' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));

    expect(screen.getAllByText('预检中')).toHaveLength(1);
    expect(screen.getAllByText('正在检查输入')).toHaveLength(2);
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
    let advanceToDetail: (() => void) | undefined;
    let completeRequest: (() => void) | undefined;
    falClientMocks.runFalImageJob.mockImplementationOnce((_input, options) => (
      new Promise((resolve) => {
        options.onExecution?.({ requestId: 'req-stages', modelId: 'fal-ai/bria/product-shot' });
        options.onProgress?.(36);
        advanceToDetail = () => options.onProgress?.(78);
        completeRequest = () => resolve({
          images: [{ url: 'https://fal.media/stages.png', width: 1024, height: 1024 }],
          seed: 17,
          modelId: 'fal-ai/bria/product-shot',
          childRequestIds: ['req-stages-child'],
        });
      })
    ));

    render(<WorkbenchHarness />);
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(screen.getAllByText('正在生成').length).toBeGreaterThan(0));

    await act(async () => advanceToDetail?.());
    expect(screen.getAllByText('优化细节').length).toBeGreaterThan(0);

    await act(async () => completeRequest?.());
    await waitFor(() => expect(screen.getAllByText('已完成').length).toBeGreaterThan(0));
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
    fireEvent.click(screen.getByRole('button', { name: '修改光影' }));
    fireEvent.click(screen.getByRole('button', { name: '主光源 右侧' }));
    fireEvent.change(screen.getByRole('slider', { name: '光线强度' }), {
      target: { value: '72' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    const branchScene = latestState.scenes.at(-1)!;
    const branchJob = latestState.jobs.at(-1)!;
    expect(branchScene).toMatchObject({
      parentSceneId: 'scene-source',
      sourceResultId: settled.results[0].id,
      operation: '修改光影',
    });
    expect(branchJob).toMatchObject({
      sceneId: branchScene.id,
      inputSnapshot: {
        inputKind: 'result',
        inputNodeId: settled.results[0].id,
        sourceResultId: settled.results[0].id,
        prompt: '',
        ratio: '1:1',
        parameters: { lightIntensity: 72 },
      },
    });
    expect(branchJob.inputSnapshot.parameters).toEqual({
      lightDirection: 'right',
      lightIntensity: 72,
      lightTemperature: 5200,
      lightSmartMode: false,
      rimLight: false,
    });
  });

  it('offers a keyboard-click path for adding an asset to the canvas', () => {
    let latestState = initialStudioState();
    render(<WorkbenchHarness onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: /护肤套装，AST-SK-014/ }));

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
    falClientMocks.runFalImageJob.mockImplementationOnce(() => new Promise(() => undefined));
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

    expect(screen.getAllByText('预检中')).toHaveLength(1);
    expect(screen.getAllByText('正在检查输入')).toHaveLength(2);
    expect(latestState.jobs).toHaveLength(2);
    expect(latestState.jobs[0]).toMatchObject({ id: queued.jobs[0].id, status: 'failed' });
    expect(latestState.jobs[1]).toMatchObject({ status: 'preflight' });
    expect(latestState.jobs[1].retryOfJobId).toBe(latestState.jobs[0].id);
    expect(latestState.jobs[1].id).not.toBe(queued.jobs[0].id);
  });

  it('creates a review revision from a returned result instead of resubmitting the old file', () => {
    falClientMocks.runFalImageJob.mockImplementationOnce(() => new Promise(() => undefined));
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
      prompt: '原始提示词',
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    const submitted = submitForReview(settled, settled.results[0].id);
    const returned = returnResult(
      submitted,
      submitted.results[0].id,
      'Reviewer A',
      '请保留瓶身结构并提升材质细节',
    );
    let latestState = returned;
    render(<WorkbenchHarness initialState={returned} onStateChange={(state) => { latestState = state; }} />);

    expect(screen.queryByRole('button', { name: '提交审核' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '创建修改版本' })[0]);
    const dialog = screen.getByRole('dialog', { name: '创建修改版本' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '修改提示词' }), {
      target: { value: '保持商品结构，降低高光并提升材质细节' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '开始生成修改版本' }));

    expect(latestState.results[0].reviewStatus).toBe('returned');
    expect(latestState.jobs.at(-1)).toMatchObject({
      retryOfJobId: queued.jobs[0].id,
      supersedesResultId: returned.results[0].id,
      inputSnapshot: { prompt: '保持商品结构，降低高光并提升材质细节' },
    });
  });

  it('重试旧多角度任务时自动修正历史越界角度', () => {
    falClientMocks.runFalImageJob.mockImplementationOnce(() => new Promise(() => undefined));
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'angle',
      outputCount: 1,
      parameters: { horizontalAngle: -111, verticalView: 0, moveForward: 2 },
    });
    const failed = failJob(queued, queued.jobs[0].id, '任务未生成可用结果');
    let latestState = failed;
    render(<WorkbenchHarness initialState={failed} onStateChange={(state) => { latestState = state; }} />);

    fireEvent.click(screen.getByRole('button', { name: /任务队列/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '重试任务' })[0]);

    expect(latestState.jobs[1].inputSnapshot.parameters).toMatchObject({
      horizontalAngle: -90,
      verticalView: 0,
      moveForward: 2,
    });
  });
});
