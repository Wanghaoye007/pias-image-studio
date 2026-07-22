export type JobStatus =
  | 'preflight'
  | 'queued'
  | 'running'
  | 'postprocessing'
  | 'partially_succeeded'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'expired';
export type ReviewStatus = 'draft' | 'submitted' | 'approved' | 'returned' | 'rejected';
export type QualityIssue =
  | 'product-deformation'
  | 'text-logo'
  | 'material'
  | 'composition'
  | 'lighting'
  | 'background'
  | 'dimensions'
  | 'content-safety'
  | 'other';
export type ExportFormat = 'png' | 'jpeg' | 'webp';
export type ExportSize = 'original' | '1080' | '2048';

export type ExportSpec = {
  format: ExportFormat;
  size: ExportSize;
  includeManifestCsv: boolean;
  includeManifestJson: boolean;
};

export type CanvasNodeKind = 'scene' | 'job' | 'result';
export type CanvasPosition = { x: number; y: number };
export type JobInputKind = 'scene' | 'result';
export type TaskParameters = Record<string, string | number | boolean>;
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

export type UsageLedgerEntry = {
  id: string;
  jobId: string;
  profileId: TaskProfileId;
  entryType: 'reserve' | 'charge' | 'release' | 'adjustment';
  units: number;
  balanceAfter: number;
  pricingRuleVersion: 'content-studio-credit-v1';
  reason: string;
  at: string;
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
  inputSnapshot: JobInputSnapshot;
  retryOfJobId?: string;
  supersedesResultId?: string;
  externalExecution?: ExternalExecution;
  errorMessage?: string;
};

export type ExternalExecution = {
  provider: 'fal';
  modelId: string;
  requestId: string;
};

export type JobInputSnapshot = {
  inputKind: JobInputKind;
  inputNodeId: string;
  prompt: string;
  ratio: string;
  parameters: TaskParameters;
  referenceAssetIds: string[];
  maskImageUrl?: string;
  sourceAssetId?: string;
  sourceAssetVersion?: string;
  sourceResultId?: string;
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
  reviewedBy?: string;
  reviewComment?: string;
  supersedesResultId?: string;
  isFavorite?: boolean;
  isAdopted?: boolean;
  isPrimary?: boolean;
  adoptedBy?: string;
  adoptedAt?: string;
  qualityIssue?: QualityIssue;
  width?: number;
  height?: number;
  createdAt?: string;
  generationMetadata?: ResultGenerationMetadata;
};

export type ResultGenerationMetadata = ExternalExecution & {
  seed?: number;
  parameters: TaskParameters;
};

export type ResultManifestEntry = {
  resultId: string;
  skuCode: string;
  dimensions: string;
  operation: string;
  generatedAt: string;
  reviewStatus: ReviewStatus;
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
  details?: Record<string, string | number | boolean>;
};

export type StudioNotification = {
  id: string;
  type: 'review.submitted' | 'review.approved' | 'review.returned' | 'review.rejected' | 'review.withdrawn';
  targetId: string;
  message: string;
  at: string;
  recipientUserId?: string;
  recipientRole?: 'creator' | 'reviewer';
  readAt?: string;
};

export type StudioState = {
  tenantName: string;
  projectName: string;
  workspaceName: string;
  selectedSceneId: string;
  selectedTool: TaskProfileId;
  usage: UsageState;
  usageLedger: UsageLedgerEntry[];
  assets: Asset[];
  scenes: Scene[];
  edges: SceneEdge[];
  jobs: GenerationJob[];
  results: Result[];
  auditEvents: AuditEvent[];
  notifications: StudioNotification[];
};

