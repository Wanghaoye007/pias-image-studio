import { describe, expect, it } from 'vitest';
import {
  serializeProductionLog,
  writeProductionLog,
} from '../src/server/productionLog';

describe('production log serialization', () => {
  it('keeps stable error codes without serializing messages or stacks', () => {
    const error = Object.assign(new Error('FAL_KEY=must-not-be-logged'), {
      code: 'SQLITE_BUSY',
    });

    const output = serializeProductionLog('pias_operation_failed', {
      requestId: 'request-safe',
    }, error);

    expect(JSON.parse(output)).toEqual({
      event: 'pias_operation_failed',
      requestId: 'request-safe',
      errorCode: 'SQLITE_BUSY',
    });
    expect(output).not.toContain('must-not-be-logged');
    expect(output).not.toContain('stack');
  });

  it('replaces untrusted error codes and drops unsafe fields', () => {
    const output = serializeProductionLog('pias_operation_failed', {
      path: '/api/fal/jobs',
      prompt: 'must-not-be-logged',
      imageUrl: 'data:image/png;base64,must-not-be-logged',
    }, {
      code: 'secret=must-not-be-logged',
      message: 'must-not-be-logged',
    });

    expect(JSON.parse(output)).toEqual({
      event: 'pias_operation_failed',
      path: '/api/fal/jobs',
      errorCode: 'UNEXPECTED_ERROR',
    });
    expect(output).not.toContain('must-not-be-logged');
  });

  it('does not let a logging transport failure interrupt production work', () => {
    expect(() => writeProductionLog(
      () => { throw new Error('stdout unavailable'); },
      'pias_http_request',
      { requestId: 'request-safe' },
    )).not.toThrow();
  });
});
