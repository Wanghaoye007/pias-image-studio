import { describe, expect, it, vi } from 'vitest';
import {
  cancelFalImageJob,
  FAL_LIFECYCLE_ABORT_REASON,
  prepareImageUrlForFal,
  resumeFalImageJob,
  runFalImageJob,
} from '../src/client/fal/falImageClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Fal 通用浏览器客户端', () => {
  it('取消接口失败时向工作台返回服务端错误，不伪装成已取消', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'FAL_CANCEL_FAILED', message: '供应商未确认取消，请稍后重试' },
    }, 502));

    await expect(cancelFalImageJob('fal-local-cancel-failed', fetcher))
      .rejects.toThrow('供应商未确认取消，请稍后重试');
  });

  it('保留公网 HTTPS，读取同源图片并转换为 Data URI', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      new Uint8Array([137, 80, 78, 71]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    ));

    await expect(prepareImageUrlForFal('https://cdn.example.com/source.png', fetcher))
      .resolves.toBe('https://cdn.example.com/source.png');
    const prepared = await prepareImageUrlForFal('/demo-assets/source.png', fetcher);
    expect(prepared).toMatch(/^data:image\/png;base64,/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('按顺序准备源图、参考图和蒙版并轮询统一接口', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let statusCount = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.startsWith('/demo-assets/')) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      if (url === '/api/fal/jobs' && init?.method === 'POST') {
        return jsonResponse({ requestId: 'fal-local-1', modelId: 'fal-ai/bria/product-shot' }, 202);
      }
      if (url.endsWith('/status')) {
        statusCount += 1;
        return jsonResponse(statusCount === 1
          ? { status: 'running', logs: [], progress: 58 }
          : { status: 'completed', logs: [], progress: 94 });
      }
      if (url.endsWith('/result')) {
        return jsonResponse({
          images: [{ url: 'https://fal.media/result.png', width: 1024, height: 1280 }],
          seed: 9,
          modelId: 'fal-ai/bria/product-shot',
          childRequestIds: ['upstream-1'],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const progress: number[] = [];
    const execution: Array<{ requestId: string; modelId: string }> = [];

    await expect(runFalImageJob({
      profileId: 'blend',
      imageUrls: ['/demo-assets/product.png', '/demo-assets/scene.png'],
      maskImageUrl: 'data:image/png;base64,TUFTSw==',
      prompt: '',
      ratio: '4:5',
      outputCount: 2,
      parameters: {},
      sourceWidth: 512,
      sourceHeight: 512,
    }, {
      fetcher,
      pollIntervalMs: 0,
      onExecution: (value) => execution.push(value),
      onProgress: (value) => progress.push(value),
    })).resolves.toEqual({
      images: [{ url: 'https://fal.media/result.png', width: 1024, height: 1280 }],
      seed: 9,
      modelId: 'fal-ai/bria/product-shot',
      childRequestIds: ['upstream-1'],
    });

    const submission = requests.find((item) => item.url === '/api/fal/jobs');
    expect(JSON.parse(String(submission?.init?.body))).toEqual(expect.objectContaining({
      profileId: 'blend',
      imageUrls: [
        expect.stringMatching(/^data:image\/png;base64,/),
        expect.stringMatching(/^data:image\/png;base64,/),
      ],
      maskImageUrl: 'data:image/png;base64,TUFTSw==',
    }));
    expect(execution).toEqual([{
      requestId: 'fal-local-1',
      modelId: 'fal-ai/bria/product-shot',
    }]);
    expect(progress).toEqual([24, 58, 94]);
  });

  it('中止已提交任务时请求服务端取消', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/fal/jobs') {
        return jsonResponse({ requestId: 'fal-local-cancel', modelId: 'model' }, 202);
      }
      if (url.endsWith('/status')) {
        controller.abort();
        throw new DOMException('任务已取消', 'AbortError');
      }
      if (init?.method === 'DELETE') return jsonResponse({ canceled: true });
      throw new Error(`unexpected ${url}`);
    });

    await expect(runFalImageJob({
      profileId: 'extract',
      imageUrls: ['data:image/png;base64,AA=='],
      prompt: '',
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    }, { fetcher, signal: controller.signal, pollIntervalMs: 0 })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await Promise.resolve();
    expect(calls).toContain('DELETE /api/fal/jobs/fal-local-cancel');
  });

  it('页面卸载只停止本页轮询，不取消可恢复的远端任务', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/fal/jobs') {
        return jsonResponse({ requestId: 'fal-local-resumable', modelId: 'model' }, 202);
      }
      if (url.endsWith('/status')) {
        controller.abort(FAL_LIFECYCLE_ABORT_REASON);
        throw new DOMException('页面已卸载', 'AbortError');
      }
      if (init?.method === 'DELETE') return jsonResponse({ canceled: true });
      throw new Error(`unexpected ${url}`);
    });

    await expect(runFalImageJob({
      profileId: 'extract',
      imageUrls: ['data:image/png;base64,AA=='],
      prompt: '',
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    }, { fetcher, signal: controller.signal, pollIntervalMs: 0 })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await Promise.resolve();
    expect(calls).not.toContain('DELETE /api/fal/jobs/fal-local-resumable');
  });

  it('页面恢复时只轮询已存在的 Fal 请求，不重复提交或上传输入', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const progress: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/status')) {
        return jsonResponse({ status: 'completed', logs: [], progress: 94 });
      }
      if (url.endsWith('/result')) {
        return jsonResponse({
          images: [{ url: 'https://fal.media/resumed.png', width: 2048, height: 2048 }],
          modelId: 'fal-ai/topaz/upscale/image',
          childRequestIds: ['upstream-existing'],
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(resumeFalImageJob({
      requestId: 'fal-local-existing',
      modelId: 'fal-ai/topaz/upscale/image',
    }, {
      fetcher,
      pollIntervalMs: 0,
      onProgress: (value) => progress.push(value),
    })).resolves.toEqual({
      images: [{ url: 'https://fal.media/resumed.png', width: 2048, height: 2048 }],
      modelId: 'fal-ai/topaz/upscale/image',
      childRequestIds: ['upstream-existing'],
    });

    expect(calls).toEqual([
      { url: '/api/fal/jobs/fal-local-existing/status', method: 'GET' },
      { url: '/api/fal/jobs/fal-local-existing/result', method: 'GET' },
    ]);
    expect(progress).toEqual([94]);
  });

  it('把服务端安全错误原样显示为中文', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'FAL_INVALID_INPUT', message: '去除任务必须先绘制有效蒙版' },
    }, 400));

    await expect(runFalImageJob({
      profileId: 'remove',
      imageUrls: ['data:image/png;base64,AA=='],
      prompt: '',
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    }, { fetcher })).rejects.toThrow('去除任务必须先绘制有效蒙版');
  });
});
