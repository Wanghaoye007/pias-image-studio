import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initialStudioState } from '../src/domain';
import {
  createFileStudioStatePersistence,
  createScopedStudioStatePersistence,
  StudioStateConflictError,
  StudioStateStorageError,
} from '../src/studio/studioStatePersistence';

const temporaryDirectories: string[] = [];

async function createStorePath() {
  const directory = await mkdtemp(join(tmpdir(), 'pias-studio-state-'));
  temporaryDirectories.push(directory);
  return { directory, filePath: join(directory, 'state.json') };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('file StudioState persistence', () => {
  it('returns null when no state has been saved', async () => {
    const { filePath } = await createStorePath();
    const store = createFileStudioStatePersistence(filePath);

    await expect(store.load()).resolves.toBeNull();
  });

  it('creates revision one and reloads it through a fresh store instance', async () => {
    const { filePath } = await createStorePath();
    const state = initialStudioState();
    state.projectName = '持久化项目';

    const saved = await createFileStudioStatePersistence(filePath).save(0, state);
    const reloaded = await createFileStudioStatePersistence(filePath).load();

    expect(saved).toMatchObject({ schemaVersion: 1, revision: 1, state });
    expect(saved.updatedAt).toEqual(expect.any(String));
    expect(reloaded).toEqual(saved);
  });

  it('increments the revision after a valid update', async () => {
    const { filePath } = await createStorePath();
    const store = createFileStudioStatePersistence(filePath);
    const first = await store.save(0, initialStudioState());
    const nextState = structuredClone(first.state);
    nextState.workspaceName = '已恢复工作区';

    const second = await store.save(first.revision, nextState);

    expect(second.revision).toBe(2);
    expect(second.state.workspaceName).toBe('已恢复工作区');
  });

  it('rejects a stale revision without overwriting the confirmed state', async () => {
    const { filePath } = await createStorePath();
    const store = createFileStudioStatePersistence(filePath);
    const first = await store.save(0, initialStudioState());
    const confirmed = structuredClone(first.state);
    confirmed.projectName = '服务端确认版本';
    await store.save(1, confirmed);

    const stale = structuredClone(first.state);
    stale.projectName = '过期页面版本';

    await expect(store.save(1, stale)).rejects.toBeInstanceOf(StudioStateConflictError);
    await expect(store.load()).resolves.toMatchObject({
      revision: 2,
      state: { projectName: '服务端确认版本' },
    });
  });

  it('serializes concurrent writes so only one matching revision succeeds', async () => {
    const { filePath } = await createStorePath();
    const store = createFileStudioStatePersistence(filePath);
    await store.save(0, initialStudioState());
    const stateA = initialStudioState();
    const stateB = initialStudioState();
    stateA.projectName = '并发 A';
    stateB.projectName = '并发 B';

    const results = await Promise.allSettled([
      store.save(1, stateA),
      store.save(1, stateB),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(StudioStateConflictError) });
    await expect(store.load()).resolves.toMatchObject({ revision: 2 });
  });

  it('leaves only the final state file after an atomic save', async () => {
    const { directory, filePath } = await createStorePath();
    await createFileStudioStatePersistence(filePath).save(0, initialStudioState());

    expect(await readdir(directory)).toEqual(['state.json']);
  });

  it('reports a corrupt file without replacing it', async () => {
    const { filePath } = await createStorePath();
    await writeFile(filePath, '{broken', 'utf8');
    const store = createFileStudioStatePersistence(filePath);

    await expect(store.load()).rejects.toBeInstanceOf(StudioStateStorageError);
    await expect(store.save(0, initialStudioState())).rejects.toBeInstanceOf(StudioStateStorageError);
  });

  it('isolates identical project ids across tenants and revisions independently', async () => {
    const { directory } = await createStorePath();
    const tenantA = createScopedStudioStatePersistence(directory, {
      tenantId: 'tenant-a',
      projectId: 'project-main',
    });
    const tenantB = createScopedStudioStatePersistence(directory, {
      tenantId: 'tenant-b',
      projectId: 'project-main',
    });
    const stateA = initialStudioState();
    stateA.projectName = 'Tenant A 项目';

    await expect(tenantA.save(0, stateA)).resolves.toMatchObject({ revision: 1 });
    await expect(tenantB.load()).resolves.toBeNull();

    const stateB = initialStudioState();
    stateB.projectName = 'Tenant B 项目';
    await expect(tenantB.save(0, stateB)).resolves.toMatchObject({ revision: 1 });
    await expect(tenantA.load()).resolves.toMatchObject({ state: { projectName: 'Tenant A 项目' } });
    await expect(tenantB.load()).resolves.toMatchObject({ state: { projectName: 'Tenant B 项目' } });

    const scopeDirectories = await readdir(directory);
    expect(scopeDirectories).toHaveLength(2);
    expect(scopeDirectories.every((name) => /^[a-f0-9]{64}$/.test(name))).toBe(true);
  });
});
