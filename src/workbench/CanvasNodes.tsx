import {
  Handle,
  Position,
  useUpdateNodeInternals,
  useViewport,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  Check,
  Columns3,
  Crown,
  ImagePlus,
  Info,
  Pencil,
  Plus,
  Star,
} from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import type { GenerationJob, JobStatus, ReviewStatus, Scene } from '../domain';
import {
  AnglePreview,
  ExpandOverlay,
  LightOverlay,
  RemoveMaskOverlay,
  type ExpandAnchor,
  type LightDirection,
} from './CanvasOverlays';
import { getSceneTitle, type JobNodeData, type ResultNodeData, type SceneNodeData } from './graph';

const jobStatusLabels: Record<JobStatus, string> = {
  preflight: '预检中',
  queued: '等待中',
  running: '生成中',
  postprocessing: '后处理中',
  partially_succeeded: '部分完成',
  cancel_requested: '正在取消',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
  expired: '已过期',
};

const reviewStatusLabels: Record<ReviewStatus, string> = {
  draft: '草稿',
  submitted: '待审核',
  approved: '审核已通过',
  returned: '已退回',
  rejected: '已拒绝',
};

const sceneStatusLabels: Record<Scene['status'], string> = {
  source: '源素材',
  draft: '草稿',
  ...jobStatusLabels,
};

export function getJobStatusLabel(status: JobStatus): string {
  return jobStatusLabels[status];
}

export function getJobStageLabel(job: Pick<GenerationJob, 'progress' | 'status'>): string {
  if (job.status === 'preflight') return '正在检查输入';
  if (job.status === 'queued') return '等待调度';
  if (job.status === 'running') return job.progress >= 70 ? '优化细节' : '正在生成';
  if (job.status === 'postprocessing') return '整理生成结果';
  if (job.status === 'partially_succeeded') return '部分结果可用';
  if (job.status === 'cancel_requested') return '正在取消远端任务';
  if (job.status === 'expired') return '任务已过期';
  return getJobStatusLabel(job.status);
}

export function getReviewStatusLabel(status: ReviewStatus): string {
  return reviewStatusLabels[status];
}

export function getSceneStatusLabel(status: Scene['status']): string {
  return sceneStatusLabels[status];
}

export function SceneCanvasNode({ data, id }: NodeProps<Node<SceneNodeData, 'scene'>>) {
  const approvedCount = data.results.filter((result) => result.reviewStatus === 'approved').length;
  const submittedCount = data.results.filter((result) => result.reviewStatus === 'submitted').length;
  const sceneTitle = getSceneTitle(data.scene);

  return (
    <article
      className={`canvas-node scene-node ${data.selected ? 'is-selected' : ''}`}
      data-interaction-mode={data.interactionMode ?? 'node-selected'}
    >
      <Handle type="target" position={Position.Left} />
      <header className="canvas-node__header">
        <strong>{sceneTitle}</strong>
        <span aria-hidden="true" className="canvas-node__edit-mark"><Pencil size={12} /></span>
      </header>
      {data.scene.imageUrl ? (
        <img src={data.scene.imageUrl} alt={sceneTitle} />
      ) : (
        <div aria-label="空白场景" className="scene-node__empty">
          <ImagePlus aria-hidden="true" size={28} />
          <span>拖入素材</span>
        </div>
      )}
      <div className="canvas-node__content canvas-node__metadata">
        <strong>{sceneTitle}</strong>
        <span>{data.scene.skuCode}</span>
        <small>{getSceneStatusLabel(data.scene.status)}</small>
        <small>审核：{approvedCount} 已通过 / {submittedCount} 待审核</small>
      </div>
      <CanvasToolOverlay data={data} />
      <CreationHandle
        nodeId={id}
        onCreateNode={data.actions?.onCreateNode}
        selected={data.selected}
      />
    </article>
  );
}

