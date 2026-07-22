import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPiasDatabase } from '../src/persistence/sqliteDatabase';
import {
  createHealthMiddleware,
  type HealthReadiness,
} from '../src/server/healthPlugin';
import { createProductionReadinessCheck } from '../src/server/productionReadiness';
import { loadReleaseIdentity } from '../src/server/releaseIdentity';

const directories: string[] = [];
const release = { version: '0.1.0', revision: 'abc1234' };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('health API', () => {
  it('serves public liveness with a stable release identity and no cache', async () => {
    const response = await invoke(createHealthMiddleware({
      release,
      readinessCheck: async () => ready(),
    }), 'GET', '/api/health/live');

    expect(response).toMatchObject({
      statusCode: 200,
      body: {
        status: 'ok',
        service: 'pias-image-studio',
        version: '0.1.0',
        revision: 'abc1234',
      },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.next).not.toHaveBeenCalled();
  });

  it('returns a sanitized 503 when readiness fails', async () => {
    const response = await invoke(createHealthMiddleware({
      release,
      readinessCheck: async () => {
        throw new Error('database missing at /private/production/pias.sqlite');
      },
    }), 'GET', '/api/health/ready');

    expect(response).toMatchObject({
      statusCode: 503,
      body: {
        status: 'not_ready',
        code: 'PIAS_NOT_READY',
        checks: {
          database: 'failed',
          artifact: 'failed',
          assets: 'failed',
          identity: 'failed',
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('/private/production');
  });

  it('supports HEAD, rejects writes and ignores unrelated routes', async () => {
    const middleware = createHealthMiddleware({
      release,
      readinessCheck: async () => ready(),
    });
    const head = await invoke(middleware, 'HEAD', '/api/health/live');
    const write = await invoke(middleware, 'POST', '/api/health/ready');
    const unrelated = await invoke(middleware, 'GET', '/api/auth/session');

    expect(head).toMatchObject({ statusCode: 200, rawBody: '' });
    expect(write).toMatchObject({
      statusCode: 405,
      body: { error: { code: 'HEALTH_METHOD_NOT_ALLOWED' } },
    });
    expect(unrelated.next).toHaveBeenCalledOnce();
  });
});

describe('production readiness', () => {
  it('checks the current schema, build artifact, writable asset directory and identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pias-readiness-'));
    directories.push(directory);
    const databaseFile = join(directory, 'pias.sqlite');
    const database = openPiasDatabase(databaseFile);
    database.close();
    const artifactDirectory = join(directory, 'dist');
    const assetDirectory = join(directory, 'assets');
    await mkdir(artifactDirectory, { mode: 0o700 });
    await mkdir(assetDirectory, { mode: 0o700 });
    await writeFile(join(artifactDirectory, 'index.html'), '<!doctype html>', { mode: 0o600 });

    const check = createProductionReadinessCheck({
      databaseFile,
      artifactDirectory,
      assetDirectory,
      identityConfigured: true,
    });

    await expect(check()).resolves.toEqual(ready());

    await writeFile(join(artifactDirectory, 'index.html'), '');
    const degraded = await check();
    expect(degraded).toMatchObject({ ok: false, checks: { artifact: 'failed' } });
  });

  it('loads the health identity from release metadata without exposing build paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pias-release-identity-'));
    directories.push(directory);
    await writeFile(join(directory, 'release.json'), JSON.stringify({
      schemaVersion: 1,
      service: 'pias-image-studio',
      version: '1.2.3',
      revision: 'def5678',
      dirty: false,
      builtAt: '2026-07-22T00:30:00.000Z',
    }), { mode: 0o644 });

    const identity = loadReleaseIdentity(directory, release);

    expect(identity).toEqual({ version: '1.2.3', revision: 'def5678' });
    expect(JSON.stringify(identity)).not.toContain(directory);
  });
});

function ready(): HealthReadiness {
  return {
    ok: true,
    checks: {
      database: 'ok',
      artifact: 'ok',
      assets: 'ok',
      identity: 'ok',
    },
  };
}

async function invoke(
  middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
  method: string,
  url: string,
) {
  const request = new EventEmitter() as IncomingMessage;
  request.method = method;
  request.url = url;
  request.headers = {};
  let rawBody = '';
  const headers = new Map<string, string>();
  let resolveResponse: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string | number | readonly string[]) => {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
    },
    end: (value = '') => {
      rawBody = String(value);
      resolveResponse();
    },
  } as unknown as ServerResponse;
  const next = vi.fn(resolveResponse);

  void middleware(request, response, next);
  await completed;
  return {
    statusCode: response.statusCode,
    rawBody,
    body: rawBody ? JSON.parse(rawBody) as Record<string, unknown> : undefined,
    headers,
    next,
  };
}
