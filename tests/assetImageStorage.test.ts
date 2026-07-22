import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileAssetImageStorage,
  createScopedAssetImageStorage,
} from '../src/server/assets/assetImageStorage';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('asset image file storage', () => {
  it('deduplicates identical bytes by content hash and restores the image', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-assets-'));
    directories.push(directory);
    const storage = createFileAssetImageStorage(directory);

    const first = await storage.save({ bytes: Buffer.from('same-image'), contentType: 'image/png' });
    const second = await storage.save({ bytes: Buffer.from('same-image'), contentType: 'image/png' });

    expect(second).toEqual(first);
    expect(first.fileName).toMatch(/^[a-f0-9]{64}\.png$/);
    await expect(storage.read(first.fileName)).resolves.toEqual({
      bytes: Buffer.from('same-image'),
      contentType: 'image/png',
    });
  });

  it('refuses path traversal and unknown extensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-assets-'));
    directories.push(directory);
    const storage = createFileAssetImageStorage(directory);

    await expect(storage.read('../studio-state.json')).resolves.toBeNull();
    await expect(storage.read(`${'a'.repeat(64)}.svg`)).resolves.toBeNull();
  });

  it('keeps identical content hashes isolated across tenant projects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-assets-'));
    directories.push(directory);
    const tenantA = createScopedAssetImageStorage(directory, {
      tenantId: 'tenant-a',
      projectId: 'project-main',
    });
    const tenantB = createScopedAssetImageStorage(directory, {
      tenantId: 'tenant-b',
      projectId: 'project-main',
    });
    const input = { bytes: Buffer.from('shared-hash'), contentType: 'image/png' };

    const storedA = await tenantA.save(input);
    await expect(tenantB.read(storedA.fileName)).resolves.toBeNull();
    const storedB = await tenantB.save(input);

    expect(storedB.fileName).toBe(storedA.fileName);
    await expect(tenantA.read(storedA.fileName)).resolves.toMatchObject({ bytes: input.bytes });
    await expect(tenantB.read(storedB.fileName)).resolves.toMatchObject({ bytes: input.bytes });
  });
});
