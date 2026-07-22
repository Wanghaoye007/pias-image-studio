import { randomUUID } from 'node:crypto';
import type { TaskProfileId } from '../../shared/domain';
import { readFalKey } from '../../server/fal/falCredentials';
import type { FalBillingAdapter, FalBillingReconciliation } from '../../server/fal/falBillingClient';
import {
  buildDirectionalLightInvocations,
  buildFalWorkflowPlan,
  buildNextUpscaleInvocation,
  normalizeFalResult,
  type FalToolRequest,
  type FalWorkflowPlan,
  type NormalizedFalResult,
} from '../../shared/fal/toolWorkflows';

type UpstreamStatus = {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  logs?: Array<{ message: string }>;
};

type UpstreamResult = { data: unknown };

export type FalQueueAdapter = {
  config(options: { credentials: string }): void;
  submit(
    modelId: string,
    options: { input: Record<string, unknown> },
  ): Promise<{ request_id: string }>;
  status(
    modelId: string,
    options: { requestId: string; logs: true },
  ): Promise<UpstreamStatus>;
  result(modelId: string, options: { requestId: string }): Promise<UpstreamResult>;
  cancel(modelId: string, options: { requestId: string }): Promise<void>;
};

export type FalQueueStatus = {
  status: 'queued' | 'running' | 'completed';
  logs: string[];
  progress: number;
};

export type FalToolResult = NormalizedFalResult & {
  modelId: string;
  childRequestIds: string[];
};

export type ChildStatus = 'queued' | 'running' | 'completed';

export type LocalFalChild = {
  modelId: string;
  requestId: string;
  status: ChildStatus;
};

export type PersistedFalJob = {
  id: string;
  createdBy?: string;
  profileId: TaskProfileId;
  modelId: string;
  request: FalToolRequest;
  plan: FalWorkflowPlan;
  children: LocalFalChild[];
  nextUpscaleFactorIndex: number;
  directionalLightFinalStarted?: boolean;
  canceled: boolean;
  providerBilling?: FalBillingReconciliation;
};

type LocalFalJob = PersistedFalJob;

export type FalQueuePersistence = {
  mergeWrites?: boolean;
  load(): Promise<PersistedFalJob[]>;
  save(jobs: PersistedFalJob[]): Promise<void>;
};

export type FalJobLeaseStore = {
  acquire(jobId: string, ownerId: string, nowMs: number, ttlMs: number): Promise<boolean>;
  renew(jobId: string, ownerId: string, nowMs: number, ttlMs: number): Promise<boolean>;
  release(jobId: string, ownerId: string): Promise<void>;
};

export type FalJobRecoveryPayload = {
  directionalLightSourceImageUrl?: string;
};

export type FalJobPayloadStore = {
  load(jobId: string): Promise<FalJobRecoveryPayload | undefined>;
  save(jobId: string, payload: FalJobRecoveryPayload): Promise<void>;
  delete(jobId: string): Promise<void>;
};

export class FalServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'FalServiceError';
  }
}

function statusLabel(status: UpstreamStatus['status']): ChildStatus {
  if (status === 'IN_QUEUE') return 'queued';
  if (status === 'IN_PROGRESS') return 'running';
  return 'completed';
}

function requireJob(jobs: Map<string, LocalFalJob>, requestId: string): LocalFalJob {
  const job = jobs.get(requestId);
  if (!job) throw new FalServiceError('Fal 任务不存在或服务已重启', 'FAL_JOB_NOT_FOUND', 404);
  return job;
}

function aggregateProgress(children: LocalFalChild[]): number {
  if (children.length === 0) return 8;
  const completed = children.filter((child) => child.status === 'completed').length;
  if (completed === children.length) return 94;
  const running = children.filter((child) => child.status === 'running').length;
  return Math.round(24 + completed / children.length * 60 + running / children.length * 20);
}

