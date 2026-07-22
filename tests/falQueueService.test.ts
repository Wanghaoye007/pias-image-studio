import { describe, expect, it, vi } from 'vitest';
import {
  createFalQueueService,
  type FalJobLeaseStore,
  type FalJobPayloadStore,
  type FalQueueAdapter,
  type FalQueuePersistence,
  type PersistedFalJob,
} from '../src/worker/fal/falQueueService';
import type { FalToolRequest } from '../src/shared/fal/toolWorkflows';

function request(overrides: Partial<FalToolRequest> = {}): FalToolRequest {
  return {
    profileId: 'generate',
    imageUrls: ['source-image'],
    prompt: '',
    ratio: '1:1',
    outputCount: 1,
    parameters: {},
    sourceWidth: 512,
    sourceHeight: 512,
    ...overrides,
  };
}

function createAdapter(): FalQueueAdapter {
  let requestIndex = 0;
  return {
    config: vi.fn(),
    submit: vi.fn().mockImplementation(async () => ({ request_id: `upstream-${++requestIndex}` })),
    status: vi.fn().mockResolvedValue({ status: 'COMPLETED', logs: [] }),
    result: vi.fn().mockResolvedValue({
      data: { images: [{ url: 'https://fal.media/result.png', width: 1024, height: 1024 }], seed: 33 },
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Fal 统一作业编排器', () => {
  it('cancels submitted upstream work when durable job persistence fails', async () => {
    const adapter = createAdapter();
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-persist-failed',
      persistence: {
        load: vi.fn(async () => []),
        save: vi.fn(async () => { throw new Error('disk full'); }),
      },
    });

    await expect(service.submit(request())).rejects.toMatchObject({
      code: 'FAL_PERSIST_FAILED',
      statusCode: 503,
    });
    expect(adapter.cancel).toHaveBeenCalledWith('fal-ai/bria/product-shot', {
      requestId: 'upstream-1',
    });
  });

  it('renews the job lease while an upstream status request is still running', async () => {
    vi.useFakeTimers();
    try {
      let now = 1_000;
      let resolveStatus!: (value: { status: 'COMPLETED'; logs: [] }) => void;
      const pendingStatus = new Promise<{ status: 'COMPLETED'; logs: [] }>((resolve) => {
        resolveStatus = resolve;
      });
      const adapter = createAdapter();
      vi.mocked(adapter.status).mockReturnValue(pendingStatus);
      const leaseStore: FalJobLeaseStore = {
        acquire: vi.fn(async () => true),
        renew: vi.fn(async () => true),
        release: vi.fn(async () => undefined),
      };
      const service = createFalQueueService({
        adapter,
        readKey: async () => 'id:secret',
        persistence: {
          load: vi.fn(async () => [persistedQueuedJob('fal-local-slow')]),
          save: vi.fn(async () => undefined),
        },
        leaseStore,
        leaseTtlMs: 300,
        workerId: 'worker-slow',
        now: () => now,
      });

      const status = service.status('fal-local-slow');
      await vi.advanceTimersByTimeAsync(0);
      expect(adapter.status).toHaveBeenCalledOnce();
      now = 1_100;
      await vi.advanceTimersByTimeAsync(100);
      expect(leaseStore.renew).toHaveBeenCalledWith(
        'fal-local-slow',
        'worker-slow',
        1_100,
        300,
      );

      resolveStatus({ status: 'COMPLETED', logs: [] });
      await expect(status).resolves.toMatchObject({ status: 'completed' });
      expect(leaseStore.release).toHaveBeenCalledWith('fal-local-slow', 'worker-slow');
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists the trusted creator and rejects another creator canceling the job', async () => {
    let storedJobs: PersistedFalJob[] = [];
    const adapter = createAdapter();
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-owned',
      persistence: {
        load: vi.fn(async () => structuredClone(storedJobs)),
        save: vi.fn(async (jobs) => { storedJobs = structuredClone(jobs); }),
      },
    });

    await service.submit(request(), 'user-creator-a');
    expect(storedJobs[0].createdBy).toBe('user-creator-a');
    await expect(service.cancel('fal-local-owned', 'user-creator-b', false)).rejects.toMatchObject({
      code: 'FAL_JOB_FORBIDDEN',
      statusCode: 403,
    });
    await expect(service.cancel('fal-local-owned', 'user-creator-a', false)).resolves.toBeUndefined();
  });

  it('恢复旧版定向光任务时不误触发新的结构化阶段', async () => {
    const legacyJob: PersistedFalJob = {
      id: 'fal-local-legacy-light',
      profileId: 'light',
      modelId: 'bria/fibo-edit/relight',
      request: request({ profileId: 'light', imageUrls: [] }),
      plan: { modelId: 'bria/fibo-edit/relight', invocations: [] },
      children: [{
        modelId: 'bria/fibo-edit/relight',
        requestId: 'legacy-upstream-1',
        status: 'completed',
      }],
      nextUpscaleFactorIndex: 1,
      canceled: false,
    };
    const adapter = createAdapter();
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      persistence: {
        load: vi.fn(async () => [legacyJob]),
        save: vi.fn(async () => undefined),
      },
    });

    await expect(service.status('fal-local-legacy-light')).resolves.toEqual({
      status: 'completed',
      logs: [],
      progress: 94,
    });
    expect(adapter.result).not.toHaveBeenCalled();
    expect(adapter.submit).not.toHaveBeenCalled();
  });

  it('服务重启后从轻量快照恢复上游任务并继续查询', async () => {
    let storedJobs: PersistedFalJob[] = [];
    const persistence: FalQueuePersistence = {
      load: vi.fn(async () => structuredClone(storedJobs)),
      save: vi.fn(async (jobs) => { storedJobs = structuredClone(jobs); }),
    };
    const firstAdapter = createAdapter();
    const firstService = createFalQueueService({
      adapter: firstAdapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-resumable',
      persistence,
    });

    await firstService.submit(request({
      profileId: 'angle',
      imageUrls: ['data:image/png;base64,PRIVATE_IMAGE'],
      parameters: { horizontalAngle: -45, verticalView: -0.7 },
    }));
    expect(storedJobs[0].request.imageUrls).toEqual([]);
    expect(storedJobs[0].plan.invocations).toEqual([]);

    const resumedAdapter = createAdapter();
    const resumedService = createFalQueueService({
      adapter: resumedAdapter,
      readKey: async () => 'id:secret',
      persistence,
    });

    await expect(resumedService.status('fal-local-resumable')).resolves.toEqual({
      status: 'completed',
      logs: [],
      progress: 94,
    });
    expect(resumedAdapter.submit).not.toHaveBeenCalled();
    expect(resumedAdapter.status).toHaveBeenCalledWith(
      'fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles',
      { requestId: 'upstream-1', logs: true },
    );
  });

  it('服务重启后用隔离恢复载荷继续定向光最终阶段并清理源图', async () => {
    let storedJobs: PersistedFalJob[] = [];
    const payloads = new Map<string, { directionalLightSourceImageUrl?: string }>();
    const persistence: FalQueuePersistence = {
      load: vi.fn(async () => structuredClone(storedJobs)),
      save: vi.fn(async (jobs) => { storedJobs = structuredClone(jobs); }),
    };
    const payloadStore: FalJobPayloadStore = {
      load: vi.fn(async (jobId) => structuredClone(payloads.get(jobId))),
      save: vi.fn(async (jobId, payload) => { payloads.set(jobId, structuredClone(payload)); }),
      delete: vi.fn(async (jobId) => { payloads.delete(jobId); }),
    };
    const firstAdapter = createAdapter();
    const firstService = createFalQueueService({
      adapter: firstAdapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-light-recover',
      persistence,
      payloadStore,
    });
    await firstService.submit(request({
      profileId: 'light',
      imageUrls: ['data:image/png;base64,PRIVATE_LIGHT_SOURCE'],
      parameters: { lightDirection: 'top-left' },
    }));
    expect(storedJobs[0].plan.directionalLight?.sourceImageUrl).toBe('');
    expect(payloads.get('fal-local-light-recover')).toEqual({
      directionalLightSourceImageUrl: 'data:image/png;base64,PRIVATE_LIGHT_SOURCE',
    });

    const resumedAdapter = createAdapter();
    vi.mocked(resumedAdapter.result).mockResolvedValueOnce({
      data: {
        objects: [{ description: 'cosmetic bottle' }],
        lighting: { direction: 'top-left' },
        text_render: [],
      },
    });
    const resumedService = createFalQueueService({
      adapter: resumedAdapter,
      readKey: async () => 'id:secret',
      persistence,
      payloadStore,
    });

    await expect(resumedService.status('fal-local-light-recover')).resolves.toMatchObject({
      status: 'queued',
    });
    expect(resumedAdapter.submit).toHaveBeenCalledWith(
      'bria/fibo-edit/edit',
      expect.objectContaining({
        input: expect.objectContaining({
          image_url: 'data:image/png;base64,PRIVATE_LIGHT_SOURCE',
        }),
      }),
    );
    expect(payloadStore.delete).toHaveBeenCalledWith('fal-local-light-recover');
    expect(payloads.has('fal-local-light-recover')).toBe(false);
  });

  it('只在服务端配置凭证，并为原生多结果模型提交一个请求', async () => {
    const adapter = createAdapter();
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-1',
    });

    await expect(service.submit(request({ outputCount: 4 }))).resolves.toEqual({
      requestId: 'fal-local-1',
      modelId: 'fal-ai/bria/product-shot',
    });
    expect(adapter.config).toHaveBeenCalledWith({ credentials: 'id:secret' });
    expect(adapter.submit).toHaveBeenCalledTimes(1);
    expect(adapter.submit).toHaveBeenCalledWith('fal-ai/bria/product-shot', {
      input: expect.objectContaining({ num_results: 4 }),
    });
  });

  it('persists private provider billing without exposing it in the public result', async () => {
    let storedJobs: PersistedFalJob[] = [];
    const billingAdapter = {
      lookup: vi.fn(async () => ({
        status: 'confirmed' as const,
        events: [{
          requestId: 'upstream-1',
          endpointId: 'fal-ai/bria/product-shot',
          timestamp: '2026-07-22T00:00:00Z',
          outputUnits: 1,
          unitPrice: 0.02,
          percentDiscount: null,
          costNanoUsd: 20_000_000,
        }],
        totalCostNanoUsd: 20_000_000,
        currency: 'USD' as const,
        checkedAt: '2026-07-22T00:01:00Z',
      })),
    };
    const service = createFalQueueService({
      adapter: createAdapter(),
      billingAdapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-billing',
      persistence: {
        load: vi.fn(async () => structuredClone(storedJobs)),
        save: vi.fn(async (jobs) => { storedJobs = structuredClone(jobs); }),
      },
    });
    await service.submit(request());
    await service.status('fal-local-billing');

    const result = await service.result('fal-local-billing');

    expect(billingAdapter.lookup).toHaveBeenCalledWith(['upstream-1']);
    expect(result).not.toHaveProperty('providerBilling');
    expect(storedJobs[0].providerBilling).toMatchObject({
      status: 'confirmed',
      totalCostNanoUsd: 20_000_000,
    });
  });

  it('retries unavailable provider billing after the reconciliation cooldown', async () => {
    let storedJobs: PersistedFalJob[] = [{
      ...persistedQueuedJob('fal-local-billing-retry'),
      children: [{
        modelId: 'fal-ai/bria/product-shot',
        requestId: 'upstream-1',
        status: 'completed',
      }],
      providerBilling: {
        status: 'unavailable',
        events: [],
        totalCostNanoUsd: 0,
        currency: 'USD',
        checkedAt: '2026-07-22T00:00:00.000Z',
        reason: 'admin_key_missing',
      },
    }];
    const billingAdapter = {
      lookup: vi.fn(async () => ({
        status: 'confirmed' as const,
        events: [],
        totalCostNanoUsd: 0,
        currency: 'USD' as const,
        checkedAt: '2026-07-22T00:10:00.000Z',
      })),
    };
    const service = createFalQueueService({
      adapter: createAdapter(),
      billingAdapter,
      readKey: async () => 'id:secret',
      persistence: {
        load: vi.fn(async () => structuredClone(storedJobs)),
        save: vi.fn(async (jobs) => { storedJobs = structuredClone(jobs); }),
      },
      now: () => Date.parse('2026-07-22T00:10:00.000Z'),
      billingRetryIntervalMs: 5 * 60_000,
    });

    await expect(service.listBillingPendingJobs()).resolves.toEqual(['fal-local-billing-retry']);
    await expect(service.reconcileBilling('fal-local-billing-retry')).resolves.toBe('confirmed');
    expect(billingAdapter.lookup).toHaveBeenCalledWith(['upstream-1']);
    expect(storedJobs[0].providerBilling?.status).toBe('confirmed');
  });

  it('定向光先解析完整画面结构，再扇出最终出图并聚合结果', async () => {
    const adapter = createAdapter();
    vi.mocked(adapter.result).mockImplementation(async (_modelId, options) => options.requestId === 'upstream-1'
      ? {
          data: {
            objects: [{ description: 'blank cosmetic bottle' }],
            lighting: { direction: 'upper-left', shadows: 'lower-right' },
            text_render: [],
          },
        }
      : {
          data: { image: { url: `https://fal.media/${options.requestId}.png` } },
        });
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-light',
    });
    await service.submit(request({
      profileId: 'light',
      outputCount: 4,
      parameters: { lightDirection: 'top-left' },
    }));

    expect(adapter.submit).toHaveBeenCalledTimes(1);
    expect(adapter.submit).toHaveBeenLastCalledWith(
      'bria/fibo-edit/edit/structured_instruction',
      { input: expect.objectContaining({ image_url: 'source-image' }) },
    );
    await expect(service.status('fal-local-light')).resolves.toEqual({
      status: 'queued',
      logs: [],
      progress: 35,
    });
    expect(adapter.submit).toHaveBeenCalledTimes(5);
    expect(adapter.submit).toHaveBeenNthCalledWith(2, 'bria/fibo-edit/edit', {
      input: expect.objectContaining({
        structured_instruction: expect.objectContaining({ text_render: [] }),
        seed: 5555,
      }),
    });

    await expect(service.status('fal-local-light')).resolves.toEqual({
      status: 'completed',
      logs: [],
      progress: 94,
    });
    await expect(service.result('fal-local-light')).resolves.toEqual({
      images: [
        { url: 'https://fal.media/upstream-2.png' },
        { url: 'https://fal.media/upstream-3.png' },
        { url: 'https://fal.media/upstream-4.png' },
        { url: 'https://fal.media/upstream-5.png' },
      ],
      modelId: 'bria/fibo-edit/edit',
      childRequestIds: ['upstream-1', 'upstream-2', 'upstream-3', 'upstream-4', 'upstream-5'],
    });
  });

  it('返回部分成功图片并保留全部上游请求 ID', async () => {
    const adapter = createAdapter();
    vi.mocked(adapter.result).mockImplementation(async (_modelId, options) => {
      if (options.requestId === 'upstream-2') throw new Error('temporary upstream failure');
      return {
        data: {
          image: {
            url: `https://fal.media/${options.requestId}.png`,
            content_type: 'image/png',
          },
        },
      };
    });
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-expand',
    });
    await service.submit(request({
      profileId: 'expand',
      outputCount: 2,
      ratio: '16:9',
      parameters: { expandScale: 60 },
    }));

    await expect(service.result('fal-local-expand')).resolves.toEqual({
      images: [{
        url: 'https://fal.media/upstream-1.png',
        contentType: 'image/png',
      }],
      modelId: 'fal-ai/bria/expand',
      childRequestIds: ['upstream-1', 'upstream-2'],
    });
  });

  it('在全部结果失败时透传可操作的 Fal 参数错误', async () => {
    const adapter = createAdapter();
    vi.mocked(adapter.result).mockRejectedValue({
      name: 'ValidationError',
      message: 'Unprocessable Entity',
      status: 422,
      body: {
        detail: [{
          loc: ['body', 'rotate_right_left'],
          msg: 'Input should be greater than or equal to -90',
          input: -111,
        }],
      },
    });
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-invalid-angle',
    });
    await service.submit(request({ profileId: 'angle' }));

    await expect(service.result('fal-local-invalid-angle'))
      .rejects.toThrow('水平旋转仅支持 -90° 到 90°');
  });

  it('取消本地作业时取消全部未终止子请求', async () => {
    const adapter = createAdapter();
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-light',
    });
    await service.submit(request({ profileId: 'light', outputCount: 2 }));

    await service.cancel('fal-local-light');
    expect(adapter.cancel).toHaveBeenCalledTimes(1);
    expect(adapter.cancel).toHaveBeenCalledWith('bria/fibo-edit/edit/structured_instruction', {
      requestId: 'upstream-1',
    });
  });

  it('在超分首段完成后用其结果自动提交下一段', async () => {
    const adapter = createAdapter();
    vi.mocked(adapter.result).mockImplementation(async (_modelId, options) => ({
      data: {
        image: {
          url: `https://fal.media/${options.requestId}.png`,
          content_type: 'image/png',
        },
      },
    }));
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-upscale',
    });
    await service.submit(request({
      profileId: 'upscale',
      parameters: { upscaleSize: '8192', detailLevel: 60 },
    }));

    await expect(service.status('fal-local-upscale')).resolves.toEqual({
      status: 'queued',
      logs: [],
      progress: 50,
    });
    expect(adapter.submit).toHaveBeenCalledTimes(2);
    expect(adapter.submit).toHaveBeenLastCalledWith('fal-ai/topaz/upscale/image', {
      input: expect.objectContaining({
        image_url: 'https://fal.media/upstream-1.png',
        upscale_factor: 4,
      }),
    });

    await expect(service.status('fal-local-upscale')).resolves.toEqual({
      status: 'completed',
      logs: [],
      progress: 94,
    });
    await expect(service.result('fal-local-upscale')).resolves.toEqual({
      images: [{
        url: 'https://fal.media/upstream-2.png',
        contentType: 'image/png',
        width: 8192,
        height: 8192,
      }],
      modelId: 'fal-ai/topaz/upscale/image',
      childRequestIds: ['upstream-1', 'upstream-2'],
    });
  });

  it('把输入和上游错误转换为不泄露凭证的中文错误', async () => {
    const adapter = createAdapter();
    const service = createFalQueueService({ adapter, readKey: async () => 'id:secret' });
    await expect(service.submit(request({ profileId: 'remove' }))).rejects.toThrow('蒙版');

    vi.mocked(adapter.submit).mockRejectedValue(new Error('Authorization id:secret failed'));
    await expect(service.submit(request())).rejects.toThrow('Fal 任务提交失败');
  });

  it('routes persistence failures through the operational error hook', async () => {
    const onOperationalError = vi.fn();
    const service = createFalQueueService({
      adapter: createAdapter(),
      readKey: async () => 'id:secret',
      persistence: {
        load: vi.fn()
          .mockRejectedValueOnce(new Error('database path must-not-be-logged'))
          .mockResolvedValue([]),
        save: vi.fn(async () => undefined),
      },
      onOperationalError,
    });

    await expect(service.submit(request())).resolves.toMatchObject({
      requestId: expect.any(String),
    });
    expect(onOperationalError).toHaveBeenCalledWith(
      'content_studio_fal_queue_hydration_failed',
      expect.any(Error),
    );
  });
});

function persistedQueuedJob(id: string): PersistedFalJob {
  return {
    id,
    profileId: 'generate',
    modelId: 'fal-ai/bria/product-shot',
    request: request({ imageUrls: [] }),
    plan: { modelId: 'fal-ai/bria/product-shot', invocations: [] },
    children: [{
      modelId: 'fal-ai/bria/product-shot',
      requestId: 'upstream-slow',
      status: 'queued',
    }],
    nextUpscaleFactorIndex: 1,
    directionalLightFinalStarted: false,
    canceled: false,
  };
}
