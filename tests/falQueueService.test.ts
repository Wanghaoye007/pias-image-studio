import { describe, expect, it, vi } from 'vitest';
import {
  createFalQueueService,
  type FalQueueAdapter,
  type FalQueuePersistence,
  type PersistedFalJob,
} from '../src/fal/falQueueService';
import type { FalToolRequest } from '../src/fal/toolWorkflows';

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
      images: [{ url: 'https://fal.media/upstream-2.png', contentType: 'image/png' }],
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
});