function activeChildren(job: LocalFalJob): LocalFalChild[] {
  return job.profileId === 'upscale'
    ? job.children.slice(-1)
    : job.profileId === 'light' && job.directionalLightFinalStarted
      ? job.children.slice(1)
      : job.children;
}

function isRecoverableJob(job: LocalFalJob): boolean {
  if (job.canceled) return false;
  const children = activeChildren(job);
  if (children.some((child) => child.status !== 'completed')) return true;
  if (
    job.profileId === 'light'
    && Boolean(job.plan.directionalLight)
    && !job.directionalLightFinalStarted
  ) return true;
  const factors = job.plan.upscaleFactors ?? [];
  return job.profileId === 'upscale' && job.nextUpscaleFactorIndex < factors.length;
}

function localQueueStatus(job: LocalFalJob): FalQueueStatus {
  if (job.canceled) return { status: 'completed', logs: [], progress: 94 };
  const children = activeChildren(job);
  const statuses = children.map((child) => child.status);
  const status = statuses.every((value) => value === 'completed') && !isRecoverableJob(job)
    ? 'completed'
    : statuses.some((value) => value === 'running')
      ? 'running'
      : 'queued';
  return { status, logs: [], progress: aggregateProgress(children) };
}

function applyExpectedImageSize(
  job: LocalFalJob,
  images: NormalizedFalResult['images'],
): NormalizedFalResult['images'] {
  if (job.profileId !== 'upscale') return images;
  const sourceWidth = job.request.sourceWidth ?? 1024;
  const sourceHeight = job.request.sourceHeight ?? 1024;
  const targetLongEdge = Number(job.request.parameters.upscaleSize);
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  if (!Number.isFinite(targetLongEdge) || targetLongEdge <= 0 || sourceLongEdge <= 0) return images;
  const factor = targetLongEdge / sourceLongEdge;
  const expectedWidth = Math.max(1, Math.round(sourceWidth * factor));
  const expectedHeight = Math.max(1, Math.round(sourceHeight * factor));
  return images.map((image) => ({
    ...image,
    width: image.width ?? expectedWidth,
    height: image.height ?? expectedHeight,
  }));
}

function falResultFailureMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Fal 结果读取失败，请重试';
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') return 'Fal 结果读取失败，请重试';
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return 'Fal 结果读取失败，请重试';
  const field = detail
    .flatMap((item) => item && typeof item === 'object'
      ? [(item as { loc?: unknown }).loc]
      : [])
    .find((loc): loc is unknown[] => Array.isArray(loc))
    ?.at(-1);

  if (field === 'rotate_right_left') return '水平旋转仅支持 -90° 到 90°';
  if (field === 'vertical_angle') return '垂直视角仅支持 -1 到 1';
  if (field === 'move_forward') return '镜头推进仅支持 0 到 10';
  return 'Fal 参数校验失败，请调整后重试';
}

function persistenceSnapshot(job: LocalFalJob): PersistedFalJob {
  const { maskImageUrl: _maskImageUrl, ...request } = job.request;
  return {
    ...job,
    request: {
      ...request,
      imageUrls: [],
      parameters: { ...request.parameters },
    },
    plan: {
      ...job.plan,
      invocations: [],
      ...(job.plan.upscaleFactors ? { upscaleFactors: [...job.plan.upscaleFactors] } : {}),
      ...(job.plan.directionalLight
        ? { directionalLight: { ...job.plan.directionalLight, sourceImageUrl: '' } }
        : {}),
    },
    children: job.children.map((child) => ({ ...child })),
  };
}

function isPersistedJob(value: unknown): value is PersistedFalJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<PersistedFalJob>;
  return typeof job.id === 'string'
    && typeof job.profileId === 'string'
    && typeof job.modelId === 'string'
    && Array.isArray(job.children)
    && Boolean(job.request)
    && Boolean(job.plan);
}

