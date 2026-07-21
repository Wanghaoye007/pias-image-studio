import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  createFileStudioStatePersistence,
  StudioStateConflictError,
  StudioStateStorageError,
  type StudioStatePersistence,
} from './studioStatePersistence';
import { parseStudioState, StudioStateValidationError } from './studioStateSchema';

const apiPath = '/api/studio/state';
const maxBodyBytes = 5 * 1024 * 1024;

class StudioStateApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'StudioStateApiError';
  }
}

export function createStudioStateMiddleware(
  persistence: StudioStatePersistence,
): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== apiPath) {
      next();
      return;
    }

    try {
      if (request.method === 'GET') {
        const snapshot = await persistence.load();
        if (!snapshot) {
          writeJson(response, 404, {
            error: { code: 'STUDIO_STATE_NOT_FOUND', message: '尚未保存工作台状态' },
          });
          return;
        }
        writeJson(response, 200, snapshot);
        return;
      }

      if (request.method === 'PUT') {
        const body = asRecord(await readJsonBody(request));
        if (body.schemaVersion !== 1) {
          throw new StudioStateApiError('工作台状态版本无效', 'STUDIO_STATE_INVALID', 400);
        }
        if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
          throw new StudioStateApiError('工作台状态 revision 无效', 'STUDIO_STATE_INVALID', 400);
        }
        const state = parseStudioState(body.state);
        const saved = await persistence.save(body.expectedRevision as number, state);
        writeJson(response, 200, {
          schemaVersion: saved.schemaVersion,
          revision: saved.revision,
          updatedAt: saved.updatedAt,
        });
        return;
      }

      writeJson(response, 405, {
        error: { code: 'STUDIO_STATE_METHOD_NOT_ALLOWED', message: '请求方法不受支持' },
      });
    } catch (error) {
      const safeError = normalizeError(error);
      writeJson(response, safeError.statusCode, {
        error: { code: safeError.code, message: safeError.message },
      });
    }
  };
}

export function studioStatePlugin(): Plugin {
  const middleware = createStudioStateMiddleware(createFileStudioStatePersistence());
  return {
    name: 'pias-studio-state',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        settled = true;
        reject(new StudioStateApiError(
          '工作台状态超过 5 MiB 限制',
          'STUDIO_STATE_BODY_TOO_LARGE',
          413,
        ));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new StudioStateApiError(
          '请求内容不是有效 JSON',
          'STUDIO_STATE_INVALID_JSON',
          400,
        ));
      }
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function normalizeError(error: unknown): StudioStateApiError {
  if (error instanceof StudioStateApiError) return error;
  if (error instanceof StudioStateConflictError) {
    return new StudioStateApiError(
      '工作台状态已在其他页面更新',
      'STUDIO_STATE_CONFLICT',
      409,
    );
  }
  if (error instanceof StudioStateValidationError) {
    return new StudioStateApiError(
      '工作台状态内容无效',
      'STUDIO_STATE_INVALID',
      400,
    );
  }
  if (error instanceof StudioStateStorageError) {
    return new StudioStateApiError(
      '工作台状态存储暂不可用',
      'STUDIO_STATE_STORAGE_FAILED',
      500,
    );
  }
  return new StudioStateApiError(
    '工作台状态服务暂不可用',
    'STUDIO_STATE_FAILED',
    500,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StudioStateApiError('请求内容必须是对象', 'STUDIO_STATE_INVALID', 400);
  }
  return value as Record<string, unknown>;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
