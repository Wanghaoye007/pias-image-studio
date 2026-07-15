import type { Edge, Node } from '@xyflow/react';
import { getProfile, type Result, type Scene, type StudioState, type TaskProfileId } from '../domain';

const operationLabels: Record<string, string> = {
  Generate: '生成',
  Blend: '融图',
  'Directional Light': '定向光',
  'Quick Angle': '快速视角',
  Expand: '扩图',
  Upscale: '超分',
  Remove: '去除',
  Extract: '抠图',
};
const knownChineseOperations = new Set([
  '生成',
  '融图',
  '定向光',
  '快速视角',
  '扩图',
  '超分',
  '去除',
  '抠图',
  '商品素材',
  '其他处理',
]);

export function getOperationLabel(operation: string): string {
  if (operationLabels[operation]) return operationLabels[operation];
  return knownChineseOperations.has(operation) ? operation : '其他处理';
}

export function getSceneTitle(scene: Pick<Scene, 'operation' | 'title'>): string {
  const operationLabel = getOperationLabel(scene.operation);
  return operationLabel === scene.operation
    ? scene.title
    : scene.title.replace(scene.operation, operationLabel);
}

export type CanvasNodeActions = {
  onDerive?: (result: Result) => void;
  onSubmitReview?: (resultId: string) => void;
};

export type SceneNodeData = {
  kind: 'scene';
  scene: StudioState['scenes'][number];
  results: Result[];
  selected: boolean;
  activeTool: TaskProfileId;
};

export type JobNodeData = {
  kind: 'job';
  job: StudioState['jobs'][number];
  profile: ReturnType<typeof getProfile>;
};

export type ResultNodeData = {
  kind: 'result';
  result: Result;
  selected: boolean;
  actions: CanvasNodeActions;
};

export type CanvasGraph = {
  nodes: Node<SceneNodeData | JobNodeData | ResultNodeData>[];
  edges: Edge[];
};

export function buildCanvasGraph(
  state: StudioState,
  selectedNodeId: string,
  activeTool: TaskProfileId,
  actions: CanvasNodeActions = {},
): CanvasGraph {
  const sceneNodes: Node<SceneNodeData>[] = state.scenes.map((scene) => ({
    id: `scene:${scene.id}`,
    type: 'scene',
    position: { x: scene.x, y: scene.y },
    data: {
      kind: 'scene',
      scene: {
        ...scene,
        operation: getOperationLabel(scene.operation),
        title: getSceneTitle(scene),
      },
      results: state.results.filter((result) => scene.resultIds.includes(result.id)),
      selected: selectedNodeId === `scene:${scene.id}`,
      activeTool,
    },
  }));
  const jobNodes: Node<JobNodeData>[] = state.jobs.map((job) => ({
    id: `job:${job.id}`,
    type: 'job',
    position: { x: job.x, y: job.y },
    data: { kind: 'job', job, profile: getProfile(job.profileId) },
  }));
  const resultNodes: Node<ResultNodeData>[] = state.results.map((result) => ({
    id: `result:${result.id}`,
    type: 'result',
    position: { x: result.x, y: result.y },
    data: {
      kind: 'result',
      result,
      selected: selectedNodeId === `result:${result.id}`,
      actions,
    },
  }));

  return {
    nodes: [...sceneNodes, ...jobNodes, ...resultNodes],
    edges: buildEdges(state),
  };
}

function buildEdges(state: StudioState): Edge[] {
  const jobEdges: Edge[] = state.jobs.map((job) => ({
    id: `scene-job:${job.id}`,
    source: `scene:${job.sceneId}`,
    target: `job:${job.id}`,
    animated: job.status === 'queued' || job.status === 'running',
    className: `lineage-edge is-${job.status}`,
    ...(job.status === 'failed' || job.status === 'canceled'
      ? { style: { strokeDasharray: '6 4' } }
      : {}),
  }));
  const resultEdges: Edge[] = state.results.map((result) => ({
    id: `job-result:${result.id}`,
    source: `job:${result.jobId}`,
    target: `result:${result.id}`,
    className: 'lineage-edge is-succeeded',
  }));
  const derivedEdges: Edge[] = state.edges.map((edge) => ({
    id: edge.id,
    source: `result:${resolveDerivedResultId(state, edge.source, edge.target)}`,
    target: `scene:${edge.target}`,
    label: getOperationLabel(edge.label),
    className: 'lineage-edge is-succeeded',
  }));

  return [...jobEdges, ...resultEdges, ...derivedEdges];
}

function resolveDerivedResultId(state: StudioState, sourceId: string, targetSceneId: string): string {
  if (state.results.some((result) => result.id === sourceId)) {
    return sourceId;
  }

  return state.scenes.find((scene) => scene.id === targetSceneId)?.sourceResultId ?? sourceId;
}
