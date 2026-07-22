import { describe, expect, it } from 'vitest';

import { inspectTrackedFile } from '../scripts/repository-hygiene-core.mjs';

describe('repository hygiene', () => {
  it('allows release source, documentation, and non-secret configuration examples', () => {
    expect(inspectTrackedFile({
      path: 'deploy/pias.env.example',
      size: 72,
      content: 'FAL_KEY_FILE=/etc/pias/fal-inference.key\nPIAS_PUBLIC_URL=https://pias.example.com',
    })).toEqual([]);
  });

  it.each([
    ['analysis/contact-sheet.png', 'FORBIDDEN_RELEASE_PATH'],
    ['thesea_videos/reference.mp4', 'FORBIDDEN_RELEASE_PATH'],
    ['dist/index.html', 'FORBIDDEN_RELEASE_PATH'],
    ['runtime/pias.sqlite', 'FORBIDDEN_RELEASE_PATH'],
    ['.env.production', 'FORBIDDEN_RELEASE_PATH'],
  ])('rejects tracked release-excluded path %s', (path, code) => {
    expect(inspectTrackedFile({ path, size: 1, content: 'x' })).toContainEqual({ path, code });
  });

  it('rejects oversized tracked files', () => {
    expect(inspectTrackedFile({
      path: 'public/too-large.png',
      size: 5 * 1024 * 1024 + 1,
      content: null,
    })).toContainEqual({ path: 'public/too-large.png', code: 'TRACKED_FILE_TOO_LARGE' });
  });

  it.each([
    [['/Users', 'alice', 'Desktop/key.md'].join('/'), 'PERSONAL_ABSOLUTE_PATH'],
    [[
      '123e4567-e89b-12d3-a456-426614174000',
      '0123456789abcdef0123456789abcdef',
    ].join(':'), 'FAL_KEY_SHAPED_VALUE'],
    [['sk', 'live0123456789abcdefghijklmnop'].join('-'), 'OPENAI_KEY_SHAPED_VALUE'],
    [['-----BEGIN', 'PRIVATE KEY-----'].join(' '), 'PRIVATE_KEY_MATERIAL'],
  ])('rejects sensitive tracked text', (content, code) => {
    expect(inspectTrackedFile({ path: 'src/example.ts', size: content.length, content })).toContainEqual({
      path: 'src/example.ts',
      code,
    });
  });
});
