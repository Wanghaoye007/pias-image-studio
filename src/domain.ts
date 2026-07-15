export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type ReviewStatus = 'draft' | 'submitted' | 'approved' | 'returned';

export type CanvasNodeKind = 'scene' | 'job' | 'result';
export type CanvasPosition = { x: number; y: number };
export type TaskProfileId =
  | 'generate' | 'blend' | 'angle' | 'light'
  | 'remove' | 'extract' | 'expand' | 'upscale';

export type TaskProfile = {
  id: TaskProfileId;
  label: string;
  description: string;
  labelJa: string;
  costPerOutput: number;
  defaultOutputs: number;
  accent: string;
};

export type UsageState = {
  monthlyCredits: number;
  availableCredits: number;
  frozenCredits: number;
  spentCredits: number;
};

export type Scene = {
  id: string;
  title: string;
  skuCode: string;
  operation: string;
  status: 'source' | 'draft' | JobStatus;
  x: number;
  y: number;
  imageUrl: string;
  resultIds: string[];
  sourceAssetId?: string;
  sourceAssetVersion?: string;
  parentSceneId?: string;
  sourceResultId?: string;
};

export type SceneEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

export type GenerationJob = {
  id: string;
  sceneId: string;
  profileId: TaskProfileId;
  status: JobStatus;
  outputCount: number;
  reservedCredits: number;
  actualCredits: number;
  progress: number;
  x: number;
  y: number;
  errorMessage?: string;
};

export type Result = {
  id: string;
  sourceSceneId: string;
  jobId: string;
  assetId: string;
  title: string;
  imageUrl: string;
  reviewStatus: ReviewStatus;
  x: number;
  y: number;
  approvedBy?: string;
};

export type Asset = {
  id: string;
  brand: string;
  product: string;
  skuCode: string;
  usage: string;
  version: string;
  imageUrl: string;
};

export type AuditEvent = {
  id: string;
  type: string;
  actor: string;
  targetId: string;
  at: string;
};

export type StudioState = {
  tenantName: string;
  projectName: string;
  workspaceName: string;
  selectedSceneId: string;
  selectedTool: TaskProfileId;
  usage: UsageState;
  assets: Asset[];
  scenes: Scene[];
  edges: SceneEdge[];
  jobs: GenerationJob[];
  results: Result[];
  auditEvents: AuditEvent[];
};

export const taskProfiles: TaskProfile[] = [
  { id: 'generate', label: '生成', description: '生成', labelJa: '生成', costPerOutput: 15, defaultOutputs: 4, accent: '#2f6fed' },
  { id: 'blend', label: '融图', description: '融图', labelJa: '融图', costPerOutput: 18, defaultOutputs: 4, accent: '#0b8a74' },
  { id: 'angle', label: '快速视角', description: '快速视角', labelJa: '快速视角', costPerOutput: 22, defaultOutputs: 4, accent: '#7a5c2e' },
  { id: 'light', label: '定向光', description: '定向光', labelJa: '定向光', costPerOutput: 14, defaultOutputs: 4, accent: '#d58a00' },
  { id: 'remove', label: '去除', description: '去除', labelJa: '去除', costPerOutput: 12, defaultOutputs: 4, accent: '#bd3f3f' },
  { id: 'extract', label: '抠图', description: '抠图', labelJa: '抠图', costPerOutput: 12, defaultOutputs: 4, accent: '#39525f' },
  { id: 'expand', label: '扩图', description: '扩图', labelJa: '扩图', costPerOutput: 12, defaultOutputs: 4, accent: '#bd3f3f' },
  { id: 'upscale', label: '超分', description: '超分', labelJa: '超分', costPerOutput: 12, defaultOutputs: 1, accent: '#39525f' },
];

const resultImages = [
  '/figma_thesea_slides_15_21/slide_15.png',
  '/figma_thesea_slides_15_21/slide_17.png',
  '/figma_thesea_slides_15_21/slide_18.png',
  '/figma_thesea_slides_15_21/slide_20.png',
  '/figma_thesea_slides_15_21/slide_21.png',
];

