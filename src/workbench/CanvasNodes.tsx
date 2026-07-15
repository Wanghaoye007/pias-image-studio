import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { JobStatus, ReviewStatus, Scene } from '../domain';
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

export function getReviewStatusLabel(status: ReviewStatus): string {
  return reviewStatusLabels[status];
}

export function getSceneStatusLabel(status: Scene['status']): string {
  return sceneStatusLabels[status];
}

export function SceneCanvasNode({ data }: NodeProps<Node<SceneNodeData, 'scene'>>) {
  const approvedCount = data.results.filter((result) => result.reviewStatus === 'approved').length;
  const submittedCount = data.results.filter((result) => result.reviewStatus === 'submitted').length;
  const sceneTitle = getSceneTitle(data.scene);

  return (
    <article
      className={`canvas-node scene-node ${data.selected ? 'is-selected' : ''}`}
      data-interaction-mode={data.interactionMode ?? 'node-selected'}
    >
      <Handle type="target" position={Position.Left} />
      <img src={data.scene.imageUrl} alt={sceneTitle} />
      <div className="canvas-node__content">
        <strong>{sceneTitle}</strong>
        <span>{data.scene.skuCode}</span>
        <small>{getSceneStatusLabel(data.scene.status)}</small>
        <small>审核：{approvedCount} 已通过 / {submittedCount} 待审核</small>
      </div>
      <CanvasToolOverlay data={data} />
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

export function JobCanvasNode({ data }: NodeProps<Node<JobNodeData, 'job'>>) {
  return (
    <article className={`canvas-node job-node is-${data.job.status}`}>
      <Handle type="target" position={Position.Left} />
      <span>{data.profile.label}</span>
      <strong>{getJobStatusLabel(data.job.status)}</strong>
      <progress value={data.job.progress} max={100} aria-label="任务生成进度" />
      <small>{data.job.progress}%</small>
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

export function ResultCanvasNode({ data }: NodeProps<Node<ResultNodeData, 'result'>>) {
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
      <Handle type="source" position={Position.Right} />
    </article>
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
