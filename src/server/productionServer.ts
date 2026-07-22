import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sirv from 'sirv';
import type { Connect, Plugin } from 'vite';
import { assetImagePlugin } from '../assets/assetImagePlugin';
import { authApiPlugin } from '../auth/authApiPlugin';
import { loadIdentityServiceFromConfig } from '../auth/authConfig';
import { readFalKey } from '../fal/falCredentials';
import { falImageProxyPlugin } from '../fal/falProxyPlugin';
import { loadInvitationEmailConfig } from '../organization/invitationEmailDelivery';
import { organizationPlugin } from '../organization/organizationPlugin';
import { studioStatePlugin } from '../studio/studioStatePlugin';
import { healthPlugin } from './healthPlugin';
import { createProductionReadinessCheck } from './productionReadiness';
import { loadReleaseIdentity } from './releaseIdentity';

type ProductionEnvironment = Record<string, string | undefined>;

type ProductionServerOptions = {
  env?: ProductionEnvironment;
  host?: string;
  port?: number;
  logger?: (message: string) => void;
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
  const httpServer = createServer((request, response) => {
    dispatchMiddleware(middlewareStack, request, response);
  });
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
      workerIntervalMs: positiveInteger(env.PIAS_FAL_WORKER_INTERVAL_MS, 2_500),
      leaseTtlMs: positiveInteger(env.PIAS_FAL_LEASE_TTL_MS, 15_000),
      billingRetryIntervalMs: positiveInteger(env.PIAS_FAL_BILLING_RETRY_MS, 300_000),
      readKey: () => readFalKey({ env, defaultFile: '' }),
    }),
  ];
  middlewareStack.push(securityHeadersMiddleware);
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
      options.logger?.(JSON.stringify({
        event: 'pias_server_started',
        host: config.host,
        port: address.port,
        version: release.version,
        revision: release.revision,
      }));
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
  if (env.PIAS_SECURE_COOKIES !== 'true') throw new Error('SECURE_COOKIES_REQUIRED');
  if (env.PIAS_PERSISTENCE_BACKEND !== 'sqlite') throw new Error('SQLITE_BACKEND_REQUIRED');
  const host = options.host ?? env.PIAS_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('LOOPBACK_HOST_REQUIRED');
  const requestedPort = options.port ?? positiveInteger(env.PIAS_PORT, 4_173);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    throw new Error('SERVER_PORT_INVALID');
  }
  return {
    host,
    port: requestedPort,
    databaseFile: required(env.PIAS_DATABASE_FILE, 'DATABASE_REQUIRED'),
    assetDirectory: required(env.PIAS_ASSET_DIR, 'ASSET_STORAGE_REQUIRED'),
    artifactDirectory: required(env.PIAS_RELEASE_ARTIFACT_DIR, 'BUILD_ARTIFACT_REQUIRED'),
    authConfigFile: required(env.PIAS_AUTH_CONFIG_FILE, 'AUTH_CONFIG_REQUIRED'),
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

function securityHeadersMiddleware(
  _request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  next();
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
) {
  const dispatch = (index: number, error?: unknown) => {
    if (response.writableEnded) return;
    if (error) {
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
