import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { initialStudioState } from '../src/domain';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('StudioState tenant migration command', () => {
  it('defaults to dry-run and copies without deleting or overwriting the legacy source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pias-state-migration-'));
    directories.push(directory);
    const source = join(directory, 'legacy.json');
    const targetRoot = join(directory, 'scopes');
    const snapshot = {
      schemaVersion: 1,
      revision: 3,
      updatedAt: '2026-07-22T03:50:00.000Z',
      state: initialStudioState(),
    };
    await writeFile(source, JSON.stringify(snapshot), { mode: 0o600 });
    const args = [
      'scripts/migrate-studio-state.mjs',
      '--source', source,
      '--target-root', targetRoot,
      '--tenant', 'tenant-a',
      '--project', 'project-a',
    ];

    const dryRun = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
    expect(dryRun.status).toBe(0);
    const plan = JSON.parse(dryRun.stdout) as { mode: string; target: string };
    expect(plan.mode).toBe('dry-run');
    await expect(stat(plan.target)).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = spawnSync(process.execPath, [...args, '--apply'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(applied.status).toBe(0);
    const result = JSON.parse(applied.stdout) as { mode: string; target: string };
    expect(result.mode).toBe('applied');
    await expect(readFile(result.target, 'utf8')).resolves.toBe(JSON.stringify(snapshot));
    await expect(readFile(source, 'utf8')).resolves.toBe(JSON.stringify(snapshot));
    expect((await stat(result.target)).mode & 0o077).toBe(0);

    const duplicate = spawnSync(process.execPath, [...args, '--apply'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain('目标状态已存在');
  });
});