export function getProfile(profileId: TaskProfileId): TaskProfile {
  const profile = taskProfiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error(`未知任务工具：${profileId}`);
  }
  return profile;
}

export function initialStudioState(): StudioState {
  return {
    tenantName: 'PIAS Japan',
    projectName: '2026 夏季 SKU 上新',
    workspaceName: '图片工作台',
    selectedSceneId: 'scene-source',
    selectedTool: 'generate',
    usage: {
      monthlyCredits: 2000,
      availableCredits: 2000,
      frozenCredits: 0,
      spentCredits: 0,
    },
    assets: [
      {
        id: 'asset-main',
        brand: 'PIAS',
        product: 'Serum Foundation',
        skuCode: 'PIAS-SF-001',
        usage: '主商品图',
        version: 'v3',
        imageUrl: '/figma_thesea_slides_15_21/slide_15_after_click.png',
      },
      {
        id: 'asset-pack',
        brand: 'PIAS',
        product: 'Skin Care Kit',
        skuCode: 'PIAS-SK-014',
        usage: '包装',
        version: 'v1',
        imageUrl: '/figma_thesea_slides_15_21/slide_17_after_click.png',
      },
      {
        id: 'asset-scene',
        brand: 'PIAS',
        product: 'Campaign Reference',
        skuCode: 'PIAS-REF-SEA',
        usage: '场景参考',
        version: 'v2',
        imageUrl: '/analysis/contact_sheets/TheSEA_slide18_ai_lighting_contact.jpg',
      },
    ],
    scenes: [
      {
        id: 'scene-source',
        title: '源场景',
        skuCode: 'PIAS-SF-001',
        operation: '商品素材',
        status: 'source',
        x: 0,
        y: 40,
        imageUrl: '/figma_thesea_slides_15_21/slide_15_after_click.png',
        resultIds: [],
        sourceAssetId: 'asset-main',
        sourceAssetVersion: 'v3',
      },
    ],
    edges: [],
    jobs: [],
    results: [],
    auditEvents: [],
  };
}

export function createJob(
  state: StudioState,
  input: { sceneId: string; profileId: TaskProfileId; outputCount: number },
): StudioState {
  const profile = getProfile(input.profileId);
  const source = state.scenes.find((scene) => scene.id === input.sceneId);
  if (!source) {
    throw new Error(`场景不存在：${input.sceneId}`);
  }
  const reservedCredits = profile.costPerOutput * input.outputCount;
  if (state.usage.availableCredits < reservedCredits) {
    throw new Error('可用额度不足');
  }

  const job: GenerationJob = {
    id: `job-${state.jobs.length + 1}`,
    sceneId: input.sceneId,
    profileId: input.profileId,
    status: 'queued',
    outputCount: input.outputCount,
    reservedCredits,
    actualCredits: 0,
    progress: 8,
    x: source.x + 320,
    y: source.y + 24,
  };

  return {
    ...state,
    jobs: [...state.jobs, job],
    scenes: state.scenes.map((scene) =>
      scene.id === input.sceneId ? { ...scene, status: 'queued' } : scene,
    ),
    usage: {
      ...state.usage,
      availableCredits: state.usage.availableCredits - reservedCredits,
      frozenCredits: state.usage.frozenCredits + reservedCredits,
    },
    auditEvents: [
      ...state.auditEvents,
      audit('job.created', job.id, 'Mika Tanaka'),
    ],
  };
}

export function moveCanvasItem(
  state: StudioState,
  input: { kind: CanvasNodeKind; id: string; position: CanvasPosition },
): StudioState {
  const patch = <T extends { id: string; x: number; y: number }>(items: T[]) =>
    items.map((item) => item.id === input.id ? { ...item, ...input.position } : item);

  if (input.kind === 'scene') return { ...state, scenes: patch(state.scenes) };
  if (input.kind === 'job') return { ...state, jobs: patch(state.jobs) };
  return { ...state, results: patch(state.results) };
}

