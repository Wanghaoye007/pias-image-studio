import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const defaultKeyFile = join(homedir(), 'Desktop', 'key.md');

type FalKeyFileReader = (path: string, encoding: 'utf8') => Promise<string>;

export function parseFalKey(raw: string): string {
  const assignment = raw.match(/(?:^|\n)\s*(?:export\s+)?FAL_KEY\s*=\s*["']?([^\s"'`#]+)["']?/m);
  if (assignment?.[1]) return assignment[1];

  const bareLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes(':') && !line.startsWith('#') && !line.startsWith('```'));
  if (bareLine && !/\s/.test(bareLine)) return bareLine.replace(/^['"]|['"]$/g, '');

  throw new Error('Fal 服务凭证未配置');
}

export async function readFalKey(options: {
  env?: Record<string, string | undefined>;
  defaultFile?: string;
  fileReader?: FalKeyFileReader;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  if (env.FAL_KEY) return parseFalKey(env.FAL_KEY);

  const keyFile = env.FAL_KEY_FILE ?? options.defaultFile ?? defaultKeyFile;
  if (!keyFile) throw new Error('Fal 服务凭证未配置');

  try {
    return parseFalKey(await (options.fileReader ?? readFile)(keyFile, 'utf8'));
  } catch (error) {
    if (error instanceof Error && error.message === 'Fal 服务凭证未配置') throw error;
    throw new Error('Fal 服务凭证未配置');
  }
}
