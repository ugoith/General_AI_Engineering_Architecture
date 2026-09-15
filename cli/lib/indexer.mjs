/**
 * 文件索引器：为项目构建/更新 `.ai/index/files.json`。
 *
 * 设计要点（见 docs/system/04-context-discipline.md）：
 *  - `hash` 是内容指纹，用于判定"是否需要重读源码"。
 *  - `digest` 是语义摘要，由 AI 生成；`reviewedHash` 记录摘要所对应的内容版本。
 *  - 本模块**从不生成语义摘要**，只做机械部分：hash、行数、语言、依赖反向引用、优先级与待办清单。
 *    语义摘要由 AI 通过 `index --stale` / `index --apply` 往返填写，保证可审计。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  walk, sha256, countLines, languageOf, readJsonSafe, writeJson, normalizeRel,
  matchesAny, isProbablyText, toPosix,
} from './fsx.mjs';
import { candidatePathsOf } from './pathc.mjs';

export const INDEX_SCHEMA_VERSION = 1;

const IMPORT_PATTERNS = [
  // JS/TS
  /(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Python
  /(?:^|\n)\s*from\s+([.\w]+)\s+import\s+/g,
  /(?:^|\n)\s*import\s+([.\w]+)/g,
  // C# / Unity
  /(?:^|\n)\s*using\s+([\w.]+)\s*;/g,
  // C / C++
  /(?:^|\n)\s*#include\s+["<]([^">]+)[">]/g,
  // GDScript
  /(?:^|\n)\s*(?:preload|load)\(\s*["']([^"']+)["']\s*\)/g,
  /(?:^|\n)extends\s+["']?([\w/]+)["']?/g,
];

const CONFIG_HINTS = [
  /(^|\/)(dockerfile|docker-compose\.ya?ml|makefile)$/i,
  /\.(csproj|sln|uproject|godot|config|ini|env|toml|ya?ml)$/i,
  /(^|\/)(package\.json|pyproject\.toml|tsconfig\.json|cargo\.toml|go\.mod)$/i,
  /(^|\/)project\.godot$/i,
];

const HIGH_RISK_NAME = /(migration|schema|contract|registry|constitution|api|protocol|save|serial|security|crypto|auth)/i;

export function scanProject(root, opts = {}) {
  const {
    extraIgnore = [],
    previous = null,
    maxFileBytes = 512 * 1024,
  } = opts;
  const { files: relFiles } = walk(root, { ignore: extraIgnore });
  const prevMap = new Map((previous?.files ?? []).map((f) => [f.path, f]));
  const entries = [];

  for (const rel of relFiles) {
    if (matchesAny(rel, ['.ai/index/files.json'])) continue;
    // 框架快照（.ai/framework/**、.ai/bin/**、.ai/lib/**）不进索引：
    // 它们是框架只读资产，既不需要摘要，也永远不该出现在任务读取清单里。
    if (isFrameworkSnapshot(rel)) continue;
    const abs = path.join(root, rel);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    const text = stat.size <= maxFileBytes && isProbablyText(abs)
      ? fs.readFileSync(abs, 'utf8')
      : null;
    const hash = text === null
      ? sha256(`binary:${stat.size}`)
      : sha256(text);
    const prev = prevMap.get(rel);
    const lang = languageOf(rel);
    const loc = text === null ? null : countLines(text);
    const imports = text === null ? [] : extractImports(text, rel);
    const digest = reconcileDigest(prev, hash);

    entries.push({
      path: rel,
      kind: text === null ? 'binary-or-large' : 'text',
      lang,
      loc,
      bytes: stat.size,
      hash,
      imports,
      importedBy: [],
      owner: prev?.owner ?? null,
      risk: prev?.risk ?? initialRisk(rel, loc, imports.length, text),
      tags: prev?.tags ?? initialTags(rel),
      digest,
    });
  }

  buildReverseDeps(entries);
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    generated: new Date().toISOString(),
    root: '.',
    fileCount: entries.length,
    files: entries,
    summary: summarize(entries),
  };
}

function extractImports(text, rel) {
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const spec = match[1];
      if (!spec) continue;
      if (/^[.\w]+$/.test(spec) && spec.includes('.')) {
        // C#/Python 命名空间：保留，但不当作相对路径
        found.add(spec);
        continue;
      }
      const resolved = resolveSpecifier(spec, rel);
      if (resolved) found.add(resolved);
    }
  }
  return [...found].slice(0, 60);
}

function resolveSpecifier(spec, rel) {
  if (spec.startsWith('.')) {
    const base = toPosix(path.posix.join(path.posix.dirname(rel), spec));
    return normalizeRel(base);
  }
  if (spec.startsWith('res://') || spec.startsWith('user://')) return spec;
  return null; // 外部依赖只记录在 deps.json，不进入 imports
}

function buildReverseDeps(entries) {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  for (const entry of entries) {
    for (const target of entry.imports) {
      for (const candidate of candidatePathsOf(target)) {
        const hit = byPath.get(candidate);
        if (hit && !hit.importedBy.includes(entry.path)) hit.importedBy.push(entry.path);
      }
    }
  }
}

function reconcileDigest(prev, hash) {
  const prevDigest = prev?.digest ?? null;
  if (!prevDigest || !prevDigest.reviewedHash) {
    return {
      status: 'pending',
      purpose: null,
      exports: [],
      invariants: [],
      risk: prevDigest?.risk ?? null,
      tags: [],
      reviewedHash: null,
      reviewedAt: null,
      stale: false,
    };
  }
  const stale = prevDigest.reviewedHash !== hash;
  return {
    status: stale ? 'stale' : (prevDigest.status ?? 'digest'),
    purpose: prevDigest.purpose ?? null,
    exports: prevDigest.exports ?? [],
    invariants: prevDigest.invariants ?? [],
    risk: prevDigest.risk ?? null,
    tags: prevDigest.tags ?? [],
    reviewedHash: prevDigest.reviewedHash,
    reviewedAt: prevDigest.reviewedAt ?? null,
    stale,
  };
}

function initialRisk(rel, loc, importCount, text) {
  if (CONFIG_HINTS.some((re) => re.test(rel))) return 'high';
  if (HIGH_RISK_NAME.test(rel)) return 'high';
  if (loc !== null && loc > 600) return 'high';
  if (loc !== null && loc > 300) return 'medium';
  if (importCount > 8) return 'medium';
  if (text && /TODO|FIXME|HACK/.test(text)) return 'medium';
  return 'low';
}

function initialTags(rel) {
  const tags = [];
  if (/\.(md)$/i.test(rel)) tags.push('doc');
  if (/test|spec/i.test(rel)) tags.push('test');
  if (/(^|\/)(\.ai)\//.test(rel)) tags.push('ai-context');
  if (/\.(csproj|sln|uproject|godot|json|ya?ml|toml)$/i.test(rel)) tags.push('config');
  return tags;
}

function summarize(entries) {
  const byRisk = { high: 0, medium: 0, low: 0 };
  let pending = 0;
  let stale = 0;
  let loc = 0;
  for (const entry of entries) {
    byRisk[entry.risk] = (byRisk[entry.risk] ?? 0) + 1;
    if (entry.digest.status === 'pending') pending += 1;
    if (entry.digest.stale) stale += 1;
    loc += entry.loc ?? 0;
  }
  return { byRisk, pendingDigest: pending, staleDigest: stale, totalLoc: loc };
}

export function loadIndex(root) {
  const file = path.join(root, '.ai', 'index', 'files.json');
  return readJsonSafe(file, null);
}

export function saveIndex(root, index) {
  const file = path.join(root, '.ai', 'index', 'files.json');
  writeJson(file, index);
  return file;
}

/**
 * 规模评估：以索引统计为准（见 docs/system/02-scales.md）。
 */