const terminalJobStatuses = new Set<JobStatus>([
  'partially_succeeded',
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

function isTerminalJobStatus(status: JobStatus): boolean {
  return terminalJobStatuses.has(status);
}

export const taskProfiles: TaskProfile[] = [
  { id: 'generate', label: '生成', description: '生成', labelJa: '生成', costPerOutput: 15, defaultOutputs: 4, accent: '#2f6fed' },
  { id: 'blend', label: '融图', description: '融图', labelJa: '融图', costPerOutput: 18, defaultOutputs: 4, accent: '#0b8a74' },
  { id: 'angle', label: '多角度', description: '多角度', labelJa: '多角度', costPerOutput: 22, defaultOutputs: 4, accent: '#7a5c2e' },
  { id: 'light', label: '定向光', description: '定向光', labelJa: '定向光', costPerOutput: 14, defaultOutputs: 4, accent: '#d58a00' },
  { id: 'remove', label: '去除', description: '去除', labelJa: '去除', costPerOutput: 12, defaultOutputs: 1, accent: '#bd3f3f' },
  { id: 'extract', label: '抠图', description: '抠图', labelJa: '抠图', costPerOutput: 12, defaultOutputs: 1, accent: '#39525f' },
  { id: 'expand', label: '扩图', description: '扩图', labelJa: '扩图', costPerOutput: 12, defaultOutputs: 4, accent: '#bd3f3f' },
  { id: 'upscale', label: '超分', description: '超分', labelJa: '超分', costPerOutput: 12, defaultOutputs: 1, accent: '#39525f' },
];

const resultImages = [
  '/demo-assets/demo-product-emerald.png',
  '/demo-assets/demo-product-blue.png',
  '/demo-assets/demo-product-coral.png',
  '/demo-assets/demo-product-flatlay.png',
  '/demo-assets/demo-product-pack.png',
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
    tenantName: 'Aster Japan',
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
    usageLedger: [],
    assets: [
      {
        id: 'asset-main',
        brand: 'Aster',
        product: '精华粉底',
        skuCode: 'AST-SF-001',
        usage: '主商品图',
        version: 'v3',
        imageUrl: '/demo-assets/demo-product-source.png',
      },
      {
        id: 'asset-pack',
        brand: 'Aster',
        product: '护肤套装',
        skuCode: 'AST-SK-014',
        usage: '包装',
        version: 'v1',
        imageUrl: '/demo-assets/demo-product-pack.png',
      },
      {
        id: 'asset-scene',
        brand: 'Aster',
        product: '活动参考',
        skuCode: 'AST-REF-SEA',
        usage: '场景参考',
        version: 'v2',
        imageUrl: '/demo-assets/demo-product-flatlay.png',
      },
    ],
    scenes: [
      {
        id: 'scene-source',
        title: '源场景',
        skuCode: 'AST-SF-001',
        operation: '商品素材',
        status: 'source',
        x: 0,
        y: 40,
        imageUrl: '/demo-assets/demo-product-source.png',
        resultIds: [],
        sourceAssetId: 'asset-main',
        sourceAssetVersion: 'v3',
      },
    ],
    edges: [],
    jobs: [],
    results: [],
    auditEvents: [],
    notifications: [],
  };
}

export function createJob(
  state: StudioState,
  input: {
    sceneId: string;
    profileId: TaskProfileId;
    outputCount: number;
    inputKind?: JobInputKind;
    inputNodeId?: string;
    prompt?: string;
    ratio?: string;
    parameters?: TaskParameters;
    referenceAssetIds?: string[];
    maskImageUrl?: string;
    sourceResultId?: string;
    position?: CanvasPosition;
    retryOfJobId?: string;
    supersedesResultId?: string;
  },
): StudioState {
  if (!Number.isInteger(input.outputCount) || input.outputCount <= 0) {
    throw new Error('产出数量必须为正整数');
  }
  const profile = getProfile(input.profileId);
  const source = state.scenes.find((scene) => scene.id === input.sceneId);
  if (!source) {
    throw new Error(`场景不存在：${input.sceneId}`);
  }
  const inputKind = input.inputKind ?? 'scene';
  const inputNodeId = input.inputNodeId ?? input.sceneId;
  if (inputKind === 'result') {
    const sourceResult = state.results.find((result) => result.id === input.sourceResultId);
    if (!sourceResult || source.sourceResultId !== sourceResult.id) {
      throw new Error('结果输入与目标分支不一致');
    }
  }
  const referenceAssetIds = input.referenceAssetIds?.length
    ? [...input.referenceAssetIds]
    : input.profileId === 'blend' && source.sourceAssetId
      ? [source.sourceAssetId]
      : [];
  if (input.profileId === 'blend' && referenceAssetIds.length === 0) {
    throw new Error('融图任务必须选择参考素材');
  }
  if (referenceAssetIds.some((assetId) => !state.assets.some((asset) => asset.id === assetId))) {
    throw new Error('参考素材不存在');
  }
  const retrySource = input.retryOfJobId
    ? state.jobs.find((job) => job.id === input.retryOfJobId)
    : undefined;
  if (input.retryOfJobId && !retrySource) throw new Error('原重试任务不存在');
  if (retrySource) {
    if (retrySource.sceneId !== input.sceneId || retrySource.profileId !== input.profileId) {
      throw new Error('重试任务与原任务归属不一致');
    }
    const reviewRevision = input.supersedesResultId
      ? state.results.find((result) => result.id === input.supersedesResultId)
      : undefined;
    if (input.supersedesResultId && (
      !reviewRevision
      || reviewRevision.jobId !== retrySource.id
      || (reviewRevision.reviewStatus !== 'returned' && reviewRevision.reviewStatus !== 'rejected')
    )) {
      throw new Error('审核修改版本与原结果不一致');
    }
    if (!input.supersedesResultId && retrySource.status !== 'failed' && retrySource.status !== 'expired') {
      throw new Error('仅失败或过期任务可直接重试');
    }
    if (state.jobs.some((job) => (
      job.retryOfJobId === retrySource.id
      && job.supersedesResultId === input.supersedesResultId
      && !isTerminalJobStatus(job.status)
    ))) {
      throw new Error('已有进行中的重试任务');
    }
  } else if (input.supersedesResultId) {
    throw new Error('审核修改版本必须关联原任务');
  }
  const reservedCredits = profile.costPerOutput * input.outputCount;
  if (state.usage.availableCredits < reservedCredits) {
    throw new Error('可用额度不足');
  }

  const sceneJobCount = state.jobs.filter((item) => item.sceneId === source.id).length;
  const sceneBranchCount = state.scenes.filter((item) => item.parentSceneId === source.id).length;
  const job: GenerationJob = {
    id: `job-${state.jobs.length + 1}`,
    sceneId: input.sceneId,
    profileId: input.profileId,
    status: 'preflight',
    outputCount: input.outputCount,
    reservedCredits,
    actualCredits: 0,
    progress: 4,
    x: input.position?.x ?? source.x + 380,
    y: input.position?.y ?? source.y + 24 + (sceneJobCount + sceneBranchCount) * 360,
    inputSnapshot: {
      inputKind,
      inputNodeId,
      prompt: input.prompt ?? '',
      ratio: input.ratio ?? '1:1',
      parameters: { ...(input.parameters ?? {}) },
      referenceAssetIds,
      ...(input.maskImageUrl ? { maskImageUrl: input.maskImageUrl } : {}),
      ...(source.sourceAssetId ? { sourceAssetId: source.sourceAssetId } : {}),
      ...(source.sourceAssetVersion ? { sourceAssetVersion: source.sourceAssetVersion } : {}),
      ...(input.sourceResultId ? { sourceResultId: input.sourceResultId } : {}),
    },
    ...(input.retryOfJobId ? { retryOfJobId: input.retryOfJobId } : {}),
    ...(input.supersedesResultId ? { supersedesResultId: input.supersedesResultId } : {}),
  };
  const jobs = [...state.jobs, job];

  return {
    ...state,
    jobs,
    scenes: refreshSceneStatuses(state.scenes, jobs),
    usage: {
      ...state.usage,
      availableCredits: state.usage.availableCredits - reservedCredits,
      frozenCredits: state.usage.frozenCredits + reservedCredits,
    },
    usageLedger: [
      ...(state.usageLedger ?? []),
      usageLedgerEntry(state, job, 'reserve', reservedCredits, {
        balanceAfter: state.usage.availableCredits - reservedCredits,
        reason: '任务提交冻结预计额度',
      }),
    ],
    auditEvents: [
      ...state.auditEvents,
      audit('job.created', job.id, 'Mika Tanaka', {
        ...(job.retryOfJobId ? { retryOfJobId: job.retryOfJobId } : {}),
        ...(job.supersedesResultId ? { supersedesResultId: job.supersedesResultId } : {}),
      }),
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
  status: 'failed' | 'canceled' | 'expired',
  errorMessage?: string,
  actualCredits = 0,
): StudioState {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) {
    throw new Error(`任务不存在：${jobId}`);
  }
  if (isTerminalJobStatus(job.status)) {
    throw new Error('任务已结算，不能重复结算');
  }
  if (!Number.isFinite(actualCredits) || actualCredits < 0 || actualCredits > job.reservedCredits) {
    throw new Error('实际额度超出预留范围');
  }

  const jobs = state.jobs.map((item) =>
    item.id === jobId
      ? { ...item, status, actualCredits, ...(errorMessage !== undefined ? { errorMessage } : {}) }
      : item,
  );
  const balanceAfter = state.usage.availableCredits + job.reservedCredits - actualCredits;
  const settlementLedger = settlementLedgerEntries(
    state,
    job,
    actualCredits,
    balanceAfter,
    `任务${status}结算`,
  );

  return {
    ...state,
    jobs,
    scenes: refreshSceneStatuses(state.scenes, jobs),
    usage: {
      ...state.usage,
      availableCredits: state.usage.availableCredits + job.reservedCredits - actualCredits,
      frozenCredits: Math.max(0, state.usage.frozenCredits - job.reservedCredits),
      spentCredits: state.usage.spentCredits + actualCredits,
    },
    usageLedger: [...(state.usageLedger ?? []), ...settlementLedger],
    auditEvents: [
      ...state.auditEvents,
      audit(`job.${status}`, job.id, '图像处理服务'),
    ],
  };
}

export function failJob(
  state: StudioState,
  jobId: string,
  errorMessage: string,
  actualCredits = 0,
): StudioState {
  return settleJob(state, jobId, 'failed', errorMessage, actualCredits);
}

export function cancelJob(state: StudioState, jobId: string, actualCredits = 0): StudioState {
  return settleJob(state, jobId, 'canceled', undefined, actualCredits);
}

export function expireJob(
  state: StudioState,
  jobId: string,
  errorMessage = '供应商任务已过期',
  actualCredits = 0,
): StudioState {
  return settleJob(state, jobId, 'expired', errorMessage, actualCredits);
}

export function requestJobCancellation(state: StudioState, jobId: string): StudioState {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error(`任务不存在：${jobId}`);
  if (isTerminalJobStatus(job.status)) throw new Error('任务已结算，不能取消');
  if (job.status === 'cancel_requested') return state;

  const jobs = state.jobs.map((item) => item.id === jobId
    ? { ...item, status: 'cancel_requested' as const }
    : item);
  return {
    ...state,
    jobs,
    scenes: refreshSceneStatuses(state.scenes, jobs),
    auditEvents: [...state.auditEvents, audit('job.cancel_requested', job.id, 'Mika Tanaka')],
  };
}

export function addAsset(state: StudioState, input: Omit<Asset, 'id'>): StudioState {
  const asset = {
    ...input,
    brand: input.brand.trim(),
    product: input.product.trim(),
    skuCode: input.skuCode.trim(),
    usage: input.usage.trim(),
    version: input.version.trim(),
    imageUrl: input.imageUrl.trim(),
  };
  const requiredFields = [asset.brand, asset.product, asset.skuCode, asset.usage, asset.version, asset.imageUrl];
  if (requiredFields.some((value) => !value)) {
    throw new Error('素材信息不完整');
  }
  if (state.assets.some((item) => item.skuCode.toLocaleLowerCase() === asset.skuCode.toLocaleLowerCase())) {
    throw new Error(`SKU 编码已存在：${asset.skuCode}`);
  }

  const id = getNextAssetId(state);
  return {
    ...state,
    assets: [...state.assets, { id, ...asset }],
    auditEvents: [...state.auditEvents, audit('asset.uploaded', id, 'Mika Tanaka', {
      skuCode: asset.skuCode,
      version: asset.version,
    })],
  };
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
    id: getNextSceneId(state),
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

export function createBlankScene(
  state: StudioState,
  input: { position: CanvasPosition },
): StudioState {
  const scene: Scene = {
    id: getNextSceneId(state),
    title: '未命名场景',
    skuCode: '未绑定 SKU',
    operation: '空白场景',
    status: 'draft',
    ...input.position,
    imageUrl: '',
    resultIds: [],
  };

  return {
    ...state,
    selectedSceneId: scene.id,
    scenes: [...state.scenes, scene],
    auditEvents: [...state.auditEvents, audit('scene.created_blank', scene.id, 'Mika Tanaka')],
  };
}

export function duplicateScene(state: StudioState, sceneId: string): StudioState {
  const source = state.scenes.find((scene) => scene.id === sceneId);
  if (!source) {
    throw new Error(`场景不存在：${sceneId}`);
  }

  const scene: Scene = {
    id: getNextSceneId(state),
    title: `${source.title} 副本`,
    skuCode: source.skuCode,
    operation: source.operation,
    status: 'draft',
    x: source.x + 48,
    y: source.y + 48,
    imageUrl: source.imageUrl,
    resultIds: [],
    ...(source.sourceAssetId ? { sourceAssetId: source.sourceAssetId } : {}),
    ...(source.sourceAssetVersion ? { sourceAssetVersion: source.sourceAssetVersion } : {}),
  };

  return {
    ...state,
    selectedSceneId: scene.id,
    scenes: [...state.scenes, scene],
    auditEvents: [...state.auditEvents, audit('scene.duplicated', scene.id, 'Mika Tanaka')],
  };
}

export function renameScene(state: StudioState, sceneId: string, title: string): StudioState {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new Error('场景名称不能为空');
  }
  if (!state.scenes.some((scene) => scene.id === sceneId)) {
    throw new Error(`场景不存在：${sceneId}`);
  }

  return {
    ...state,
    scenes: state.scenes.map((scene) => scene.id === sceneId
      ? { ...scene, title: normalizedTitle }
      : scene),
    auditEvents: [...state.auditEvents, audit('scene.renamed', sceneId, 'Mika Tanaka')],
  };
}

export function deleteScene(state: StudioState, sceneId: string): StudioState {
  const scene = state.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new Error(`场景不存在：${sceneId}`);
  }
  const hasDownstreamContent = scene.resultIds.length > 0
    || state.jobs.some((job) => job.sceneId === sceneId)
    || state.results.some((result) => result.sourceSceneId === sceneId)
    || state.scenes.some((item) => item.parentSceneId === sceneId)
    || state.edges.some((edge) => edge.target === sceneId);
  if (hasDownstreamContent) {
    throw new Error('该场景已有任务或下游内容，暂不能删除');
  }

  const scenes = state.scenes.filter((item) => item.id !== sceneId);
  return {
    ...state,
    selectedSceneId: state.selectedSceneId === sceneId ? scenes[0]?.id ?? '' : state.selectedSceneId,
    scenes,
    auditEvents: [...state.auditEvents, audit('scene.deleted', sceneId, 'Mika Tanaka')],
  };
}

export function updateJobProgress(state: StudioState, jobId: string, progress: number): StudioState {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job || isTerminalJobStatus(job.status) || job.status === 'cancel_requested' || job.status === 'postprocessing') {
    return state;
  }

  const boundedProgress = Math.max(0, Math.min(94, progress));

  const jobs = state.jobs.map((item) =>
    item.id === jobId ? { ...item, status: 'running' as const, progress: boundedProgress } : item,
  );

  return {
    ...state,
    jobs,
    scenes: refreshSceneStatuses(state.scenes, jobs),
  };
}

