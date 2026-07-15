import { useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  Archive,
  BadgeCheck,
  Box,
  Check,
  ChevronRight,
  Coins,
  Download,
  Eraser,
  Eye,
  FolderKanban,
  Gauge,
  Image,
  Layers3,
  Lock,
  PanelRightOpen,
  Play,
  RotateCw,
  Scan,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Upload,
  Users,
  Wand2,
  Waypoints,
  Zap,
} from 'lucide-react';
import {
  approveResult,
  completeJob,
  createDerivedScene,
  createJob,
  getProfile,
  initialStudioState,
  setSelectedScene,
  setSelectedTool,
  submitForReview,
  taskProfiles,
  updateJobProgress,
  type Result,
  type JobStatus,
  type ReviewStatus,
  type Scene,
  type StudioState,
  type TaskProfileId,
} from './domain';

type NavKey = 'dashboard' | 'projects' | 'studio' | 'assets' | 'reviews' | 'usage' | 'admin';

const navItems: Array<{ key: NavKey; label: string; icon: typeof Gauge }> = [
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
  ...jobStatusLabels,
  draft: '草稿',
};

const auditEventLabels: Record<string, string> = {
  'job.created': '已创建任务',
  'job.succeeded': '任务已完成',
  'job.failed': '任务失败',
  'job.canceled': '任务已取消',
  'scene.created_from_asset': '已从素材创建场景',
  'scene.derived': '已创建派生场景',
  'review.submitted': '已提交审核',
  'review.approved': '审核已通过',
};

const operationLabels: Record<string, string> = {
  Blend: '融图',
  'Directional Light': '定向光',
};

function displayOperation(operation: string) {
  return operationLabels[operation] ?? operation;
}

function displayTenantName(tenantName: string) {
  return tenantName === 'PIAS Japan' ? 'PIAS 日本' : tenantName;
}

const toolIcons: Record<TaskProfileId, typeof Wand2> = {
  generate: Wand2,
  blend: Layers3,
  light: SunMedium,
  expand: PanelRightOpen,
  upscale: Zap,
  angle: RotateCw,
  remove: Eraser,
  extract: Scan,
};

