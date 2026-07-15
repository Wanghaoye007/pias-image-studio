import {
  Archive,
  BadgeCheck,
  Box,
  Check,
  ChevronRight,
  Coins,
  Download,
  Eye,
  FolderKanban,
  Gauge,
  Image,
  Lock,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import {
  approveResult,
  getProfile,
  type JobStatus,
  type ReviewStatus,
  type Scene,
  type StudioState,
} from './domain';
import { getSceneTitle } from './workbench/graph';

export type NavKey = 'dashboard' | 'projects' | 'studio' | 'assets' | 'reviews' | 'usage' | 'admin';

type NavItem = {
  key: NavKey;
  label: string;
  icon: LucideIcon;
};

type SecondaryViewProps = {
  activeNav: NavKey;
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
};

export const navItems: NavItem[] = [
  { key: 'dashboard', label: '首页', icon: Gauge },
  { key: 'projects', label: '项目', icon: FolderKanban },
  { key: 'studio', label: '图片工作台', icon: Image },
  { key: 'assets', label: '素材库', icon: Archive },
  { key: 'reviews', label: '审核', icon: BadgeCheck },
  { key: 'usage', label: '用量', icon: Coins },
  { key: 'admin', label: '企业管理', icon: ShieldCheck },
];

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

const auditEventLabels: Record<string, string> = {
  'job.created': '已创建任务',
  'job.succeeded': '任务已完成',
  'job.failed': '任务失败',
  'job.canceled': '已取消任务',
  'scene.created_from_asset': '已从素材创建场景',
  'scene.derived': '已创建派生场景',
  'review.submitted': '已提交审核',
  'review.approved': '审核已通过',
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

  const result = state.results.find((item) => item.id === targetId);
  return result?.title ?? '操作对象';
}

export function GlobalNav({
  activeNav,
  onNavigate,
  state,
}: {
  activeNav: NavKey;
  onNavigate: (key: NavKey) => void;
  state: StudioState;
}) {
  return (
    <aside className="nav-rail">
      <div className="brand-mark">
        <Box aria-hidden="true" size={20} />
        <span>PIAS 图片</span>
      </div>
      <nav aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              aria-current={activeNav === item.key ? 'page' : undefined}
              className={activeNav === item.key ? 'is-active' : ''}
              key={item.key}
              onClick={() => onNavigate(item.key)}
              title={item.label}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
            </button>
          );
        })}
      </nav>
      <div className="tenant-block">
        <strong>{displayTenantName(state.tenantName)}</strong>
        <small>日本区域 · 已启用多因素认证</small>
      </div>
    </aside>
  );
}

export function SecondaryView({ activeNav, state, setState }: SecondaryViewProps) {
  const submittedResults = state.results.filter((result) => result.reviewStatus === 'submitted');
  const approvedResults = state.results.filter((result) => result.reviewStatus === 'approved');
  const activeLabel = navItems.find((item) => item.key === activeNav)?.label ?? '首页';

  return (
    <>
      <header className="global-header">
        <div>
          <span className="eyebrow">企业内容生产</span>
          <h1>{activeLabel}</h1>
        </div>
        <div className="header-metrics" aria-label="工作区摘要">
          <Metric label="冻结" value={state.usage.frozenCredits.toString()} />
          <Metric label="已用" value={state.usage.spentCredits.toString()} />
          <Metric label="待审核" value={submittedResults.length.toString()} />
        </div>
      </header>
      <section className="page-surface">
        {activeNav === 'dashboard' && (
          <OperationalDashboard approvedCount={approvedResults.length} state={state} />
        )}
        {activeNav === 'projects' && <ProjectsView state={state} />}
        {activeNav === 'assets' && <AssetsView state={state} />}
        {activeNav === 'reviews' && (
          <ReviewsView
            onApprove={(resultId) => setState((current) => approveResult(current, resultId, '青井审核员'))}
            state={state}
          />
        )}
        {activeNav === 'usage' && <UsageView state={state} />}
        {activeNav === 'admin' && <AdminView state={state} />}
      </section>
    </>
  );
}

