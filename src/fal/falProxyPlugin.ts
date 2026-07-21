import { fal } from '@fal-ai/client';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  createFalQueueService,
  FalServiceError,
  type FalQueueAdapter,
  type FalQueueService,
} from './falQueueService';
import { createFileFalQueuePersistence } from './falJobPersistence';
import type { FalToolRequest } from './toolWorkflows';

const apiRoot = '/api/fal/jobs';
const maxBodyBytes = 40 * 1024 * 1024;

const falAdapter: FalQueueAdapter = {
  config: (options) => fal.config(options),
  submit: (modelId, options) => fal.queue.submit(modelId, options) as ReturnType<FalQueueAdapter['submit']>,
  status: (modelId, options) => fal.queue.status(modelId, options) as ReturnType<FalQueueAdapter['status']>,
  result: (modelId, options) => fal.queue.result(modelId, options) as ReturnType<FalQueueAdapter['result']>,
  cancel: (modelId, options) => fal.queue.cancel(modelId, options),
};

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new FalServiceError('输入图片超过本地服务限制', 'FAL_BODY_TOO_LARGE', 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new FalServiceError('请求内容不是有效 JSON', 'FAL_INVALID_JSON', 400));
      }
    });
    request.on('error', reject);
  });
}

export function createFalProxyMiddleware(
  service: FalQueueService,
): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith(apiRoot)) {
      next();
      return;
    }

    try {
      if (request.method === 'POST' && url.pathname === apiRoot) {
        writeJson(response, 202, await service.submit(await readJsonBody(request) as FalToolRequest));
        return;
      }

      const statusMatch = url.pathname.match(/^\/api\/fal\/jobs\/([^/]+)\/(status|result)$/);
      if (request.method === 'GET' && statusMatch) {
        const requestId = decodeURIComponent(statusMatch[1]);
        writeJson(response, 200, statusMatch[2] === 'status'
          ? await service.status(requestId)
          : await service.result(requestId));
        return;
      }

      const cancelMatch = url.pathname.match(/^\/api\/fal\/jobs\/([^/]+)$/);
      if (request.method === 'DELETE' && cancelMatch) {
        await service.cancel(decodeURIComponent(cancelMatch[1]));
        writeJson(response, 200, { canceled: true });
        return;
      }

      writeJson(response, 404, { error: { code: 'FAL_ROUTE_NOT_FOUND', message: '接口不存在' } });
    } catch (error) {
      const safeError = error instanceof FalServiceError
        ? error
        : new FalServiceError('Fal 图片服务暂时不可用', 'FAL_PROXY_FAILED', 502);
      writeJson(response, safeError.statusCode, {
        error: { code: safeError.code, message: safeError.message },
      });
    }
  };
}

export function falImageProxyPlugin(): Plugin {
  const service = createFalQueueService({
    adapter: falAdapter,
    persistence: createFileFalQueuePersistence(),
  });
  const middleware = createFalProxyMiddleware(service);
  return {
    name: 'pias-fal-image-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