export function assessScale(index, extra = {}) {
  const files = index?.files ?? [];
  const loc = index?.summary?.totalLoc ?? 0;
  const modules = extra.modules ?? countModules(files, extra.srcDir ?? 'src');
  const contributors = extra.contributors ?? null;

  const locLevel = loc < 2000 ? 'S' : loc < 30000 ? 'M' : loc < 200000 ? 'L' : 'XL';
  const moduleLevel = modules <= 1 ? 'S' : modules <= 15 ? 'M' : modules <= 60 ? 'L' : 'XL';
  const personLevel = contributors === null ? 'S' : contributors <= 1 ? 'S' : contributors <= 8 ? 'M' : contributors <= 30 ? 'L' : 'XL';

  const order = ['S', 'M', 'L', 'XL'];
  const level = [locLevel, moduleLevel, personLevel]
    .reduce((acc, cur) => (order.indexOf(cur) > order.indexOf(acc) ? cur : acc), 'S');

  return {
    level,
    evidence: {
      loc, locLevel,
      modules, moduleLevel,
      contributors, personLevel,
    },
    reasons: [
      `代码行数 ${loc} → ${locLevel}`,
      `模块数 ${modules} → ${moduleLevel}`,
      contributors === null ? '参与人数未知（未提供 --contributors，按 S 计）' : `参与人数 ${contributors} → ${personLevel}`,
    ],
  };
}

