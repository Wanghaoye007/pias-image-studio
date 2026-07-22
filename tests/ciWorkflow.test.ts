import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release quality workflow', () => {
  it('runs every local release gate with least-privilege access', () => {
    const workflow = readFileSync(`${process.cwd()}/.github/workflows/release-quality.yml`, 'utf8');

    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38');
    expect(workflow).toContain("node-version: '24'");
    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('run: npm ci');
    [
      'npm run repo:check',
      'npm run lint',
      'npm run typecheck',
      'npm test -- --run',
      'npm run build',
      'npm audit --omit=dev --audit-level=high',
    ].forEach((command) => expect(workflow).toContain(`run: ${command}`));
    expect(workflow).toContain('uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(workflow).toContain('dist-server/');
  });
});
