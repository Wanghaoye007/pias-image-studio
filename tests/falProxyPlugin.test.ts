import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createFalProxyMiddleware } from '../src/fal/falProxyPlugin';
import { FalServiceError, type FalQueueService } from '../src/fal/falQueueService';

async function invoke(
  middleware: ReturnType<typeof createFalProxyMiddleware>,
  method: string,
  url: string,
  body?: unknown,
) {
  const request = new EventEmitter() as IncomingMessage;
  request.method = method;
  request.url = url;
  request.destroy = vi.fn() as never;
  let responseBody = '';
  const headers = new Map<string, string>();
  let resolveResponse: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string) => headers.set(name, value),
    end: (value = '') => {
      responseBody = String(value);
      resolveResponse();
    },
  } as unknown as ServerResponse;
  const next = vi.fn(() => resolveResponse());

  void middleware(request, response, next);
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)));
    request.emit('end');
  });
  await completed;
  return {
    statusCode: response.statusCode,
    headers,
    body: responseBody ? JSON.parse(responseBody) as unknown : undefined,
    next,
  };
}

function createService(): FalQueueService {
  return {
    submit: vi.fn().mockResolvedValue({ requestId: 'fal-local-1', modelId: 'model-1' }),
    status: vi.fn().mockResolvedValue({ status: 'running', logs: [], progress: 55 }),
    result: vi.fn().mockResolvedValue({
      images: [{ url: 'result.png' }],
      modelId: 'model-1',
      childRequestIds: ['upstream-1'],
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  } as unknown as FalQueueService;
}

describe('Fal 统一同源代理', () => {
  it('提交任意图片工具到统一路由', async () => {
    const service = createService();
    const response = await invoke(createFalProxyMiddleware(service), 'POST', '/api/fal/jobs', {
      profileId: 'extract',
      imageUrls: ['data:image/png;base64,AA=='],
      prompt: '',
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({ requestId: 'fal-local-1', modelId: 'model-1' });
    expect(service.submit).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'extract' }));
  });

  it('查询状态、结果并取消本地编排任务', async () => {
    const service = createService();
    const middleware = createFalProxyMiddleware(service);

    await expect(invoke(middleware, 'GET', '/api/fal/jobs/fal-local-1/status'))
      .resolves.toEqual(expect.objectContaining({
        statusCode: 200,
        body: { status: 'running', logs: [], progress: 55 },
      }));
    await expect(invoke(middleware, 'GET', '/api/fal/jobs/fal-local-1/result'))
      .resolves.toEqual(expect.objectContaining({
        statusCode: 200,
        body: expect.objectContaining({ modelId: 'model-1' }),
      }));
    await expect(invoke(middleware, 'DELETE', '/api/fal/jobs/fal-local-1'))
      .resolves.toEqual(expect.objectContaining({
        statusCode: 200,
        body: { canceled: true },
      }));
  });

  it('返回稳定中文错误且不暴露上游内容', async () => {
    const service = createService();
    vi.mocked(service.submit).mockRejectedValue(new FalServiceError(
      'Fal 任务提交失败',
      'FAL_SUBMIT_FAILED',
      502,
    ));
    const response = await invoke(createFalProxyMiddleware(service), 'POST', '/api/fal/jobs', {});

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({
      error: { code: 'FAL_SUBMIT_FAILED', message: 'Fal 任务提交失败' },
    });
  });

  it('非 Fal 路由交给后续中间件', async () => {
    const response = await invoke(createFalProxyMiddleware(createService()), 'GET', '/assets/app.js');
    expect(response.next).toHaveBeenCalled();
  });
});
