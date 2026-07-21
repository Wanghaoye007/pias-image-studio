import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FalQueuePersistence, PersistedFalJob } from './falQueueService';

type PersistedQueueState = {
  version: 1;
  jobs: PersistedFalJob[];
};

export function createFileFalQueuePersistence(
  filePath = process.env.PIAS_FAL_JOB_STATE_FILE
    || '/tmp/pias-image-studio/fal-queue-state.json',
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
