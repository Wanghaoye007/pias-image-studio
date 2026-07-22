import { describe, expect, it } from 'vitest';

import { inspectTrackedFile } from '../scripts/repository-hygiene-core.mjs';

describe('repository hygiene', () => {
  const legacyBrand = ['p', 'i', 'a', 's'].join('');
  const legacyBrandUpper = legacyBrand.toUpperCase();
  const legacyBrandPascal = `${legacyBrand[0].toUpperCase()}${legacyBrand.slice(1)}`;

  it('allows release source, documentation, and non-secret configuration examples', () => {
    expect(inspectTrackedFile({
      path: 'deploy/content-studio.env.example',
      size: 72,
      content: 'FAL_KEY_FILE=/etc/content-studio/fal-inference.key\nCONTENT_STUDIO_PUBLIC_BASE_URL=https://studio.example.com',
    })).toEqual([]);
  });

  it.each([
    [`src/${legacyBrand}Example.ts`, 'export const product = "Content Studio";'],
    ['src/example.ts', `const product = "${legacyBrandUpper}";`],
    ['src/example.ts', `const worker = "${legacyBrand}-worker";`],
    ['src/example.ts', `type ${legacyBrandPascal}Database = unknown;`],
  ])('rejects legacy branding and related identifiers in %s', (path, content) => {
    expect(inspectTrackedFile({ path, size: content.length, content })).toContainEqual({
      path,
      code: 'FORBIDDEN_LEGACY_BRAND',
    });
  });

  it.each([
    ['analysis/contact-sheet.png', 'FORBIDDEN_RELEASE_PATH'],
    ['thesea_videos/reference.mp4', 'FORBIDDEN_RELEASE_PATH'],
    ['dist/index.html', 'FORBIDDEN_RELEASE_PATH'],
    ['runtime/content-studio.sqlite', 'FORBIDDEN_RELEASE_PATH'],
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