export function JobCanvasNode({ data }: NodeProps<Node<JobNodeData, 'job'>>) {
  return (
    <article
      className={`canvas-node job-node is-${data.job.status}`}
      data-stage={getJobStageLabel(data.job)}
    >
      <Handle type="target" position={Position.Left} />
      <header className="canvas-node__header">
        <strong>{data.profile.label} · {getJobStageLabel(data.job)}</strong>
      </header>
      <img alt="" className="job-node__preview" src={data.previewImageUrl} />
      <span aria-hidden="true" className="job-node__scrim" />
      <div className="job-node__progress">
        <span>{data.profile.label}</span>
        <strong>{getJobStageLabel(data.job)}</strong>
        <progress value={data.job.progress} max={100} aria-label="任务生成进度" />
        <small>{data.job.progress}%</small>
      </div>
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

export function ResultCanvasNode({ data, id }: NodeProps<Node<ResultNodeData, 'result'>>) {
  const canSubmit = data.result.reviewStatus === 'draft';
  const canRevise = data.result.reviewStatus === 'returned' || data.result.reviewStatus === 'rejected';
  const isAdopted = Boolean(data.result.isAdopted);
  const isPrimary = Boolean(data.result.isPrimary);

  return (
    <article
      className={`canvas-node result-node ${data.selected ? 'is-selected' : ''}`}
      data-interaction-mode={data.interactionMode ?? 'node-selected'}
    >
      <Handle type="target" position={Position.Left} />
      <header className="canvas-node__header">
        <strong>{data.result.title}</strong>
        <span aria-hidden="true" className="canvas-node__edit-mark"><Pencil size={12} /></span>
      </header>
      <img src={data.result.imageUrl} alt={data.result.title} />
      <div aria-label="结果快捷操作" className="result-decision-bar nodrag">
        <ResultIconAction
          active={Boolean(data.result.isFavorite)}
          icon={Star}
          label={data.result.isFavorite ? '取消收藏' : '收藏结果'}
          onClick={() => data.actions.onToggleFavorite?.(data.result.id)}
        />
        <ResultIconAction
          active={isAdopted}
          icon={Check}
          label={isAdopted ? '取消采用' : '采用结果'}
          onClick={() => data.actions.onToggleAdoption?.(data.result.id)}
        />
        <ResultIconAction
          active={isPrimary}
          disabled={!isAdopted || isPrimary}
          icon={Crown}
          label={isPrimary ? '当前主结果' : '设置为主结果'}
          onClick={() => data.actions.onSetPrimary?.(data.result.id)}
        />
        <ResultIconAction
          active={Boolean(data.compareSelected)}
          icon={Columns3}
          label={data.compareSelected ? '移出对比' : '加入对比'}
          onClick={() => data.actions.onToggleCompare?.(data.result.id)}
        />
        <ResultIconAction
          icon={Info}
          label="查看结果详情"
          onClick={() => data.actions.onOpenDetails?.(data.result.id)}
        />
      </div>
      {(isAdopted || isPrimary) && (
        <div className="result-state-badges" aria-label="结果决策状态">
          {isAdopted && <span>已采用</span>}
          {isPrimary && <span>主结果</span>}
        </div>
      )}
      <div className="canvas-node__content canvas-node__metadata">
        <strong>{data.result.title}</strong>
        <small>{getReviewStatusLabel(data.result.reviewStatus)}</small>
        {data.result.reviewComment && <small>{data.result.reviewComment}</small>}
      </div>
      <div className="result-actions nodrag">
        <button
          aria-label="继续创作"
          onClick={(event) => {
            event.stopPropagation();
            data.actions.onDerive?.(data.result);
          }}
          type="button"
        >
          继续创作
        </button>
        {canSubmit && (
          <button
            aria-label="提交审核"
            onClick={(event) => {
              event.stopPropagation();
              data.actions.onSubmitReview?.(data.result.id);
            }}
            type="button"
          >
            提交审核
          </button>
        )}
        {data.result.reviewStatus === 'submitted' && (
          <button
            aria-label="撤回审核"
            onClick={(event) => {
              event.stopPropagation();
              data.actions.onWithdrawReview?.(data.result.id);
            }}
            type="button"
          >
            撤回
          </button>
        )}
        {canRevise && (
          <button
            aria-label="创建修改版本"
            onClick={(event) => {
              event.stopPropagation();
              data.actions.onReviseResult?.(data.result.id);
            }}
            type="button"
          >
            修改后重试
          </button>
        )}
      </div>
      <CanvasToolOverlay data={data} />
      <CreationHandle
        nodeId={id}
        onCreateNode={data.actions.onCreateNode}
        selected={data.selected}
      />
    </article>
  );
}

function ResultIconAction({
  active = false,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: typeof Star;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={active ? 'is-active' : ''}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={14} />
    </button>
  );
}

function CreationHandle({
  nodeId,
  onCreateNode,
  selected,
}: {
  nodeId: string;
  onCreateNode?: (sourceNodeId: string) => void;
  selected: boolean;
}) {
  const { zoom } = useViewport();
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, selected, updateNodeInternals, zoom]);

  if (!selected) {
    return <Handle type="source" position={Position.Right} />;
  }

  const activate = () => onCreateNode?.(nodeId);
  const safeZoom = zoom > 0 ? zoom : 1;
  const createHandleStyle = {
    '--node-create-size': `${44 / safeZoom}px`,
    '--node-create-visual-size': `${36 / safeZoom}px`,
  } as CSSProperties;

  return (
    <Handle
      aria-label="拖拽新增节点"
      className="node-create-handle nodrag"
      id="create"
      onClick={(event) => {
        event.stopPropagation();
        activate();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        activate();
      }}
      position={Position.Right}
      role="button"
      style={createHandleStyle}
      tabIndex={0}
      title="拖拽新增节点"
      type="source"
    >
      <Plus aria-hidden="true" size={20} strokeWidth={2.4} />
    </Handle>
  );
}

