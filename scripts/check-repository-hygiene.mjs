import { execFileSync } from 'node:child_process';
import { lstat, readFile, readlink } from 'node:fs/promises';

import { inspectTrackedFile } from './repository-hygiene-core.mjs';

const trackedOutput = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
const trackedFiles = trackedOutput.split('\0').filter(Boolean);
const findings = [];

for (const path of trackedFiles) {
  const fileStat = await lstat(path);
  let content = null;
  if (fileStat.isSymbolicLink()) {
    content = await readlink(path);
  } else if (fileStat.isFile()) {
    const bytes = await readFile(path);
    if (!bytes.includes(0)) content = bytes.toString('utf8');
  }
  findings.push(...inspectTrackedFile({ path, size: fileStat.size, content }));
}

if (findings.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, findings }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, trackedFiles: trackedFiles.length })}\n`);
}
