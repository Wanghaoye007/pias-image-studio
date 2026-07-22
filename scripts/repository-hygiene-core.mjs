export const MAX_TRACKED_FILE_BYTES = 5 * 1024 * 1024;

const forbiddenPathPatterns = [
  /^(?:analysis|dist|dist-server|figma_thesea_slides_15_21|thesea_videos)\//,
  /(?:^|\/)\.env(?:$|\.(?!example$))/,
  /\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/i,
];

const sensitiveTextPatterns = [
  ['PERSONAL_ABSOLUTE_PATH', /\/(?:Users|home)\/[^/\s"'`]+\//],
  ['FAL_KEY_SHAPED_VALUE', /[0-9a-f]{8}-[0-9a-f-]{27,}:[0-9a-f]{24,}/i],
  ['OPENAI_KEY_SHAPED_VALUE', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['AWS_KEY_SHAPED_VALUE', /\bAKIA[A-Z0-9]{16}\b/],
  ['PRIVATE_KEY_MATERIAL', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
];

export function inspectTrackedFile({ path, size, content }) {
  const normalizedPath = path.replaceAll('\\', '/');
  const findings = [];

  if (forbiddenPathPatterns.some((pattern) => pattern.test(normalizedPath))) {
    findings.push({ path: normalizedPath, code: 'FORBIDDEN_RELEASE_PATH' });
  }
  if (size > MAX_TRACKED_FILE_BYTES) {
    findings.push({ path: normalizedPath, code: 'TRACKED_FILE_TOO_LARGE' });
  }
  if (typeof content === 'string') {
    for (const [code, pattern] of sensitiveTextPatterns) {
      if (pattern.test(content)) findings.push({ path: normalizedPath, code });
    }
  }

  return findings;
}
