import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sirv from 'sirv';
import type { Connect, Plugin } from 'vite';
import { assetImagePlugin } from './assets/assetImagePlugin';
import { authApiPlugin } from './auth/authApiPlugin';
import { loadIdentityServiceFromConfig } from './auth/authConfig';
import { readFalKey } from './fal/falCredentials';
import { falImageProxyPlugin } from './fal/falProxyPlugin';
import { loadInvitationEmailConfig } from '../worker/organization/invitationEmailDelivery';
import { organizationPlugin } from './organization/organizationPlugin';
import { studioStatePlugin } from './studio/studioStatePlugin';
import { healthPlugin } from './healthPlugin';
import {
  type ProductionLogWriter,
  writeProductionLog,
} from './productionLog';
import { createProductionReadinessCheck } from './productionReadiness';
import { loadReleaseIdentity } from './releaseIdentity';

type ProductionEnvironment = Record<string, string | undefined>;

const loginRateLimit = 20;
const loginRateWindowMs = 60_000;
export const productionHttpLimits = Object.freeze({
  requestTimeout: 60_000,
  headersTimeout: 15_000,
  keepAliveTimeout: 5_000,
  connectionsCheckingInterval: 1_000,
  maxHeaderSize: 16 * 1024,
  maxHeadersCount: 100,
  maxRequestsPerSocket: 1_000,
});
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

type ProductionServerOptions = {
  env?: ProductionEnvironment;
  host?: string;
  port?: number;
  logger?: ProductionLogWriter;
};

export type ProductionServer = {
  start(): Promise<{ origin: string }>;
  close(): Promise<void>;
};

