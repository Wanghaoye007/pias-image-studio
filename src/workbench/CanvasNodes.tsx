import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ImagePlus, Plus } from 'lucide-react';
import type { GenerationJob, JobStatus, ReviewStatus, Scene } from '../domain';
import {
  AnglePreview,
  ExpandOverlay,
  LightOverlay,
  type LightDirection,
} from './CanvasOverlays';
import { getSceneTitle, type JobNodeData, type ResultNodeData, type SceneNodeData } from './graph';

const jobStatusLabels: Record<JobStatus, string> = {
  queued: '等待中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
};

const reviewStatusLabels: Record<ReviewStatus, string> = {
  draft: '草稿',
  submitted: '待审核',
  approved: '审核已通过',
  returned: '已退回',
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
  if (job.status === 'queued') return '等待调度';
  if (job.status === 'running') return job.progress >= 70 ? '优化细节' : '正在生成';
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
      {data.scene.imageUrl ? (
        <img src={data.scene.imageUrl} alt={sceneTitle} />
      ) : (
        <div aria-label="空白场景" className="scene-node__empty">
          <ImagePlus aria-hidden="true" size={28} />
          <span>拖入素材</span>
        </div>
      )}
      <div className="canvas-node__content">
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
  const canSubmit = data.result.reviewStatus === 'draft' || data.result.reviewStatus === 'returned';
  const isApproved = data.result.reviewStatus === 'approved';

  return (
    <article
      className={`canvas-node result-node ${data.selected ? 'is-selected' : ''}`}
      data-interaction-mode={data.interactionMode ?? 'node-selected'}
    >
      <Handle type="target" position={Position.Left} />
      <img src={data.result.imageUrl} alt={data.result.title} />
      <div className="canvas-node__content">
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
            {data.result.reviewStatus === 'returned' ? '重新提交' : '提交审核'}
          </button>
        )}
        {isApproved && (
          <a
            aria-label="下载结果"
            download={`${data.result.title}.png`}
            href={data.result.imageUrl}
            onClick={(event) => event.stopPropagation()}
          >
            下载
          </a>
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

function CreationHandle({
  nodeId,
  onCreateNode,
  selected,
}: {
  nodeId: string;
  onCreateNode?: (sourceNodeId: string) => void;
  selected: boolean;
}) {
  if (!selected) {
    return <Handle type="source" position={Position.Right} />;
  }

  const activate = () => onCreateNode?.(nodeId);

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
        ratio={data.ratio ?? '1:1'}
        scale={numberParameter(data.parameters?.expandScale, 72)}
      />
    );
  }

  if (data.activeTool === 'angle' && data.interactionMode === 'editing-angle') {
    return (
      <AnglePreview
        horizontal={numberParameter(data.parameters?.horizontalAngle, 0)}
        vertical={numberParameter(data.parameters?.verticalAngle, 0)}
      />
    );
  }

  return null;
}

function isLightDirection(value: string | number | undefined): value is LightDirection {
  return typeof value === 'string' && [
    'top-left',
    'top',
    'top-right',
    'right',
    'bottom-right',
    'bottom',
    'bottom-left',
    'left',
  ].includes(value);
}

function numberParameter(value: string | number | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

export const canvasNodeTypes = {
  scene: SceneCanvasNode,
  job: JobCanvasNode,
  result: ResultCanvasNode,
};