function countModules(files, srcDir) {
  const prefix = normalizeRel(srcDir).replace(/\/$/, '');
  const dirs = new Set();
  for (const f of files) {
    if (!f.path.startsWith(prefix + '/')) continue;
    const rest = f.path.slice(prefix.length + 1).split('/');
    if (rest.length > 1) dirs.add(rest[0]);
  }
  return dirs.size;
}

/**
 * 列出需要（重新）写摘要的文件。
 *
 * 排序优先级（见 docs/system/04-context-discipline.md「摘要由谁写」）：
 *  1. 项目源码（收益最高）
 *  2. `.ai/` 里被高频读取的核心上下文（constitution / registry / impact-map）
 *  3. `.ai/` 其它文件（框架副本、任务包、ADR 等）——成本高、收益低，默认排除
 */
export function staleFiles(index, { limit = 40, includeUnread = true, includeAiInternals = false } = {}) {
  const files = index?.files ?? [];
  const eligible = (f) => f.kind === 'text' && (includeAiInternals || !isAiInternal(f.path));
  const stale = files.filter((f) => eligible(f) && (f.digest.stale || f.digest.status === 'stale'));
  const pending = includeUnread
    ? files.filter((f) => eligible(f) && f.digest.status === 'pending')
    : [];
  const score = (f) => aiContextPriority(f.path) * 1000 + riskWeight(f);
  stale.sort((a, b) => score(b) - score(a));
  pending.sort((a, b) => score(b) - score(a));
  return {
    stale,
    pending: pending.slice(0, limit),
    pendingTotal: pending.length,
    excludedAiInternals: files.filter((f) => isAiInternal(f.path) && f.digest.status === 'pending').length,
  };
}

/** `.ai/` 下的框架快照与过程文件：不参与摘要生成（只读框架资产或一次性记录）。 */
const AI_INTERNAL_PREFIXES = [
  '.ai/bin/',
  '.ai/lib/',
  '.ai/framework/',   // 框架规范与模板快照（.ai/framework/{docs,templates}）
  '.ai/tasks/',
  '.ai/cache/',
];

/**
 * 是否为"框架只读资产"：不进索引、不写摘要、不进任务读取清单。
 * 与 AI_INTERNAL 的区别：这些连索引条目都不建（索引只描述项目内容）。
 */
export function isFrameworkSnapshot(relPath) {
  return relPath.startsWith('.ai/bin/')
    || relPath.startsWith('.ai/lib/')
    || relPath.startsWith('.ai/framework/');
}
/** `.ai/` 下值得写摘要的核心上下文。 */
const AI_CORE_PATHS = new Set([
  '.ai/constitution.md',
  '.ai/registry.json',
  '.ai/index/README.md',
  '.ai/index/impact-map.json',
  '.ai/skills/README.md',
]);

function isAiInternal(relPath) {
  if (AI_CORE_PATHS.has(relPath)) return false;
  return AI_INTERNAL_PREFIXES.some((p) => relPath.startsWith(p));
}