export function createFalQueueService(options: {
  adapter: FalQueueAdapter;
  billingAdapter?: FalBillingAdapter;
  readKey?: () => Promise<string>;
  createId?: () => string;
  persistence?: FalQueuePersistence;
  leaseStore?: FalJobLeaseStore;
  payloadStore?: FalJobPayloadStore;
  workerId?: string;
  leaseTtlMs?: number;
  billingRetryIntervalMs?: number;
  now?: () => number;
  onOperationalError?: (event: string, error: unknown) => void;
}) {
  let configured: Promise<void> | undefined;
  let hydrated: Promise<void> | undefined;
  let persistenceWrite = Promise.resolve();
  const jobs = new Map<string, LocalFalJob>();
  const createId = options.createId ?? (() => `fal-local-${randomUUID()}`);
  const workerId = options.workerId ?? `pias-${process.pid}-${randomUUID()}`;
  const leaseTtlMs = options.leaseTtlMs ?? 15_000;
  const billingRetryIntervalMs = Math.max(1_000, options.billingRetryIntervalMs ?? 5 * 60_000);
  const now = options.now ?? Date.now;

  const billingReconciliationDue = (job: LocalFalJob) => {
    if (!job.providerBilling) return true;
    if (job.providerBilling.status === 'confirmed') return false;
    const checkedAtMs = Date.parse(job.providerBilling.checkedAt);
    return !Number.isFinite(checkedAtMs) || now() - checkedAtMs >= billingRetryIntervalMs;
  };

  const ensureConfigured = () => {
    configured ??= (options.readKey ?? readFalKey)()
      .then((credentials) => options.adapter.config({ credentials }))
      .catch(() => {
        throw new FalServiceError('Fal 服务凭证未配置', 'FAL_CREDENTIALS', 503);
      });
    return configured;
  };

  const ensureHydrated = () => {
    hydrated ??= options.persistence
      ? options.persistence.load()
        .then((savedJobs) => {
          savedJobs.filter(isPersistedJob).forEach((job) => jobs.set(job.id, job));
        })
        .catch((error) => {
          options.onOperationalError?.('pias_fal_queue_hydration_failed', error);
        })
      : Promise.resolve();
    return hydrated;
  };

  const refreshPersistedJobs = async () => {
    if (!options.persistence) return;
    const savedJobs = await options.persistence.load();
    savedJobs.filter(isPersistedJob).forEach((job) => jobs.set(job.id, job));
  };

  const persist = (changedJob?: LocalFalJob, strict = false) => {
    if (!options.persistence) return Promise.resolve();
    const snapshot = options.persistence.mergeWrites && changedJob
      ? [persistenceSnapshot(changedJob)]
      : Array.from(jobs.values(), persistenceSnapshot).slice(-100);
    const write = persistenceWrite
      .catch(() => undefined)
      .then(() => options.persistence?.save(snapshot));
    persistenceWrite = write.catch((error) => {
        options.onOperationalError?.('pias_fal_queue_persistence_failed', error);
      });
    return strict ? write : persistenceWrite;
  };

  const submitInvocation = async (
    modelId: string,
    input: Record<string, unknown>,
  ): Promise<LocalFalChild> => {
    const submission = await options.adapter.submit(modelId, { input });
    if (!submission.request_id) throw new Error('missing request id');
    return { modelId, requestId: submission.request_id, status: 'queued' };
  };

  const reconcileProviderBilling = async (job: LocalFalJob) => {
    if (!options.billingAdapter || job.providerBilling?.status === 'confirmed') return;
    job.providerBilling = await options.billingAdapter.lookup(
      job.children.map((child) => child.requestId),
    );
    await persist(job);
  };

  return {
    async submit(
      request: FalToolRequest,
      createdBy?: string,
    ): Promise<{ requestId: string; modelId: string }> {
      await ensureHydrated();
      let plan: FalWorkflowPlan;
      try {
        plan = buildFalWorkflowPlan(request);
      } catch (error) {
        throw new FalServiceError(
          error instanceof Error ? error.message : 'Fal 任务参数无效',
          'FAL_INVALID_INPUT',
          400,
        );
      }
      await ensureConfigured();

      const children: LocalFalChild[] = [];
      try {
        for (const invocation of plan.invocations) {
          children.push(await submitInvocation(invocation.modelId, invocation.input));
        }
      } catch {
        await Promise.allSettled(children.map((child) => options.adapter.cancel(child.modelId, {
          requestId: child.requestId,
        })));
        throw new FalServiceError('Fal 任务提交失败', 'FAL_SUBMIT_FAILED', 502);
      }

      const requestId = createId();
      const job: LocalFalJob = {
        id: requestId,
        ...(createdBy ? { createdBy } : {}),
        profileId: request.profileId,
        modelId: plan.modelId,
        request: {
          ...request,
          imageUrls: [...request.imageUrls],
          parameters: { ...request.parameters },
        },
        plan,
        children,
        nextUpscaleFactorIndex: 1,
        directionalLightFinalStarted: false,
        canceled: false,
      };
      jobs.set(requestId, job);
      try {
        const sourceImageUrl = plan.directionalLight?.sourceImageUrl;
        if (sourceImageUrl && options.payloadStore) {
          await options.payloadStore.save(requestId, {
            directionalLightSourceImageUrl: sourceImageUrl,
          });
        }
        await persist(job, true);
      } catch {
        jobs.delete(requestId);
        await options.payloadStore?.delete(requestId).catch(() => undefined);
        await Promise.allSettled(children.map((child) => options.adapter.cancel(child.modelId, {
          requestId: child.requestId,
        })));
        throw new FalServiceError('Fal 任务持久化失败', 'FAL_PERSIST_FAILED', 503);
      }
      return { requestId, modelId: plan.modelId };
    },

    async status(requestId: string): Promise<FalQueueStatus> {
      await ensureHydrated();
      let leaseAcquired = false;
      let leaseValid = true;
      let leaseRenewing = false;
      let leaseHeartbeat: ReturnType<typeof setInterval> | undefined;
      if (options.leaseStore) {
        leaseAcquired = await options.leaseStore.acquire(
          requestId,
          workerId,
          now(),
          leaseTtlMs,
        );
        if (!leaseAcquired) {
          await refreshPersistedJobs();
          return localQueueStatus(requireJob(jobs, requestId));
        }
        leaseHeartbeat = setInterval(() => {
          if (leaseRenewing || !leaseValid) return;
          leaseRenewing = true;
          void options.leaseStore?.renew(requestId, workerId, now(), leaseTtlMs)
            .then((renewed) => { leaseValid = renewed; })
            .catch(() => { leaseValid = false; })
            .finally(() => { leaseRenewing = false; });
        }, Math.max(25, Math.floor(leaseTtlMs / 3)));
        (leaseHeartbeat as { unref?: () => void }).unref?.();
      }

      try {
        const assertLeaseValid = () => {
          if (!leaseValid) {
            throw new FalServiceError(
              'Fal 任务已由其他实例接管',
              'FAL_JOB_BUSY',
              409,
            );
          }
        };
        await refreshPersistedJobs();
        await ensureConfigured();
        const job = requireJob(jobs, requestId);
        if (job.canceled) return { status: 'completed', logs: [], progress: 94 };
        const currentChildren = activeChildren(job);
        const logs: string[] = [];

        try {
        for (const child of currentChildren) {
          if (child.status === 'completed') continue;
          const upstream = await options.adapter.status(child.modelId, {
            requestId: child.requestId,
            logs: true,
          });
          assertLeaseValid();
          child.status = statusLabel(upstream.status);
          logs.push(...(upstream.logs ?? []).map((log) => log.message).filter(Boolean));
        }

        const currentComplete = currentChildren.every((child) => child.status === 'completed');
        if (
          job.profileId === 'light'
          && Boolean(job.plan.directionalLight)
          && currentComplete
          && !job.directionalLightFinalStarted
        ) {
          const structureChild = currentChildren[0];
          const upstream = await options.adapter.result(structureChild.modelId, {
            requestId: structureChild.requestId,
          });
          assertLeaseValid();
          if (!upstream.data || typeof upstream.data !== 'object') {
            throw new FalServiceError(
              '定向光结构解析未生成可用结果',
              'FAL_EMPTY_LIGHT_STRUCTURE',
              502,
            );
          }

          let invocations;
          try {
            let recoveryPlan = job.plan;
            if (!job.plan.directionalLight?.sourceImageUrl && options.payloadStore) {
              const payload = await options.payloadStore.load(job.id);
              if (payload?.directionalLightSourceImageUrl && job.plan.directionalLight) {
                recoveryPlan = {
                  ...job.plan,
                  directionalLight: {
                    ...job.plan.directionalLight,
                    sourceImageUrl: payload.directionalLightSourceImageUrl,
                  },
                };
              }
            }
            invocations = buildDirectionalLightInvocations(
              recoveryPlan,
              upstream.data as Record<string, unknown>,
            );
          } catch (error) {
            throw new FalServiceError(
              error instanceof Error ? error.message : '定向光源图已失效，请重试任务',
              'FAL_LIGHT_RETRY_REQUIRED',
              409,
            );
          }

          const finalChildren: LocalFalChild[] = [];
          try {
            for (const invocation of invocations) {
              finalChildren.push(await submitInvocation(invocation.modelId, invocation.input));
            }
          } catch {
            await Promise.allSettled(finalChildren.map((child) => options.adapter.cancel(
              child.modelId,
              { requestId: child.requestId },
            )));
            throw new FalServiceError('定向光出图提交失败，请重试', 'FAL_LIGHT_SUBMIT_FAILED', 502);
          }
          job.children.push(...finalChildren);
          job.directionalLightFinalStarted = true;
          await persist(job);
          await options.payloadStore?.delete(job.id).catch(() => undefined);
          return { status: 'queued', logs, progress: 35 };
        }

        const factors = job.plan.upscaleFactors ?? [];
        if (
          job.profileId === 'upscale'
          && currentComplete
          && job.nextUpscaleFactorIndex < factors.length
        ) {
          const current = currentChildren[0];
          const upstream = await options.adapter.result(current.modelId, {
            requestId: current.requestId,
          });
          assertLeaseValid();
          const intermediate = normalizeFalResult(upstream.data).images[0];
          if (!intermediate) {
            throw new FalServiceError('超分中间阶段未生成可用结果', 'FAL_EMPTY_RESULT', 502);
          }
          const invocation = buildNextUpscaleInvocation(
            intermediate.url,
            factors[job.nextUpscaleFactorIndex],
            job.request.parameters,
          );
          job.children.push(await submitInvocation(invocation.modelId, invocation.input));
          job.nextUpscaleFactorIndex += 1;
          await persist(job);
          return {
            status: 'queued',
            logs,
            progress: Math.round((job.nextUpscaleFactorIndex - 1) / factors.length * 100),
          };
        }

        const statuses = currentChildren.map((child) => child.status);
        const status = statuses.every((value) => value === 'completed')
          ? 'completed'
          : statuses.some((value) => value === 'running')
            ? 'running'
            : 'queued';
        await persist(job);
        return {
          status,
          logs,
          progress: aggregateProgress(currentChildren),
        };
        } catch (error) {
          if (error instanceof FalServiceError) throw error;
          throw new FalServiceError('Fal 任务状态查询失败', 'FAL_STATUS_FAILED', 502);
        }
      } finally {
        if (leaseHeartbeat) clearInterval(leaseHeartbeat);
        if (leaseAcquired) {
          await options.leaseStore?.release(requestId, workerId).catch(() => undefined);
        }
      }
    },

    async listRecoverableJobs(): Promise<string[]> {
      await ensureHydrated();
      await refreshPersistedJobs();
      return Array.from(jobs.values())
        .filter(isRecoverableJob)
        .map((job) => job.id)
        .sort();
    },

    async listBillingPendingJobs(): Promise<string[]> {
      await ensureHydrated();
      await refreshPersistedJobs();
      if (!options.billingAdapter) return [];
      return Array.from(jobs.values())
        .filter((job) => (
          !isRecoverableJob(job)
          && billingReconciliationDue(job)
        ))
        .map((job) => job.id)
        .sort();
    },

    async reconcileBilling(requestId: string): Promise<FalBillingReconciliation['status']> {
      await ensureHydrated();
      await refreshPersistedJobs();
      const job = requireJob(jobs, requestId);
      if (isRecoverableJob(job) || !options.billingAdapter) return 'pending';
      await reconcileProviderBilling(job);
      return job.providerBilling?.status ?? 'pending';
    },

    async result(requestId: string): Promise<FalToolResult> {
      await ensureHydrated();
      await ensureConfigured();
      const job = requireJob(jobs, requestId);
      const resultChildren = job.profileId === 'upscale'
        ? job.children.slice(-1)
        : job.profileId === 'light' && job.directionalLightFinalStarted
          ? job.children.slice(1)
          : job.children;
      const settled = await Promise.allSettled(resultChildren.map(async (child) => {
        const upstream = await options.adapter.result(child.modelId, { requestId: child.requestId });
        return normalizeFalResult(upstream.data);
      }));
      const successful = settled
        .filter((item): item is PromiseFulfilledResult<NormalizedFalResult> => item.status === 'fulfilled')
        .map((item) => item.value);
      const images = applyExpectedImageSize(
        job,
        successful.flatMap((item) => item.images),
      );
      if (images.length === 0) {
        const rejected = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
        if (rejected) {
          throw new FalServiceError(
            falResultFailureMessage(rejected.reason),
            'FAL_RESULT_FAILED',
            502,
          );
        }
        throw new FalServiceError('任务未生成可用结果', 'FAL_EMPTY_RESULT', 502);
      }
      const seed = successful.find((item) => item.seed !== undefined)?.seed;
      await reconcileProviderBilling(job);
      return {
        images,
        ...(seed !== undefined ? { seed } : {}),
        modelId: job.modelId,
        childRequestIds: job.children.map((child) => child.requestId),
      };
    },

    async cancel(
      requestId: string,
      actor?: string,
      canCancelAny = true,
    ): Promise<void> {
      await ensureHydrated();
      let leaseAcquired = false;
      if (options.leaseStore) {
        leaseAcquired = await options.leaseStore.acquire(
          requestId,
          workerId,
          now(),
          leaseTtlMs,
        );
        if (!leaseAcquired) {
          throw new FalServiceError('任务正在由其他实例更新，请重试', 'FAL_JOB_BUSY', 409);
        }
      }
      try {
        await refreshPersistedJobs();
        const job = requireJob(jobs, requestId);
        if (actor && !canCancelAny && job.createdBy !== actor) {
          throw new FalServiceError(
            '只能取消自己创建的任务',
            'FAL_JOB_FORBIDDEN',
            403,
          );
        }
        await ensureConfigured();
        job.canceled = true;
        await Promise.allSettled(job.children.map((child) => options.adapter.cancel(child.modelId, {
          requestId: child.requestId,
        })));
        await persist(job);
        await options.payloadStore?.delete(job.id).catch(() => undefined);
      } finally {
        if (leaseAcquired) {
          await options.leaseStore?.release(requestId, workerId).catch(() => undefined);
        }
      }
    },
  };
}

export type FalQueueService = ReturnType<typeof createFalQueueService>;
