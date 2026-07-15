import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type AriaLabelConfig,
  type Node,
  type NodeProps,
  type OnConnectEnd,
  type OnConnectStart,
} from '@xyflow/react';
import { CheckCircle2, Coins, FolderKanban, ListChecks } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import {
  cancelJob,
  completeJob,
  createBlankScene,
  createDerivedScene,
  createJob,
  createSceneFromAsset,
  deleteScene,
  duplicateScene,
  getNextSceneId,
  getProfile,
  moveCanvasItem,
  renameScene,
  setSelectedScene,
  setSelectedTool,
  submitForReview,
  updateJobProgress,
  type CanvasNodeKind,
  type Asset,
  type GenerationJob,
  type Result,
  type Scene,
  type StudioState,
  type TaskParameters,
  type TaskProfileId,
} from '../domain';
import { JobCanvasNode, canvasNodeTypes, getReviewStatusLabel } from './CanvasNodes';
import { CanvasCommandBar } from './CanvasCommandBar';
import { ContextToolPanel } from './ContextToolPanel';
import { DraftTaskNode } from './DraftTaskNode';
import { NodeTypePicker } from './NodeTypePicker';
import { SceneRail } from './SceneRail';
import { TaskTray } from './TaskTray';
import { ToolPalette } from './ToolPalette';
import { buildCanvasGraph, type JobNodeData } from './graph';
import {
  createInitialInteractionState,
  reduceWorkbenchInteraction,
} from './interactionMachine';
import {
  buildFocusNodeIds,
  choosePanelPlacement,
  isUserViewportGesture,
  placeNodePicker,
  shouldApplyAutoFocus,
} from './viewportDirector';

type WorkbenchProps = {
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
};

type RunJobInput = Parameters<typeof createJob>[1];

type JobActions = {
  onCancel: (jobId: string) => void;
  onRetry: (job: GenerationJob) => void;
};

type CanvasNotice = { message: string; tone: 'success' | 'warning' };
type NodeDialog = 'rename' | 'delete' | null;

const terminalStatuses = new Set(['succeeded', 'failed', 'canceled']);
const JobActionsContext = createContext<JobActions>({ onCancel: () => undefined, onRetry: () => undefined });
const directionLabels: Record<string, string> = { left: '左', right: '右', up: '上', down: '下' };
const defaultToolParameters: TaskParameters = {
  sceneTemplate: '日光展台',
  quality: '精细',
  lightIntensity: 60,
  lightDirection: 'top-right',
  lightTemperature: 5200,
  blendStrength: 50,
  horizontalAngle: 0,
  verticalAngle: 0,
  distance: 50,
  expandDirection: '四周',
  expandScale: 72,
  upscaleSize: '2048',
  detailLevel: 60,
  brushSize: 42,
  edgePrecision: 72,
};

function parametersForTool(tool: TaskProfileId, parameters: TaskParameters): TaskParameters {
  const parameterKeys: Record<TaskProfileId, string[]> = {
    generate: ['sceneTemplate', 'quality'],
    blend: ['blendStrength'],
    angle: ['horizontalAngle', 'verticalAngle', 'distance'],
    light: ['lightDirection', 'lightIntensity', 'lightTemperature'],
    remove: ['brushSize'],
    extract: ['edgePrecision'],
    expand: ['expandDirection', 'expandScale'],
    upscale: ['upscaleSize', 'detailLevel'],
  };
  return Object.fromEntries(parameterKeys[tool]
    .filter((key) => parameters[key] !== undefined)
    .map((key) => [key, parameters[key]]));
}
const reactFlowAriaLabels: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default': '按回车键选中节点，使用方向键移动节点',
  'node.a11yDescription.keyboardDisabled': '键盘移动节点已禁用',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
    `节点已向${directionLabels[direction] ?? '指定方向'}移动到横坐标 ${x}，纵坐标 ${y}`,
  'edge.a11yDescription.default': '按回车键选中连线，按删除键删除连线',
  'controls.ariaLabel': '画布缩放控件',
  'controls.zoomIn.ariaLabel': '放大画布',
  'controls.zoomOut.ariaLabel': '缩小画布',
  'controls.fitView.ariaLabel': '适配画布内容',
  'controls.interactive.ariaLabel': '切换画布交互',
  'minimap.ariaLabel': '画布小地图',
  'handle.ariaLabel': '节点连接点',
};

const workbenchNodeTypes = {
  ...canvasNodeTypes,
  'draft-task': DraftTaskNode,
  job: InteractiveJobCanvasNode,
};

