import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('project storage migration command', () => {
  it('dry-runs then copies assets and Fal mappings without deleting sources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-project-migration-'));
    directories.push(directory);
    const assetSource = join(directory, 'legacy-assets');
    const assetTargetRoot = join(directory, 'asset-scopes');
    const falSource = join(directory, 'legacy-fal.json');
    const falTargetRoot = join(directory, 'fal-scopes');
    const fileName = `${'a'.repeat(64)}.png`;
    await mkdir(assetSource);
    await writeFile(join(assetSource, fileName), Buffer.from('asset'), { mode: 0o600 });
    await writeFile(falSource, JSON.stringify({ version: 1, jobs: [] }), { mode: 0o600 });
    const args = [
      'scripts/migrate-project-storage.mjs',
      '--asset-source', assetSource,
      '--asset-target-root', assetTargetRoot,
      '--fal-source', falSource,
      '--fal-target-root', falTargetRoot,
      '--tenant', 'tenant-a',
      '--project', 'project-a',
    ];

    const dryRun = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
    expect(dryRun.status).toBe(0);
    const plan = JSON.parse(dryRun.stdout) as {
      mode: string;
      assetCount: number;
      assetTarget: string;
      falTarget: string;
    };
    expect(plan).toMatchObject({ mode: 'dry-run', assetCount: 1 });
    await expect(stat(plan.assetTarget)).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = spawnSync(process.execPath, [...args, '--apply'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(applied.status).toBe(0);
    const result = JSON.parse(applied.stdout) as typeof plan;
    await expect(readFile(join(result.assetTarget, fileName))).resolves.toEqual(Buffer.from('asset'));
    await expect(readFile(result.falTarget, 'utf8')).resolves.toBe(JSON.stringify({ version: 1, jobs: [] }));
    await expect(readFile(join(assetSource, fileName))).resolves.toEqual(Buffer.from('asset'));
    await expect(readFile(falSource, 'utf8')).resolves.toContain('"version":1');

    const duplicate = spawnSync(process.execPath, [...args, '--apply'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain('目标范围已存在');
  });
});
