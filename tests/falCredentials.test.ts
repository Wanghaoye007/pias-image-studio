import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFalKey } from '../src/server/fal/falCredentials';

describe('Fal credential loading', () => {
  let fileReader: ReturnType<typeof vi.fn<(path: string, encoding: 'utf8') => Promise<string>>>;

  beforeEach(() => {
    fileReader = vi.fn();
  });

  it('does not fall back to a developer key file when production disables the default', async () => {
    await expect(readFalKey({ env: {}, defaultFile: '', fileReader })).rejects.toThrow(
      'Fal 服务凭证未配置',
    );
    expect(fileReader).not.toHaveBeenCalled();
  });

  it('loads the configured Fal key file', async () => {
    fileReader.mockResolvedValue('FAL_KEY=test-id:test-secret');

    await expect(
      readFalKey({ env: { FAL_KEY_FILE: '/run/secrets/fal-key' }, fileReader }),
    ).resolves.toBe('test-id:test-secret');
    expect(fileReader).toHaveBeenCalledWith('/run/secrets/fal-key', 'utf8');
  });
});
