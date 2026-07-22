import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FalQueuePersistence, PersistedFalJob } from './falQueueService';

export type FalQueueScope = {
  tenantId: string;
  projectId: string;
};

type PersistedQueueState = {
  version: 1;
  jobs: PersistedFalJob[];
};

export function createFileFalQueuePersistence(
  filePath = process.env.CONTENT_STUDIO_FAL_JOB_STATE_FILE
    || '/tmp/content-studio/fal-queue-state.json',
): FalQueuePersistence {
  return {
    async load() {
      try {
        const state = JSON.parse(await readFile(filePath, 'utf8')) as Partial<PersistedQueueState>;
        return state.version === 1 && Array.isArray(state.jobs) ? state.jobs : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    async save(jobs) {
      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      const state: PersistedQueueState = { version: 1, jobs };
      await writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600 });
      await rename(temporaryPath, filePath);
    },
  };
}

export function createScopedFalQueuePersistence(
  rootDirectory: string,
  scope: FalQueueScope,
): FalQueuePersistence {
  const scopeKey = createHash('sha256')
    .update(scope.tenantId)
    .update('\0')
    .update(scope.projectId)
    .digest('hex');
  return createFileFalQueuePersistence(join(rootDirectory, scopeKey, 'fal-queue-state.json'));
}