export async function createProductionServer(
  options: ProductionServerOptions = {},
): Promise<ProductionServer> {
  const env = options.env ?? process.env;
  const config = validateConfig(env, options);
  const identity = loadIdentityServiceFromConfig(config.authConfigFile);
  if (!identity) throw new Error('AUTH_CONFIG_REQUIRED');
  const release = loadReleaseIdentity(config.artifactDirectory, {
    version: 'unknown',
    revision: 'unknown',
  });
  const middlewareStack: Connect.NextHandleFunction[] = [];
  const httpServer = createServer({
    requestTimeout: productionHttpLimits.requestTimeout,
    headersTimeout: productionHttpLimits.headersTimeout,
    keepAliveTimeout: productionHttpLimits.keepAliveTimeout,
    connectionsCheckingInterval: productionHttpLimits.connectionsCheckingInterval,
    maxHeaderSize: productionHttpLimits.maxHeaderSize,
  }, (request, response) => {
    dispatchMiddleware(middlewareStack, request, response, options.logger);
  });
  httpServer.maxHeadersCount = productionHttpLimits.maxHeadersCount;
  httpServer.maxRequestsPerSocket = productionHttpLimits.maxRequestsPerSocket;
  const plugins: Plugin[] = [
    healthPlugin({
      release,
      readinessCheck: createProductionReadinessCheck({
        databaseFile: config.databaseFile,
        artifactDirectory: config.artifactDirectory,
        assetDirectory: config.assetDirectory,
        identityConfigured: true,
      }),
    }),
    authApiPlugin(identity, { secureCookies: true }),
    organizationPlugin(identity, {
      databaseFile: config.databaseFile,
      emailConfig: loadInvitationEmailConfig(env),
    }),
    assetImagePlugin({
      scoped: true,
      scopedDirectory: config.assetDirectory,
    }),
    studioStatePlugin({
      scoped: true,
      persistenceBackend: 'sqlite',
      databaseFile: config.databaseFile,
    }),
    falImageProxyPlugin({
      scoped: true,
      persistenceBackend: 'sqlite',
      databaseFile: config.databaseFile,
      workerIntervalMs: positiveInteger(env.CONTENT_STUDIO_FAL_WORKER_INTERVAL_MS, 2_500),
      leaseTtlMs: positiveInteger(env.CONTENT_STUDIO_FAL_LEASE_TTL_MS, 15_000),
      billingRetryIntervalMs: positiveInteger(env.CONTENT_STUDIO_FAL_BILLING_RETRY_MS, 300_000),
      readKey: () => readFalKey({ env, defaultFile: '' }),
      logger: options.logger,
    }),
  ];
  middlewareStack.push(createRequestObservabilityMiddleware(options.logger));
  middlewareStack.push(securityHeadersMiddleware);
  middlewareStack.push(createRequestBoundaryMiddleware(config.publicOrigin));
  middlewareStack.push(createLoginRateLimitMiddleware());
  const previewServer = {
    middlewares: {
      use(handler: Connect.NextHandleFunction) {
        middlewareStack.push(handler);
      },
    },
    httpServer,
  };
  for (const plugin of plugins) await invokePluginHook(plugin.configurePreviewServer, plugin, previewServer);
  middlewareStack.push(apiNotFoundMiddleware);
  const staticHandler = sirv(config.artifactDirectory, {
    dev: false,
    etag: true,
    single: true,
    setHeaders(response, pathname) {
      response.setHeader(
        'cache-control',
        pathname.includes('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-store',
      );
    },
  });
  middlewareStack.push((request, response, next) => staticHandler(request, response, next));

  let startedOrigin: string | null = null;
  let closing: Promise<void> | null = null;
  let pluginsClosed = false;
  const closePlugins = async () => {
    if (pluginsClosed) return;
    pluginsClosed = true;
    for (const plugin of [...plugins].reverse()) {
      await invokePluginHook(plugin.closeBundle, plugin);
    }
  };

  return {
    async start() {
      if (startedOrigin) return { origin: startedOrigin };
      if (closing) throw new Error('SERVER_CLOSED');
      try {
        await listen(httpServer, config.host, config.port);
      } catch (error) {
        await closePlugins();
        throw error;
      }
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        await closeHttpServer(httpServer);
        await closePlugins();
        throw new Error('SERVER_ADDRESS_INVALID');
      }
      startedOrigin = `http://${formatHost(config.host)}:${address.port}`;
      writeProductionLog(options.logger, 'content_studio_server_started', {
        host: config.host,
        port: address.port,
        version: release.version,
        revision: release.revision,
      });
      return { origin: startedOrigin };
    },
    close() {
      closing ??= (async () => {
        if (httpServer.listening) await closeHttpServer(httpServer);
        await closePlugins();
        startedOrigin = null;
      })();
      return closing;
    },
  };
}

function validateConfig(
  env: ProductionEnvironment,
  options: ProductionServerOptions,
) {
  if (env.NODE_ENV !== 'production') throw new Error('PRODUCTION_MODE_REQUIRED');
  if (env.CONTENT_STUDIO_SECURE_COOKIES !== 'true') throw new Error('SECURE_COOKIES_REQUIRED');
  if (env.CONTENT_STUDIO_PERSISTENCE_BACKEND !== 'sqlite') throw new Error('SQLITE_BACKEND_REQUIRED');
  const host = options.host ?? env.CONTENT_STUDIO_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('LOOPBACK_HOST_REQUIRED');
  const requestedPort = options.port ?? positiveInteger(env.CONTENT_STUDIO_PORT, 4_173);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    throw new Error('SERVER_PORT_INVALID');
  }
  return {
    host,
    port: requestedPort,
    databaseFile: required(env.CONTENT_STUDIO_DATABASE_FILE, 'DATABASE_REQUIRED'),
    assetDirectory: required(env.CONTENT_STUDIO_ASSET_DIR, 'ASSET_STORAGE_REQUIRED'),
    artifactDirectory: required(env.CONTENT_STUDIO_RELEASE_ARTIFACT_DIR, 'BUILD_ARTIFACT_REQUIRED'),
    authConfigFile: required(env.CONTENT_STUDIO_AUTH_CONFIG_FILE, 'AUTH_CONFIG_REQUIRED'),
    publicOrigin: requirePublicOrigin(env.CONTENT_STUDIO_PUBLIC_BASE_URL),
  };
}