function App() {
  const [state, setState] = useState<StudioState>(() => seedDemoState());
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [outputCount, setOutputCount] = useState(4);

  const selectedScene = state.scenes.find((scene) => scene.id === state.selectedSceneId) ?? state.scenes[0];
  const selectedProfile = getProfile(state.selectedTool);
  const estimate = selectedProfile.costPerOutput * outputCount;
  const submittedResults = state.results.filter((result) => result.reviewStatus === 'submitted');
  const approvedResults = state.results.filter((result) => result.reviewStatus === 'approved');

  const nodes = useMemo<Node[]>(
    () =>
      state.scenes.map((scene) => ({
        id: scene.id,
        type: 'scene',
        position: { x: scene.x, y: scene.y },
        data: {
          scene,
          selected: scene.id === state.selectedSceneId,
          results: state.results.filter((result) => scene.resultIds.includes(result.id)),
        },
      })),
    [state.scenes, state.results, state.selectedSceneId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      state.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
        style: { stroke: '#315c71', strokeWidth: 2 },
        labelStyle: { fill: '#294050', fontWeight: 700 },
      })),
    [state.edges],
  );

  function runSelectedJob() {
    const queued = createJob(state, {
      sceneId: state.selectedSceneId,
      profileId: state.selectedTool,
      outputCount,
    });
    const jobId = queued.jobs.at(-1)?.id;
    if (!jobId) {
      return;
    }

    setState(queued);
    window.setTimeout(() => {
      setState((latest) => updateJobProgress(latest, jobId, 48));
    }, 500);
    window.setTimeout(() => {
      setState((latest) =>
        completeJob(latest, jobId, {
          successfulOutputs: Math.max(1, Math.min(outputCount, outputCount - 1)),
          actualCredits: selectedProfile.costPerOutput * Math.max(1, outputCount - 1),
        }),
      );
    }, 1400);
  }

  function deriveFromResult(result: Result, operation: string) {
    setState((current) =>
      createDerivedScene(current, {
        parentSceneId: result.sourceSceneId,
        sourceResultId: result.id,
        operation,
      }),
    );
    setActiveNav('studio');
  }

  function renderMain() {
    if (activeNav !== 'studio') {
      return (
        <section className="page-surface">
          {activeNav === 'dashboard' && (
            <OperationalDashboard state={state} approvedCount={approvedResults.length} />
          )}
          {activeNav === 'projects' && <ProjectsView state={state} />}
          {activeNav === 'assets' && <AssetsView state={state} />}
          {activeNav === 'reviews' && (
            <ReviewsView
              state={state}
              onApprove={(resultId) => setState((current) => approveResult(current, resultId, '青井审核员'))}
            />
          )}
          {activeNav === 'usage' && <UsageView state={state} />}
          {activeNav === 'admin' && <AdminView state={state} />}
        </section>
      );
    }

    return (
      <section className="studio-shell">
        <aside className="asset-panel" aria-label="SKU 素材">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PIAS 素材目录</span>
              <h2>SKU 素材</h2>
            </div>
            <button className="icon-button" title="上传" type="button">
              <Upload size={18} />
            </button>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input value="PIAS" readOnly aria-label="搜索素材" />
          </label>
          <div className="asset-list">
            {state.assets.map((asset) => (
              <button
                className={`asset-tile ${asset.skuCode === selectedScene?.skuCode ? 'is-active' : ''}`}
                key={asset.id}
                type="button"
              >
                <img src={asset.imageUrl} alt={`${asset.skuCode} ${asset.product}`} />
                <span>
                  <strong>{asset.skuCode}</strong>
                  <small>{asset.usage} / {asset.version}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="canvas-stage">
          <div className="studio-topbar">
            <div>
              <span className="eyebrow">{state.projectName}</span>
              <h1>图片工作台</h1>
            </div>
            <div className="lease-pill">
              <Lock size={14} />
              已保存 · 可编辑
            </div>
          </div>

          <div className="tool-strip" aria-label="图片工具">
            {taskProfiles.map((profile) => {
              const Icon = toolIcons[profile.id];
              return (
                <button
                  aria-label={profile.label}
                  className={`tool-button ${state.selectedTool === profile.id ? 'is-active' : ''}`}
                  key={profile.id}
                  onClick={() => {
                    setState((current) => setSelectedTool(current, profile.id));
                    setOutputCount(profile.defaultOutputs);
                  }}
                  title={profile.label}
                  type="button"
                >
                  <Icon size={18} />
                  <span>{profile.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flow-wrap">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.35}
              maxZoom={1.4}
              onNodeClick={(_, node) => setState((current) => setSelectedScene(current, node.id))}
            >
              <Background color="#d8e2e5" gap={22} />
              <MiniMap pannable zoomable nodeColor="#315c71" maskColor="rgba(244, 247, 247, 0.72)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </main>

        <aside className="inspector">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{selectedScene?.skuCode}</span>
              <h2>{selectedProfile.label}</h2>
            </div>
            <span className="status-chip">{selectedScene ? sceneStatusLabels[selectedScene.status] : ''}</span>
          </div>

          <div className="control-group">
            <label>出力数</label>
            <div className="segmented">
              {[1, 2, 4].map((count) => (
                <button
                  className={outputCount === count ? 'is-active' : ''}
                  key={count}
                  onClick={() => setOutputCount(count)}
                  type="button"
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className="estimate-band">
            <span>预留用量</span>
            <strong>{estimate} 点</strong>
          </div>

          <button className="primary-action" onClick={runSelectedJob} type="button">
            <Play size={18} />
            创建生成任务
          </button>

          <section className="result-section">
            <h3>结果</h3>
            <div className="result-list">
              {state.results
                .filter((result) => result.sourceSceneId === selectedScene?.id)
                .map((result) => (
                  <article className="result-tile" key={result.id}>
                    <img src={result.imageUrl} alt={result.title} />
                    <div>
                      <strong>{result.title}</strong>
                      <small>{reviewStatusLabels[result.reviewStatus]}</small>
                    </div>
                    <div className="result-actions">
                      <button title="创建派生场景" onClick={() => deriveFromResult(result, selectedProfile.label)} type="button">
                        <Waypoints size={15} />
                      </button>
                      <button
                        disabled={result.reviewStatus !== 'draft'}
                        title={result.reviewStatus === 'draft' ? '提交审核' : '已提交审核'}
                        onClick={() => setState((current) => submitForReview(current, result.id))}
                        type="button"
                      >
                        <Send size={15} />
                      </button>
                      {result.reviewStatus === 'approved' ? (
                        <a className="icon-link" href={result.imageUrl} download={`${result.title}.png`} title="下载">
                          <Download size={15} />
                        </a>
                      ) : (
                        <button disabled title="需审核通过后下载" type="button">
                          <Download size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
            </div>
          </section>

          <TaskCenter state={state} submittedCount={submittedResults.length} />
        </aside>
      </section>
    );
  }

  return (
    <div className="app-frame">
      <aside className="nav-rail">
        <div className="brand-mark">
          <Box size={20} />
          <span>PIAS AI</span>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-label={item.label}
                className={activeNav === item.key ? 'is-active' : ''}
                key={item.key}
                onClick={() => setActiveNav(item.key)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="tenant-block">
          <strong>{displayTenantName(state.tenantName)}</strong>
          <small>日本区域 · 已启用多因素认证</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="global-header">
          <div>
            <span className="eyebrow">企业内容生产</span>
            <h1>{activeNav === 'studio' ? state.workspaceName : navItems.find((item) => item.key === activeNav)?.label}</h1>
          </div>
          <div className="header-metrics">
            <Metric label="冻结" value={state.usage.frozenCredits.toString()} />
            <Metric label="已用" value={state.usage.spentCredits.toString()} />
            <Metric label="待审核" value={submittedResults.length.toString()} />
          </div>
        </header>
        {renderMain()}
      </div>
    </div>
  );
}

function seedDemoState(): StudioState {
  const base = initialStudioState();
  const withGenerate = createJob(base, { sceneId: 'scene-source', profileId: 'generate', outputCount: 4 });
  const settled = completeJob(withGenerate, withGenerate.jobs[0].id, {
    successfulOutputs: 3,
    actualCredits: 45,
  });
  const derived = createDerivedScene(settled, {
    parentSceneId: 'scene-source',
    sourceResultId: settled.results[0].id,
    operation: '融图',
  });
  return approveResult(submitForReview(derived, settled.results[1].id), settled.results[1].id, '青井审核员');
}

const nodeTypes = {
  scene: SceneNode,
};

type SceneNodeData = {
  scene: Scene;
  selected: boolean;
  results: Result[];
};

function SceneNode({ data }: NodeProps<Node<SceneNodeData>>) {
  const scene = data.scene;
  return (
    <div className={`scene-node ${data.selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="scene-image">
        <img src={scene.imageUrl} alt={`${scene.title} 预览`} />
        <span>{sceneStatusLabels[scene.status]}</span>
      </div>
      <div className="scene-body">
        <small>{displayOperation(scene.operation)}</small>
        <strong>{scene.title}</strong>
        <p>{scene.skuCode}</p>
      </div>
      <div className="scene-results">
        {data.results.slice(0, 4).map((result) => (
          <img key={result.id} src={result.imageUrl} alt={`${result.title} 缩略图`} />
        ))}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
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

function TaskCenter({ state, submittedCount }: { state: StudioState; submittedCount: number }) {
  return (
    <section className="task-center">
      <div className="task-header">
        <h3>任务中心</h3>
        <span>{submittedCount} 项待审核</span>
      </div>
      {state.jobs.slice(-4).map((job) => (
        <div className="job-row" key={job.id}>
          <Sparkles size={15} />
          <span>{getProfile(job.profileId).label}</span>
          <progress value={job.progress} max={100} />
          <strong>{jobStatusLabels[job.status]}</strong>
        </div>
      ))}
    </section>
  );
}

function OperationalDashboard({ state, approvedCount }: { state: StudioState; approvedCount: number }) {
  return (
    <>
      <div className="overview-grid">
        <Kpi icon={Image} label="已审核图片" value={approvedCount.toString()} tone="green" />
        <Kpi icon={Sparkles} label="任务数" value={state.jobs.length.toString()} tone="blue" />
        <Kpi icon={Coins} label="可用用量" value={state.usage.availableCredits.toString()} tone="gold" />
        <Kpi icon={ShieldCheck} label="审计事件" value={state.auditEvents.length.toString()} tone="red" />
      </div>
      <div className="wide-table">
        <TableHeader title="最近操作" action="导出清单" />
        {state.auditEvents.slice(-6).map((event) => (
          <div className="table-row" key={event.id}>
            <span>{auditEventLabels[event.type] ?? '审计事件'}</span>
            <strong>{event.actor}</strong>
            <small>{event.targetId}</small>
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
        <ChevronRight size={22} />
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
            <img src={asset.imageUrl} alt={`${asset.skuCode} ${asset.product}`} />
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
        {state.results.map((result) => (
          <article className="review-row" key={result.id}>
            <img src={result.imageUrl} alt={result.title} />
            <div>
              <strong>{result.title}</strong>
              <small>{reviewStatusLabels[result.reviewStatus]} · {result.sourceSceneId}</small>
            </div>
            {result.reviewStatus === 'submitted' ? (
              <button className="icon-button" onClick={() => onApprove(result.id)} title="通过审核" type="button">
                <Check size={18} />
              </button>
            ) : (
              <span className="status-chip">{reviewStatusLabels[result.reviewStatus]}</span>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function UsageView({ state }: { state: StudioState }) {
  const spentPct = Math.round((state.usage.spentCredits / state.usage.monthlyCredits) * 100);
  return (
    <>
      <div className="overview-grid">
        <Kpi icon={Coins} label="每月用量" value={state.usage.monthlyCredits.toString()} tone="blue" />
        <Kpi icon={Gauge} label="已用" value={`${spentPct}%`} tone="red" />
        <Kpi icon={Lock} label="冻结" value={state.usage.frozenCredits.toString()} tone="gold" />
        <Kpi icon={Download} label="已导出" value="1" tone="green" />
      </div>
      <div className="usage-ledger">
        {state.jobs.map((job) => (
          <div className="ledger-row" key={job.id}>
            <span>{job.id}</span>
            <strong>{getProfile(job.profileId).label}</strong>
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
        <TableHeader title={displayTenantName(state.tenantName)} action="审计日志" />
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

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Image; label: string; value: string; tone: string }) {
  return (
    <article className={`kpi-card tone-${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function TableHeader({ title, action }: { title: string; action: string }) {
  return (
    <div className="table-header">
      <h3>{title}</h3>
      <button type="button">
        <Eye size={15} />
        {action}
      </button>
    </div>
  );
}

export default App;