export function Workbench(props: WorkbenchProps) {
  return (
    <ReactFlowProvider>
      <WorkbenchContent {...props} />
    </ReactFlowProvider>
  );
}

function WorkbenchContent({ state, setState }: WorkbenchProps) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [interaction, dispatchInteraction] = useReducer(
    reduceWorkbenchInteraction,
    `scene:${state.selectedSceneId}`,
    createInitialInteractionState,
  );
  const selectedNodeId = interaction.selectedNodeIds.at(-1) ?? '';
  const commandScene = useMemo(() => {
    const parsed = parseCanvasNodeId(selectedNodeId);
    return parsed?.kind === 'scene'
      ? state.scenes.find((scene) => scene.id === parsed.id)
      : undefined;
  }, [selectedNodeId, state.scenes]);
  const [railCollapsed, setRailCollapsed] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 768px) and (max-width: 1199px)').matches
  ));
  const [prompt, setPrompt] = useState('');
  const [outputCount, setOutputCount] = useState(getProfile(state.selectedTool).defaultOutputs);
  const [ratio, setRatio] = useState('1:1');
  const [toolParameters, setToolParameters] = useState<TaskParameters>(defaultToolParameters);
  const [referenceAssetId, setReferenceAssetId] = useState(
    state.assets.find((asset) => asset.id === 'asset-scene')?.id ?? state.assets[0]?.id ?? '',
  );
  const [dragTargetNodeId, setDragTargetNodeId] = useState('');
  const [nodeDialog, setNodeDialog] = useState<NodeDialog>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [canvasNotice, setCanvasNotice] = useState<CanvasNotice | null>(null);
  const scheduledJobTimers = useRef(new Map<string, number[]>());
  const toolTriggerRef = useRef<HTMLButtonElement | null>(null);
  const canvasStageRef = useRef<HTMLElement | null>(null);
  const userRevisionRef = useRef(0);
  const pendingFocusRef = useRef<{ nodeIds: string[]; revision: number } | null>(null);
  const completedFocusRef = useRef<{ jobId: string; revision: number } | null>(null);

  useEffect(() => () => {
    scheduledJobTimers.current.forEach((timeoutIds) => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    });
    scheduledJobTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!canvasNotice) return undefined;
    const timeoutId = window.setTimeout(() => setCanvasNotice(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [canvasNotice]);

  useEffect(() => {
    setNodeDialog(null);
  }, [selectedNodeId]);

  const scheduleJob = useCallback((jobId: string, successfulOutputs: number, actualCredits: number) => {
    if (scheduledJobTimers.current.has(jobId)) return;

    const timeoutIds: number[] = [];
    const requestRevision = userRevisionRef.current;
    scheduledJobTimers.current.set(jobId, timeoutIds);
    timeoutIds.push(window.setTimeout(() => {
      setState((current) => updateJobProgress(current, jobId, 36));
    }, 900));
    timeoutIds.push(window.setTimeout(() => {
      setState((current) => updateJobProgress(current, jobId, 78));
    }, 3600));
    timeoutIds.push(window.setTimeout(() => {
      setState((current) => updateJobProgress(current, jobId, 94));
    }, 5400));
    timeoutIds.push(window.setTimeout(() => {
      completedFocusRef.current = { jobId, revision: requestRevision };
      setState((current) => {
        const job = current.jobs.find((item) => item.id === jobId);
        if (!job || terminalStatuses.has(job.status)) return current;
        return completeJob(current, jobId, { successfulOutputs, actualCredits });
      });
      scheduledJobTimers.current.delete(jobId);
    }, 6400));
  }, [setState]);

  useEffect(() => {
    state.jobs.forEach((job) => {
      if (job.status !== 'queued' && job.status !== 'running') return;
      scheduleJob(job.id, job.outputCount, job.reservedCredits);
    });
  }, [scheduleJob, state.jobs]);

  const runJob = useCallback((input: RunJobInput) => {
    setState((current) => createJob(current, input));
  }, [setState]);

  const handleCancel = useCallback((jobId: string) => {
    setState((current) => {
      const job = current.jobs.find((item) => item.id === jobId);
      if (!job || terminalStatuses.has(job.status)) return current;
      return cancelJob(current, jobId);
    });
  }, [setState]);

  const handleRetry = useCallback((job: GenerationJob) => {
    runJob({
      sceneId: job.sceneId,
      profileId: job.profileId,
      outputCount: job.outputCount,
      ...job.inputSnapshot,
    });
  }, [runJob]);

  const handleDerive = useCallback((result: Result) => {
    userRevisionRef.current += 1;
    const nextSceneId = getNextSceneId(state);
    setState((current) => createDerivedScene(current, {
      parentSceneId: result.sourceSceneId,
      sourceResultId: result.id,
      operation: getProfile(current.selectedTool).label,
    }));
    dispatchInteraction({ type: 'SELECT_NODE', nodeId: `scene:${nextSceneId}` });
  }, [setState, state.scenes]);

  const handleSubmitReview = useCallback((resultId: string) => {
    setState((current) => submitForReview(current, resultId));
  }, [setState]);

  const handleParameterChange = useCallback((key: string, value: string | number) => {
    setToolParameters((current) => ({ ...current, [key]: value }));
  }, []);

  const markUserGesture = useCallback(() => {
    userRevisionRef.current += 1;
  }, []);

  const handleMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (isUserViewportGesture(event)) markUserGesture();
  }, [markUserGesture]);

  const cancelDraftNode = useCallback(() => {
    dispatchInteraction({ type: 'CANCEL_NODE_CREATION' });
  }, []);

  const showNodePicker = useCallback((
    sourceNodeId: string,
    screenPoint: { x: number; y: number },
    canvasPosition: { x: number; y: number },
  ) => {
    const stageBounds = getUsableStageBounds(canvasStageRef.current);
    const picker = placeNodePicker(screenPoint, stageBounds, { width: 320, height: 420 }, 16);
    dispatchInteraction({ type: 'BEGIN_NODE_CONNECTION', sourceNodeId });
    dispatchInteraction({
      type: 'SHOW_NODE_PICKER',
      screenPosition: picker.position,
      canvasPosition,
      placement: picker.panelPlacement,
    });
  }, []);

  const handleCreateNode = useCallback((sourceNodeId: string) => {
    markUserGesture();
    const position = getCreationFallbackPosition(state, sourceNodeId);
    if (!position) return;
    const stageBounds = getUsableStageBounds(canvasStageRef.current);
    const nodeBounds = canvasStageRef.current
      ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${sourceNodeId}"]`)
      ?.getBoundingClientRect();
    const screenPoint = nodeBounds && nodeBounds.width > 0
      ? { x: nodeBounds.right + 28, y: nodeBounds.top + 28 }
      : { x: stageBounds.left + 420, y: stageBounds.top + 180 };
    showNodePicker(sourceNodeId, screenPoint, position);
  }, [markUserGesture, showNodePicker, state]);

  const handleConnectStart: OnConnectStart = useCallback((_event, params) => {
    if (!params.nodeId || params.handleId !== 'create' || params.handleType !== 'source') return;
    const parsed = parseCanvasNodeId(params.nodeId);
    if (!parsed || parsed.kind === 'job') return;
    markUserGesture();
    dispatchInteraction({ type: 'BEGIN_NODE_CONNECTION', sourceNodeId: params.nodeId });
  }, [markUserGesture]);

  const handleConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (!connectionState.fromNode) return;
    if (connectionState.toNode) {
      cancelDraftNode();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || !target.classList.contains('react-flow__pane')) {
      cancelDraftNode();
      return;
    }

    const pointer = 'changedTouches' in event ? event.changedTouches[0] : event;
    const screenPoint = { x: pointer.clientX, y: pointer.clientY };
    const stageBounds = getUsableStageBounds(canvasStageRef.current);
    const picker = placeNodePicker(screenPoint, stageBounds, { width: 320, height: 420 }, 16);
    dispatchInteraction({
      type: 'SHOW_NODE_PICKER',
      screenPosition: picker.position,
      canvasPosition: screenToFlowPosition(screenPoint),
      placement: picker.panelPlacement,
    });
  }, [cancelDraftNode, screenToFlowPosition]);

  const handleDraftToolSelect = useCallback((tool: TaskProfileId) => {
    setState((current) => setSelectedTool(current, tool));
    setOutputCount(getProfile(tool).defaultOutputs);
    setPrompt('');
    setRatio('1:1');
    setToolParameters(defaultToolParameters);
    dispatchInteraction({ type: 'SELECT_DRAFT_TOOL', tool });
  }, [setState]);

  const graph = useMemo(() => buildCanvasGraph(
    state,
    selectedNodeId,
    state.selectedTool,
    { onCreateNode: handleCreateNode, onDerive: handleDerive, onSubmitReview: handleSubmitReview },
    {
      mode: interaction.mode,
      parameters: toolParameters,
      ratio,
      dropTargetNodeId: dragTargetNodeId,
      draftNode: interaction.draftNode,
      onCancelDraft: cancelDraftNode,
      onParameterChange: handleParameterChange,
    },
  ), [cancelDraftNode, dragTargetNodeId, handleCreateNode, handleDerive, handleParameterChange, handleSubmitReview, interaction.draftNode, interaction.mode, ratio, selectedNodeId, state, toolParameters]);

  const handleToolSelect = (tool: TaskProfileId, trigger: HTMLButtonElement) => {
    markUserGesture();
    toolTriggerRef.current = trigger;
    setState((current) => setSelectedTool(current, tool));
    setOutputCount(getProfile(tool).defaultOutputs);
    dispatchInteraction({ type: 'OPEN_TOOL', tool });

    const stageBounds = canvasStageRef.current?.getBoundingClientRect();
    const nodeElement = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
      .find((element) => element.dataset.id === selectedNodeId);
    const nodeBounds = nodeElement?.getBoundingClientRect();
    if (stageBounds && nodeBounds) {
      dispatchInteraction({
        type: 'SET_PANEL_PLACEMENT',
        placement: choosePanelPlacement(nodeBounds, stageBounds, { width: 336, height: 600 }, 16),
      });
    }
  };

  const handlePanelClose = useCallback(() => {
    dispatchInteraction({ type: interaction.draftNode ? 'CANCEL_NODE_CREATION' : 'CLOSE_TOOL' });
    toolTriggerRef.current?.focus();
  }, [interaction.draftNode]);

  const handleSceneSelect = (scene: Scene) => {
    markUserGesture();
    setState((current) => setSelectedScene(current, scene.id));
    dispatchInteraction({ type: 'SELECT_NODE', nodeId: `scene:${scene.id}` });
    void fitView({ duration: 300, nodes: [{ id: `scene:${scene.id}` }], padding: 0.2 });
  };

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (node.id === 'draft:task') return;
    markUserGesture();
    dispatchInteraction({ type: 'SELECT_NODE', nodeId: node.id });
    const parsed = parseCanvasNodeId(node.id);
    if (!parsed) return;
    setState((current) => {
      if (parsed.kind === 'scene') return setSelectedScene(current, parsed.id);
      if (parsed.kind === 'result') {
        const result = current.results.find((item) => item.id === parsed.id);
        return result ? setSelectedScene(current, result.sourceSceneId) : current;
      }
      const job = current.jobs.find((item) => item.id === parsed.id);
      return job ? setSelectedScene(current, job.sceneId) : current;
    });
  };

  const handleNodeDragStop = (_event: MouseEvent | TouchEvent, node: Node) => {
    const parsed = parseCanvasNodeId(node.id);
    if (!parsed) return;
    setState((current) => moveCanvasItem(current, {
      kind: parsed.kind,
      id: parsed.id,
      position: node.position,
    }));
  };

  const selectCreatedScene = useCallback((sceneId: string) => {
    pendingFocusRef.current = {
      nodeIds: [`scene:${sceneId}`],
      revision: userRevisionRef.current,
    };
    dispatchInteraction({ type: 'SELECT_NODE', nodeId: `scene:${sceneId}` });
  }, []);

  const handleCreateBlankScene = useCallback(() => {
    markUserGesture();
    const stageBounds = canvasStageRef.current?.getBoundingClientRect();
    const screenPoint = stageBounds
      ? { x: stageBounds.left + stageBounds.width * 0.52, y: stageBounds.top + stageBounds.height * 0.48 }
      : { x: 520, y: 320 };
    const position = screenToFlowPosition(screenPoint);
    const nextSceneId = getNextSceneId(state);
    setState((current) => createBlankScene(current, { position }));
    selectCreatedScene(nextSceneId);
    setCanvasNotice({ message: '已创建空白场景', tone: 'success' });
  }, [markUserGesture, screenToFlowPosition, selectCreatedScene, setState, state.scenes]);

  const handleDuplicateScene = useCallback(() => {
    if (!commandScene) return;
    markUserGesture();
    const nextSceneId = getNextSceneId(state);
    setState((current) => duplicateScene(current, commandScene.id));
    selectCreatedScene(nextSceneId);
    setCanvasNotice({ message: `已复制${getSceneTitleForNotice(commandScene)}`, tone: 'success' });
  }, [commandScene, markUserGesture, selectCreatedScene, setState, state.scenes]);

  const handleRequestRename = useCallback(() => {
    if (!commandScene) return;
    setRenameDraft(commandScene.title);
    setNodeDialog('rename');
  }, [commandScene]);

  const handleConfirmRename = useCallback(() => {
    if (!commandScene || !renameDraft.trim()) return;
    const nextTitle = renameDraft.trim();
    setState((current) => renameScene(current, commandScene.id, nextTitle));
    setNodeDialog(null);
    setCanvasNotice({ message: `已重命名为${nextTitle}`, tone: 'success' });
  }, [commandScene, renameDraft, setState]);

  const handleRequestDelete = useCallback(() => {
    if (!commandScene) return;
    if (!canDeleteScene(state, commandScene.id)) {
      setCanvasNotice({ message: '该节点已有任务或下游内容，不能删除', tone: 'warning' });
      return;
    }
    setNodeDialog('delete');
  }, [commandScene, state]);

  const handleConfirmDelete = useCallback(() => {
    if (!commandScene) return;
    const deletedTitle = getSceneTitleForNotice(commandScene);
    const fallbackScene = state.scenes.find((scene) => scene.id !== commandScene.id);
    setState((current) => deleteScene(current, commandScene.id));
    setNodeDialog(null);
    if (fallbackScene) {
      dispatchInteraction({ type: 'SELECT_NODE', nodeId: `scene:${fallbackScene.id}` });
    }
    setCanvasNotice({ message: `已删除${deletedTitle}`, tone: 'success' });
  }, [commandScene, setState, state.scenes]);

  const handleFitAll = useCallback(() => {
    markUserGesture();
    void fitView({ duration: 280, padding: 0.14 });
  }, [fitView, markUserGesture]);

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const targetNodeId = getDroppableNodeId(event.target);
    setDragTargetNodeId((current) => current === targetNodeId ? current : targetNodeId);
    event.dataTransfer.dropEffect = targetNodeId ? 'link' : 'copy';
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const assetId = event.dataTransfer.getData('application/x-pias-asset');
    if (!assetId) return;
    const asset = state.assets.find((item) => item.id === assetId);
    if (!asset) return;
    const targetNodeId = getDroppableNodeId(event.target);
    setDragTargetNodeId('');

    if (targetNodeId) {
      const parsed = parseCanvasNodeId(targetNodeId);
      if (parsed && parsed.kind !== 'job') {
        const targetSceneId = parsed.kind === 'scene'
          ? parsed.id
          : state.results.find((result) => result.id === parsed.id)?.sourceSceneId;
        if (targetSceneId) {
          markUserGesture();
          setReferenceAssetId(assetId);
          setOutputCount(getProfile('blend').defaultOutputs);
          setPrompt('');
          toolTriggerRef.current = canvasStageRef.current
            ?.querySelector<HTMLButtonElement>('.tool-palette button[aria-label="融图"]') ?? null;
          setState((current) => setSelectedTool(setSelectedScene(current, targetSceneId), 'blend'));
          dispatchInteraction({ type: 'SELECT_NODE', nodeId: targetNodeId });
          dispatchInteraction({ type: 'OPEN_TOOL', tool: 'blend' });

          const stageBounds = canvasStageRef.current?.getBoundingClientRect();
          const nodeBounds = (event.target as Element).closest<HTMLElement>('.react-flow__node')
            ?.getBoundingClientRect();
          if (stageBounds && nodeBounds) {
            dispatchInteraction({
              type: 'SET_PANEL_PLACEMENT',
              placement: choosePanelPlacement(nodeBounds, stageBounds, { width: 336, height: 600 }, 16),
            });
          }
          setCanvasNotice({ message: `已绑定${asset.product}，可直接开始融图`, tone: 'success' });
          return;
        }
      }
    }

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const nextSceneId = getNextSceneId(state);
    setState((current) => createSceneFromAsset(current, { assetId, position }));
    selectCreatedScene(nextSceneId);
    setCanvasNotice({ message: `已添加${asset.product}节点`, tone: 'success' });
  };

  const handleAssetAdd = useCallback((asset: Asset) => {
    const nextSceneId = getNextSceneId(state);
    const lane = state.scenes.length;
    setState((current) => createSceneFromAsset(current, {
      assetId: asset.id,
      position: { x: 80 + (lane % 3) * 300, y: 420 + Math.floor(lane / 3) * 300 },
    }));
    selectCreatedScene(nextSceneId);
    setCanvasNotice({ message: `已添加${asset.product}节点`, tone: 'success' });
  }, [selectCreatedScene, setState, state.scenes]);

  const handleRunSelected = useCallback(() => {
    const parsed = parseCanvasNodeId(selectedNodeId);
    const draftPosition = interaction.draftNode?.canvasPosition;
    const predictedBranchId = parsed?.kind === 'result' ? getNextSceneId(state) : null;
    const predictedJobId = `job-${state.jobs.length + 1}`;
    const focusTargets = [
      ...(predictedBranchId ? [`scene:${predictedBranchId}`] : []),
      `job:${predictedJobId}`,
    ];

    pendingFocusRef.current = {
      nodeIds: buildFocusNodeIds(selectedNodeId, focusTargets),
      revision: userRevisionRef.current,
    };
    dispatchInteraction({ type: 'SUBMIT' });

    setState((current) => {
      let next = current;
      let sceneId = current.selectedSceneId;
      let inputKind: 'scene' | 'result' = 'scene';
      let inputNodeId = sceneId;
      let sourceResultId: string | undefined;

      if (parsed?.kind === 'result') {
        const result = current.results.find((item) => item.id === parsed.id);
        if (!result) return current;
        next = createDerivedScene(current, {
          parentSceneId: result.sourceSceneId,
          sourceResultId: result.id,
          operation: getProfile(current.selectedTool).label,
        });
        sceneId = next.selectedSceneId;
        inputKind = 'result';
        inputNodeId = result.id;
        sourceResultId = result.id;
      } else if (parsed?.kind === 'job') {
        const job = current.jobs.find((item) => item.id === parsed.id);
        if (job) sceneId = job.sceneId;
        inputNodeId = sceneId;
      } else if (parsed?.kind === 'scene') {
        sceneId = parsed.id;
        inputNodeId = parsed.id;
      }

      return createJob(next, {
        sceneId,
        profileId: current.selectedTool,
        outputCount,
        inputKind,
        inputNodeId,
        prompt,
        ratio,
        parameters: parametersForTool(current.selectedTool, toolParameters),
        referenceAssetIds: current.selectedTool === 'blend' && referenceAssetId
          ? [referenceAssetId]
          : [],
        sourceResultId,
        position: draftPosition,
      });
    });
  }, [interaction.draftNode, outputCount, prompt, ratio, referenceAssetId, selectedNodeId, setState, state.jobs.length, state.scenes.length, toolParameters]);

  useEffect(() => {
    const request = pendingFocusRef.current;
    if (!request) return;
    const availableNodeIds = new Set(graph.nodes.map((node) => node.id));
    if (!request.nodeIds.every((nodeId) => availableNodeIds.has(nodeId))) return;
    pendingFocusRef.current = null;
    if (!shouldApplyAutoFocus(request.revision, userRevisionRef.current)) return;
    void fitView({
      duration: 320,
      nodes: request.nodeIds.map((id) => ({ id })),
      padding: 0.18,
    });
  }, [fitView, graph.nodes]);

  useEffect(() => {
    const request = completedFocusRef.current;
    if (!request) return;
    const job = state.jobs.find((item) => item.id === request.jobId);
    if (!job || !terminalStatuses.has(job.status)) return;
    completedFocusRef.current = null;
    if (job.status !== 'succeeded') return;

    const resultNodeIds = state.results
      .filter((result) => result.jobId === job.id)
      .map((result) => `result:${result.id}`);
    if (resultNodeIds.length === 0 || !shouldApplyAutoFocus(request.revision, userRevisionRef.current)) return;

    const nodeIds = buildFocusNodeIds(`scene:${job.sceneId}`, resultNodeIds);
    void fitView({ duration: 360, nodes: nodeIds.map((id) => ({ id })), padding: 0.16 });
    dispatchInteraction({ type: 'SUBMISSION_SETTLED', nodeId: resultNodeIds[0] });
  }, [fitView, state.jobs, state.results]);

  const jobActions = useMemo<JobActions>(() => ({
    onCancel: handleCancel,
    onRetry: handleRetry,
  }), [handleCancel, handleRetry]);

  return (
    <div className={`workbench ${railCollapsed ? 'is-rail-collapsed' : ''}`}>
      <header aria-label="工作台状态" className="workbench-topbar">
        <div className="workbench-topbar__project">
          <FolderKanban aria-hidden="true" size={16} />
          <span>项目</span>
          <strong title={state.projectName}>{state.projectName}</strong>
        </div>
        <div className="workbench-topbar__status">
          <span className="is-saved">
            <CheckCircle2 aria-hidden="true" size={15} />
            已自动保存
          </span>
          <span>
            <Coins aria-hidden="true" size={15} />
            可用点数 <strong>{state.usage.availableCredits}</strong>
          </span>
          <span>
            <ListChecks aria-hidden="true" size={15} />
            任务 <strong>{state.jobs.length}</strong>
          </span>
        </div>
      </header>
      <SceneRail
        collapsed={railCollapsed}
        onAddAsset={handleAssetAdd}
        onSelectScene={handleSceneSelect}
        onToggleCollapsed={() => setRailCollapsed((current) => !current)}
        state={state}
      />
      <main
        aria-label="节点画布"
        className="canvas-stage"
        onDragLeave={(event) => {
          const relatedTarget = event.relatedTarget;
          if (!(relatedTarget instanceof Element) || !event.currentTarget.contains(relatedTarget)) {
            setDragTargetNodeId('');
          }
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        ref={canvasStageRef}
      >
        <JobActionsContext.Provider value={jobActions}>
          <ReactFlow
            ariaLabelConfig={reactFlowAriaLabels}
            edges={graph.edges}
            fitView
            maxZoom={1.8}
            minZoom={0.3}
            nodes={graph.nodes}
            nodeTypes={workbenchNodeTypes}
            onConnectEnd={handleConnectEnd}
            onConnectStart={handleConnectStart}
            onMoveStart={handleMoveStart}
            onNodeClick={handleNodeClick}
            onNodeDragStart={markUserGesture}
            onNodeDragStop={handleNodeDragStop}
            onPaneClick={() => {
              if (interaction.draftNode) cancelDraftNode();
            }}
          >
            <Background color="#353840" gap={24} size={1} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </JobActionsContext.Provider>
        <MobileResultPreview
          onSubmitReview={handleSubmitReview}
          results={state.results}
        />
        <ToolPalette activeTool={state.selectedTool} onSelect={handleToolSelect} />
        <CanvasCommandBar
          hasSelectedScene={Boolean(commandScene)}
          onCreate={handleCreateBlankScene}
          onDelete={handleRequestDelete}
          onDuplicate={handleDuplicateScene}
          onFit={handleFitAll}
          onRename={handleRequestRename}
        />
        {interaction.mode === 'choosing-node-type' && interaction.draftNode && (
          <NodeTypePicker
            onClose={cancelDraftNode}
            onSelect={handleDraftToolSelect}
            position={interaction.draftNode.screenPosition}
          />
        )}
        {interaction.panelOpen && (
          <ContextToolPanel
            assetPickerOpen={interaction.assetPickerOpen}
            availableCredits={state.usage.availableCredits}
            assets={state.assets}
            isSubmitting={interaction.mode === 'submitting'}
            onAssetPickerClose={() => dispatchInteraction({ type: 'CLOSE_ASSET_PICKER' })}
            onAssetPickerOpen={() => dispatchInteraction({ type: 'OPEN_ASSET_PICKER' })}
            onClose={handlePanelClose}
            onOutputCountChange={setOutputCount}
            onParameterChange={handleParameterChange}
            onPromptChange={setPrompt}
            onReferenceAssetChange={setReferenceAssetId}
            onRatioChange={setRatio}
            onRun={handleRunSelected}
            outputCount={outputCount}
            parameters={toolParameters}
            placement={interaction.panelPlacement}
            prompt={prompt}
            referenceAssetId={referenceAssetId}
            ratio={ratio}
            tool={state.selectedTool}
          />
        )}
        {nodeDialog === 'rename' && commandScene && (
          <section aria-label="重命名场景" className="node-command-dialog" role="dialog">
            <header>
              <strong>重命名场景</strong>
              <small>{commandScene.skuCode}</small>
            </header>
            <label>
              <span>场景名称</span>
              <input
                aria-label="场景名称"
                autoFocus
                maxLength={40}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleConfirmRename();
                  if (event.key === 'Escape') setNodeDialog(null);
                }}
                value={renameDraft}
              />
            </label>
            <footer>
              <button aria-label="取消重命名" onClick={() => setNodeDialog(null)} type="button">取消</button>
              <button
                aria-label="保存场景名称"
                className="is-primary"
                disabled={!renameDraft.trim()}
                onClick={handleConfirmRename}
                type="button"
              >
                保存
              </button>
            </footer>
          </section>
        )}
        {nodeDialog === 'delete' && commandScene && (
          <section aria-label="删除场景" className="node-command-dialog" role="dialog">
            <header>
              <strong>删除场景</strong>
              <small>{commandScene.skuCode}</small>
            </header>
            <p>将从当前画布移除“{commandScene.title}”。此节点尚未产生任务或下游结果。</p>
            <footer>
              <button aria-label="取消删除" onClick={() => setNodeDialog(null)} type="button">取消</button>
              <button
                aria-label="确认删除场景"
                className="is-danger"
                onClick={handleConfirmDelete}
                type="button"
              >
                删除
              </button>
            </footer>
          </section>
        )}
        {canvasNotice && (
          <div
            aria-label="画布操作反馈"
            className="canvas-notice"
            data-tone={canvasNotice.tone}
            role="status"
          >
            {canvasNotice.message}
          </div>
        )}
        <TaskTray jobs={state.jobs} onCancel={handleCancel} onRetry={handleRetry} />
      </main>
    </div>
  );
}