export function markJobPostprocessing(state: StudioState, jobId: string): StudioState {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job || isTerminalJobStatus(job.status) || job.status === 'cancel_requested') return state;
  const jobs = state.jobs.map((item) => item.id === jobId
    ? { ...item, status: 'postprocessing' as const, progress: Math.max(96, item.progress) }
    : item);
  return { ...state, jobs, scenes: refreshSceneStatuses(state.scenes, jobs) };
}

export function attachExternalJob(
  state: StudioState,
  jobId: string,
  externalExecution: ExternalExecution,
): StudioState {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error(`任务不存在：${jobId}`);
  if (isTerminalJobStatus(job.status)) {
    throw new Error('任务已结算，不能挂载外部请求');
  }
  if (!externalExecution.modelId.trim()) throw new Error('外部模型 ID 不能为空');
  if (!externalExecution.requestId.trim()) throw new Error('外部请求 ID 不能为空');
  if (job.externalExecution) {
    if (
      job.externalExecution.provider === externalExecution.provider
      && job.externalExecution.modelId === externalExecution.modelId
      && job.externalExecution.requestId === externalExecution.requestId
    ) return state;
    throw new Error('任务已挂载其他外部请求');
  }

  const jobs = state.jobs.map((item) => item.id === jobId
    ? {
        ...item,
        status: 'queued' as const,
        progress: Math.max(24, item.progress),
        externalExecution: { ...externalExecution },
      }
    : item);
  return { ...state, jobs, scenes: refreshSceneStatuses(state.scenes, jobs) };
}

