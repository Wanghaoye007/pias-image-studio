import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadIdentityServiceFromConfig } from '../src/server/auth/authConfig';
import { hashPassword } from '../src/server/auth/identityService';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('authentication configuration', () => {
  it('stays unconfigured when no file path is provided', () => {
    expect(loadIdentityServiceFromConfig()).toBeNull();
  });

  it('loads only a private hash-only user configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-auth-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      users: [{
        id: 'user-owner',
        tenantId: 'tenant-a',
        email: 'owner@studio.test',
        displayName: 'Content Studio Owner',
        passwordHash: await hashPassword('Studio-release-2026!'),
        role: 'owner',
        status: 'active',
        projectIds: ['project-a'],
        mfaEnabled: true,
        mfaSecret: 'JBSWY3DPEHPK3PXP',
      }],
    }), { mode: 0o600 });

    const identity = loadIdentityServiceFromConfig(path);

    await expect(identity?.beginLogin('owner@studio.test', 'Studio-release-2026!'))
      .resolves.toMatchObject({ status: 'mfa_required' });
  });

  it('rejects world-readable files and plaintext password fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-auth-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, users: [] }), { mode: 0o600 });
    await chmod(path, 0o644);

    expect(() => loadIdentityServiceFromConfig(path)).toThrowError(/0600/);

    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      users: [{ password: 'plaintext-is-forbidden' }],
    }), { mode: 0o600 });
    await chmod(path, 0o600);
    expect(() => loadIdentityServiceFromConfig(path)).toThrowError(/明文密码/);
  });

  it('rejects business users without a valid project assignment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-auth-'));
    directories.push(directory);
    const path = join(directory, 'auth.json');
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      users: [{
        id: 'user-viewer',
        tenantId: 'tenant-a',
        email: 'viewer@studio.test',
        displayName: 'Content Studio Viewer',
        passwordHash: await hashPassword('CS-viewer-2026!'),
        role: 'viewer',
        status: 'active',
        projectIds: [],
        mfaEnabled: false,
      }],
    }), { mode: 0o600 });

    expect(() => loadIdentityServiceFromConfig(path)).toThrowError(/至少分配一个项目/);
  });
});