function MobileResultPreview({
  results,
  onSubmitReview,
}: {
  results: Result[];
  onSubmitReview: (resultId: string) => void;
}) {
  return (
    <section aria-label="移动端结果预览" className="mobile-preview">
      <header>
        <strong>移动端预览</strong>
        <span>桌面端可编辑</span>
      </header>
      <div className="mobile-preview__results">
        {results.map((result) => {
          const canSubmit = result.reviewStatus === 'draft' || result.reviewStatus === 'returned';
          return (
            <article key={result.id}>
              <img alt="" src={result.imageUrl} />
              <div>
                <strong>{result.title}</strong>
                <small>{getReviewStatusLabel(result.reviewStatus)}</small>
                {result.reviewComment && <small>{result.reviewComment}</small>}
              </div>
              <div className="mobile-preview__actions">
                {canSubmit && (
                  <button aria-label="提交审核" onClick={() => onSubmitReview(result.id)} type="button">
                    {result.reviewStatus === 'returned' ? '重新提交' : '提交审核'}
                  </button>
                )}
                {result.reviewStatus === 'approved' && (
                  <a aria-label="下载结果" download={`${result.title}.png`} href={result.imageUrl}>下载</a>
                )}
              </div>
            </article>
          );
        })}
        {results.length === 0 && <p>暂无生成结果</p>}
      </div>
    </section>
  );
}