function settleJob(
  state: StudioState,
  jobId: string,
  status: 'failed' | 'canceled',
  errorMessage?: string,
): StudioState {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) {
    throw new Error(`任务不存在：${jobId}`);
  }
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
    throw new Error('任务已结算，不能重复结算');
  }

  return {
    ...state,
    jobs: state.jobs.map((item) =>
      item.id === jobId
        ? { ...item, status, ...(errorMessage !== undefined ? { errorMessage } : {}) }
        : item,
    ),
    scenes: state.scenes.map((scene) =>
      scene.id === job.sceneId ? { ...scene, status } : scene,
    ),
    usage: {
      ...state.usage,
      availableCredits: state.usage.availableCredits + job.reservedCredits,
      frozenCredits: Math.max(0, state.usage.frozenCredits - job.reservedCredits),
    },
    auditEvents: [
      ...state.auditEvents,
      audit(`job.${status}`, job.id, '图像处理服务'),
    ],
  };
}

export function failJob(state: StudioState, jobId: string, errorMessage: string): StudioState {
  return settleJob(state, jobId, 'failed', errorMessage);
}

export function cancelJob(state: StudioState, jobId: string): StudioState {
  return settleJob(state, jobId, 'canceled');
}

export function createSceneFromAsset(
  state: StudioState,
  input: { assetId: string; position: CanvasPosition },
): StudioState {
  const asset = state.assets.find((item) => item.id === input.assetId);
  if (!asset) {
    throw new Error(`素材不存在：${input.assetId}`);
  }

  const scene: Scene = {
    id: `scene-${state.scenes.length + 1}`,
    title: asset.product,
    skuCode: asset.skuCode,
    operation: '商品素材',
    status: 'source',
    ...input.position,
    imageUrl: asset.imageUrl,
    resultIds: [],
    sourceAssetId: asset.id,
    sourceAssetVersion: asset.version,
  };

  return {
    ...state,
    selectedSceneId: scene.id,
    scenes: [...state.scenes, scene],
    auditEvents: [
      ...state.auditEvents,
      audit('scene.created_from_asset', scene.id, 'Mika Tanaka'),
    ],
  };
}

export function updateJobProgress(state: StudioState, jobId: string, progress: number): StudioState {
  return {
    ...state,
    jobs: state.jobs.map((job) =>
      job.id === jobId ? { ...job, status: progress >= 100 ? job.status : 'running', progress } : job,
    ),
    scenes: state.scenes.map((scene) => {
      const job = state.jobs.find((item) => item.id === jobId);
      return job?.sceneId === scene.id ? { ...scene, status: 'running' } : scene;
    }),
  };
}

export function completeJob(
  state: StudioState,
  jobId: string,
  input: { successfulOutputs: number; actualCredits: number },
): StudioState {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) {
    throw new Error(`任务不存在：${jobId}`);
  }
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
    throw new Error('任务已结算，不能重复结算');
  }
  if (!Number.isInteger(input.successfulOutputs) || input.successfulOutputs < 0 || input.successfulOutputs > job.outputCount) {
    throw new Error('成功产出数量超出任务范围');
  }
  if (!Number.isFinite(input.actualCredits) || input.actualCredits < 0 || input.actualCredits > job.reservedCredits) {
    throw new Error('实际额度超出预留范围');
  }

  const newResults = Array.from({ length: input.successfulOutputs }).map((_, index) => {
    const id = `result-${state.results.length + index + 1}`;
    return {
      id,
      sourceSceneId: job.sceneId,
      jobId: job.id,
      assetId: `generated-${id}`,
      title: `${getProfile(job.profileId).label} ${index + 1}`,
      imageUrl: resultImages[(state.results.length + index) % resultImages.length],
      reviewStatus: 'draft' as ReviewStatus,
      x: job.x + 280 + index * 220,
      y: job.y,
    };
  });

  return {
    ...state,
    jobs: state.jobs.map((item) =>
      item.id === jobId
        ? { ...item, status: 'succeeded', progress: 100, actualCredits: input.actualCredits }
        : item,
    ),
    scenes: state.scenes.map((scene) =>
      scene.id === job.sceneId
        ? {
            ...scene,
            status: 'succeeded',
            resultIds: [...scene.resultIds, ...newResults.map((result) => result.id)],
          }
        : scene,
    ),
    results: [...state.results, ...newResults],
    usage: {
      ...state.usage,
      availableCredits: state.usage.availableCredits + job.reservedCredits - input.actualCredits,
      frozenCredits: Math.max(0, state.usage.frozenCredits - job.reservedCredits),
      spentCredits: state.usage.spentCredits + input.actualCredits,
    },
    auditEvents: [
      ...state.auditEvents,
      audit('job.succeeded', job.id, '图像处理服务'),
    ],
  };
}