type SuccessfulResultInput = {
  imageUrl: string;
  width: number;
  height: number;
  generationMetadata?: ResultGenerationMetadata;
};

function settleSuccessfulJob(
  state: StudioState,
  job: GenerationJob,
  actualCredits: number,
  outputs: SuccessfulResultInput[],
): StudioState {
  const completionStatus: 'partially_succeeded' | 'succeeded' = outputs.length < job.outputCount
    ? 'partially_succeeded'
    : 'succeeded';
  const newResults: Result[] = outputs.map((output, index) => {
    const id = `result-${state.results.length + index + 1}`;
    return {
      id,
      sourceSceneId: job.sceneId,
      jobId: job.id,
      assetId: `generated-${id}`,
      title: `${getProfile(job.profileId).label} ${index + 1}`,
      imageUrl: output.imageUrl,
      reviewStatus: 'draft',
      ...(job.supersedesResultId ? { supersedesResultId: job.supersedesResultId } : {}),
      isFavorite: false,
      isAdopted: false,
      isPrimary: false,
      width: output.width,
      height: output.height,
      createdAt: new Date().toISOString(),
      x: job.x + 380 + index * 300,
      y: job.y,
      ...(output.generationMetadata
        ? { generationMetadata: output.generationMetadata }
        : {}),
    };
  });

  const jobs = state.jobs.map((item) =>
    item.id === job.id
      ? { ...item, status: completionStatus, progress: 100, actualCredits }
      : item,
  );
  const scenes = refreshSceneStatuses(
    state.scenes.map((scene) =>
      scene.id === job.sceneId
        ? { ...scene, resultIds: [...scene.resultIds, ...newResults.map((result) => result.id)] }
        : scene,
    ),
    jobs,
  );
  const externalDetails = job.externalExecution
    ? {
        provider: job.externalExecution.provider,
        modelId: job.externalExecution.modelId,
        requestId: job.externalExecution.requestId,
      }
    : undefined;
  const balanceAfter = state.usage.availableCredits + job.reservedCredits - actualCredits;

  return {
    ...state,
    jobs,
    scenes,
    results: [...state.results, ...newResults],
    usage: {
      ...state.usage,
      availableCredits: state.usage.availableCredits + job.reservedCredits - actualCredits,
      frozenCredits: Math.max(0, state.usage.frozenCredits - job.reservedCredits),
      spentCredits: state.usage.spentCredits + actualCredits,
    },
    usageLedger: [
      ...(state.usageLedger ?? []),
      ...settlementLedgerEntries(state, job, actualCredits, balanceAfter, '任务结果结算'),
    ],
    auditEvents: [
      ...state.auditEvents,
      audit(`job.${completionStatus}`, job.id, '图像处理服务', externalDetails),
    ],
  };
}

