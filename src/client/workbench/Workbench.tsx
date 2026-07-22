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
import { Aperture, Coins, FolderKanban, ListChecks } from 'lucide-react';
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
  attachExternalJob,
  buildExportFilename,
  cancelJob,
  completeJobWithResults,
  createBlankScene,
  createDerivedScene,
  createJob,
  createSceneFromAsset,
  deleteScene,
  duplicateScene,
  failJob,
  expireJob,
  getNextSceneId,
  getProfile,
  markJobPostprocessing,
  moveCanvasItem,
  recordResultExport,
  renameScene,
  requestJobCancellation,
  retryResultGeneration,
  setPrimaryResult,
  setResultQualityIssue,
  setSelectedScene,
  setSelectedTool,
  submitForReview,
  toggleResultAdoption,
  toggleResultFavorite,
  updateJobProgress,
  withdrawReview,
  type CanvasNodeKind,
  type Asset,
  type ExportSpec,
  type GenerationJob,
  type JobStatus,
  type QualityIssue,
  type Result,
  type Scene,
  type StudioState,
  type TaskParameters,
  type TaskProfileId,
} from '../../shared/domain';
import {
  FAL_LIFECYCLE_ABORT_REASON,
  resumeFalImageJob,
  runFalImageJob,
} from '../fal/falImageClient';
import { clampFalHorizontalAngle } from '../../shared/fal/multipleAngles';
import { PersistenceStatus } from '../studio/PersistenceStatus';
import type { StudioSaveStatus } from '../studio/usePersistentStudioState';
import {
  downloadProductionDelivery,
  downloadWatermarkedPreview,
} from '../export/exportDelivery';
import { JobCanvasNode, canvasNodeTypes, getReviewStatusLabel } from './CanvasNodes';
import { CanvasCommandBar } from './CanvasCommandBar';
import { ContextToolPanel } from './ContextToolPanel';
import { DraftTaskNode } from './DraftTaskNode';
import { ExportDialog } from './ExportDialog';
import { NodeTypePicker } from './NodeTypePicker';
import { ResultCompare } from './ResultCompare';
import { ResultInspector } from './ResultInspector';
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
  actorId?: string;
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
  saveStatus?: StudioSaveStatus;
  onRetrySave?: () => void;
  onReloadState?: () => void;
};

type RunJobInput = Parameters<typeof createJob>[1];

type JobActions = {
  onCancel: (jobId: string) => void;
  onRetry: (job: GenerationJob) => void;
};

type CanvasNotice = { message: string; tone: 'success' | 'warning' };
type NodeDialog = 'rename' | 'delete' | null;

const terminalStatuses = new Set<JobStatus>([
  'partially_succeeded', 'succeeded', 'failed', 'canceled', 'expired',
]);
const executableStatuses = new Set<JobStatus>(['preflight', 'queued', 'running']);
const cancellableStatuses = new Set<JobStatus>(['preflight', 'queued', 'running', 'postprocessing']);
const JobActionsContext = createContext<JobActions>({ onCancel: () => undefined, onRetry: () => undefined });
const directionLabels: Record<string, string> = { left: '左', right: '右', up: '上', down: '下' };
const defaultToolParameters: TaskParameters = {
  sceneTemplate: '日光展台',
  quality: '精细',
  lightIntensity: 50,
  lightDirection: 'front',
  lightTemperature: 5200,
  lightSmartMode: false,
  rimLight: false,
  productPlacement: 'bottom_center',
  horizontalAngle: -45,
  moveForward: 0,
  verticalView: -0.7,
  wideAngle: false,
  expandAnchor: 'center',
  expandScale: 72,
  upscaleSize: '2048',
  detailLevel: 60,
  brushSize: 42,
};

