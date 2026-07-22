import {
  Check,
  ChevronRight,
  Coins,
  Copy,
  Download,
  FolderKanban,
  Gauge,
  Image,
  ImagePlus,
  Lock,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ActiveAuthSession } from './auth/authClient';
import {
  useEffect,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { uploadAssetImage } from './assets/assetImageClient';
import {
  addAsset,
  approveResult,
  getProfile,
  recordResultExport,
  rejectResult,
  returnResult,
  type Asset,
  type ExportSpec,
  type JobStatus,
  type ReviewStatus,
  type Scene,
  type StudioState,
} from './domain';
import { downloadProductionDelivery } from './exportDelivery';
import {
  createInvitation,
  createProject,
  listInvitations,
  listMembers,
  listProjects,
  resendInvitation,
  revokeInvitation,
  updateMember,
} from './organization/organizationClient';
import type {
  OrganizationInvitation,
  OrganizationMember,
  OrganizationProject,
} from './organization/organizationService';
import { PersistenceStatus } from './studio/PersistenceStatus';
import type { StudioSaveStatus } from './studio/usePersistentStudioState';
import { getSceneTitle } from './workbench/graph';
import { navItems, roleLabel, type NavKey } from './GlobalNav';

type SecondaryViewProps = {
  activeNav: NavKey;
  activeProject?: OrganizationProject | null;
  activeProjectId?: string;
  authSession?: ActiveAuthSession | null;
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
  saveStatus?: StudioSaveStatus;
  onOpenProject?: (project: OrganizationProject) => void;
  onRetrySave?: () => void;
  onReloadState?: () => void;
};

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

const auditEventLabels: Record<string, string> = {
  'asset.uploaded': '已上传素材',
  'job.created': '已创建任务',
  'job.cancel_requested': '已请求取消任务',
  'job.succeeded': '任务已完成',
  'job.partially_succeeded': '任务部分完成',
  'job.failed': '任务失败',
  'job.canceled': '已取消任务',
  'job.expired': '任务已过期',
  'scene.created_from_asset': '已从素材创建场景',
  'scene.derived': '已创建派生场景',
  'review.submitted': '已提交审核',
  'review.approved': '审核已通过',
  'review.returned': '审核已退回',
  'review.rejected': '审核已拒绝',
  'review.withdrawn': '已撤回审核',
  'result.favorited': '已收藏结果',
  'result.unfavorited': '已取消收藏',
  'result.adopted': '已采用结果',
  'result.unadopted': '已取消采用',
  'result.primary_set': '已设为主结果',
  'result.quality_flagged': '已记录不可用原因',
  'result.exported': '已创建生产导出',
};

const quickExportSpec: ExportSpec = {
  format: 'png',
  size: 'original',
  includeManifestCsv: true,
  includeManifestJson: true,
};

export function getAuditTargetLabel(state: StudioState, targetId: string): string {
  const jobIndex = state.jobs.findIndex((job) => job.id === targetId);
  if (jobIndex >= 0) {
    return `任务 ${String(jobIndex + 1).padStart(2, '0')} · ${getProfile(state.jobs[jobIndex].profileId).label}`;
  }

  const scene = state.scenes.find((item) => item.id === targetId);
  if (scene) {
    return `${getSceneTitle(scene)} · ${scene.skuCode}`;
  }

  const asset = state.assets.find((item) => item.id === targetId);
  if (asset) {
    return `${asset.product} · ${asset.skuCode}`;
  }

  const result = state.results.find((item) => item.id === targetId);
  return result?.title ?? '操作对象';
}

export function SecondaryView({
  activeNav,
  activeProject,
  activeProjectId,
  authSession,
  state,
  setState,
  saveStatus = 'saved',
  onOpenProject,
  onRetrySave = () => undefined,
  onReloadState = () => undefined,
}: SecondaryViewProps) {
  const submittedResults = state.results.filter((result) => result.reviewStatus === 'submitted');
  const approvedResults = state.results.filter((result) => result.reviewStatus === 'approved');
  const activeLabel = navItems.find((item) => item.key === activeNav)?.label ?? '首页';
  const actorId = authSession?.status === 'authenticated' ? authSession.user.id : 'Mika Tanaka';
  const visibleNotifications = state.notifications.filter((notification) => {
    if (!authSession || authSession.status !== 'authenticated') return true;
    if (authSession.user.role === 'owner' || authSession.user.role === 'admin') return true;
    if (notification.recipientUserId) return notification.recipientUserId === authSession.user.id;
    return notification.recipientRole === authSession.user.role;
  });
  const [exportingResultId, setExportingResultId] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [assetUploadOpen, setAssetUploadOpen] = useState(false);
  const [assetNotice, setAssetNotice] = useState('');
  const [reviewDecision, setReviewDecision] = useState<{
    resultId: string;
    type: 'return' | 'reject';
  } | null>(null);
  const [reviewReason, setReviewReason] = useState('');

  const handleQuickExport = async (resultId: string) => {
    const result = state.results.find((item) => item.id === resultId);
    if (!result) return;
    setExportingResultId(resultId);
    setExportNotice('');
    try {
      const files = await downloadProductionDelivery(state, result, quickExportSpec);
      setState((current) => recordResultExport(current, resultId, 'Mika Tanaka', quickExportSpec));
      setExportNotice(`已生成 ${files.length} 个交付文件`);
    } catch (error) {
      setExportNotice(error instanceof Error ? error.message : '生产导出失败');
    } finally {
      setExportingResultId('');
    }
  };

  const handleAssetUpload = (input: Omit<Asset, 'id'>) => {
    const next = addAsset(state, input);
    setState(next);
    setAssetUploadOpen(false);
    setAssetNotice(`已上传 ${input.product.trim()}`);
  };

  return (
    <>
      <header className="global-header">
        <div>
          <span className="eyebrow">企业内容生产</span>
          <h1>{activeLabel}</h1>
        </div>
        <div className="header-metrics" aria-label="工作区摘要">
          <div className="secondary-persistence-status">
            <PersistenceStatus
              onReload={onReloadState}
              onRetry={onRetrySave}
              status={saveStatus}
            />
          </div>
          <Metric label="冻结" value={state.usage.frozenCredits.toString()} />
          <Metric label="已用" value={state.usage.spentCredits.toString()} />
          <Metric label="待审核" value={submittedResults.length.toString()} />
        </div>
      </header>
      <section className="page-surface">
        {activeNav === 'reviews' && exportNotice && (
          <div className="secondary-notice" role="status">{exportNotice}</div>
        )}
        {activeNav === 'dashboard' && (
          <OperationalDashboard
            approvedCount={approvedResults.length}
            notifications={visibleNotifications}
            state={state}
          />
        )}
        {activeNav === 'assets' && assetNotice && (
          <div aria-label="素材上传状态" className="secondary-notice" role="status">{assetNotice}</div>
        )}
        {activeNav === 'projects' && (
          <ProjectsView
            authSession={authSession}
            activeProjectId={activeProjectId}
            onOpenProject={onOpenProject}
            state={state}
            switchEnabled={saveStatus === 'saved' || saveStatus === 'idle'}
          />
        )}
        {activeNav === 'assets' && (
          <AssetsView onUpload={() => setAssetUploadOpen(true)} state={state} />
        )}
        {activeNav === 'reviews' && (
          <ReviewsView
            exportingResultId={exportingResultId}
            onApprove={(resultId) => setState((current) => approveResult(current, resultId, actorId))}
            onExport={(resultId) => { void handleQuickExport(resultId); }}
            onReject={(resultId) => {
              setReviewReason('');
              setReviewDecision({ resultId, type: 'reject' });
            }}
            onReturn={(resultId) => {
              setReviewReason('');
              setReviewDecision({ resultId, type: 'return' });
            }}
            state={state}
          />
        )}
        {activeNav === 'usage' && <UsageView state={state} />}
        {activeNav === 'admin' && (
          <AdminView
            activeProject={activeProject}
            activeProjectId={activeProjectId}
            authSession={authSession}
            state={state}
          />
        )}
      </section>
      {activeNav === 'assets' && assetUploadOpen && (
        <AssetUploadDialog
          onClose={() => setAssetUploadOpen(false)}
          onSubmit={handleAssetUpload}
        />
      )}
      {reviewDecision && (
        <ReviewDecisionDialog
          decision={reviewDecision.type}
          onClose={() => setReviewDecision(null)}
          onConfirm={() => {
            setState((current) => reviewDecision.type === 'return'
              ? returnResult(current, reviewDecision.resultId, actorId, reviewReason)
              : rejectResult(current, reviewDecision.resultId, actorId, reviewReason));
            setReviewDecision(null);
          }}
          onReasonChange={setReviewReason}
          reason={reviewReason}
        />
      )}
    </>
  );
}

function OperationalDashboard({
  state,
  approvedCount,
  notifications,
}: {
  state: StudioState;
  approvedCount: number;
  notifications: StudioState['notifications'];
}) {
  return (
    <>
      <div className="overview-grid">
        <Kpi icon={Image} label="已审核图片" tone="green" value={approvedCount.toString()} />
        <Kpi icon={Sparkles} label="任务数" tone="blue" value={state.jobs.length.toString()} />
        <Kpi icon={Coins} label="可用用量" tone="gold" value={state.usage.availableCredits.toString()} />
        <Kpi icon={ShieldCheck} label="审计事件" tone="red" value={state.auditEvents.length.toString()} />
      </div>
      <div className="wide-table">
        <TableHeader meta="最近 6 条" title="最近操作" />
        {state.auditEvents.slice(-6).map((event) => (
          <div className="table-row" key={event.id}>
            <span>{auditEventLabels[event.type] ?? '审计事件'}</span>
            <strong>{event.actor}</strong>
            <small>{getAuditTargetLabel(state, event.targetId)}</small>
          </div>
        ))}
      </div>
      <div className="wide-table">
        <TableHeader meta={`${notifications.length} 条`} title="站内通知" />
        {notifications.slice(-6).reverse().map((notification) => (
          <div className="table-row" key={notification.id}>
            <span>{notification.message}</span>
            <strong>{getAuditTargetLabel(state, notification.targetId)}</strong>
            <small>{notification.readAt ? '已读' : '未读'}</small>
          </div>
        ))}
        {notifications.length === 0 && (
          <div className="table-row table-row--empty">暂无通知</div>
        )}
      </div>
    </>
  );
}

function ProjectsView({
  state,
  authSession,
  activeProjectId,
  onOpenProject,
  switchEnabled,
}: {
  state: StudioState;
  authSession?: ActiveAuthSession | null;
  activeProjectId?: string;
  onOpenProject?: (project: OrganizationProject) => void;
  switchEnabled: boolean;
}) {
  const organizationEnabled = authSession?.status === 'authenticated';
  const canCreate = organizationEnabled
    && ['owner', 'admin', 'creator'].includes(authSession.user.role);
  const [projects, setProjects] = useState<OrganizationProject[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!organizationEnabled) return;
    let active = true;
    void listProjects().then((items) => {
      if (active) setProjects(items);
    }).catch((nextError: unknown) => {
      if (active) setError(errorMessage(nextError, '无法读取项目列表'));
    });
    return () => { active = false; };
  }, [organizationEnabled]);

  const actionTitle = !organizationEnabled
    ? '需要启用企业身份服务'
    : canCreate ? '新建项目' : '当前角色不能新建项目';

  return (
    <>
      <div className="section-title">
        <h2>项目</h2>
        <button
          className="secondary-action"
          disabled={!canCreate}
          onClick={() => setDialogOpen(true)}
          title={actionTitle}
          type="button"
        >
          <FolderKanban size={17} />
          新建项目
        </button>
      </div>
      {error && <div className="secondary-notice secondary-notice--error" role="alert">{error}</div>}
      <article className="project-row project-row--current">
        <div>
          <span className="eyebrow">图片工作区</span>
          <h3>{state.projectName}</h3>
          <p>PIAS-SF-001 · {state.scenes.length} 个场景 · {state.results.length} 个结果</p>
        </div>
        <span className="project-row__status">当前项目</span>
      </article>
      {projects.length > 0 && (
        <div className="project-list" aria-label="企业项目列表">
          {projects.filter((project) => project.id !== activeProjectId).map((project) => (
            <button
              aria-label={`打开项目 ${project.name}`}
              className="project-row"
              disabled={!onOpenProject || !switchEnabled}
              key={project.id}
              onClick={() => onOpenProject?.(project)}
              title={switchEnabled ? `打开 ${project.name}` : '当前项目仍有未确认保存'}
              type="button"
            >
              <div>
                <span className="eyebrow">{project.reviewRequired ? '需审核' : '直接交付'}</span>
                <h3>{project.name}</h3>
                <p>{project.defaultBrand || '未设置默认品牌'} · {project.defaultSku || '未绑定默认 SKU'}</p>
              </div>
              <ChevronRight aria-hidden="true" size={22} />
            </button>
          ))}
        </div>
      )}
      {dialogOpen && (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(project) => {
            setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
            setDialogOpen(false);
          }}
        />
      )}
    </>
  );
}