function usageLedgerEntry(
  state: StudioState,
  job: GenerationJob,
  entryType: UsageLedgerEntry['entryType'],
  units: number,
  options: { balanceAfter: number; reason: string; offset?: number },
): UsageLedgerEntry {
  return {
    id: `usage-${(state.usageLedger?.length ?? 0) + 1 + (options.offset ?? 0)}`,
    jobId: job.id,
    profileId: job.profileId,
    entryType,
    units,
    balanceAfter: options.balanceAfter,
    pricingRuleVersion: 'content-studio-credit-v1',
    reason: options.reason,
    at: new Date().toISOString(),
  };
}

function settlementLedgerEntries(
  state: StudioState,
  job: GenerationJob,
  actualCredits: number,
  balanceAfter: number,
  reason: string,
): UsageLedgerEntry[] {
  return [
    usageLedgerEntry(state, job, 'charge', actualCredits, {
      balanceAfter: state.usage.availableCredits,
      reason,
    }),
    usageLedgerEntry(state, job, 'release', job.reservedCredits - actualCredits, {
      balanceAfter,
      reason: '释放未结算的冻结额度',
      offset: 1,
    }),
  ];
}

function getCompletableJob(
  state: StudioState,
  jobId: string,
  successfulOutputs: number,
  actualCredits: number,
): GenerationJob {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error(`任务不存在：${jobId}`);
  if (isTerminalJobStatus(job.status)) {
    throw new Error('任务已结算，不能重复结算');
  }
  if (!Number.isInteger(successfulOutputs) || successfulOutputs < 0 || successfulOutputs > job.outputCount) {
    throw new Error('成功产出数量超出任务范围');
  }
  if (!Number.isFinite(actualCredits) || actualCredits < 0 || actualCredits > job.reservedCredits) {
    throw new Error('实际额度超出预留范围');
  }
  return job;
}