function parametersForTool(tool: TaskProfileId, parameters: TaskParameters): TaskParameters {
  const parameterKeys: Record<TaskProfileId, string[]> = {
    generate: ['sceneTemplate', 'quality'],
    blend: ['productPlacement'],
    angle: ['horizontalAngle', 'moveForward', 'verticalView', 'wideAngle'],
    light: ['lightDirection', 'lightIntensity', 'lightTemperature', 'lightSmartMode', 'rimLight'],
    remove: ['brushSize'],
    extract: [],
    expand: ['expandAnchor', 'expandScale'],
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

function WorkbenchContent({
  actorId = 'Mika Tanaka',
  state,
  setState,
  saveStatus = 'saved',
  onRetrySave = () => undefined,
  onReloadState = () => undefined,
}: WorkbenchProps) {
  const { fitView, getViewport, screenToFlowPosition, setViewport } = useReactFlow();
  const [interaction, dispatchInteraction] = useReducer(
    reduceWorkbenchInteraction,
    `scene:${state.selectedSceneId}`,
    createInitialInteractionState,
  );
  const activeTool = interaction.activeTool ?? state.selectedTool;
  const selectedNodeId = interaction.selectedNodeIds.at(-1) ?? '';
  const commandScene = useMemo(() => {
    const parsed = parseCanvasNodeId(selectedNodeId);
    return parsed?.kind === 'scene'
      ? state.scenes.find((scene) => scene.id === parsed.id)
      : undefined;
  }, [selectedNodeId, state.scenes]);
  const panelPreviewImageUrl = useMemo(() => {
    const parsed = parseCanvasNodeId(selectedNodeId);
    if (parsed?.kind === 'scene') {
      return state.scenes.find((scene) => scene.id === parsed.id)?.imageUrl ?? '';
    }
    if (parsed?.kind === 'result') {
      return state.results.find((result) => result.id === parsed.id)?.imageUrl ?? '';
    }
    if (parsed?.kind === 'job') {
      const job = state.jobs.find((item) => item.id === parsed.id);
      return state.scenes.find((scene) => scene.id === job?.sceneId)?.imageUrl ?? '';
    }
    return state.scenes.find((scene) => scene.id === state.selectedSceneId)?.imageUrl
      ?? state.assets[0]?.imageUrl
      ?? '';
  }, [selectedNodeId, state.assets, state.jobs, state.results, state.scenes, state.selectedSceneId]);
  const [railCollapsed, setRailCollapsed] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 768px) and (max-width: 899px)').matches
  ));
  const [prompt, setPrompt] = useState('');
  const [outputCount, setOutputCount] = useState(getProfile(state.selectedTool).defaultOutputs);
  const [ratio, setRatio] = useState('1:1');
  const [toolParameters, setToolParameters] = useState<TaskParameters>(defaultToolParameters);
  const [removeMaskImageUrl, setRemoveMaskImageUrl] = useState('');
  const [referenceAssetId, setReferenceAssetId] = useState(
    state.assets.find((asset) => asset.id === 'asset-scene')?.id ?? state.assets[0]?.id ?? '',
  );
  const [dragTargetNodeId, setDragTargetNodeId] = useState('');
  const [nodeDialog, setNodeDialog] = useState<NodeDialog>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [canvasNotice, setCanvasNotice] = useState<CanvasNotice | null>(null);
  const [compareResultIds, setCompareResultIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [inspectedResultId, setInspectedResultId] = useState<string | null>(null);
  const [exportResultId, setExportResultId] = useState<string | null>(null);
  const [revisionResultId, setRevisionResultId] = useState<string | null>(null);
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const falJobControllers = useRef(new Map<string, AbortController>());
  const falExecutorMounted = useRef(true);
  const toolTriggerRef = useRef<HTMLButtonElement | null>(null);
  const canvasStageRef = useRef<HTMLElement | null>(null);
  const userRevisionRef = useRef(0);
  const pendingFocusRef = useRef<{ nodeIds: string[]; revision: number } | null>(null);
  const completedFocusRef = useRef<{ jobId: string; revision: number } | null>(null);
  const initialFitCompleteRef = useRef(false);

  useEffect(() => {
    falExecutorMounted.current = true;
    return () => {
      falExecutorMounted.current = false;
      queueMicrotask(() => {
        if (falExecutorMounted.current) return;
        falJobControllers.current.forEach((controller) => {
          controller.abort(FAL_LIFECYCLE_ABORT_REASON);
        });
        falJobControllers.current.clear();
      });
    };
  }, []);

  useEffect(() => {
    if (!canvasNotice) return undefined;
    const timeoutId = window.setTimeout(() => setCanvasNotice(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [canvasNotice]);

  useEffect(() => {
    if (compareResultIds.length < 2) setCompareOpen(false);
  }, [compareResultIds.length]);

  useEffect(() => {
    setNodeDialog(null);
  }, [selectedNodeId]);

  useEffect(() => {
    state.jobs.forEach((job) => {
      if (!executableStatuses.has(job.status)) return;
      if (falJobControllers.current.has(job.id)) return;

      const scene = state.scenes.find((item) => item.id === job.sceneId);
      const imageUrl = scene?.imageUrl;
      if (!imageUrl) {
        setState((current) => {
          const currentJob = current.jobs.find((item) => item.id === job.id);
          return !currentJob || terminalStatuses.has(currentJob.status)
            ? current
            : failJob(current, job.id, '无法读取任务输入图片');
        });
        return;
      }

      const referenceUrls = job.inputSnapshot.referenceAssetIds
        .map((assetId) => state.assets.find((asset) => asset.id === assetId)?.imageUrl)
        .filter((url): url is string => Boolean(url));
      const sourceResult = scene?.sourceResultId
        ? state.results.find((result) => result.id === scene.sourceResultId)
        : undefined;

      const controller = new AbortController();
      falJobControllers.current.set(job.id, controller);
      const executionOptions = {
        signal: controller.signal,
        onProgress: (progress: number) => {
          setState((current) => updateJobProgress(current, job.id, progress));
        },
      };
      const execution = job.externalExecution
        ? resumeFalImageJob(job.externalExecution, executionOptions)
        : runFalImageJob({
            profileId: job.profileId,
            imageUrls: [imageUrl, ...referenceUrls],
            prompt: job.inputSnapshot.prompt,
            ratio: job.inputSnapshot.ratio,
            outputCount: job.outputCount,
            parameters: job.inputSnapshot.parameters,
            ...(job.inputSnapshot.maskImageUrl
              ? { maskImageUrl: job.inputSnapshot.maskImageUrl }
              : {}),
            sourceWidth: sourceResult?.width ?? 512,
            sourceHeight: sourceResult?.height ?? 512,
          }, {
            ...executionOptions,
            onExecution: ({ requestId, modelId }) => {
              setState((current) => {
                const currentJob = current.jobs.find((item) => item.id === job.id);
                if (!currentJob || terminalStatuses.has(currentJob.status)) return current;
                return attachExternalJob(current, job.id, {
                  provider: 'fal',
                  modelId,
                  requestId,
                });
              });
            },
          });
      void execution.then((result) => {
        completedFocusRef.current = { jobId: job.id, revision: userRevisionRef.current };
        setState((current) => {
          const currentJob = current.jobs.find((item) => item.id === job.id);
          if (!currentJob || terminalStatuses.has(currentJob.status)) return current;
          return markJobPostprocessing(current, job.id);
        });
        queueMicrotask(() => setState((current) => {
          const currentJob = current.jobs.find((item) => item.id === job.id);
          if (!currentJob || terminalStatuses.has(currentJob.status) || currentJob.status === 'cancel_requested') {
            return current;
          }
          const actualCredits = Math.min(
            currentJob.reservedCredits,
            result.images.length * getProfile(currentJob.profileId).costPerOutput,
          );
          return completeJobWithResults(current, job.id, {
            images: result.images,
            actualCredits,
            ...(result.seed !== undefined ? { seed: result.seed } : {}),
          });
        }));
      }).catch((error: unknown) => {
        setState((current) => {
          const currentJob = current.jobs.find((item) => item.id === job.id);
          if (!currentJob || terminalStatuses.has(currentJob.status)) return current;
          const errorName = error && typeof error === 'object' && 'name' in error
            ? String(error.name)
            : '';
          if (errorName === 'AbortError') {
            if (controller.signal.reason === FAL_LIFECYCLE_ABORT_REASON) return current;
            return cancelJob(current, job.id);
          }
          const message = error instanceof Error && error.name !== 'AbortError'
            ? error.message
            : `${getProfile(job.profileId).label}任务已取消`;
          if (/过期|expired|not found|不存在/i.test(message) && currentJob.externalExecution) {
            return expireJob(current, job.id, '供应商任务已过期，请重新提交');
          }
          return failJob(current, job.id, message);
        });
      }).finally(() => {
        falJobControllers.current.delete(job.id);
      });
    });
  }, [setState, state.assets, state.jobs, state.results, state.scenes]);

  const runJob = useCallback((input: RunJobInput) => {
    setState((current) => createJob(current, input));
  }, [setState]);

  const handleCancel = useCallback((jobId: string) => {
    const controller = falJobControllers.current.get(jobId);
    setState((current) => {
      const job = current.jobs.find((item) => item.id === jobId);
      if (!job || !cancellableStatuses.has(job.status)) return current;
      return requestJobCancellation(current, jobId);
    });
    if (controller) {
      controller.abort();
      queueMicrotask(() => setState((current) => {
        const job = current.jobs.find((item) => item.id === jobId);
        return job?.status === 'cancel_requested' ? cancelJob(current, jobId) : current;
      }));
    }
    else {
      setState((current) => {
        const job = current.jobs.find((item) => item.id === jobId);
        return job?.status === 'cancel_requested' ? cancelJob(current, jobId) : current;
      });
    }
  }, [setState]);

  const handleRetry = useCallback((job: GenerationJob) => {
    const retrySnapshot = job.profileId === 'angle'
      ? {
          ...job.inputSnapshot,
          parameters: {
            ...job.inputSnapshot.parameters,
            horizontalAngle: clampFalHorizontalAngle(
              Number(job.inputSnapshot.parameters.horizontalAngle ?? 0),
            ),
          },
        }
      : job.inputSnapshot;
    runJob({
      sceneId: job.sceneId,
      profileId: job.profileId,
      outputCount: job.outputCount,
      ...retrySnapshot,
      retryOfJobId: job.id,
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
    setState((current) => submitForReview(current, resultId, actorId));
  }, [actorId, setState]);

  const handleWithdrawReview = useCallback((resultId: string) => {
    setState((current) => withdrawReview(current, resultId, actorId));
  }, [actorId, setState]);

  const handleRequestRevision = useCallback((resultId: string) => {
    const result = state.results.find((item) => item.id === resultId);
    const job = result ? state.jobs.find((item) => item.id === result.jobId) : undefined;
    if (!result || !job) return;
    setRevisionResultId(resultId);
    setRevisionPrompt(job.inputSnapshot.prompt);
  }, [state.jobs, state.results]);

  const handleConfirmRevision = useCallback(() => {
    if (!revisionResultId) return;
    setState((current) => retryResultGeneration(current, revisionResultId, {
      prompt: revisionPrompt,
    }));
    setRevisionResultId(null);
    setCanvasNotice({ message: '已创建修改版本任务', tone: 'success' });
  }, [revisionPrompt, revisionResultId, setState]);

  const handleToggleFavorite = useCallback((resultId: string) => {
    setState((current) => toggleResultFavorite(current, resultId));
  }, [setState]);

  const handleToggleAdoption = useCallback((resultId: string) => {
    setState((current) => toggleResultAdoption(current, resultId, 'Mika Tanaka'));
  }, [setState]);

  const handleSetPrimary = useCallback((resultId: string) => {
    setState((current) => setPrimaryResult(current, resultId, 'Mika Tanaka'));
  }, [setState]);

  const handleOpenDetails = useCallback((resultId: string) => {
    dispatchInteraction({ type: 'CLOSE_TOOL' });
    setInspectedResultId(resultId);
  }, []);

  const handleToggleCompare = useCallback((resultId: string) => {
    if (compareResultIds.includes(resultId)) {
      setCompareResultIds(compareResultIds.filter((id) => id !== resultId));
      return;
    }
    if (compareResultIds.length >= 4) {
      setCanvasNotice({ message: '最多同时对比 4 张结果', tone: 'warning' });
      return;
    }
    setCompareResultIds([...compareResultIds, resultId]);
  }, [compareResultIds]);

  const handleQualityIssue = useCallback((resultId: string, issue: QualityIssue) => {
    setState((current) => setResultQualityIssue(current, resultId, issue, 'Mika Tanaka'));
    setCanvasNotice({ message: '不可用原因已记录，不会用于模型训练', tone: 'success' });
  }, [setState]);

  const handleParameterChange = useCallback((key: string, value: string | number | boolean) => {
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
    setOutputCount(getProfile(tool).defaultOutputs);
    setPrompt('');
    setRatio('1:1');
    setToolParameters(defaultToolParameters);
    setRemoveMaskImageUrl('');
    dispatchInteraction({ type: 'SELECT_DRAFT_TOOL', tool });
  }, []);

  const graph = useMemo(() => buildCanvasGraph(
    state,
    selectedNodeId,
    activeTool,
    {
      onCreateNode: handleCreateNode,
      onDerive: handleDerive,
      onSubmitReview: handleSubmitReview,
      onWithdrawReview: handleWithdrawReview,
      onReviseResult: handleRequestRevision,
      onToggleFavorite: handleToggleFavorite,
      onToggleAdoption: handleToggleAdoption,
      onSetPrimary: handleSetPrimary,
      onToggleCompare: handleToggleCompare,
      onOpenDetails: handleOpenDetails,
    },
    {
      mode: interaction.mode,
      parameters: toolParameters,
      ratio,
      maskImageUrl: removeMaskImageUrl,
      dropTargetNodeId: dragTargetNodeId,
      compareResultIds,
      draftNode: interaction.draftNode,
      onCancelDraft: cancelDraftNode,
      onParameterChange: handleParameterChange,
      onMaskChange: setRemoveMaskImageUrl,
    },
  ), [activeTool, cancelDraftNode, compareResultIds, dragTargetNodeId, handleCreateNode, handleDerive, handleOpenDetails, handleParameterChange, handleRequestRevision, handleSetPrimary, handleSubmitReview, handleToggleAdoption, handleToggleCompare, handleToggleFavorite, handleWithdrawReview, interaction.draftNode, interaction.mode, ratio, removeMaskImageUrl, selectedNodeId, state, toolParameters]);

  useEffect(() => {
    if (initialFitCompleteRef.current || graph.nodes.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      initialFitCompleteRef.current = true;
      void fitView({
        duration: 220,
        maxZoom: 1,
        padding: { top: '36px', right: '28px', bottom: '64px', left: '176px' },
      });
    }, 80);
    return () => window.clearTimeout(timeoutId);
  }, [fitView, graph.nodes.length]);

  const handleToolSelect = (tool: TaskProfileId, trigger: HTMLButtonElement) => {
    markUserGesture();
    toolTriggerRef.current = trigger;
    setState((current) => setSelectedTool(current, tool));
    setOutputCount(getProfile(tool).defaultOutputs);
    setRemoveMaskImageUrl('');
    dispatchInteraction({ type: 'OPEN_TOOL', tool });

    const stageBounds = canvasStageRef.current?.getBoundingClientRect();
    const nodeElement = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
      .find((element) => element.dataset.id === selectedNodeId);
    const nodeBounds = nodeElement?.getBoundingClientRect();
    let panelPlacement = interaction.panelPlacement;
    if (stageBounds && nodeBounds) {
      panelPlacement = choosePanelPlacement(nodeBounds, stageBounds, { width: 336, height: 600 }, 16);
      dispatchInteraction({
        type: 'SET_PANEL_PLACEMENT',
        placement: panelPlacement,
      });
    }
    if (selectedNodeId) {
      void fitView({
        duration: 260,
        maxZoom: 1,
        nodes: [{ id: selectedNodeId }],
        padding: panelPlacement === 'left'
          ? { top: '64px', right: '24px', bottom: '64px', left: '456px' }
          : { top: '64px', right: '456px', bottom: '64px', left: '24px' },
      }).then((didFit) => {
        if (!didFit) return;
        const viewport = getViewport();
        void setViewport({
          ...viewport,
          x: viewport.x + (panelPlacement === 'left' ? 140 : -140),
        }, { duration: 120 });
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
    const runTool = interaction.activeTool ?? state.selectedTool;
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
    setCanvasNotice({
      message: `${getProfile(runTool).label}任务已提交，完成后将自动定位结果`,
      tone: 'success',
    });

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
          operation: getProfile(runTool).label,
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

      next = setSelectedTool(next, runTool);
      return createJob(next, {
        sceneId,
        profileId: runTool,
        outputCount,
        inputKind,
        inputNodeId,
        prompt,
        ratio,
        parameters: parametersForTool(runTool, toolParameters),
        maskImageUrl: runTool === 'remove' ? removeMaskImageUrl : undefined,
        referenceAssetIds: runTool === 'blend' && referenceAssetId
          ? [referenceAssetId]
          : [],
        sourceResultId,
        position: draftPosition,
      });
    });
  }, [interaction.activeTool, interaction.draftNode, outputCount, prompt, ratio, referenceAssetId, removeMaskImageUrl, selectedNodeId, setState, state.jobs.length, state.scenes.length, state.selectedTool, toolParameters]);

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
    if (job.status !== 'succeeded' && job.status !== 'partially_succeeded') return;

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
  const comparedResults = compareResultIds
    .map((resultId) => state.results.find((result) => result.id === resultId))
    .filter((result): result is Result => Boolean(result));
  const inspectedResult = state.results.find((result) => result.id === inspectedResultId);
  const inspectedScene = inspectedResult
    ? state.scenes.find((scene) => scene.id === inspectedResult.sourceSceneId)
    : undefined;
  const inspectedJob = inspectedResult
    ? state.jobs.find((job) => job.id === inspectedResult.jobId)
    : undefined;
  const exportResult = state.results.find((result) => result.id === exportResultId);

  const handlePreviewDownload = async (result: Result) => {
    try {
      const filename = await downloadWatermarkedPreview(result);
      setCanvasNotice({ message: `已生成带水印预览：${filename}`, tone: 'success' });
    } catch (error) {
      setCanvasNotice({
        message: error instanceof Error ? error.message : '预览文件生成失败',
        tone: 'warning',
      });
    }
  };

  const handleExport = async (result: Result, spec: ExportSpec) => {
    try {
      const files = await downloadProductionDelivery(state, result, spec);
      setState((current) => recordResultExport(current, result.id, 'Mika Tanaka', spec));
      setExportResultId(null);
      setCanvasNotice({ message: `已生成 ${files.length} 个交付文件`, tone: 'success' });
    } catch (error) {
      setCanvasNotice({
        message: error instanceof Error ? error.message : '生产导出失败',
        tone: 'warning',
      });
      throw error;
    }
  };

  return (
    <div className={`workbench ${railCollapsed ? 'is-rail-collapsed' : ''}`}>
      <header aria-label="工作台状态" className="workbench-topbar">
        <div className="workbench-topbar__brand" aria-label="PIAS 图片工作台">
          <span><Aperture aria-hidden="true" size={18} /></span>
          <strong>PIAS</strong>
          <small>图片工作台</small>
        </div>
        <div className="workbench-topbar__project">
          <FolderKanban aria-hidden="true" size={16} />
          <span>项目</span>
          <strong title={state.projectName}>{state.projectName}</strong>
        </div>
        <div className="workbench-topbar__status">
          <PersistenceStatus
            onReload={onReloadState}
            onRetry={onRetrySave}
            status={saveStatus}
          />
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
        className={`canvas-stage${interaction.draftNode ? ' is-configuring-draft' : ''}${inspectedResult || exportResult ? ' is-showing-result-overlay' : ''}`}
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
            fitViewOptions={{ maxZoom: 1, padding: 0.16 }}
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
          onOpenExport={(resultId) => setExportResultId(resultId)}
          onOpenDetails={handleOpenDetails}
          onSubmitReview={handleSubmitReview}
          onWithdrawReview={handleWithdrawReview}
          onReviseResult={handleRequestRevision}
          onToggleAdoption={handleToggleAdoption}
          onToggleFavorite={handleToggleFavorite}
          results={state.results}
        />
        <ToolPalette activeTool={activeTool} onSelect={handleToolSelect} />
        {!interaction.panelOpen && (
          <CanvasCommandBar
            hasSelectedScene={Boolean(commandScene)}
            onCreate={handleCreateBlankScene}
            onDelete={handleRequestDelete}
            onDuplicate={handleDuplicateScene}
            onFit={handleFitAll}
            onRename={handleRequestRename}
          />
        )}
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
            onClearRemoveMask={() => setRemoveMaskImageUrl('')}
            onPromptChange={setPrompt}
            onReferenceAssetChange={setReferenceAssetId}
            onRatioChange={setRatio}
            onRun={handleRunSelected}
            outputCount={outputCount}
            hasRemoveMask={Boolean(removeMaskImageUrl)}
            parameters={toolParameters}
            placement={interaction.panelPlacement}
            previewImageUrl={panelPreviewImageUrl}
            prompt={prompt}
            referenceAssetId={referenceAssetId}
            ratio={ratio}
            tool={activeTool}
          />
        )}
        <ResultCompare
          onClose={() => setCompareOpen(false)}
          onInspect={(resultId) => {
            setCompareOpen(false);
            handleOpenDetails(resultId);
          }}
          onOpen={() => setCompareOpen(true)}
          onRemove={handleToggleCompare}
          open={compareOpen}
          results={comparedResults}
        />
        {inspectedResult && inspectedScene && inspectedJob && (
          <ResultInspector
            job={inspectedJob}
            onClose={() => setInspectedResultId(null)}
            onDownloadPreview={() => { void handlePreviewDownload(inspectedResult); }}
            onOpenExport={() => setExportResultId(inspectedResult.id)}
            onQualityIssue={(issue) => handleQualityIssue(inspectedResult.id, issue)}
            onSetPrimary={() => handleSetPrimary(inspectedResult.id)}
            onSubmitReview={() => handleSubmitReview(inspectedResult.id)}
            onWithdrawReview={() => handleWithdrawReview(inspectedResult.id)}
            onReviseResult={() => handleRequestRevision(inspectedResult.id)}
            onToggleAdoption={() => handleToggleAdoption(inspectedResult.id)}
            onToggleFavorite={() => handleToggleFavorite(inspectedResult.id)}
            result={inspectedResult}
            scene={inspectedScene}
          />
        )}
        {exportResult && (
          <ExportDialog
            buildFilename={(spec) => buildExportFilename(state, exportResult.id, spec)}
            onClose={() => setExportResultId(null)}
            onSubmit={(spec) => handleExport(exportResult, spec)}
            result={exportResult}
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
        {revisionResultId && (
          <section aria-label="创建修改版本" className="node-command-dialog" role="dialog">
            <header>
              <strong>创建修改版本</strong>
              <small>原结果保留</small>
            </header>
            <p>新任务会保留原审核结果、参数快照和结算记录。</p>
            <label>
              <span>修改提示词</span>
              <textarea
                aria-label="修改提示词"
                autoFocus
                maxLength={2000}
                onChange={(event) => setRevisionPrompt(event.target.value)}
                rows={5}
                value={revisionPrompt}
              />
            </label>
            <footer>
              <button aria-label="取消修改版本" onClick={() => setRevisionResultId(null)} type="button">取消</button>
              <button
                aria-label="开始生成修改版本"
                className="is-primary"
                onClick={handleConfirmRevision}
                type="button"
              >
                开始生成
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
  onWithdrawReview,
  onReviseResult,
  onOpenDetails,
  onOpenExport,
  onToggleAdoption,
  onToggleFavorite,
}: {
  results: Result[];
  onSubmitReview: (resultId: string) => void;
  onWithdrawReview: (resultId: string) => void;
  onReviseResult: (resultId: string) => void;
  onOpenDetails: (resultId: string) => void;
  onOpenExport: (resultId: string) => void;
  onToggleAdoption: (resultId: string) => void;
  onToggleFavorite: (resultId: string) => void;
}) {
  return (
    <section aria-label="移动端结果预览" className="mobile-preview">
      <header>
        <strong>移动端预览</strong>
        <span>桌面端可编辑</span>
      </header>
      <div className="mobile-preview__results">
        {results.map((result) => {
          const canSubmit = result.reviewStatus === 'draft';
          const canRevise = result.reviewStatus === 'returned' || result.reviewStatus === 'rejected';
          return (
            <article key={result.id}>
              <img alt="" src={result.imageUrl} />
              <div>
                <strong>{result.title}</strong>
                <small>{getReviewStatusLabel(result.reviewStatus)}</small>
                {result.reviewComment && <small>{result.reviewComment}</small>}
              </div>
              <div className="mobile-preview__actions">
                <button
                  aria-label={result.isFavorite ? '取消收藏' : '收藏结果'}
                  onClick={() => onToggleFavorite(result.id)}
                  type="button"
                >
                  {result.isFavorite ? '已收藏' : '收藏'}
                </button>
                <button
                  aria-label={result.isAdopted ? '取消采用' : '采用结果'}
                  onClick={() => onToggleAdoption(result.id)}
                  type="button"
                >
                  {result.isAdopted ? '已采用' : '采用'}
                </button>
                <button aria-label="查看结果详情" onClick={() => onOpenDetails(result.id)} type="button">
                  详情
                </button>
                {canSubmit && (
                  <button aria-label="提交审核" onClick={() => onSubmitReview(result.id)} type="button">
                    提交审核
                  </button>
                )}
                {result.reviewStatus === 'submitted' && (
                  <button aria-label="撤回审核" onClick={() => onWithdrawReview(result.id)} type="button">撤回</button>
                )}
                {canRevise && (
                  <button aria-label="创建修改版本" onClick={() => onReviseResult(result.id)} type="button">
                    修改后重试
                  </button>
                )}
                {result.reviewStatus === 'approved' && (
                  <button aria-label="配置生产导出" onClick={() => onOpenExport(result.id)} type="button">
                    生产导出
                  </button>
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
  const canCancel = cancellableStatuses.has(job.status);

  return (
    <div className="interactive-job-node">
      <JobCanvasNode {...props} />
      {job.errorMessage && <p role="alert">{job.errorMessage}</p>}
      {canCancel && (
        <button aria-label="取消任务" onClick={() => actions.onCancel(job.id)} type="button">
          取消
        </button>
      )}
      {(job.status === 'failed' || job.status === 'expired') && (
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
  return source ? { x: source.x + 380, y: source.y + 24 } : null;
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

export default Workbench;
