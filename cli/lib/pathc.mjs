/**
 * 路径候选生成：与 indexer 的反向依赖解析保持同一套规则。
 */

import path from 'node:path';
import { normalizeRel, toPosix } from './fsx.mjs';

export const SOURCE_EXTS = [
  '', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.py', '.cs', '.gd',
  '.h', '.hpp', '.cpp', '.cc', '.java', '.kt', '.go', '.rs', '.rb', '.php', '.lua',
];

export function candidatePathsOf(spec) {
  const out = new Set();
  if (spec.startsWith('res://') || spec.startsWith('user://')) {
    out.add(spec);
    return [...out];
  }
  const base = normalizeRel(spec);
  for (const ext of SOURCE_EXTS) out.add(base + ext);
  for (const ext of SOURCE_EXTS.slice(1)) out.add(`${base}/index${ext}`);
  return [...out];
}

export function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(toPosix(fromFile)), spec);
  return normalizeRel(base);
}