function required(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value.trim();
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requirePublicOrigin(value: string | undefined): string {
  const input = required(value, 'PUBLIC_BASE_URL_REQUIRED');
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('invalid origin');
    }
    return url.origin;
  } catch {
    throw new Error('PUBLIC_BASE_URL_INVALID');
  }
}

function securityHeadersMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/api/')) response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('strict-transport-security', 'max-age=31536000');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  response.setHeader('x-permitted-cross-domain-policies', 'none');
  response.setHeader('content-security-policy', contentSecurityPolicy);
  next();
}

const requestIdKey = Symbol('content-studio.request-id');
type ObservedRequest = IncomingMessage & { [requestIdKey]?: string };

function createRequestObservabilityMiddleware(
  logger: ProductionLogWriter | undefined,
  now: () => number = Date.now,
): Connect.NextHandleFunction {
  return (request, response, next) => {
    const requestId = randomUUID();
    const startedAt = now();
    (request as ObservedRequest)[requestIdKey] = requestId;
    response.setHeader('x-request-id', requestId);
    let logged = false;
    const logCompletion = (aborted: boolean) => {
      if (logged) return;
      logged = true;
      writeProductionLog(logger, 'content_studio_http_request', {
        requestId,
        method: request.method ?? 'GET',
        path: logPathname(request.url),
        status: aborted && !response.writableEnded ? 499 : response.statusCode,
        durationMs: Math.max(0, now() - startedAt),
      });
    };
    response.once('finish', () => logCompletion(false));
    response.once('close', () => logCompletion(true));
    next();
  };
}

function createLoginRateLimitMiddleware(
  now: () => number = Date.now,
): Connect.NextHandleFunction {
  let windowStartedAt = 0;
  let attempts = 0;
  return (request, response, next) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method !== 'POST' || pathname !== '/api/auth/login') {
      next();
      return;
    }
    const currentTime = now();
    if (!windowStartedAt || currentTime - windowStartedAt >= loginRateWindowMs) {
      windowStartedAt = currentTime;
      attempts = 0;
    }
    if (attempts >= loginRateLimit) {
      request.resume();
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStartedAt + loginRateWindowMs - currentTime) / 1_000),
      );
      response.statusCode = 429;
      response.setHeader('retry-after', retryAfterSeconds.toString());
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        error: { code: 'AUTH_RATE_LIMITED', message: '登录尝试过多，请稍后再试' },
      }));
      return;
    }
    attempts += 1;
    next();
  };
}

function createRequestBoundaryMiddleware(publicOrigin: string): Connect.NextHandleFunction {
  return (request, response, next) => {
    const method = request.method ?? 'GET';
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      next();
      return;
    }
    const origin = singleHeader(request, 'origin');
    const fetchSite = singleHeader(request, 'sec-fetch-site').toLowerCase();
    if ((origin && origin !== publicOrigin) || fetchSite === 'cross-site') {
      request.resume();
      writeSecurityError(
        response,
        403,
        'SECURITY_ORIGIN_REJECTED',
        '请求来源不受信任',
      );
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (requiresJsonBody(method, pathname) && requestMediaType(request) !== 'application/json') {
      request.resume();
      writeSecurityError(
        response,
        415,
        'SECURITY_JSON_REQUIRED',
        '请求必须使用 application/json',
      );
      return;
    }
    next();
  };
}

function requiresJsonBody(method: string, pathname: string): boolean {
  if (method === 'POST' && ['/api/auth/login', '/api/auth/mfa', '/api/fal/jobs'].includes(pathname)) {
    return true;
  }
  if (pathname === '/api/studio/state') return method === 'PUT';
  if (method === 'POST' && [
    '/api/organization/projects',
    '/api/organization/invitations',
    '/api/organization/invitations/preview',
    '/api/organization/invitations/accept',
  ].includes(pathname)) {
    return true;
  }
  return method === 'PATCH'
    && /^\/api\/organization\/members\/user-[a-f0-9-]{36}$/.test(pathname);
}