function CanvasToolOverlay({ data }: { data: SceneNodeData | ResultNodeData }) {
  if (!data.selected || !data.activeTool || !data.interactionMode) return null;

  if (data.activeTool === 'light' && data.interactionMode === 'editing-light') {
    const direction = isLightDirection(data.parameters?.lightDirection)
      ? data.parameters.lightDirection
      : 'top-right';
    return (
      <LightOverlay
        direction={direction}
        onDirectionChange={(value) => data.onParameterChange?.('lightDirection', value)}
      />
    );
  }

  if (data.activeTool === 'expand' && data.interactionMode === 'editing-expand') {
    return (
      <ExpandOverlay
        anchor={isExpandAnchor(data.parameters?.expandAnchor)
          ? data.parameters.expandAnchor
          : 'center'}
        onAnchorChange={(value) => data.onParameterChange?.('expandAnchor', value)}
        ratio={data.ratio ?? '1:1'}
        scale={numberParameter(data.parameters?.expandScale, 72)}
      />
    );
  }

  if (data.activeTool === 'angle' && data.interactionMode === 'editing-angle') {
    return (
      <AnglePreview
        horizontal={numberParameter(data.parameters?.horizontalAngle, 0)}
        onHorizontalChange={(value) => data.onParameterChange?.('horizontalAngle', value)}
        vertical={numberParameter(data.parameters?.verticalView, 0)}
      />
    );
  }

  if (data.activeTool === 'remove' && data.interactionMode === 'editing-remove') {
    return (
      <RemoveMaskOverlay
        brushSize={numberParameter(data.parameters?.brushSize, 42)}
        maskImageUrl={data.maskImageUrl}
        onMaskChange={data.onMaskChange}
      />
    );
  }

  return null;
}

function isExpandAnchor(value: unknown): value is ExpandAnchor {
  return typeof value === 'string' && [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right',
  ].includes(value);
}

function isLightDirection(value: unknown): value is LightDirection {
  return typeof value === 'string' && [
    'top-left',
    'top',
    'top-right',
    'right',
    'bottom-right',
    'bottom',
    'bottom-left',
    'left',
    'front',
    'back',
  ].includes(value);
}

function numberParameter(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

export const canvasNodeTypes = {
  scene: SceneCanvasNode,
  job: JobCanvasNode,
  result: ResultCanvasNode,
};
