import { createHash } from 'node:crypto';
import { constants, chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

try {
  const options = parseArgs(process.argv.slice(2));
  const sourceBytes = await readFile(options.source);
  validateSnapshot(sourceBytes);
  const scopeKey = createHash('sha256')
    .update(options.tenantId)
    .update('\0')
    .update(options.projectId)
    .digest('hex');
  const target = join(options.targetRoot, scopeKey, 'studio-state.json');

  if (options.apply) {
    await mkdir(join(options.targetRoot, scopeKey), { recursive: true, mode: 0o700 });
    try {
      await copyFile(options.source, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('目标状态已存在，拒绝覆盖', { cause: error });
      throw error;
    }
    await chmod(target, 0o600);
  }

  process.stdout.write(`${JSON.stringify({
    mode: options.apply ? 'applied' : 'dry-run',
    source: options.source,
    target,
    tenantId: options.tenantId,
    projectId: options.projectId,
    sourceRetained: true,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : '迁移失败'}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = new Map();
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (!['--source', '--target-root', '--tenant', '--project'].includes(argument)) {
      throw new Error(`未知参数：${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${argument}`);
    values.set(argument, value);
    index += 1;
  }

  const source = values.get('--source');
  const targetRoot = values.get('--target-root');
  const tenantId = values.get('--tenant');
  const projectId = values.get('--project');
  if (!source || !targetRoot || !tenantId || !projectId) {
    throw new Error('必须提供 --source、--target-root、--tenant 和 --project');
  }
  if (!validScopeId(tenantId) || !validScopeId(projectId)) {
    throw new Error('Tenant 或 Project ID 格式无效');
  }
  return { source, targetRoot, tenantId, projectId, apply };
}

function validScopeId(value) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

function validateSnapshot(bytes) {
  let snapshot;
  try {
    snapshot = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('源状态不是有效 JSON');
  }
  if (
    !snapshot
    || typeof snapshot !== 'object'
    || Array.isArray(snapshot)
    || snapshot.schemaVersion !== 1
    || !Number.isInteger(snapshot.revision)
    || snapshot.revision < 1
    || typeof snapshot.updatedAt !== 'string'
    || !snapshot.state
    || typeof snapshot.state !== 'object'
    || Array.isArray(snapshot.state)
  ) {
    throw new Error('源状态快照格式无效');
  }
}
