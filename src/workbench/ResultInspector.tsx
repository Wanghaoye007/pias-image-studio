import { Check, Crown, Download, Star, X } from 'lucide-react';
import type {
  GenerationJob,
  QualityIssue,
  Result,
  Scene,
} from '../domain';
import { getProfile } from '../domain';
import { getReviewStatusLabel } from './CanvasNodes';
import { getSceneTitle } from './graph';

const qualityIssueLabels: Record<QualityIssue, string> = {
  'product-deformation': '商品变形',
  'text-logo': '文字或 Logo',
  material: '材质不准确',
  composition: '构图问题',
  lighting: '光影问题',
  background: '背景问题',
  dimensions: '尺寸问题',
  'content-safety': '内容安全',
  other: '其他',
};

const parameterLabels: Record<string, string> = {
  sceneTemplate: '视觉模板',
  quality: '质量档位',
  lightIntensity: '光照强度',
  lightDirection: '光照方向',
  lightTemperature: '色温',
  lightSmartMode: '智能打光',
  rimLight: '轮廓光',
  productPlacement: '商品位置',
  horizontalAngle: '水平旋转',
  moveForward: '镜头推进',
  verticalView: '垂直视角',
  wideAngle: '广角镜头',
  expandAnchor: '原图锚点',
  expandScale: '扩展比例',
  upscaleSize: '目标尺寸',
  detailLevel: '细节强度',
  brushSize: '笔刷大小',
};

type ResultInspectorProps = {
  result: Result;
  scene: Scene;
  job: GenerationJob;
  onClose: () => void;
  onDownloadPreview: () => void;
  onOpenExport: () => void;
  onQualityIssue: (issue: QualityIssue) => void;
  onSetPrimary: () => void;
  onSubmitReview: () => void;
  onToggleAdoption: () => void;
  onToggleFavorite: () => void;
};

export function ResultInspector({
  result,
  scene,
  job,
  onClose,
  onDownloadPreview,
  onOpenExport,
  onQualityIssue,
  onSetPrimary,
  onSubmitReview,
  onToggleAdoption,
  onToggleFavorite,
}: ResultInspectorProps) {
  const canSubmit = result.reviewStatus === 'draft' || result.reviewStatus === 'returned';
  const isApproved = result.reviewStatus === 'approved';
  const parameters = Object.entries(job.inputSnapshot.parameters);

  return (
    <aside aria-label="结果详情" className="result-inspector">
      <header>
        <div>
          <span>结果详情</span>
          <strong>{result.title}</strong>
        </div>
        <button aria-label="关闭结果详情" onClick={onClose} title="关闭" type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="result-inspector__scroll">
        <div className="result-inspector__preview">
          <img alt={result.title} src={result.imageUrl} />
          {!isApproved && <span className="result-inspector__watermark">预览用途</span>}
          <span className="result-inspector__dimensions">{result.width ?? 2048} x {result.height ?? 2048}</span>
        </div>

        <section className="result-inspector__section">
          <div className="result-inspector__section-title">
            <strong>结果决策</strong>
            <span>{getReviewStatusLabel(result.reviewStatus)}</span>
          </div>
          <div className="result-inspector__decisions">
            <button aria-pressed={Boolean(result.isFavorite)} onClick={onToggleFavorite} type="button">
              <Star aria-hidden="true" size={15} />
              {result.isFavorite ? '已收藏' : '收藏'}
            </button>
            <button aria-pressed={Boolean(result.isAdopted)} onClick={onToggleAdoption} type="button">
              <Check aria-hidden="true" size={15} />
              {result.isAdopted ? '已采用' : '采用'}
            </button>
            <button disabled={!result.isAdopted || result.isPrimary} onClick={onSetPrimary} type="button">
              <Crown aria-hidden="true" size={15} />
              {result.isPrimary ? '主结果' : '设为主结果'}
            </button>
          </div>
          <label className="result-inspector__quality">
            <span>不可用原因</span>
            <select
              aria-label="不可用原因"
              onChange={(event) => onQualityIssue(event.target.value as QualityIssue)}
              value={result.qualityIssue ?? ''}
            >
              <option disabled value="">未标记</option>
              {Object.entries(qualityIssueLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="result-inspector__section">
          <strong>来源与任务</strong>
          <dl className="result-inspector__metadata">
            <div><dt>来源场景</dt><dd>{getSceneTitle(scene)}</dd></div>
            <div><dt>SKU</dt><dd>{scene.skuCode}</dd></div>
            <div><dt>任务工具</dt><dd>{getProfile(job.profileId).label}</dd></div>
            <div><dt>目标比例</dt><dd>{job.inputSnapshot.ratio}</dd></div>
            <div><dt>任务状态</dt><dd>已完成</dd></div>
            <div><dt>消耗点数</dt><dd>{job.actualCredits}</dd></div>
            {result.generationMetadata && (
              <>
                <div><dt>模型</dt><dd>{result.generationMetadata.modelId}</dd></div>
                <div><dt>请求 ID</dt><dd>{result.generationMetadata.requestId}</dd></div>
                {result.generationMetadata.seed !== undefined && (
                  <div><dt>Seed</dt><dd>{result.generationMetadata.seed}</dd></div>
                )}
              </>
            )}
          </dl>
          {parameters.length > 0 && (
            <div className="result-inspector__parameters">
              {parameters.map(([key, value]) => (
                <span key={key}>{parameterLabels[key] ?? '任务参数'}：{String(value)}</span>
              ))}
            </div>
          )}
        </section>

        <section className="result-inspector__section result-inspector__delivery">
          <strong>交付</strong>
          <p>{isApproved ? '审核已通过，可生成无水印生产文件。' : '当前仅可下载带预览用途标识的文件。'}</p>
          {isApproved ? (
            <button className="is-primary" onClick={onOpenExport} type="button">配置生产导出</button>
          ) : (
            <button onClick={onDownloadPreview} type="button">
              <Download aria-hidden="true" size={15} />
              下载带水印预览
            </button>
          )}
          {canSubmit && <button onClick={onSubmitReview} type="button">提交审核</button>}
        </section>
      </div>
    </aside>
  );
}
