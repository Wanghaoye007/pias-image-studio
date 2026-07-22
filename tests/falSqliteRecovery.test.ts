import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPiasDatabase, type PiasDatabase } from '../src/persistence/sqliteDatabase';
import {
  createSqliteFalJobLeaseStore,
  createSqliteFalJobPayloadStore,
  createSqliteFalQueuePersistence,
} from '../src/fal/falSqlitePersistence';
import {
  createFalQueueService,
  type FalQueueAdapter,
  type PersistedFalJob,
} from '../src/fal/falQueueService';
import {
  createFalRecoveryWorker,
  runFalRecoveryCycle,
} from '../src/fal/falRecoveryWorker';

const directories: string[] = [];
const databases: PiasDatabase[] = [];
const scope = { tenantId: 'tenant-a', projectId: 'project-a' };

afterEach(async () => {
  while (databases.length > 0) databases.pop()?.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('Fal SQLite recovery', () => {
  it('persists jobs across connections without leaking another scope', async () => {
    const filePath = await databasePath();
    const first = createSqliteFalQueuePersistence(open(filePath), scope);
    const second = createSqliteFalQueuePersistence(open(filePath), scope);
    const other = createSqliteFalQueuePersistence(open(filePath), {
      tenantId: 'tenant-b', projectId: 'project-a',
    });
    const job = persistedJob();

    await first.save([job]);
    await expect(second.load()).resolves.toEqual([job]);
    await expect(other.load()).resolves.toEqual([]);

    const updated = { ...job, canceled: true };
    await second.save([updated]);
    await expect(first.load()).resolves.toEqual([updated]);
  });

  it('grants one owner at a time and allows takeover only after lease expiry', async () => {
    const filePath = await databasePath();
    const first = createSqliteFalJobLeaseStore(open(filePath), scope);
    const second = createSqliteFalJobLeaseStore(open(filePath), scope);

    await expect(first.acquire('job-1', 'worker-a', 1_000, 500)).resolves.toBe(true);
    await expect(second.acquire('job-1', 'worker-b', 1_499, 500)).resolves.toBe(false);
    await expect(second.acquire('job-1', 'worker-b', 1_501, 500)).resolves.toBe(true);
    await first.release('job-1', 'worker-a');
    await expect(second.renew('job-1', 'worker-b', 1_700, 500)).resolves.toBe(true);
    await second.release('job-1', 'worker-b');
    await expect(first.acquire('job-1', 'worker-a', 1_701, 500)).resolves.toBe(true);
  });

  it('isolates and deletes multi-stage recovery payloads by project scope', async () => {
    const filePath = await databasePath();
    const database = open(filePath);
    const first = createSqliteFalJobPayloadStore(database, scope);
    const other = createSqliteFalJobPayloadStore(database, {
      tenantId: 'tenant-a',
      projectId: 'project-b',
    });
    await first.save('job-1', {
      directionalLightSourceImageUrl: 'data:image/png;base64,PRIVATE',
    });

    await expect(first.load('job-1')).resolves.toEqual({
      directionalLightSourceImageUrl: 'data:image/png;base64,PRIVATE',
    });
    await expect(other.load('job-1')).resolves.toBeUndefined();
    await first.delete('job-1');
    await expect(first.load('job-1')).resolves.toBeUndefined();
  });

  it('prevents two recovery workers from advancing the same job concurrently', async () => {
    const filePath = await databasePath();
    const databaseA = open(filePath);
    const databaseB = open(filePath);
    const persistenceA = createSqliteFalQueuePersistence(databaseA, scope);
    const persistenceB = createSqliteFalQueuePersistence(databaseB, scope);
    await persistenceA.save([persistedJob()]);
    const pendingStatus = deferred<{ status: 'COMPLETED'; logs: [] }>();
    const adapterA = adapter();
    const adapterB = adapter();
    vi.mocked(adapterA.status).mockReturnValue(pendingStatus.promise);
    const serviceA = createFalQueueService({
      adapter: adapterA,
      readKey: async () => 'id:secret',
      persistence: persistenceA,
      leaseStore: createSqliteFalJobLeaseStore(databaseA, scope),
      workerId: 'worker-a',
      now: () => 1_000,
    });
    const serviceB = createFalQueueService({
      adapter: adapterB,
      readKey: async () => 'id:secret',
      persistence: persistenceB,
      leaseStore: createSqliteFalJobLeaseStore(databaseB, scope),
      workerId: 'worker-b',
      now: () => 1_000,
    });

    const firstCycle = runFalRecoveryCycle(serviceA);
    await vi.waitFor(() => expect(adapterA.status).toHaveBeenCalledOnce());
    await runFalRecoveryCycle(serviceB);
    expect(adapterB.status).not.toHaveBeenCalled();
    pendingStatus.resolve({ status: 'COMPLETED', logs: [] });
    await firstCycle;

    await expect(persistenceB.load()).resolves.toMatchObject([{
      children: [{ status: 'completed' }],
    }]);
  });

  it('recovers a job abandoned by an expired worker lease', async () => {
    const filePath = await databasePath();
    const database = open(filePath);
    const persistence = createSqliteFalQueuePersistence(database, scope);
    const leases = createSqliteFalJobLeaseStore(database, scope);
    await persistence.save([persistedJob()]);
    await leases.acquire('fal-local-recover', 'dead-worker', 1_000, 500);
    const recoveryAdapter = adapter();
    const service = createFalQueueService({
      adapter: recoveryAdapter,
      readKey: async () => 'id:secret',
      persistence,
      leaseStore: leases,
      workerId: 'replacement-worker',
      now: () => 1_501,
    });

    await runFalRecoveryCycle(service);

    expect(recoveryAdapter.status).toHaveBeenCalledOnce();
    await expect(persistence.load()).resolves.toMatchObject([{
      children: [{ status: 'completed' }],
    }]);
  });

  it('coalesces overlapping background recovery cycles', async () => {
    const pendingStatus = deferred<void>();
    const service = {
      listRecoverableJobs: vi.fn(async () => ['job-1']),
      status: vi.fn(async () => {
        await pendingStatus.promise;
        return { status: 'completed' as const, logs: [], progress: 94 };
      }),
    };
    const worker = createFalRecoveryWorker({
      listServices: async () => [service],
      intervalMs: 1_000,
    });

    const first = worker.runOnce();
    const overlapping = worker.runOnce();
    await vi.waitFor(() => expect(service.status).toHaveBeenCalledOnce());
    expect(service.listRecoverableJobs).toHaveBeenCalledOnce();

    pendingStatus.resolve();
    await expect(Promise.all([first, overlapping])).resolves.toHaveLength(2);
    expect(service.status).toHaveBeenCalledOnce();
    worker.stop();
  });

  it('reconciles completed jobs whose provider billing is still pending', async () => {
    const service = {
      listRecoverableJobs: vi.fn(async () => []),
      status: vi.fn(),
      listBillingPendingJobs: vi.fn(async () => ['job-billing']),
      reconcileBilling: vi.fn(async () => 'confirmed' as const),
    };

    await expect(runFalRecoveryCycle(service)).resolves.toMatchObject({
      inspected: 0,
      billingInspected: 1,
      billingConfirmed: 1,
      failed: [],
    });
    expect(service.reconcileBilling).toHaveBeenCalledWith('job-billing');
  });
});

function persistedJob(): PersistedFalJob {
  return {
    id: 'fal-local-recover',
    createdBy: 'user-creator',
    profileId: 'generate',
    modelId: 'fal-ai/bria/product-shot',
    request: {
      profileId: 'generate',
      imageUrls: [],
      prompt: '',
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    },
    plan: { modelId: 'fal-ai/bria/product-shot', invocations: [] },
    children: [{
      modelId: 'fal-ai/bria/product-shot',
      requestId: 'upstream-recover',
      status: 'queued',
    }],
    nextUpscaleFactorIndex: 1,
    directionalLightFinalStarted: false,
    canceled: false,
  };
}

function adapter(): FalQueueAdapter {
  return {
    config: vi.fn(),
    submit: vi.fn(async () => ({ request_id: 'upstream-next' })),
    status: vi.fn(async () => ({ status: 'COMPLETED' as const, logs: [] })),
    result: vi.fn(async () => ({ data: { images: [{ url: 'https://fal.media/result.png' }] } })),
    cancel: vi.fn(async () => undefined),
  };
}

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pias-fal-sqlite-'));
  directories.push(directory);
  return join(directory, 'pias.sqlite');
}

function open(filePath: string): PiasDatabase {
  const database = openPiasDatabase(filePath);
  databases.push(database);
  return database;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