function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: OrganizationProject) => void;
}) {
  const [name, setName] = useState('');
  const [defaultBrand, setDefaultBrand] = useState('');
  const [defaultSku, setDefaultSku] = useState('');
  const [reviewRequired, setReviewRequired] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      onCreated(await createProject({ name, defaultBrand, defaultSku, reviewRequired }));
    } catch (nextError) {
      setError(errorMessage(nextError, '项目创建失败'));
      setSubmitting(false);
    }
  };

  return (
    <div className="asset-upload-backdrop" onMouseDown={onClose}>
      <form
        aria-labelledby="new-project-title"
        aria-modal="true"
        className="asset-upload-dialog organization-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { void handleSubmit(event); }}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="new-project-title">新建项目</h2>
            <p>创建独立的画布、素材、任务与审核空间。</p>
          </div>
          <button aria-label="关闭新建项目" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="organization-dialog__body">
          <label>
            <span>项目名称</span>
            <input aria-label="项目名称" autoFocus maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
          </label>
          <label>
            <span>默认品牌</span>
            <input aria-label="默认品牌" maxLength={100} onChange={(event) => setDefaultBrand(event.target.value)} value={defaultBrand} />
          </label>
          <label>
            <span>默认 SKU</span>
            <input aria-label="默认 SKU" maxLength={100} onChange={(event) => setDefaultSku(event.target.value)} value={defaultSku} />
          </label>
          <label className="organization-dialog__toggle">
            <input checked={reviewRequired} onChange={(event) => setReviewRequired(event.target.checked)} type="checkbox" />
            <span>交付前必须审核</span>
          </label>
        </div>
        {error && <p className="asset-upload-error" role="alert">{error}</p>}
        <footer>
          <button onClick={onClose} type="button">取消</button>
          <button className="is-primary" disabled={submitting || name.trim().length < 2} type="submit">
            {submitting ? '创建中' : '创建项目'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function AssetsView({ state, onUpload }: { state: StudioState; onUpload: () => void }) {
  return (
    <>
      <div className="section-title">
        <h2>素材库</h2>
        <button className="secondary-action" onClick={onUpload} type="button">
          <Upload size={17} />
          上传
        </button>
      </div>
      <div className="asset-grid-page">
        {state.assets.map((asset) => (
          <article className="catalog-card" key={asset.id}>
            <img alt={`${asset.skuCode} ${asset.product}`} src={asset.imageUrl} />
            <div>
              <strong>{asset.skuCode}</strong>
              <span>{asset.brand} / {asset.product}</span>
              <small>{asset.usage} · {asset.version}</small>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

const acceptedAssetImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAssetImageBytes = 10 * 1024 * 1024;

function AssetUploadDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: Omit<Asset, 'id'>) => void;
}) {
  const [brand, setBrand] = useState('PIAS');
  const [product, setProduct] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [usage, setUsage] = useState('商品主图');
  const [version, setVersion] = useState('v1');
  const [imageUrl, setImageUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError('');
    setImageUrl('');
    setSelectedFile(null);
    setFileName('');
    if (!file) return;
    try {
      const nextImageUrl = await readAssetImage(file);
      setImageUrl(nextImageUrl);
      setSelectedFile(file);
      setFileName(file.name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '图片读取失败');
      event.target.value = '';
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!selectedFile) return;
    setUploading(true);
    try {
      const uploaded = await uploadAssetImage(selectedFile);
      onSubmit({ brand, product, skuCode, usage, version, imageUrl: uploaded.imageUrl });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '素材上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="asset-upload-backdrop" onMouseDown={onClose}>
      <form
        aria-labelledby="asset-upload-title"
        aria-modal="true"
        className="asset-upload-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { void handleSubmit(event); }}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="asset-upload-title">上传素材</h2>
            <p>导入后可直接拖入图片工作台，素材版本会随任务记录。</p>
          </div>
          <button aria-label="关闭上传素材" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="asset-upload-dialog__body">
          <label className="asset-upload-dropzone">
            <input
              accept="image/jpeg,image/png,image/webp"
              aria-label="素材图片"
              onChange={(event) => { void handleFileChange(event); }}
              type="file"
            />
            {imageUrl ? (
              <>
                <img alt="素材预览" src={imageUrl} />
                <span>{fileName}</span>
              </>
            ) : (
              <>
                <ImagePlus aria-hidden="true" size={28} />
                <strong>选择商品图片</strong>
                <span>PNG、JPG 或 WebP，最大 10 MB</span>
              </>
            )}
          </label>
          <div className="asset-upload-fields">
            <label>
              <span>品牌</span>
              <input aria-label="品牌" onChange={(event) => setBrand(event.target.value)} value={brand} />
            </label>
            <label>
              <span>商品名称</span>
              <input aria-label="商品名称" onChange={(event) => setProduct(event.target.value)} value={product} />
            </label>
            <label>
              <span>SKU 编码</span>
              <input aria-label="SKU 编码" onChange={(event) => setSkuCode(event.target.value)} value={skuCode} />
            </label>
            <label>
              <span>用途</span>
              <select aria-label="用途" onChange={(event) => setUsage(event.target.value)} value={usage}>
                <option>商品主图</option>
                <option>商品辅图</option>
                <option>场景参考</option>
                <option>模特参考</option>
              </select>
            </label>
            <label>
              <span>版本</span>
              <input aria-label="版本" onChange={(event) => setVersion(event.target.value)} value={version} />
            </label>
          </div>
        </div>
        {error && <p className="asset-upload-error" role="alert">{error}</p>}
        <footer>
          <button onClick={onClose} type="button">取消</button>
          <button
            className="is-primary"
            disabled={uploading || !brand.trim() || !product.trim() || !skuCode.trim() || !selectedFile || !imageUrl}
            type="submit"
          >
            <Upload aria-hidden="true" size={16} />
            {uploading ? '上传中' : '确认上传'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function readAssetImage(file: File): Promise<string> {
  if (!acceptedAssetImageTypes.has(file.type)) {
    return Promise.reject(new Error('仅支持 PNG、JPG 或 WebP 图片'));
  }
  if (file.size > maxAssetImageBytes) {
    return Promise.reject(new Error('图片不能超过 10 MB'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('图片读取失败，请重新选择'));
    reader.readAsDataURL(file);
  });
}

function ReviewsView({
  state,
  onApprove,
  onExport,
  onReturn,
  onReject,
  exportingResultId,
}: {
  state: StudioState;
  onApprove: (resultId: string) => void;
  onExport: (resultId: string) => void;
  onReturn: (resultId: string) => void;
  onReject: (resultId: string) => void;
  exportingResultId: string;
}) {
  return (
    <>
      <div className="section-title">
        <h2>审核</h2>
        <span className="status-chip">{state.results.filter((result) => result.reviewStatus === 'submitted').length} 项待审核</span>
      </div>
      <div className="review-stack">
        {state.results.map((result) => {
          const sourceScene = state.scenes.find((scene) => scene.id === result.sourceSceneId);

          return (
            <article className="review-row" key={result.id}>
              <img alt={result.title} src={result.imageUrl} />
              <div>
                <strong>{result.title}</strong>
                <small>{reviewStatusLabels[result.reviewStatus]} · {getSourceSceneLabel(sourceScene)}</small>
                {result.reviewComment && <small>{result.reviewComment}</small>}
              </div>
              {result.reviewStatus === 'submitted' ? (
                <div className="review-actions">
                  <button
                    aria-label="退回修改"
                    className="icon-button"
                    onClick={() => onReturn(result.id)}
                    title="退回修改"
                    type="button"
                  >
                    <Undo2 aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label="拒绝审核"
                    className="icon-button"
                    onClick={() => onReject(result.id)}
                    title="拒绝审核"
                    type="button"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label="通过审核"
                    className="icon-button"
                    onClick={() => onApprove(result.id)}
                    title="通过审核"
                    type="button"
                  >
                    <Check aria-hidden="true" size={18} />
                  </button>
                </div>
              ) : result.reviewStatus === 'approved' ? (
                <button
                  aria-label="生成生产导出"
                  className="icon-button"
                  disabled={exportingResultId === result.id}
                  onClick={() => onExport(result.id)}
                  title="生成生产导出"
                  type="button"
                >
                  <Download aria-hidden="true" size={18} />
                </button>
              ) : (
                <span className="status-chip">{reviewStatusLabels[result.reviewStatus]}</span>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function ReviewDecisionDialog({
  decision,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
}: {
  decision: 'return' | 'reject';
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const label = decision === 'return' ? '退回修改' : '拒绝审核';
  const valid = reason.trim().length >= 5 && reason.trim().length <= 500;
  return (
    <div className="asset-upload-backdrop" onMouseDown={onClose}>
      <section
        aria-label={label}
        aria-modal="true"
        className="asset-upload-dialog review-decision-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <h2>{label}</h2>
            <p>决定会通知创作者并保留在审计记录中。</p>
          </div>
          <button aria-label="关闭审核决定" className="icon-button" onClick={onClose} title="关闭" type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="review-decision-dialog__body">
          <label>
            <span>原因（5-500 字）</span>
            <textarea
              aria-label="审核原因"
              autoFocus
              maxLength={500}
              minLength={5}
              onChange={(event) => onReasonChange(event.target.value)}
              rows={6}
              value={reason}
            />
            <small>{reason.trim().length} / 500</small>
          </label>
        </div>
        <footer>
          <button onClick={onClose} type="button">取消</button>
          <button
            aria-label={`确认${label}`}
            className={decision === 'reject' ? 'is-danger' : 'is-primary'}
            disabled={!valid}
            onClick={onConfirm}
            type="button"
          >
            确认{label}
          </button>
        </footer>
      </section>
    </div>
  );
}

function UsageView({ state }: { state: StudioState }) {
  const spentPct = Math.round((state.usage.spentCredits / state.usage.monthlyCredits) * 100);
  const exportCount = state.auditEvents.filter((event) => event.type === 'result.exported').length;
  const settledStatuses = new Set([
    'partially_succeeded', 'succeeded', 'failed', 'canceled', 'expired',
  ]);
  return (
    <>
      <div className="overview-grid">
        <Kpi icon={Coins} label="每月用量" tone="blue" value={state.usage.monthlyCredits.toString()} />
        <Kpi icon={Gauge} label="已用" tone="red" value={`${spentPct}%`} />
        <Kpi icon={Lock} label="冻结" tone="gold" value={state.usage.frozenCredits.toString()} />
        <Kpi icon={Download} label="已导出" tone="green" value={exportCount.toString()} />
      </div>
      <div className="usage-ledger">
        {state.jobs.map((job, index) => (
          <div className="ledger-row" key={job.id}>
            <span>任务 {String(index + 1).padStart(2, '0')} · {getProfile(job.profileId).label}</span>
            <strong>{jobStatusLabels[job.status]}</strong>
            <small>{settledStatuses.has(job.status) ? job.actualCredits : job.reservedCredits} 点</small>
          </div>
        ))}
      </div>
    </>
  );
}

function AdminView({
  state,
  authSession,
  activeProject,
  activeProjectId,
}: {
  state: StudioState;
  authSession?: ActiveAuthSession | null;
  activeProject?: OrganizationProject | null;
  activeProjectId?: string;
}) {
  const rows = [
    ['所有者', '单点登录 / 开放式连接', '需多因素认证'],
    ['管理员', '成员、配额', '需多因素认证'],
    ['创作者', '项目、素材、任务', '租户范围'],
    ['审核员', '通过、退回', '项目范围'],
  ];
  const organizationEnabled = authSession?.status === 'authenticated';
  const canInvite = organizationEnabled
    && (authSession.user.role === 'owner' || authSession.user.role === 'admin');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [projects, setProjects] = useState<OrganizationProject[]>([]);
  const [notice, setNotice] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState('');
  const [resendingId, setResendingId] = useState('');
  const [editingMember, setEditingMember] = useState<OrganizationMember | null>(null);

  useEffect(() => {
    if (!canInvite) return;
    let active = true;
    void listInvitations().then((items) => {
      if (active) setInvitations(items);
    }).catch((nextError: unknown) => {
      if (active) setError(errorMessage(nextError, '无法读取成员邀请'));
    });
    void listMembers().then((items) => {
      if (active) setMembers(items);
    }).catch((nextError: unknown) => {
      if (active) setError(errorMessage(nextError, '无法读取成员列表'));
    });
    void listProjects().then((items) => {
      if (active) setProjects(items);
    }).catch((nextError: unknown) => {
      if (active) setError(errorMessage(nextError, '无法读取项目列表'));
    });
    return () => { active = false; };
  }, [canInvite]);

  const projectOptions = organizationProjectOptions(activeProject, projects);

  const actionTitle = !organizationEnabled
    ? '需要启用企业身份服务'
    : !canInvite
      ? '仅企业所有者或管理员可邀请成员'
      : projectOptions.length === 0 ? '请先创建企业项目' : '邀请成员';

  const handleRevoke = async (invitation: OrganizationInvitation) => {
    setRevokingId(invitation.id);
    setError('');
    try {
      const revoked = await revokeInvitation(invitation.id);
      setInvitations((current) => current.map((item) => item.id === revoked.id ? revoked : item));
      setNotice(`已撤销 ${invitation.email} 的邀请`);
    } catch (nextError) {
      setError(errorMessage(nextError, '撤销邀请失败'));
    } finally {
      setRevokingId('');
    }
  };

  const handleResend = async (invitation: OrganizationInvitation) => {
    setResendingId(invitation.id);
    setError('');
    try {
      const resent = await resendInvitation(invitation.id);
      const canceledAt = resent.invitation.createdAt;
      setInvitations((current) => [
        resent.invitation,
        ...current.map((item) => item.id === invitation.id
          ? { ...item, status: 'canceled' as const, canceledAt }
          : item),
      ]);
      setInviteLink(resent.acceptUrl);
      setNotice(resent.invitation.deliveryStatus === 'queued'
        ? `已重新签发 ${invitation.email} 的邀请并进入邮件发送队列，旧链接已失效`
        : `已重新签发 ${invitation.email} 的邀请，旧链接已失效，请通过安全渠道发送`);
    } catch (nextError) {
      setError(errorMessage(nextError, '重新签发邀请失败'));
    } finally {
      setResendingId('');
    }
  };

  return (
    <>
      <div className="section-title">
        <h2>企业管理</h2>
        <button
          className="secondary-action"
          disabled={!canInvite || projectOptions.length === 0}
          onClick={() => setDialogOpen(true)}
          title={actionTitle}
          type="button"
        >
          <Users size={17} />
          邀请成员
        </button>
      </div>
      {notice && <div aria-label="成员邀请状态" className="secondary-notice" role="status">{notice}</div>}
      {inviteLink && (
        <div className="organization-invite-link">
          <input aria-label="一次性邀请链接" readOnly value={inviteLink} />
          <button
            aria-label="复制邀请链接"
            onClick={() => {
              void navigator.clipboard.writeText(inviteLink).then(() => setNotice('邀请链接已复制')).catch(() => {
                setError('复制失败，请手动选择链接');
              });
            }}
            title="复制邀请链接"
            type="button"
          >
            <Copy aria-hidden="true" size={16} />
          </button>
        </div>
      )}
      {error && <div className="secondary-notice secondary-notice--error" role="alert">{error}</div>}
      <div className="wide-table">
        <TableHeader meta="权限矩阵" title={displayTenantName(state.tenantName)} />
        {rows.map((row) => (
          <div className="table-row" key={row[0]}>
            <span>{row[0]}</span>
            <strong>{row[1]}</strong>
            <small>{row[2]}</small>
          </div>
        ))}
      </div>
      {members.length > 0 && (
        <div className="wide-table organization-members">
          <TableHeader meta={`${members.length} 人`} title="企业成员" />
          {members.map((member) => (
            <div className="table-row" key={member.id}>
              <span className="organization-member__identity">
                <b>{member.displayName}</b>
                <small>{member.email}</small>
              </span>
              <strong>{roleLabel(member.role)}</strong>
              <div className="organization-member__meta">
                <small className={member.status === 'disabled' ? 'is-disabled' : ''}>
                  {member.status === 'active' ? '已启用' : '已停用'}
                </small>
                <button
                  aria-label={`编辑成员 ${member.email}`}
                  onClick={() => setEditingMember(member)}
                  title="编辑成员"
                  type="button"
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {invitations.length > 0 && (
        <div className="wide-table organization-invitations">
          <TableHeader meta={`${invitations.length} 条`} title="待处理邀请" />
          {invitations.map((invitation) => (
            <div className="table-row" key={invitation.id}>
              <span>{invitation.displayName || invitation.email}</span>
              <strong>{roleLabel(invitation.role)}</strong>
              <div className="organization-invitation__meta">
                <small>{invitationDeliveryLabel(invitation)}</small>
                {invitation.status !== 'accepted' && (
                  <button
                    aria-label={`重新签发邀请 ${invitation.email}`}
                    disabled={resendingId === invitation.id}
                    onClick={() => { void handleResend(invitation); }}
                    title="重新签发邀请"
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" size={15} />
                  </button>
                )}
                {invitation.status === 'pending' && (
                  <button
                    aria-label={`撤销邀请 ${invitation.email}`}
                    disabled={revokingId === invitation.id}
                    onClick={() => { void handleRevoke(invitation); }}
                    title="撤销邀请"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {dialogOpen && organizationEnabled && (
        <InviteMemberDialog
          onClose={() => setDialogOpen(false)}
          onCreated={({ invitation, acceptUrl }) => {
            setInvitations((current) => [invitation, ...current.filter((item) => item.id !== invitation.id)]);
            setInviteLink(acceptUrl);
            setNotice(invitation.deliveryStatus === 'queued'
              ? '邀请邮件已进入发送队列，一次性链接可作为受控备用通道'
              : '邀请链接已生成，请通过安全渠道发送给成员');
            setDialogOpen(false);
          }}
          initialProjectId={activeProjectId}
          projects={projectOptions}
        />
      )}
      {editingMember && (
        <EditMemberDialog
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={(member) => {
            setMembers((current) => current.map((item) => item.id === member.id ? member : item));
            setNotice(`已更新 ${member.displayName} 的成员设置`);
            setEditingMember(null);
          }}
          projects={projectOptions}
        />
      )}
    </>
  );
}

function EditMemberDialog({
  member,
  projects,
  onClose,
  onSaved,
}: {
  member: OrganizationMember;
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (member: OrganizationMember) => void;
}) {
  const [role, setRole] = useState<OrganizationMember['role']>(member.role);
  const [status, setStatus] = useState<OrganizationMember['status']>(member.status);
  const [projectIds, setProjectIds] = useState([...member.projectIds]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleProject = (projectId: string) => {
    setProjectIds((current) => current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId]);
  };
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      onSaved(await updateMember(member.id, { role, status, projectIds }));
    } catch (nextError) {
      setError(errorMessage(nextError, '成员设置保存失败'));
      setSubmitting(false);
    }
  };

  return (
    <div className="asset-upload-backdrop" onMouseDown={onClose}>
      <form
        aria-labelledby="edit-member-title"
        aria-modal="true"
        className="asset-upload-dialog organization-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { void handleSubmit(event); }}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="edit-member-title">编辑成员</h2>
            <p>{member.displayName} · {member.email}</p>
          </div>
          <button aria-label="关闭编辑成员" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="organization-dialog__body">
          <label>
            <span>成员角色</span>
            <select
              aria-label="成员角色"
              onChange={(event) => setRole(event.target.value as OrganizationMember['role'])}
              value={role}
            >
              <option disabled={!member.mfaEnabled && member.role !== 'admin'} value="admin">
                管理员{!member.mfaEnabled ? '（需先启用 MFA）' : ''}
              </option>
              <option value="creator">创作者</option>
              <option value="reviewer">审核员</option>
              <option value="viewer">只读成员</option>
            </select>
          </label>
          <fieldset className="organization-dialog__projects">
            <legend>项目范围</legend>
            {projects.map((project) => (
              <label key={project.id}>
                <input
                  aria-label={`项目范围 ${project.name}`}
                  checked={projectIds.includes(project.id)}
                  onChange={() => toggleProject(project.id)}
                  type="checkbox"
                />
                <span>{project.name}</span>
              </label>
            ))}
          </fieldset>
          <label className="organization-dialog__toggle">
            <span>
              <b>停用成员</b>
              <small>保存后现有会话立即失效，历史记录会保留。</small>
            </span>
            <input
              aria-label="停用成员"
              checked={status === 'disabled'}
              onChange={(event) => setStatus(event.target.checked ? 'disabled' : 'active')}
              type="checkbox"
            />
          </label>
        </div>
        {error && <p className="asset-upload-error" role="alert">{error}</p>}
        <footer>
          <button onClick={onClose} type="button">取消</button>
          <button className="is-primary" disabled={submitting || projectIds.length === 0} type="submit">
            {submitting ? '保存中' : '保存成员设置'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function InviteMemberDialog({
  projects,
  initialProjectId,
  onClose,
  onCreated,
}: {
  projects: Array<{ id: string; name: string }>;
  initialProjectId?: string;
  onClose: () => void;
  onCreated: (created: Awaited<ReturnType<typeof createInvitation>>) => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<OrganizationInvitation['role']>('creator');
  const [projectId, setProjectId] = useState(
    projects.some((project) => project.id === initialProjectId)
      ? initialProjectId ?? ''
      : projects[0]?.id ?? '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      onCreated(await createInvitation({ email, displayName, role, projectIds: [projectId] }));
    } catch (nextError) {
      setError(errorMessage(nextError, '成员邀请保存失败'));
      setSubmitting(false);
    }
  };

  return (
    <div className="asset-upload-backdrop" onMouseDown={onClose}>
      <form
        aria-labelledby="invite-member-title"
        aria-modal="true"
        className="asset-upload-dialog organization-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { void handleSubmit(event); }}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="invite-member-title">邀请成员</h2>
            <p>指定角色与项目边界，邀请状态会留存在企业记录中。</p>
          </div>
          <button aria-label="关闭邀请成员" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="organization-dialog__body">
          <label>
            <span>成员邮箱</span>
            <input aria-label="成员邮箱" autoFocus onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </label>
          <label>
            <span>成员姓名（可选）</span>
            <input aria-label="成员姓名" maxLength={80} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
          <label>
            <span>成员角色</span>
            <select aria-label="成员角色" onChange={(event) => setRole(event.target.value as OrganizationInvitation['role'])} value={role}>
              <option value="admin">管理员</option>
              <option value="creator">创作者</option>
              <option value="reviewer">审核员</option>
              <option value="viewer">只读成员</option>
            </select>
          </label>
          <label>
            <span>分配项目</span>
            <select aria-label="分配项目" onChange={(event) => setProjectId(event.target.value)} value={projectId}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="asset-upload-error" role="alert">{error}</p>}
        <footer>
          <button onClick={onClose} type="button">取消</button>
          <button
            className="is-primary"
            disabled={submitting || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !projectId}
            type="submit"
          >
            {submitting ? '保存中' : '保存邀请'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function organizationProjectOptions(
  activeProject: OrganizationProject | null | undefined,
  projects: OrganizationProject[],
): Array<{ id: string; name: string }> {
  const options = new Map<string, string>();
  if (activeProject) options.set(activeProject.id, activeProject.name);
  projects.forEach((project) => options.set(project.id, project.name));
  return [...options].map(([id, name]) => ({ id, name }));
}

function invitationDeliveryLabel(invitation: OrganizationInvitation): string {
  if (invitation.status === 'accepted') return '已接受';
  if (invitation.status === 'canceled') return '已撤销';
  if (invitation.status === 'expired') return '已过期';
  return ({
    pending_configuration: '邮件未配置',
    queued: '等待发送',
    sent: '已发送',
    failed: '发送失败',
  } as const)[invitation.deliveryStatus];
}

function Kpi({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <article className={`kpi-card tone-${tone}`}>
      <Icon aria-hidden="true" size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TableHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="table-header">
      <h3>{title}</h3>
      <span className="table-header__meta">{meta}</span>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function displayTenantName(tenantName: string) {
  return tenantName === 'PIAS Japan' ? 'PIAS 日本' : tenantName;
}

export function getJobStatusLabel(status: JobStatus) {
  return jobStatusLabels[status];
}

export function getReviewStatusLabel(status: ReviewStatus) {
  return reviewStatusLabels[status];
}

export function getSceneStatusLabel(status: Scene['status']) {
  return sceneStatusLabels[status];
}

function getSourceSceneLabel(scene: Scene | undefined): string {
  return scene ? `${getSceneTitle(scene)} · ${scene.skuCode}` : '来源场景不可用';
}

export default SecondaryView;
