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
  type GenerationJob,
  type Result,
  type Scene,
  type StudioState,
  type TaskProfileId,
} from '../domain';
import { JobCanvasNode, canvasNodeTypes } from './CanvasNodes';
import { ContextToolPanel } from './ContextToolPanel';
import { SceneRail } from './SceneRail';
import { TaskTray } from './TaskTray';
import { ToolPalette } from './ToolPalette';
import { buildCanvasGraph, type JobNodeData } from './graph';

type WorkbenchProps = {
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
};

type RunJobInput = {
  sceneId: string;
  profileId: TaskProfileId;
  outputCount: number;
};

type JobActions = {
  onCancel: (jobId: string) => void;
  onRetry: (job: GenerationJob) => void;
};

const terminalStatuses = new Set(['succeeded', 'failed', 'canceled']);
const JobActionsContext = createContext<JobActions>({ onCancel: () => undefined, onRetry: () => undefined });
const directionLabels: Record<string, string> = { left: '左', right: '右', up: '上', down: '下' };
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
  const { screenToFlowPosition, setCenter } = useReactFlow();
  const [selectedNodeId, setSelectedNodeId] = useState(`scene:${state.selectedSceneId}`);
  const [panelOpen, setPanelOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [outputCount, setOutputCount] = useState(getProfile(state.selectedTool).defaultOutputs);
  const [ratio, setRatio] = useState('1:1');
  const timeoutIds = useRef<number[]>([]);
  const scheduledJobIds = useRef(new Set<string>());

  useEffect(() => () => {
    timeoutIds.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
  }, []);

  const scheduleJob = useCallback((jobId: string, successfulOutputs: number, actualCredits: number) => {
    timeoutIds.current.push(window.setTimeout(() => {
      setState((current) => updateJobProgress(current, jobId, 58));
    }, 500));
    timeoutIds.current.push(window.setTimeout(() => {
      setState((current) => {
        const job = current.jobs.find((item) => item.id === jobId);
        if (!job || terminalStatuses.has(job.status)) return current;
        return completeJob(current, jobId, { successfulOutputs, actualCredits });
      });
    }, 1400));
  }, [setState]);

  useEffect(() => {
    state.jobs.forEach((job) => {
      if (job.status !== 'queued' || scheduledJobIds.current.has(job.id)) return;
      scheduledJobIds.current.add(job.id);
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
    runJob({ sceneId: job.sceneId, profileId: job.profileId, outputCount: job.outputCount });
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

  const handleToolSelect = (tool: TaskProfileId) => {
    setState((current) => setSelectedTool(current, tool));
    setOutputCount(getProfile(tool).defaultOutputs);
    setPanelOpen(true);
  };

  const handleSceneSelect = (scene: Scene) => {
    setState((current) => setSelectedScene(current, scene.id));
    setSelectedNodeId(`scene:${scene.id}`);
    void setCenter(scene.x + 140, scene.y + 100, { duration: 300, zoom: 1 });
  };

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    const parsed = parseCanvasNodeId(node.id);
    if (parsed?.kind === 'scene') {
      setState((current) => setSelectedScene(current, parsed.id));
    }
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

  const jobActions = useMemo<JobActions>(() => ({
    onCancel: handleCancel,
    onRetry: handleRetry,
  }), [handleCancel, handleRetry]);

  return (
    <div className="workbench">
      <SceneRail
        collapsed={railCollapsed}
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
        <ToolPalette activeTool={state.selectedTool} onSelect={handleToolSelect} />
        {panelOpen && (
          <ContextToolPanel
            availableCredits={state.usage.availableCredits}
            onClose={() => setPanelOpen(false)}
            onOutputCountChange={setOutputCount}
            onPromptChange={setPrompt}
            onRatioChange={setRatio}
            onRun={() => runJob({
              sceneId: state.selectedSceneId,
              profileId: state.selectedTool,
              outputCount,
            })}
            outputCount={outputCount}
            prompt={prompt}
            ratio={ratio}
            tool={state.selectedTool}
          />
        )}
        <TaskTray jobs={state.jobs} onCancel={handleCancel} onRetry={handleRetry} />
      </main>
    </div>
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
