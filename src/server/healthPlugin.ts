import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

const livePath = '/api/health/live';
const readyPath = '/api/health/ready';
const failedChecks: HealthReadiness['checks'] = {
  database: 'failed',
  artifact: 'failed',
  assets: 'failed',
  identity: 'failed',
};

export type HealthReleaseIdentity = {
  version: string;
  revision: string;
};

export type HealthReadiness = {
  ok: boolean;
  checks: {
    database: 'ok' | 'failed';
    artifact: 'ok' | 'failed';
    assets: 'ok' | 'failed';
    identity: 'ok' | 'failed';
  };
};

type HealthMiddlewareOptions = {
  release: HealthReleaseIdentity;
  readinessCheck: () => Promise<HealthReadiness>;
};

export function createHealthMiddleware(
  options: HealthMiddlewareOptions,
): Connect.NextHandleFunction {
  return (request, response, next) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname !== livePath && pathname !== readyPath) {
      next();
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      writeJson(request, response, 405, {
        error: { code: 'HEALTH_METHOD_NOT_ALLOWED', message: '请求方法不受支持' },
      });
      return;
    }
    if (pathname === livePath) {
      writeJson(request, response, 200, {
        status: 'ok',
        service: 'pias-image-studio',
        ...options.release,
      });
      return;
    }
    void respondWithReadiness(request, response, options);
  };
}

export function healthPlugin(options: HealthMiddlewareOptions): Plugin {
  const middleware = createHealthMiddleware(options);
  return {
    name: 'pias-health-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

async function respondWithReadiness(
  request: IncomingMessage,
  response: ServerResponse,
  options: HealthMiddlewareOptions,
) {
  let readiness: HealthReadiness;
  try {
    readiness = await options.readinessCheck();
  } catch {
    readiness = { ok: false, checks: failedChecks };
  }
  writeJson(request, response, readiness.ok ? 200 : 503, {
    status: readiness.ok ? 'ready' : 'not_ready',
    service: 'pias-image-studio',
    ...options.release,
    ...(!readiness.ok ? { code: 'PIAS_NOT_READY' } : {}),
    checks: readiness.checks,
  });
}

function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(request.method === 'HEAD' ? '' : JSON.stringify(payload));
}