export function completeJobWithResults(
  state: StudioState,
  jobId: string,
  input: {
    images: Array<{ url: string; width?: number; height?: number }>;
    actualCredits: number;
    seed?: number;
  },
): StudioState {
  if (input.images.length === 0 || input.images.some((image) => !image.url.trim())) {
    throw new Error('任务未生成可用结果');
  }
  const job = getCompletableJob(state, jobId, input.images.length, input.actualCredits);
  if (!job.externalExecution) throw new Error('任务缺少外部请求信息');

  const generationMetadata: ResultGenerationMetadata = {
    ...job.externalExecution,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    parameters: { ...job.inputSnapshot.parameters },
  };
  return settleSuccessfulJob(
    state,
    job,
    input.actualCredits,
    input.images.map((image) => ({
      imageUrl: image.url.trim(),
      width: image.width && image.width > 0 ? image.width : 1024,
      height: image.height && image.height > 0 ? image.height : 1024,
      generationMetadata: { ...generationMetadata, parameters: { ...generationMetadata.parameters } },
    })),
  );
}

export function completeJob(
  state: StudioState,
  jobId: string,
  input: { successfulOutputs: number; actualCredits: number },
): StudioState {
  const job = getCompletableJob(state, jobId, input.successfulOutputs, input.actualCredits);
  if (input.successfulOutputs === 0) {
    return failJob(state, jobId, '任务未生成可用结果', input.actualCredits);
  }

  return settleSuccessfulJob(
    state,
    job,
    input.actualCredits,
    Array.from({ length: input.successfulOutputs }).map((_, index) => ({
      imageUrl: resultImages[(state.results.length + index) % resultImages.length],
      width: 2048,
      height: 2048,
    })),
  );
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
  const parentJobCount = state.jobs.filter((job) => job.sceneId === parent.id).length;
  const parentBranchCount = state.scenes.filter((scene) => scene.parentSceneId === parent.id).length;

  const sceneId = getNextSceneId(state);
  const scene: Scene = {
    id: sceneId,
    title: `${input.operation}场景`,
    skuCode: parent.skuCode,
    operation: input.operation,
    status: 'draft',
    x: sourceResult.x,
    y: parent.y + 24 + (parentJobCount + parentBranchCount) * 360,
    imageUrl: sourceResult.imageUrl,
    resultIds: [],
    parentSceneId: parent.id,
    sourceResultId: sourceResult.id,
    sourceAssetId: parent.sourceAssetId,
    sourceAssetVersion: parent.sourceAssetVersion,
  };

  return {
    ...state,
    selectedSceneId: scene.id,
    scenes: [...state.scenes, scene],
    edges: [
      ...state.edges,
      {
        id: `edge-${state.edges.length + 1}`,
        source: sourceResult.id,
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

export function submitForReview(
  state: StudioState,
  resultId: string,
  actor = 'Mika Tanaka',
): StudioState {
  const result = state.results.find((item) => item.id === resultId);
  if (!result) {
    throw new Error(`结果不存在：${resultId}`);
  }
  if (result.reviewStatus === 'returned' || result.reviewStatus === 'rejected') {
    throw new Error('已退回或已拒绝结果必须生成新版本后提交审核');
  }
  if (result.reviewStatus !== 'draft') {
    throw new Error('仅草稿结果可提交审核');
  }

  const event = audit('review.submitted', resultId, actor);
  return {
    ...state,
    results: state.results.map((result) =>
      result.id === resultId
        ? { ...result, reviewStatus: 'submitted', reviewedBy: undefined, reviewComment: undefined }
        : result,
    ),
    auditEvents: [...state.auditEvents, event],
    notifications: [...(state.notifications ?? []), reviewNotification(
      state,
      event,
      '新结果已提交审核',
      { recipientRole: 'reviewer' },
    )],
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

  const event = audit('review.approved', resultId, reviewer);
  return {
    ...state,
    results: state.results.map((result) =>
      result.id === resultId
        ? { ...result, reviewStatus: 'approved', approvedBy: reviewer, reviewedBy: reviewer }
        : result,
    ),
    auditEvents: [...state.auditEvents, event],
    notifications: [...(state.notifications ?? []), reviewNotification(
      state,
      event,
      '审核已通过',
      { recipientUserId: latestReviewSubmitter(state, resultId) },
    )],
  };
}

export function returnResult(
  state: StudioState,
  resultId: string,
  reviewer: string,
  reason: string,
): StudioState {
  const result = state.results.find((item) => item.id === resultId);
  if (!result) {
    throw new Error(`结果不存在：${resultId}`);
  }
  if (result.reviewStatus !== 'submitted') {
    throw new Error('仅待审核结果可退回');
  }
  const normalizedReason = reviewReason(reason);

  const event = audit('review.returned', resultId, reviewer);
  return {
    ...state,
    results: state.results.map((item) =>
      item.id === resultId
        ? { ...item, reviewStatus: 'returned', approvedBy: undefined, reviewedBy: reviewer, reviewComment: normalizedReason }
        : item,
    ),
    auditEvents: [...state.auditEvents, event],
    notifications: [...(state.notifications ?? []), reviewNotification(
      state,
      event,
      `审核已退回：${normalizedReason}`,
      { recipientUserId: latestReviewSubmitter(state, resultId) },
    )],
  };
}

export function rejectResult(
  state: StudioState,
  resultId: string,
  reviewer: string,
  reason: string,
): StudioState {
  const result = findResult(state, resultId);
  if (result.reviewStatus !== 'submitted') throw new Error('仅待审核结果可拒绝');
  const normalizedReason = reviewReason(reason);
  const event = audit('review.rejected', resultId, reviewer);
  return {
    ...state,
    results: state.results.map((item) => item.id === resultId
      ? {
          ...item,
          reviewStatus: 'rejected',
          approvedBy: undefined,
          reviewedBy: reviewer,
          reviewComment: normalizedReason,
        }
      : item),
    auditEvents: [...state.auditEvents, event],
    notifications: [...(state.notifications ?? []), reviewNotification(
      state,
      event,
      `审核已拒绝：${normalizedReason}`,
      { recipientUserId: latestReviewSubmitter(state, resultId) },
    )],
  };
}

export function withdrawReview(
  state: StudioState,
  resultId: string,
  actor: string,
): StudioState {
  const result = findResult(state, resultId);
  if (result.reviewStatus !== 'submitted') throw new Error('仅待审核申请可撤回');
  const event = audit('review.withdrawn', resultId, actor);
  return {
    ...state,
    results: state.results.map((item) => item.id === resultId
      ? {
          ...item,
          reviewStatus: 'draft',
          approvedBy: undefined,
          reviewedBy: undefined,
          reviewComment: undefined,
        }
      : item),
    auditEvents: [...state.auditEvents, event],
    notifications: [...(state.notifications ?? []), reviewNotification(
      state,
      event,
      '审核申请已撤回',
      { recipientRole: 'reviewer' },
    )],
  };
}

export function retryResultGeneration(
  state: StudioState,
  resultId: string,
  overrides: {
    prompt?: string;
    ratio?: string;
    parameters?: TaskParameters;
    referenceAssetIds?: string[];
    maskImageUrl?: string;
  } = {},
): StudioState {
  const result = findResult(state, resultId);
  if (result.reviewStatus !== 'returned' && result.reviewStatus !== 'rejected') {
    throw new Error('仅已退回或已拒绝结果可修改后重试');
  }
  const sourceJob = state.jobs.find((job) => job.id === result.jobId);
  if (!sourceJob) throw new Error('原生成任务不存在');
  const snapshot = sourceJob.inputSnapshot;
  return createJob(state, {
    sceneId: sourceJob.sceneId,
    profileId: sourceJob.profileId,
    outputCount: sourceJob.outputCount,
    inputKind: snapshot.inputKind,
    inputNodeId: snapshot.inputNodeId,
    prompt: overrides.prompt ?? snapshot.prompt,
    ratio: overrides.ratio ?? snapshot.ratio,
    parameters: { ...snapshot.parameters, ...(overrides.parameters ?? {}) },
    referenceAssetIds: overrides.referenceAssetIds ?? snapshot.referenceAssetIds,
    maskImageUrl: overrides.maskImageUrl ?? snapshot.maskImageUrl,
    sourceResultId: snapshot.sourceResultId,
    retryOfJobId: sourceJob.id,
    supersedesResultId: result.id,
  });
}

function reviewReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length < 5 || normalized.length > 500) {
    throw new Error('审核原因必须为 5-500 个字符');
  }
  return normalized;
}

function latestReviewSubmitter(state: StudioState, resultId: string): string {
  for (let index = state.auditEvents.length - 1; index >= 0; index -= 1) {
    const event = state.auditEvents[index];
    if (event.type === 'review.submitted' && event.targetId === resultId) return event.actor;
  }
  return 'Mika Tanaka';
}

function reviewNotification(
  state: StudioState,
  event: AuditEvent,
  message: string,
  recipient: Pick<StudioNotification, 'recipientUserId' | 'recipientRole'>,
): StudioNotification {
  return {
    id: `notification-${(state.notifications ?? []).length + 1}`,
    type: event.type as StudioNotification['type'],
    targetId: event.targetId,
    message,
    at: event.at,
    ...recipient,
  };
}

export function toggleResultFavorite(state: StudioState, resultId: string): StudioState {
  const result = findResult(state, resultId);
  const isFavorite = !result.isFavorite;

  return {
    ...state,
    results: state.results.map((item) => item.id === resultId ? { ...item, isFavorite } : item),
    auditEvents: [
      ...state.auditEvents,
      audit(isFavorite ? 'result.favorited' : 'result.unfavorited', resultId, 'Mika Tanaka'),
    ],
  };
}

export function toggleResultAdoption(state: StudioState, resultId: string, actor: string): StudioState {
  const result = findResult(state, resultId);
  const isAdopted = !result.isAdopted;
  const hasPrimary = state.results.some((item) => (
    item.sourceSceneId === result.sourceSceneId && item.isPrimary && item.id !== resultId
  ));
  const replacementPrimaryId = !isAdopted && result.isPrimary
    ? state.results.find((item) => (
      item.sourceSceneId === result.sourceSceneId && item.isAdopted && item.id !== resultId
    ))?.id
    : undefined;
  const adoptedAt = new Date().toISOString();

  return {
    ...state,
    results: state.results.map((item) => {
      if (item.id === resultId) {
        return isAdopted
          ? {
              ...item,
              isAdopted: true,
              isPrimary: !hasPrimary,
              adoptedBy: actor,
              adoptedAt,
            }
          : {
              ...item,
              isAdopted: false,
              isPrimary: false,
              adoptedBy: undefined,
              adoptedAt: undefined,
            };
      }
      return item.id === replacementPrimaryId ? { ...item, isPrimary: true } : item;
    }),
    auditEvents: [
      ...state.auditEvents,
      audit(isAdopted ? 'result.adopted' : 'result.unadopted', resultId, actor),
    ],
  };
}

export function setPrimaryResult(state: StudioState, resultId: string, actor: string): StudioState {
  const result = findResult(state, resultId);
  if (!result.isAdopted) {
    throw new Error('仅已采用结果可设为主结果');
  }

  return {
    ...state,
    results: state.results.map((item) => item.sourceSceneId === result.sourceSceneId
      ? { ...item, isPrimary: item.id === resultId }
      : item),
    auditEvents: [...state.auditEvents, audit('result.primary_set', resultId, actor)],
  };
}

export function setResultQualityIssue(
  state: StudioState,
  resultId: string,
  issue: QualityIssue,
  actor: string,
): StudioState {
  findResult(state, resultId);
  return {
    ...state,
    results: state.results.map((item) => item.id === resultId ? { ...item, qualityIssue: issue } : item),
    auditEvents: [...state.auditEvents, audit('result.quality_flagged', resultId, actor)],
  };
}

export function recordResultExport(
  state: StudioState,
  resultId: string,
  actor: string,
  spec: ExportSpec,
): StudioState {
  const result = findResult(state, resultId);
  if (result.reviewStatus !== 'approved') {
    throw new Error('仅审核通过结果可生成生产导出');
  }

  return {
    ...state,
    auditEvents: [...state.auditEvents, audit('result.exported', resultId, actor, { ...spec })],
  };
}

export function buildExportFilename(
  state: StudioState,
  resultId: string,
  spec: ExportSpec,
  date = new Date(),
): string {
  const result = findResult(state, resultId);
  const scene = state.scenes.find((item) => item.id === result.sourceSceneId);
  if (!scene) {
    throw new Error('结果来源场景不存在');
  }
  const asset = scene.sourceAssetId
    ? state.assets.find((item) => item.id === scene.sourceAssetId)
    : undefined;
  const brand = asset?.brand ?? state.tenantName;
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('');
  const parts = [brand, scene.skuCode, state.projectName, scene.title, result.title, stamp, 'v1'];
  return `${parts.map(sanitizeFilenamePart).join('_')}.${spec.format}`;
}

export function buildResultManifest(state: StudioState, resultIds: string[]): ResultManifestEntry[] {
  return resultIds.map((resultId) => {
    const result = findResult(state, resultId);
    if (result.reviewStatus !== 'approved') {
      throw new Error('清单只能包含审核通过结果');
    }
    const scene = state.scenes.find((item) => item.id === result.sourceSceneId);
    const job = state.jobs.find((item) => item.id === result.jobId);
    if (!scene || !job) {
      throw new Error('结果来源信息不完整');
    }
    return {
      resultId: result.id,
      skuCode: scene.skuCode,
      dimensions: `${result.width ?? 2048}x${result.height ?? 2048}`,
      operation: getProfile(job.profileId).label,
      generatedAt: result.createdAt ?? '',
      reviewStatus: result.reviewStatus,
    };
  });
}

export function setSelectedTool(state: StudioState, tool: TaskProfileId): StudioState {
  return { ...state, selectedTool: tool };
}

export function setSelectedScene(state: StudioState, sceneId: string): StudioState {
  return { ...state, selectedSceneId: sceneId };
}

function refreshSceneStatuses(scenes: Scene[], jobs: GenerationJob[]): Scene[] {
  return scenes.map((scene) => {
    const sceneJobs = jobs.filter((job) => job.sceneId === scene.id);
    if (sceneJobs.length === 0) return scene;
    const activePriority: JobStatus[] = [
      'postprocessing', 'running', 'queued', 'preflight', 'cancel_requested',
    ];
    const activeStatus = activePriority.find((status) => sceneJobs.some((job) => job.status === status));
    if (activeStatus) return { ...scene, status: activeStatus };
    return { ...scene, status: sceneJobs.at(-1)!.status };
  });
}

function findResult(state: StudioState, resultId: string): Result {
  const result = state.results.find((item) => item.id === resultId);
  if (!result) {
    throw new Error(`结果不存在：${resultId}`);
  }
  return result;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|%]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || '未命名';
}

function audit(
  type: string,
  targetId: string,
  actor: string,
  details?: AuditEvent['details'],
): AuditEvent {
  return {
    id: `audit-${type}-${targetId}-${Date.now()}`,
    type,
    actor,
    targetId,
    at: new Date().toISOString(),
    ...(details ? { details } : {}),
  };
}

function getNextAssetId(state: StudioState): string {
  const usedIds = new Set([
    ...state.assets.map((asset) => asset.id),
    ...state.auditEvents.map((event) => event.targetId),
  ]);
  let index = state.assets.length + 1;
  while (usedIds.has(`asset-upload-${index}`)) index += 1;
  return `asset-upload-${index}`;
}

export function getNextSceneId(state: StudioState): string {
  const historicalIds = new Set([
    ...state.scenes.map((scene) => scene.id),
    ...state.jobs.map((job) => job.sceneId),
    ...state.results.map((result) => result.sourceSceneId),
    ...state.auditEvents.map((event) => event.targetId),
    ...state.edges.flatMap((edge) => [edge.source, edge.target]),
  ].filter((id) => id.startsWith('scene-')));
  return nextEntityId('scene', [...historicalIds]);
}

function nextEntityId(prefix: string, ids: string[]): string {
  const highest = ids.reduce((max, id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, ids.length);
  return `${prefix}-${highest + 1}`;
}