function requestMediaType(request: IncomingMessage): string {
  return singleHeader(request, 'content-type').split(';', 1)[0].trim().toLowerCase();
}

function singleHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function writeSecurityError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: { code, message } }));
}

function apiNotFoundMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (!pathname.startsWith('/api/')) {
    next();
    return;
  }
  response.statusCode = 404;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify({
    error: { code: 'API_NOT_FOUND', message: '接口不存在' },
  }));
}

function dispatchMiddleware(
  stack: Connect.NextHandleFunction[],
  request: IncomingMessage,
  response: ServerResponse,
  logger?: ProductionLogWriter,
) {
  const dispatch = (index: number, error?: unknown) => {
    if (response.writableEnded) return;
    if (error) {
      writeProductionLog(logger, 'content_studio_http_failure', {
        requestId: (request as ObservedRequest)[requestIdKey] ?? 'unassigned',
        method: request.method ?? 'GET',
        path: logPathname(request.url),
      }, error);
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify({
        error: { code: 'INTERNAL_SERVER_ERROR', message: '服务暂不可用' },
      }));
      return;
    }
    const middleware = stack[index];
    if (!middleware) {
      response.statusCode = 404;
      response.end('Not Found');
      return;
    }
    try {
      const result = (middleware as unknown as (
        incoming: IncomingMessage,
        outgoing: ServerResponse,
        next: (error?: unknown) => void,
      ) => unknown)(request, response, (nextError?: unknown) => {
        dispatch(index + 1, nextError);
      });
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch((reason) => dispatch(index + 1, reason));
      }
    } catch (reason) {
      dispatch(index + 1, reason);
    }
  };
  dispatch(0);
}

function safePathname(value: string | undefined): string {
  try {
    return new URL(value ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    return '/invalid-request-target';
  }
}

const staticLogPaths = new Set([
  '/api/health/live',
  '/api/health/ready',
  '/api/auth/login',
  '/api/auth/mfa',
  '/api/auth/session',
  '/api/auth/logout',
  '/api/organization/projects',
  '/api/organization/invitations',
  '/api/organization/invitations/preview',
  '/api/organization/invitations/accept',
  '/api/organization/members',
  '/api/studio/state',
  '/api/assets/images',
  '/api/fal/jobs',
]);

function logPathname(value: string | undefined): string {
  const pathname = safePathname(value);
  if (staticLogPaths.has(pathname)) return pathname;
  if (/^\/api\/organization\/invitations\/[^/]+\/(?:revoke|resend)$/.test(pathname)) {
    return '/api/organization/invitations/:invitationId/:action';
  }
  if (/^\/api\/organization\/members\/[^/]+$/.test(pathname)) {
    return '/api/organization/members/:userId';
  }
  if (/^\/api\/assets\/images\//.test(pathname)) {
    return '/api/assets/images/:asset';
  }
  if (/^\/api\/fal\/jobs\/[^/]+\/(?:status|result)$/.test(pathname)) {
    return '/api/fal/jobs/:jobId/:view';
  }
  if (/^\/api\/fal\/jobs\/[^/]+$/.test(pathname)) {
    return '/api/fal/jobs/:jobId';
  }
  if (pathname.startsWith('/api/')) return '/api/other';
  if (pathname.startsWith('/assets/')) return '/assets/:file';
  return '/app';
}

async function invokePluginHook(
  hook: unknown,
  plugin: Plugin,
  ...args: unknown[]
) {
  if (typeof hook === 'function') {
    await hook.call(plugin, ...args);
    return;
  }
  if (hook && typeof hook === 'object' && 'handler' in hook) {
    const handler = (hook as { handler?: unknown }).handler;
    if (typeof handler === 'function') await handler.call(plugin, ...args);
  }
}

function listen(
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const application = await createProductionServer({ logger: console.log });
  await application.start();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await application.close();
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
}
