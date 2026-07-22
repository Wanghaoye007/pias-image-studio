import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createScopedFalQueuePersistence } from '../src/worker/fal/falJobPersistence';
import type { PersistedFalJob } from '../src/worker/fal/falQueueService';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function job(prompt: string): PersistedFalJob {
  return {
    id: 'fal-local-shared',
    profileId: 'generate',
    modelId: 'fal-ai/bria/product-shot',
    request: {
      profileId: 'generate',
      imageUrls: [],
      prompt,
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    },
    plan: { modelId: 'fal-ai/bria/product-shot', invocations: [] },
    children: [],
    nextUpscaleFactorIndex: 0,
    canceled: false,
  };
}

describe('Fal queue scoped persistence', () => {
  it('isolates identical local request ids across tenant projects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pias-fal-scopes-'));
    directories.push(directory);
    const tenantA = createScopedFalQueuePersistence(directory, {
      tenantId: 'tenant-a',
      projectId: 'project-main',
    });
    const tenantB = createScopedFalQueuePersistence(directory, {
      tenantId: 'tenant-b',
      projectId: 'project-main',
    });

    await tenantA.save([job('tenant-a')]);
    await expect(tenantB.load()).resolves.toEqual([]);
    await tenantB.save([job('tenant-b')]);

    await expect(tenantA.load()).resolves.toMatchObject([{ request: { prompt: 'tenant-a' } }]);
    await expect(tenantB.load()).resolves.toMatchObject([{ request: { prompt: 'tenant-b' } }]);
  });
});
