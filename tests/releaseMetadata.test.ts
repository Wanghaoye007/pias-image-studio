import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeReleaseMetadata } from '../scripts/write-release-metadata-core.mjs';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('release metadata', () => {
  it('writes an atomic, path-free identity for the built artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-release-metadata-'));
    directories.push(directory);
    const packageFile = join(directory, 'package.json');
    const artifactDirectory = join(directory, 'dist');
    await mkdir(artifactDirectory, { mode: 0o700 });
    await writeFile(packageFile, JSON.stringify({ version: '1.2.3' }), { mode: 0o600 });

    const metadata = await writeReleaseMetadata({
      packageFile,
      artifactDirectory,
      revision: 'abc1234',
      dirty: false,
      builtAt: '2026-07-22T00:30:00.000Z',
    });

    expect(metadata).toEqual({
      schemaVersion: 1,
      service: 'content-studio',
      version: '1.2.3',
      revision: 'abc1234',
      dirty: false,
      builtAt: '2026-07-22T00:30:00.000Z',
    });
    const stored = await readFile(join(artifactDirectory, 'release.json'), 'utf8');
    expect(JSON.parse(stored)).toEqual(metadata);
    expect(stored).not.toContain(directory);
    expect((await stat(join(artifactDirectory, 'release.json'))).mode & 0o777).toBe(0o644);
  });

  it('rejects malformed package versions and revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-release-metadata-invalid-'));
    directories.push(directory);
    const packageFile = join(directory, 'package.json');
    const artifactDirectory = join(directory, 'dist');
    await mkdir(artifactDirectory, { mode: 0o700 });
    await writeFile(packageFile, JSON.stringify({ version: '../private' }), { mode: 0o600 });

    await expect(writeReleaseMetadata({
      packageFile,
      artifactDirectory,
      revision: 'not a revision',
      dirty: false,
      builtAt: '2026-07-22T00:30:00.000Z',
    })).rejects.toThrow('发布元数据无效');
  });
});
