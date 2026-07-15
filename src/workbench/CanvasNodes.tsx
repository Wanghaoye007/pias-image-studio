import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { JobStatus, ReviewStatus, Scene } from '../domain';
import type { JobNodeData, ResultNodeData, SceneNodeData } from './graph';

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

  return (
    <article className={`canvas-node scene-node ${data.selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <img src={data.scene.imageUrl} alt={data.scene.title} />
      <div className="canvas-node__content">
        <strong>{data.scene.title}</strong>
        <span>{data.scene.skuCode}</span>
        <small>{getSceneStatusLabel(data.scene.status)}</small>
        <small>审核：{approvedCount} 已通过 / {submittedCount} 待审核</small>
      </div>
      {data.selected && data.activeTool === 'light' && <LightControls />}
      {data.selected && data.activeTool === 'expand' && <ExpansionGrid />}
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
  const isDraft = data.result.reviewStatus === 'draft';
  const isApproved = data.result.reviewStatus === 'approved';

  return (
    <article className={`canvas-node result-node ${data.selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <img src={data.result.imageUrl} alt={data.result.title} />
      <div className="canvas-node__content">
        <strong>{data.result.title}</strong>
        <small>{getReviewStatusLabel(data.result.reviewStatus)}</small>
      </div>
      <div className="result-actions">
        <button aria-label="继续创作" onClick={() => data.actions.onDerive?.(data.result)} type="button">
          继续创作
        </button>
        <button
          aria-label="提交审核"
          disabled={!isDraft}
          onClick={() => data.actions.onSubmitReview?.(data.result.id)}
          type="button"
        >
          提交审核
        </button>
        <button aria-label="下载结果" disabled={!isApproved} type="button">
          下载
        </button>
      </div>
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function LightControls() {
  return (
    <div className="light-controls" aria-label="定向光控制">
      <span className="light-point" aria-label="定向光控制点" />
      {Array.from({ length: 8 }, (_, index) => (
        <span className="light-handle" aria-label={`定向光控制柄 ${index + 1}`} key={index} />
      ))}
    </div>
  );
}

function ExpansionGrid() {
  return (
    <div className="expansion-grid" aria-label="扩图范围网格">
      {Array.from({ length: 9 }, (_, index) => (
        <span aria-label={`扩图区域 ${index + 1}`} key={index} />
      ))}
    </div>
  );
}

export const canvasNodeTypes = {
  scene: SceneCanvasNode,
  job: JobCanvasNode,
  result: ResultCanvasNode,
};