function InteractiveJobCanvasNode(props: NodeProps<Node<JobNodeData, 'job'>>) {
  const actions = useContext(JobActionsContext);
  const job = props.data.job;
  const canCancel = job.status === 'queued' || job.status === 'running';

  return (
    <div className="interactive-job-node">
      <JobCanvasNode {...props} />
      {job.errorMessage && <p role="alert">{job.errorMessage}</p>}
      {canCancel && (
        <button aria-label="取消任务" onClick={() => actions.onCancel(job.id)} type="button">
          取消
        </button>
      )}
      {job.status === 'failed' && (
        <button aria-label="重试任务" onClick={() => actions.onRetry(job)} type="button">
          重试
        </button>
      )}
    </div>
  );
}

function parseCanvasNodeId(nodeId: string): { kind: CanvasNodeKind; id: string } | null {
  const separatorIndex = nodeId.indexOf(':');
  if (separatorIndex < 1) return null;
  const kind = nodeId.slice(0, separatorIndex);
  const id = nodeId.slice(separatorIndex + 1);
  if (!id || (kind !== 'scene' && kind !== 'job' && kind !== 'result')) return null;
  return { kind, id };
}

function getDroppableNodeId(target: EventTarget): string {
  if (!(target instanceof Element)) return '';
  const nodeId = target.closest<HTMLElement>('.react-flow__node')?.dataset.id ?? '';
  const parsed = parseCanvasNodeId(nodeId);
  return parsed && parsed.kind !== 'job' ? nodeId : '';
}

function getUsableStageBounds(stage: HTMLElement | null) {
  const bounds = stage?.getBoundingClientRect();
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    };
  }
  return { left: 0, right: 1200, top: 0, bottom: 800 };
}

function getCreationFallbackPosition(
  state: StudioState,
  sourceNodeId: string,
): { x: number; y: number } | null {
  const parsed = parseCanvasNodeId(sourceNodeId);
  if (!parsed || parsed.kind === 'job') return null;
  const source = parsed.kind === 'scene'
    ? state.scenes.find((scene) => scene.id === parsed.id)
    : state.results.find((result) => result.id === parsed.id);
  return source ? { x: source.x + 320, y: source.y + 24 } : null;
}

function canDeleteScene(state: StudioState, sceneId: string): boolean {
  const scene = state.scenes.find((item) => item.id === sceneId);
  return Boolean(scene)
    && scene!.resultIds.length === 0
    && !state.jobs.some((job) => job.sceneId === sceneId)
    && !state.results.some((result) => result.sourceSceneId === sceneId)
    && !state.scenes.some((item) => item.parentSceneId === sceneId)
    && !state.edges.some((edge) => edge.target === sceneId);
}

function getSceneTitleForNotice(scene: Scene): string {
  return scene.title;
}