/** 越大越优先。项目源码 > 核心上下文 > 其它 .ai 文件 > 框架快照（几乎不参与任务）。 */
export function aiContextPriority(relPath) {
  if (relPath.startsWith('.ai/framework/')) return 0;   // 框架规范/模板快照：只读资产，不该进任务读取清单
  if (relPath.startsWith('.ai/bin/') || relPath.startsWith('.ai/lib/')) return 0;
  if (relPath.startsWith('.ai/cache/')) return 0;
  if (relPath.startsWith('.ai/')) return AI_CORE_PATHS.has(relPath) ? 5 : 1;
  if (/^docs\//.test(relPath)) return 7;
  if (/(^|\/)(tests?|specs?)\//i.test(relPath) || /\.(test|spec)\./i.test(relPath)) return 8;
  return 10;
}

export function riskWeight(entry) {
  const base = entry.risk === 'high' ? 3 : entry.risk === 'medium' ? 2 : 1;
  return base * 10 + Math.min(entry.importedBy.length, 9);
}
/** 生成待填摘要的提示词载荷（供 ai-arch index --stale --json 输出给 AI）。 */
export function digestRequest(index, opts = {}) {
  const { limit = 40 } = opts;
  const { stale, pending, pendingTotal } = staleFiles(index, { limit });
  const targets = [
    ...stale.map((f) => ({ ...f, reason: 'hash-changed' })),
    ...pending.map((f) => ({ ...f, reason: 'no-digest' })),
  ];
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    instructions:
      '为每个文件生成语义摘要。只输出 JSON，不要输出解释。字段：path, purpose(≤ 200 字，说明该文件为何存在、谁依赖它), '
      + 'exports(对外暴露的符号名数组), invariants(必须保持不变的约束数组), risk(low|medium|high), tags(自由标签数组), reviewedHash(原样回填输入中的 hash)。'
      + '禁止编造：不确定的字段留空数组或 null。',
    total: targets.length,
    pendingTotal,
    files: targets.map((f) => ({
      path: f.path,
      hash: f.hash,
      lang: f.lang,
      loc: f.loc,
      imports: f.imports,
      importedBy: f.importedBy,
      reason: f.reason,
      previousPurpose: f.digest?.purpose ?? null,
    })),
  };
}

/**
 * 把 AI 产出的摘要写回索引。
 * @param {object} index
 * @param {Array<{path: string, hash?: string, reviewedHash?: string, purpose?: string, exports?: string[], invariants?: string[], risk?: string, tags?: string[]}>} digests
 */
export function applyDigests(index, digests, { now = new Date().toISOString() } = {}) {
  const byPath = new Map((index.files ?? []).map((f) => [f.path, f]));
  const applied = [];
  const rejected = [];
  for (const d of digests) {
    const entry = byPath.get(normalizeRel(d.path));
    if (!entry) {
      rejected.push({ path: d.path, reason: '索引中没有该文件' });
      continue;
    }
    const claimed = d.reviewedHash ?? d.hash ?? null;
    if (claimed && claimed !== entry.hash) {
      rejected.push({ path: d.path, reason: '摘要基于的 hash 与当前内容不一致（文件已变化），请重新阅读' });
      continue;
    }
    entry.digest = {
      status: 'digest',
      purpose: d.purpose ?? entry.digest?.purpose ?? null,
      exports: Array.isArray(d.exports) ? d.exports : (entry.digest?.exports ?? []),
      invariants: Array.isArray(d.invariants) ? d.invariants : (entry.digest?.invariants ?? []),
      risk: ['low', 'medium', 'high'].includes(d.risk) ? d.risk : (entry.digest?.risk ?? entry.risk),
      tags: Array.isArray(d.tags) ? d.tags : (entry.digest?.tags ?? []),
      reviewedHash: entry.hash,
      reviewedAt: now,
      stale: false,
    };
    if (['low', 'medium', 'high'].includes(d.risk)) entry.risk = d.risk;
    if (Array.isArray(d.tags) && d.tags.length) entry.tags = [...new Set([...(entry.tags ?? []), ...d.tags])];
    applied.push(entry.path);
  }
  index.summary = summarize(index.files ?? []);
  index.generated = now;
  return { applied, rejected };
}