export function createDerivedScene(
  state: StudioState,
  input: { parentSceneId: string; sourceResultId: string; operation: string },
): StudioState {
  const parent = state.scenes.find((scene) => scene.id === input.parentSceneId);
  const sourceResult = state.results.find((result) => result.id === input.sourceResultId);
  if (!parent || !sourceResult) {
    throw new Error('父场景或源结果不存在');
  }
  const sourceJob = state.jobs.find((job) => job.id === sourceResult.jobId);
  if (
    sourceResult.sourceSceneId !== parent.id
    || !parent.resultIds.includes(sourceResult.id)
    || !sourceJob
    || sourceJob.sceneId !== sourceResult.sourceSceneId
  ) {
    throw new Error('源结果与父场景或任务归属不一致');
  }

  const sceneId = `scene-${state.scenes.length + 1}`;
  const scene: Scene = {
    id: sceneId,
    title: `${input.operation}场景`,
    skuCode: parent.skuCode,
    operation: input.operation,
    status: 'draft',
    x: sourceResult.x + 300,
    y: sourceResult.y,
    imageUrl: sourceResult.imageUrl,
    resultIds: [],
    parentSceneId: parent.id,
    sourceResultId: sourceResult.id,
  };

  return {
    ...state,
    selectedSceneId: scene.id,
    scenes: [...state.scenes, scene],
    edges: [
      ...state.edges,
      {
        id: `edge-${state.edges.length + 1}`,
        source: parent.id,
        target: scene.id,
        label: input.operation,
      },
    ],
    auditEvents: [
      ...state.auditEvents,
      audit('scene.derived', scene.id, 'Mika Tanaka'),
    ],
  };
}

export function submitForReview(state: StudioState, resultId: string): StudioState {
  const result = state.results.find((item) => item.id === resultId);
  if (!result) {
    throw new Error(`结果不存在：${resultId}`);
  }
  if (result.reviewStatus !== 'draft') {
    throw new Error('仅草稿结果可提交审核');
  }

  return {
    ...state,
    results: state.results.map((result) =>
      result.id === resultId ? { ...result, reviewStatus: 'submitted' } : result,
    ),
    auditEvents: [...state.auditEvents, audit('review.submitted', resultId, 'Mika Tanaka')],
  };
}

export function approveResult(state: StudioState, resultId: string, reviewer: string): StudioState {
  const result = state.results.find((item) => item.id === resultId);
  if (!result) {
    throw new Error(`结果不存在：${resultId}`);
  }
  if (result.reviewStatus !== 'submitted') {
    throw new Error('仅已提交结果可审批');
  }

  return {
    ...state,
    results: state.results.map((result) =>
      result.id === resultId
        ? { ...result, reviewStatus: 'approved', approvedBy: reviewer }
        : result,
    ),
    auditEvents: [...state.auditEvents, audit('review.approved', resultId, reviewer)],
  };
}

export function setSelectedTool(state: StudioState, tool: TaskProfileId): StudioState {
  return { ...state, selectedTool: tool };
}

export function setSelectedScene(state: StudioState, sceneId: string): StudioState {
  return { ...state, selectedSceneId: sceneId };
}

function audit(type: string, targetId: string, actor: string): AuditEvent {
  return {
    id: `audit-${type}-${targetId}-${Date.now()}`,
    type,
    actor,
    targetId,
    at: new Date().toISOString(),
  };
}
