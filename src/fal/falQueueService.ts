import { randomUUID } from 'node:crypto';
import type { TaskProfileId } from '../domain';
import { readFalKey } from './falCredentials';
import {
  buildFalWorkflowPlan,
  buildNextUpscaleInvocation,
  normalizeFalResult,
  type FalToolRequest,
  type FalWorkflowPlan,
  type NormalizedFalResult,
} from './toolWorkflows';

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

type ChildStatus = 'queued' | 'running' | 'completed';

type LocalFalChild = {
  modelId: string;
  requestId: string;
  status: ChildStatus;
};

type LocalFalJob = {
  id: string;
  profileId: TaskProfileId;
  modelId: string;
  request: FalToolRequest;
  plan: FalWorkflowPlan;
  children: LocalFalChild[];
  nextUpscaleFactorIndex: number;
  canceled: boolean;
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

export function createFalQueueService(options: {
  adapter: FalQueueAdapter;
  readKey?: () => Promise<string>;
  createId?: () => string;
}) {
  let configured: Promise<void> | undefined;
  const jobs = new Map<string, LocalFalJob>();
  const createId = options.createId ?? (() => `fal-local-${randomUUID()}`);

  const ensureConfigured = () => {
    configured ??= (options.readKey ?? readFalKey)()
      .then((credentials) => options.adapter.config({ credentials }))
      .catch(() => {
        throw new FalServiceError('Fal 服务凭证未配置', 'FAL_CREDENTIALS', 503);
      });
    return configured;
  };

  const submitInvocation = async (
    modelId: string,
    input: Record<string, unknown>,
  ): Promise<LocalFalChild> => {
    const submission = await options.adapter.submit(modelId, { input });
    if (!submission.request_id) throw new Error('missing request id');
    return { modelId, requestId: submission.request_id, status: 'queued' };
  };

  return {
    async submit(request: FalToolRequest): Promise<{ requestId: string; modelId: string }> {
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
      jobs.set(requestId, {
        id: requestId,
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
        canceled: false,
      });
      return { requestId, modelId: plan.modelId };
    },

    async status(requestId: string): Promise<FalQueueStatus> {
      await ensureConfigured();
      const job = requireJob(jobs, requestId);
      if (job.canceled) return { status: 'completed', logs: [], progress: 94 };
      const currentChildren = job.profileId === 'upscale'
        ? job.children.slice(-1)
        : job.children;
      const logs: string[] = [];

      try {
        for (const child of currentChildren) {
          if (child.status === 'completed') continue;
          const upstream = await options.adapter.status(child.modelId, {
            requestId: child.requestId,
            logs: true,
          });
          child.status = statusLabel(upstream.status);
          logs.push(...(upstream.logs ?? []).map((log) => log.message).filter(Boolean));
        }

        const currentComplete = currentChildren.every((child) => child.status === 'completed');
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
        return {
          status,
          logs,
          progress: aggregateProgress(currentChildren),
        };
      } catch (error) {
        if (error instanceof FalServiceError) throw error;
        throw new FalServiceError('Fal 任务状态查询失败', 'FAL_STATUS_FAILED', 502);
      }
    },

    async result(requestId: string): Promise<FalToolResult> {
      await ensureConfigured();
      const job = requireJob(jobs, requestId);
      const resultChildren = job.profileId === 'upscale'
        ? job.children.slice(-1)
        : job.children;
      const settled = await Promise.allSettled(resultChildren.map(async (child) => {
        const upstream = await options.adapter.result(child.modelId, { requestId: child.requestId });
        return normalizeFalResult(upstream.data);
      }));
      const successful = settled
        .filter((item): item is PromiseFulfilledResult<NormalizedFalResult> => item.status === 'fulfilled')
        .map((item) => item.value);
      const images = successful.flatMap((item) => item.images);
      if (images.length === 0) {
        throw new FalServiceError('任务未生成可用结果', 'FAL_EMPTY_RESULT', 502);
      }
      const seed = successful.find((item) => item.seed !== undefined)?.seed;
      return {
        images,
        ...(seed !== undefined ? { seed } : {}),
        modelId: job.modelId,
        childRequestIds: job.children.map((child) => child.requestId),
      };
    },

    async cancel(requestId: string): Promise<void> {
      await ensureConfigured();
      const job = requireJob(jobs, requestId);
      job.canceled = true;
      await Promise.allSettled(job.children.map((child) => options.adapter.cancel(child.modelId, {
        requestId: child.requestId,
      })));
    },
  };
}

export type FalQueueService = ReturnType<typeof createFalQueueService>;
