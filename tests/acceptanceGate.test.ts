import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateAcceptance,
  validateManifest,
  type AcceptanceManifest,
} from '../scripts/acceptance-core.mjs';

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'acceptance/manifest.json'), 'utf8'));

function fixture(status: 'pass' | 'fail' | 'partial', severity: 'P0' | 'P1' | 'P2'): AcceptanceManifest {
  return {
    schemaVersion: 1,
    project: 'fixture',
    target: 'production',
    checks: [{
      id: 'CHECK-001',
      category: 'business',
      severity,
      required: true,
      status,
      summary: 'fixture check',
      evidence: 'fixture evidence',
    }],
    automation: [],
  };
}

describe('acceptance gate', () => {
  it('validates the Content Studio manifest and keeps acceptance yellow while non-P0 gaps exist', () => {
    expect(() => validateManifest(manifest)).not.toThrow();
    const result = evaluateAcceptance(manifest);

    expect(result.conclusion).toBe('yellow');
    expect(result.unresolved.filter((item) => item.severity === 'P0')).toEqual([]);
  });

  it('returns red for any unresolved P0', () => {
    expect(evaluateAcceptance(fixture('fail', 'P0')).conclusion).toBe('red');
  });

  it('returns yellow for unresolved non-P0 required evidence', () => {
    expect(evaluateAcceptance(fixture('partial', 'P1')).conclusion).toBe('yellow');
    expect(evaluateAcceptance(fixture('fail', 'P2')).conclusion).toBe('yellow');
  });

  it('returns green only when every required check passes', () => {
    expect(evaluateAcceptance(fixture('pass', 'P1')).conclusion).toBe('green');
  });

  it('includes failed automation in the decision', () => {
    const result = evaluateAcceptance(fixture('pass', 'P1'), [{
      id: 'AUTO-001',
      label: 'fixture command',
      severity: 'P1',
      ok: false,
      exitCode: 1,
      output: 'failed',
    }]);

    expect(result.conclusion).toBe('yellow');
    expect(result.unresolved[0].source).toBe('automation');
  });
});
