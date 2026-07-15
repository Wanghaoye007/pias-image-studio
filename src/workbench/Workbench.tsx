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
} from '@xyflow/react';
import { CheckCircle2, Coins, FolderKanban, ListChecks } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import {
  cancelJob,
  completeJob,
  createDerivedScene,
  createJob,
  createSceneFromAsset,
  getProfile,
  moveCanvasItem,
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
import { ContextToolPanel } from './ContextToolPanel';
import { SceneRail } from './SceneRail';
import { TaskTray } from './TaskTray';
import { ToolPalette } from './ToolPalette';
import { buildCanvasGraph, type JobNodeData } from './graph';

type WorkbenchProps = {
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
};

type RunJobInput = Parameters<typeof createJob>[1];

type JobActions = {
  onCancel: (jobId: string) => void;
  onRetry: (job: GenerationJob) => void;
};

const terminalStatuses = new Set(['succeeded', 'failed', 'canceled']);
const JobActionsContext = createContext<JobActions>({ onCancel: () => undefined, onRetry: () => undefined });
const directionLabels: Record<string, string> = { left: '左', right: '右', up: '上', down: '下' };
const defaultToolParameters: TaskParameters = {
  lightIntensity: 60,
  blendStrength: 50,
  angle: '正面',
  expandDirection: '四周',
};

function parametersForTool(tool: TaskProfileId, parameters: TaskParameters): TaskParameters {
  const parameterKeys: Partial<Record<TaskProfileId, string>> = {
    light: 'lightIntensity',
    blend: 'blendStrength',
    angle: 'angle',
    expand: 'expandDirection',
  };
  const key = parameterKeys[tool];
  return key === undefined || parameters[key] === undefined ? {} : { [key]: parameters[key] };
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
  const [selectedNodeId, setSelectedNodeId] = useState(`scene:${state.selectedSceneId}`);
  const [panelOpen, setPanelOpen] = useState(false);
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
  const scheduledJobTimers = useRef(new Map<string, number[]>());
  const toolTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => {
    scheduledJobTimers.current.forEach((timeoutIds) => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    });
    scheduledJobTimers.current.clear();
  }, []);

  const scheduleJob = useCallback((jobId: string, successfulOutputs: number, actualCredits: number) => {
    if (scheduledJobTimers.current.has(jobId)) return;

    const timeoutIds: number[] = [];
    scheduledJobTimers.current.set(jobId, timeoutIds);
    timeoutIds.push(window.setTimeout(() => {
      setState((current) => updateJobProgress(current, jobId, 58));
    }, 500));
    timeoutIds.push(window.setTimeout(() => {
      setState((current) => {
        const job = current.jobs.find((item) => item.id === jobId);
        if (!job || terminalStatuses.has(job.status)) return current;
        return completeJob(current, jobId, { successfulOutputs, actualCredits });
      });
      scheduledJobTimers.current.delete(jobId);
    }, 1400));
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
    const nextSceneId = `scene-${state.scenes.length + 1}`;
    setState((current) => createDerivedScene(current, {
      parentSceneId: result.sourceSceneId,
      sourceResultId: result.id,
      operation: getProfile(current.selectedTool).label,
    }));
    setSelectedNodeId(`scene:${nextSceneId}`);
  }, [setState, state.scenes.length]);

  const handleSubmitReview = useCallback((resultId: string) => {
    setState((current) => submitForReview(current, resultId));
  }, [setState]);

  const graph = useMemo(() => buildCanvasGraph(
    state,
    selectedNodeId,
    state.selectedTool,
    { onDerive: handleDerive, onSubmitReview: handleSubmitReview },
  ), [handleDerive, handleSubmitReview, selectedNodeId, state]);

  const handleToolSelect = (tool: TaskProfileId, trigger: HTMLButtonElement) => {
    toolTriggerRef.current = trigger;
    setState((current) => setSelectedTool(current, tool));
    setOutputCount(getProfile(tool).defaultOutputs);
    setPanelOpen(true);
  };

  const handlePanelClose = useCallback(() => {
    setPanelOpen(false);
    toolTriggerRef.current?.focus();
  }, []);

  const handleSceneSelect = (scene: Scene) => {
    setState((current) => setSelectedScene(current, scene.id));
    setSelectedNodeId(`scene:${scene.id}`);
    void fitView({ duration: 300, nodes: [{ id: `scene:${scene.id}` }], padding: 0.2 });
  };

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
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

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const assetId = event.dataTransfer.getData('application/x-pias-asset');
    if (!assetId) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const nextSceneId = `scene-${state.scenes.length + 1}`;
    setState((current) => createSceneFromAsset(current, { assetId, position }));
    setSelectedNodeId(`scene:${nextSceneId}`);
  };

  const handleAssetAdd = useCallback((asset: Asset) => {
    const nextSceneId = `scene-${state.scenes.length + 1}`;
    const lane = state.scenes.length;
    setState((current) => createSceneFromAsset(current, {
      assetId: asset.id,
      position: { x: 80 + (lane % 3) * 300, y: 420 + Math.floor(lane / 3) * 300 },
    }));
    setSelectedNodeId(`scene:${nextSceneId}`);
  }, [setState, state.scenes.length]);

  const handleRunSelected = useCallback(() => {
    const parsed = parseCanvasNodeId(selectedNodeId);
    const predictedBranchId = parsed?.kind === 'result' ? `scene-${state.scenes.length + 1}` : null;

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
      });
    });

    if (predictedBranchId) setSelectedNodeId(`scene:${predictedBranchId}`);
  }, [outputCount, prompt, ratio, referenceAssetId, selectedNodeId, setState, state.scenes.length, toolParameters]);

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
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleDrop}
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
            onNodeClick={handleNodeClick}
            onNodeDragStop={handleNodeDragStop}
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
        {panelOpen && (
          <ContextToolPanel
            availableCredits={state.usage.availableCredits}
            assets={state.assets}
            onClose={handlePanelClose}
            onOutputCountChange={setOutputCount}
            onParameterChange={(key, value) => setToolParameters((current) => ({ ...current, [key]: value }))}
            onPromptChange={setPrompt}
            onReferenceAssetChange={setReferenceAssetId}
            onRatioChange={setRatio}
            onRun={handleRunSelected}
            outputCount={outputCount}
            parameters={toolParameters}
            prompt={prompt}
            referenceAssetId={referenceAssetId}
            ratio={ratio}
            tool={state.selectedTool}
          />
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