function OperationalDashboard({ state, approvedCount }: { state: StudioState; approvedCount: number }) {
  return (
    <>
      <div className="overview-grid">
        <Kpi icon={Image} label="已审核图片" tone="green" value={approvedCount.toString()} />
        <Kpi icon={Sparkles} label="任务数" tone="blue" value={state.jobs.length.toString()} />
        <Kpi icon={Coins} label="可用用量" tone="gold" value={state.usage.availableCredits.toString()} />
        <Kpi icon={ShieldCheck} label="审计事件" tone="red" value={state.auditEvents.length.toString()} />
      </div>
      <div className="wide-table">
        <TableHeader action="导出清单" title="最近操作" />
        {state.auditEvents.slice(-6).map((event) => (
          <div className="table-row" key={event.id}>
            <span>{auditEventLabels[event.type] ?? '审计事件'}</span>
            <strong>{event.actor}</strong>
            <small>{getAuditTargetLabel(state, event.targetId)}</small>
          </div>
        ))}
      </div>
    </>
  );
}

function ProjectsView({ state }: { state: StudioState }) {
  return (
    <>
      <div className="section-title">
        <h2>项目</h2>
        <button className="secondary-action" type="button">
          <FolderKanban size={17} />
          新建项目
        </button>
      </div>
      <article className="project-row">
        <div>
          <span className="eyebrow">图片工作区</span>
          <h3>{state.projectName}</h3>
          <p>PIAS-SF-001 · {state.scenes.length} 个场景 · {state.results.length} 个结果</p>
        </div>
        <ChevronRight aria-hidden="true" size={22} />
      </article>
    </>
  );
}

function AssetsView({ state }: { state: StudioState }) {
  return (
    <>
      <div className="section-title">
        <h2>素材库</h2>
        <button className="secondary-action" type="button">
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

function ReviewsView({ state, onApprove }: { state: StudioState; onApprove: (resultId: string) => void }) {
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
              </div>
              {result.reviewStatus === 'submitted' ? (
                <button
                  aria-label="通过审核"
                  className="icon-button"
                  onClick={() => onApprove(result.id)}
                  title="通过审核"
                  type="button"
                >
                  <Check aria-hidden="true" size={18} />
                </button>
              ) : result.reviewStatus === 'approved' ? (
                <a
                  aria-label="下载结果"
                  className="icon-link"
                  download={`${result.title}.png`}
                  href={result.imageUrl}
                  title="下载结果"
                >
                  <Download aria-hidden="true" size={18} />
                </a>
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

function UsageView({ state }: { state: StudioState }) {
  const spentPct = Math.round((state.usage.spentCredits / state.usage.monthlyCredits) * 100);
  return (
    <>
      <div className="overview-grid">
        <Kpi icon={Coins} label="每月用量" tone="blue" value={state.usage.monthlyCredits.toString()} />
        <Kpi icon={Gauge} label="已用" tone="red" value={`${spentPct}%`} />
        <Kpi icon={Lock} label="冻结" tone="gold" value={state.usage.frozenCredits.toString()} />
        <Kpi icon={Download} label="已导出" tone="green" value="1" />
      </div>
      <div className="usage-ledger">
        {state.jobs.map((job, index) => (
          <div className="ledger-row" key={job.id}>
            <span>任务 {String(index + 1).padStart(2, '0')} · {getProfile(job.profileId).label}</span>
            <strong>{jobStatusLabels[job.status]}</strong>
            <small>{job.actualCredits || job.reservedCredits} 点</small>
          </div>
        ))}
      </div>
    </>
  );
}

function AdminView({ state }: { state: StudioState }) {
  const rows = [
    ['所有者', '单点登录 / 开放式连接', '需多因素认证'],
    ['管理员', '成员、配额', '需多因素认证'],
    ['创作者', '项目、素材、任务', '租户范围'],
    ['审核员', '通过、退回', '项目范围'],
  ];
  return (
    <>
      <div className="section-title">
        <h2>企业管理</h2>
        <button className="secondary-action" type="button">
          <Users size={17} />
          邀请成员
        </button>
      </div>
      <div className="wide-table">
        <TableHeader action="审计日志" title={displayTenantName(state.tenantName)} />
        {rows.map((row) => (
          <div className="table-row" key={row[0]}>
            <span>{row[0]}</span>
            <strong>{row[1]}</strong>
            <small>{row[2]}</small>
          </div>
        ))}
      </div>
    </>
  );
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

function TableHeader({ title, action }: { title: string; action: string }) {
  return (
    <div className="table-header">
      <h3>{title}</h3>
      <button type="button">
        <Eye aria-hidden="true" size={15} />
        {action}
      </button>
    </div>
  );
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
