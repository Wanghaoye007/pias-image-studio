import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

let createdAssetTarget = '';
let createdFalTarget = '';

try {
  const options = parseArgs(process.argv.slice(2));
  const assetFiles = (await readdir(options.assetSource, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const falBytes = await readFile(options.falSource);
  validateFalState(falBytes);
  const scopeKey = createHash('sha256')
    .update(options.tenantId)
    .update('\0')
    .update(options.projectId)
    .digest('hex');
  const assetTarget = join(options.assetTargetRoot, scopeKey);
  const falTarget = join(options.falTargetRoot, scopeKey, 'fal-queue-state.json');

  if (options.apply) {
    if (await exists(assetTarget) || await exists(falTarget)) {
      throw new Error('目标范围已存在，拒绝覆盖');
    }
    try {
      await mkdir(dirname(assetTarget), { recursive: true, mode: 0o700 });
      await mkdir(assetTarget, { mode: 0o700 });
      createdAssetTarget = assetTarget;
      for (const fileName of assetFiles) {
        const targetFile = join(assetTarget, fileName);
        await copyFile(join(options.assetSource, fileName), targetFile);
        await chmod(targetFile, 0o600);
      }

      await mkdir(dirname(falTarget), { recursive: true, mode: 0o700 });
      await copyFile(options.falSource, falTarget);
      createdFalTarget = falTarget;
      await chmod(falTarget, 0o600);
    } catch (error) {
      if (createdAssetTarget) await rm(createdAssetTarget, { recursive: true, force: true });
      if (createdFalTarget) await rm(createdFalTarget, { force: true });
      throw error;
    }
  }

  process.stdout.write(`${JSON.stringify({
    mode: options.apply ? 'applied' : 'dry-run',
    tenantId: options.tenantId,
    projectId: options.projectId,
    assetCount: assetFiles.length,
    assetSource: options.assetSource,
    assetTarget,
    falSource: options.falSource,
    falTarget,
    sourcesRetained: true,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : '迁移失败'}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = new Map();
  let apply = false;
  const named = [
    '--asset-source', '--asset-target-root', '--fal-source', '--fal-target-root',
    '--tenant', '--project',
  ];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (!named.includes(argument)) throw new Error(`未知参数：${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${argument}`);
    values.set(argument, value);
    index += 1;
  }
  for (const name of named) {
    if (!values.get(name)) throw new Error(`必须提供 ${name}`);
  }
  const tenantId = values.get('--tenant');
  const projectId = values.get('--project');
  if (!validScopeId(tenantId) || !validScopeId(projectId)) {
    throw new Error('Tenant 或 Project ID 格式无效');
  }
  return {
    assetSource: values.get('--asset-source'),
    assetTargetRoot: values.get('--asset-target-root'),
    falSource: values.get('--fal-source'),
    falTargetRoot: values.get('--fal-target-root'),
    tenantId,
    projectId,
    apply,
  };
}

function validScopeId(value) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

function validateFalState(bytes) {
  let state;
  try {
    state = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Fal 源状态不是有效 JSON');
  }
  if (!state || typeof state !== 'object' || state.version !== 1 || !Array.isArray(state.jobs)) {
    throw new Error('Fal 源状态格式无效');
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
