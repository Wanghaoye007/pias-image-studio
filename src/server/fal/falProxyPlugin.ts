import { fal } from '@fal-ai/client';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { getRequestAuthContext, getRequestProjectScope } from '../auth/authApiPlugin';
import { authorize } from '../auth/authPolicy';
import { openContentStudioDatabase, type ContentStudioDatabase } from '../persistence/sqliteDatabase';
import { createFalBillingClient } from './falBillingClient';
import {
  createFalQueueService,
  FalServiceError,
  type FalQueueAdapter,
  type FalQueueService,
} from '../../worker/fal/falQueueService';
import {
  createFileFalQueuePersistence,
  createScopedFalQueuePersistence,
} from '../../worker/fal/falJobPersistence';
import { createFalRecoveryWorker } from '../../worker/fal/falRecoveryWorker';
import {
  createSqliteFalJobLeaseStoreForScopeKey,
  createSqliteFalJobPayloadStoreForScopeKey,
  createSqliteFalQueuePersistenceForScopeKey,
  listSqliteFalScopeKeys,
} from '../../worker/fal/falSqlitePersistence';
import type { FalToolRequest } from '../../shared/fal/toolWorkflows';
import {
  type ProductionLogWriter,
  writeProductionLog,
} from '../productionLog';

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
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        settled = true;
        reject(new FalServiceError('输入图片超过本地服务限制', 'FAL_BODY_TOO_LARGE', 413));
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
        reject(new FalServiceError('请求内容不是有效 JSON', 'FAL_INVALID_JSON', 400));
      }
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function createFalProxyMiddleware(
  serviceSource: FalQueueService | ((request: IncomingMessage) => FalQueueService),
  options: { trustedActorFromRequest?: boolean } = {},
): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith(apiRoot)) {
      next();
      return;
    }

    try {
      const service = typeof serviceSource === 'function'
        ? serviceSource(request)
        : serviceSource;
      const context = options.trustedActorFromRequest
        ? getRequestAuthContext(request)
        : null;
      if (request.method === 'POST' && url.pathname === apiRoot) {
        const toolRequest = await readJsonBody(request) as FalToolRequest;
        writeJson(response, 202, await (context
          ? service.submit(toolRequest, context.userId)
          : service.submit(toolRequest)));
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
        const canCancelAny = context
          ? authorize(context, 'job.cancel_any', getRequestProjectScope(request)).allowed
          : true;
        const requestId = decodeURIComponent(cancelMatch[1]);
        if (context) await service.cancel(requestId, context.userId, canCancelAny);
        else await service.cancel(requestId);
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

export function falImageProxyPlugin(options: {
  scoped?: boolean;
  scopedDirectory?: string;
  databaseFile?: string;
  persistenceBackend?: 'sqlite' | 'file';
  workerIntervalMs?: number;
  leaseTtlMs?: number;
  billingRetryIntervalMs?: number;
  adapter?: FalQueueAdapter;
  readKey?: () => Promise<string>;
  logger?: ProductionLogWriter;
} = {}): Plugin {
  const legacyFile = process.env.CONTENT_STUDIO_FAL_JOB_STATE_FILE
    || '/tmp/content-studio/fal-queue-state.json';
  const rootDirectory = options.scopedDirectory
    || process.env.CONTENT_STUDIO_FAL_JOB_STATE_DIR
    || join(dirname(legacyFile), 'fal-queue-scopes');
  const backend = options.persistenceBackend
    ?? (process.env.CONTENT_STUDIO_PERSISTENCE_BACKEND === 'file' ? 'file' : 'sqlite');
  const adapter = options.adapter ?? falAdapter;
  const billingAdapter = createFalBillingClient();
  const leaseTtlMs = options.leaseTtlMs
    ?? readPositiveInteger(process.env.CONTENT_STUDIO_FAL_LEASE_TTL_MS, 15_000);
  const billingRetryIntervalMs = options.billingRetryIntervalMs
    ?? readPositiveInteger(process.env.CONTENT_STUDIO_FAL_BILLING_RETRY_MS, 5 * 60_000);
  const workerId = `content-studio-fal-${process.pid}-${randomUUID()}`;
  const cache = new Map<string, FalQueueService>();
  let database: ContentStudioDatabase | null = null;
  const getDatabase = () => {
    database ??= openContentStudioDatabase(
      options.databaseFile
      || process.env.CONTENT_STUDIO_DATABASE_FILE
      || '/tmp/content-studio/content-studio.sqlite',
    );
    return database;
  };
  const serviceOptions = {
    adapter,
    billingAdapter,
    ...(options.readKey ? { readKey: options.readKey } : {}),
    leaseTtlMs,
    billingRetryIntervalMs,
    workerId,
    onOperationalError: (event: string, error: unknown) => {
      writeProductionLog(options.logger, event, { component: 'fal_queue' }, error);
    },
  };
  const getSqliteService = (scopeKey: string) => {
    let scopedService = cache.get(scopeKey);
    if (!scopedService) {
      const scopedDatabase = getDatabase();
      scopedService = createFalQueueService({
        ...serviceOptions,
        persistence: createSqliteFalQueuePersistenceForScopeKey(scopedDatabase, scopeKey),
        leaseStore: createSqliteFalJobLeaseStoreForScopeKey(scopedDatabase, scopeKey),
        payloadStore: createSqliteFalJobPayloadStoreForScopeKey(scopedDatabase, scopeKey),
      });
      cache.set(scopeKey, scopedService);
    }
    return scopedService;
  };
  const service = options.scoped
    ? backend === 'sqlite'
      ? (request: IncomingMessage) => {
          const scope = getRequestProjectScope(request);
          return getSqliteService(getDatabase().scopeKey(scope));
        }
      : (request: IncomingMessage) => {
          const scope = getRequestProjectScope(request);
          const key = `${scope.tenantId}\0${scope.projectId}`;
          let scopedService = cache.get(key);
          if (!scopedService) {
            scopedService = createFalQueueService({
              ...serviceOptions,
              persistence: createScopedFalQueuePersistence(rootDirectory, scope),
            });
            cache.set(key, scopedService);
          }
          return scopedService;
        }
    : createFalQueueService({
        ...serviceOptions,
        persistence: createFileFalQueuePersistence(legacyFile),
      });
  const middleware = createFalProxyMiddleware(service, {
    trustedActorFromRequest: Boolean(options.scoped),
  });
  const recoveryWorker = createFalRecoveryWorker({
    intervalMs: options.workerIntervalMs
      ?? readPositiveInteger(process.env.CONTENT_STUDIO_FAL_WORKER_INTERVAL_MS, 2_500),
    listServices: () => {
      if (options.scoped && backend === 'sqlite') {
        return listSqliteFalScopeKeys(getDatabase()).map(getSqliteService);
      }
      if (typeof service !== 'function') return [service];
      return Array.from(cache.values());
    },
    onError: (error) => {
      writeProductionLog(
        options.logger,
        'content_studio_fal_recovery_failed',
        { component: 'fal_recovery' },
        error,
      );
    },
  });
  const mount = (server: { middlewares: { use: (handler: Connect.NextHandleFunction) => void }; httpServer?: { once(event: 'close', listener: () => void): unknown } | null }) => {
    server.middlewares.use(middleware);
    recoveryWorker.start();
    server.httpServer?.once('close', () => {
      void recoveryWorker.stop();
    });
  };
  return {
    name: 'content-studio-fal-image-proxy',
    configureServer(server) {
      mount(server);
    },
    configurePreviewServer(server) {
      mount(server);
    },
    async closeBundle() {
      await recoveryWorker.stop();
      database?.close();
      database = null;
    },
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
