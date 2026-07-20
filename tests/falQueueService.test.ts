import { describe, expect, it, vi } from 'vitest';
import {
  createFalQueueService,
  type FalQueueAdapter,
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

  it('为单结果模型扇出请求并聚合状态与进度', async () => {
    const adapter = createAdapter();
    vi.mocked(adapter.status).mockImplementation(async (_modelId, options) => ({
      status: options.requestId === 'upstream-1'
        ? 'IN_QUEUE'
        : options.requestId === 'upstream-2'
          ? 'IN_PROGRESS'
          : 'COMPLETED',
      logs: options.requestId === 'upstream-2' ? [{ message: 'Rendering' }] : [],
    }));
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

    expect(adapter.submit).toHaveBeenCalledTimes(4);
    await expect(service.status('fal-local-light')).resolves.toEqual({
      status: 'running',
      logs: ['Rendering'],
      progress: 59,
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

  it('取消本地作业时取消全部未终止子请求', async () => {
    const adapter = createAdapter();
    const service = createFalQueueService({
      adapter,
      readKey: async () => 'id:secret',
      createId: () => 'fal-local-light',
    });
    await service.submit(request({ profileId: 'light', outputCount: 2 }));

    await service.cancel('fal-local-light');
    expect(adapter.cancel).toHaveBeenCalledTimes(2);
    expect(adapter.cancel).toHaveBeenNthCalledWith(1, 'bria/fibo-edit/edit', {
      requestId: 'upstream-1',
    });
    expect(adapter.cancel).toHaveBeenNthCalledWith(2, 'bria/fibo-edit/edit', {
      requestId: 'upstream-2',
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
