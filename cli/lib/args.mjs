/**
 * 命令行参数解析（零依赖）。
 *
 * 规则：
 *  - 第一个非选项参数是命令，其余非选项参数是位置参数。
 *  - `--key value` / `--key=value` / `--flag`（布尔）/ `-h` 短选项。
 *  - 未知选项不报错，统一收集，由命令自行校验（便于新增命令而不改解析器）。
 */

/**
 * 需要取值的选项名（白名单）。
 *
 * 语义：只有列在这里的 `--key` 才会消费下一个参数作为值；
 * 其余 `--key` 一律按布尔标志处理（`--key` = true）。这样 `--json --force` 这类连写不会互相吞参数。
 * 未列出的选项不会报错，仍会被收集到 flags 里（便于新增命令而不改解析器）。
 */
const VALUED_HINTS = new Set([
  'root', 'pack', 'name', 'description', 'owner', 'budget', 'max-files',
  'area', 'expand', 'changed', 'slug', 'out', 'limit', 'depth', 'apply',
  'src-dir', 'tests-dir', 'prompt', 'problem', 'level', 'contributors',
  'packageManager', 'runtime', 'language', 'engine', 'unityVersion',
  'ueVersion', 'godotVersion', 'renderPipeline', 'usesBlueprint', 'gdscript',
]);

export function parseArgs(argv = process.argv.slice(2)) {
  const positionals = [];
  const flags = {};
  const unknown = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (!VALUED_HINTS.has(body) || next === undefined || next.startsWith('-')) {
        flags[body] = true;
      } else {
        flags[body] = next;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const short = arg.slice(1);
      if (short === 'h') flags.help = true;
      else if (short === 'v') flags.version = true;
      else if (short === 'y') flags.yes = true;
      else unknown.push(arg);
      continue;
    }
    positionals.push(arg);
  }

  return {
    command: positionals[0] ?? null,
    args: positionals.slice(1),
    flags,
    unknown,
  };
}

export function flagString(flags, key, fallback = undefined) {
  const v = flags[key];
  if (v === undefined || v === true) return fallback;
  return String(v);
}

export function flagNumber(flags, key, fallback) {
  const v = flags[key];
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function flagBool(flags, key, fallback = false) {
  const v = flags[key];
  if (v === undefined) return fallback;
  if (v === true) return true;
  if (v === false) return false;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

/**
 * kebab-case → camelCase 归一化，供 pack-local 变量使用。
 * 例：`--package-manager pnpm` 与 `--packageManager pnpm` 等价；
 * 同时保留原键，避免影响 `src-dir` 这类原本就是 kebab 的通用选项。
 */
export function normalizeVarFlags(flags, { reserved = [] } = {}) {
  const out = {};
  const skip = new Set(reserved);
  for (const [key, value] of Object.entries(flags)) {
    if (skip.has(key)) continue;
    out[key] = value;
    const camel = key.replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase());
    if (camel !== key && out[camel] === undefined) out[camel] = value;
  }
  return out;
}
