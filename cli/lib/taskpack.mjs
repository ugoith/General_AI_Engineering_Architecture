/**
 * 任务上下文包生成器。
 *
 * 目标（见 docs/system/04-context-discipline.md）：
 *  - 让 AI 开工前先拿到一份"该读什么、为什么、值多少 token、hash 是否变化"的清单；
 *  - 清单落盘、可 diff、可审计，而不是靠模型自由探索仓库。
 *
 * 决策规则（`decision` 字段）：
 *  - read-source  ：hash 已变或摘要缺失 → 必须读源码
 *  - read-digest  ：hash 未变且摘要存在 → 只读摘要，不要打开源码
 *  - skip         ：超出预算被丢弃
 */

import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens } from './report.mjs';
import { matchesAny, normalizeRel, ensureDir, isFile } from './fsx.mjs';
import { impactOf } from './neighbors.mjs';
import { DEFAULT_TASK_BUDGET } from './limits.mjs';
import { rulesDigest } from './rules.mjs';
import { loadFacts } from './facts.mjs';

export const DEFAULT_BUDGET = DEFAULT_TASK_BUDGET;

/**
 * 必读清单：每次任务都要读的固定成本部分。
 *
 * 默认三项 + **模板包声明的补充**（`alwaysRead`）。为什么要让 pack 能加：
 * 游戏项目的资产是二进制、读不了，`.ai/index/asset-index.md` 是理解资产的唯一入口，
 * 不读它就会去"试着打开 .uasset"——那是注定失败的路径。这类"该类型项目的必读项"
 * 只有模板包知道，不能写死在 CLI 里。
 */
export const BASE_ALWAYS_READ = [
  { path: 'AGENTS.md', level: 'L0', label: 'AI 入口（硬约束 + 路由表）' },
  { path: '.ai/constitution.md', level: 'L1', label: '项目宪法（红线 + 验证命令）' },
  { path: '.ai/index/README.md', level: 'L2', label: '索引体系说明（只在首次或格式变更后需要）' },
];

export function composeAlwaysRead(pack = null) {
  const extra = Array.isArray(pack?.alwaysRead) ? pack.alwaysRead : [];
  const seen = new Set(BASE_ALWAYS_READ.map((i) => i.path));
  const merged = [...BASE_ALWAYS_READ];
  for (const item of extra) {
    if (!item?.path || seen.has(item.path)) continue;
    seen.add(item.path);
    merged.push({
      path: item.path,
      level: item.level ?? 'L2',
      label: item.label ?? item.path,
      fallback: item.fallback ?? null,
    });
  }
  return merged;
}

/** 兼容旧引用。 */
export const ALWAYS_READ = BASE_ALWAYS_READ;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'that', 'this', 'from', 'into',
  'add', 'fix', 'update', 'make', 'need', 'want', 'please', 'should', 'must',
  'code', 'file', 'files', 'task',
]);

export function tokenize(text) {
  const tokens = [];
  const ascii = String(text).toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const t of ascii) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    tokens.push(t);
  }
  const cjk = String(text).match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjk) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i + 2 <= run.length; i += 1) tokens.push(run.slice(i, i + 2));
    if (run.length >= 4) tokens.push(run);
  }
  return [...new Set(tokens)];
}

function haystack(entry) {
  const d = entry.digest ?? {};
  return [
    entry.path,
    d.purpose ?? '',
    (d.exports ?? []).join(' '),
    (d.tags ?? []).join(' '),
    (d.invariants ?? []).join(' '),
  ].join(' ').toLowerCase();
}

export function scoreFile(entry, tokens) {
  const hay = haystack(entry);
  const pathLower = entry.path.toLowerCase();
  let score = 0;
  const hits = [];
  for (const token of tokens) {
    if (!hay.includes(token)) continue;
    hits.push(token);
    score += pathLower.includes(token) ? 3 : 1;
  }
  if (hits.length === 0) return { score: 0, hits: [] };
  score += Math.min(entry.importedBy?.length ?? 0, 5) * 0.5;
  if (entry.risk === 'high') score += 1;
  if (/\.(md)$/.test(entry.path)) score += 0.5;
  if (/\.(csproj|sln|uproject|godot|json|ya?ml|toml|ini|config)$/i.test(entry.path)) score += 0.5;
  if (/(^|\/)(tests?|specs?)\//i.test(entry.path) || /\.(test|spec)\./i.test(entry.path)) score += 0.4;
  // `.ai/` 下的内容按用途分层：核心上下文可读，框架快照基本无关（它们描述的是框架自身，不是本项目）
  if (/^\.ai\/framework\//.test(entry.path)) score -= 50;
  else if (/^\.ai\/(bin|lib|cache)\//.test(entry.path)) score -= 50;
  else if (/^\.ai\//.test(entry.path)) score -= 3;
  return { score, hits };
}

function needsSource(entry) {
  if (!entry.digest || entry.digest.status === 'pending') return true;
  if (entry.digest.stale) return true;
  if (!entry.digest.purpose) return true;
  return false;
}

/**
 * 估算"打开整个源码文件"的成本。
 * 依据：CJK/ASCII 混合代码平均约 9 token/行；同时用 字节/4 作下界。见 docs/04-design-notes.md 的误差说明。
 */
export const TOKENS_PER_LOC = 9;

export function estimateSourceCost(entry) {
  const byLoc = (entry.loc ?? 0) * TOKENS_PER_LOC;
  const byBytes = Math.round((entry.bytes ?? 0) / 4);
  return Math.max(byLoc, Math.min(byBytes, byLoc * 2 || byBytes));
}

export function buildTaskPack(projectRoot, prompt, opts = {}) {
  const {
    index,
    budget = DEFAULT_BUDGET,
    maxFiles = 25,
    expandDepth = 1,
    changed = [],
    area = null,
    slug = null,
    now = new Date(),
  } = opts;

  const tokens = tokenize(prompt);
  const files = index?.files ?? [];
  const scored = [];
  for (const entry of files) {
    const { score, hits } = scoreFile(entry, tokens);
    if (score <= 0) continue;
    if (area && !normalizeRel(entry.path).startsWith(normalizeRel(area))) continue;
    scored.push({ entry, score, hits });
  }
  scored.sort((a, b) => b.score - a.score || (b.entry.importedBy?.length ?? 0) - (a.entry.importedBy?.length ?? 0));

  const picked = new Map();
  for (const item of scored.slice(0, maxFiles)) picked.set(item.entry.path, { ...item, reason: 'keyword-match' });

  // 依赖邻居：任务要用的、以及依赖它的文件
  if (expandDepth > 0) {
    for (const item of [...picked.values()]) {
      const impacts = impactOf(index, [item.entry.path], { depth: expandDepth, limit: 8 });
      for (const dep of impacts.dependents) {
        if (picked.has(dep.path)) continue;
        const node = files.find((f) => f.path === dep.path);
        if (!node) continue;
        picked.set(dep.path, { entry: node, score: item.score * 0.6, hits: [], reason: `dependent(depth=${dep.depth})` });
      }
    }
  }

  // 显式变更文件必须入选
  for (const spec of changed) {
    const norm = normalizeRel(spec);
    const node = files.find((f) => f.path === norm || f.path.endsWith('/' + norm));
    if (!node) continue;
    if (!picked.has(node.path)) picked.set(node.path, { entry: node, score: 999, hits: [], reason: 'explicit-changed' });
    else picked.get(node.path).reason = 'explicit-changed';
  }

  const always = [];
  let used = 0;
  for (const item of composeAlwaysRead(opts.pack)) {
    const node = files.find((f) => f.path === item.path);
    const abs = path.join(projectRoot, item.path);
    const text = isFile(abs) ? fs.readFileSync(abs, 'utf8') : '';
    const tokensEstimate = estimateTokens(text);
    used += tokensEstimate;
    always.push({
      path: item.path,
      level: item.level,
      label: item.label,
      exists: Boolean(text),
      hash: node?.hash?.slice(0, 10) ?? null,
      tokens: tokensEstimate,
      // 该 pack 声明为必读但文件不存在 → 给出可行动提示，而不是静默少读一份
      missingHint: text ? null : (item.fallback ?? null),
    });
    if (!text) used -= tokensEstimate; // 不存在的文件不计成本
  }

  const selected = [];
  const dropped = [];
  const ordered = [...picked.values()].sort((a, b) => b.score - a.score);
  for (const item of ordered) {
    const entry = item.entry;
    const digestTokens = estimateTokens(JSON.stringify({
      purpose: entry.digest?.purpose ?? '', exports: entry.digest?.exports ?? [],
      invariants: entry.digest?.invariants ?? [],
    }));
    const sourceTokens = entry.kind === 'text' ? estimateSourceCost(entry) : 0;
    const decision = needsSource(entry) ? 'read-source' : 'read-digest';
    const cost = decision === 'read-source'
      ? Math.max(sourceTokens, digestTokens)
      : digestTokens;

    if (used + cost > budget || selected.length >= maxFiles) {
      dropped.push({
        path: entry.path,
        reason: used + cost > budget ? 'budget' : 'max-files',
        tokens: cost,
        score: Number(item.score.toFixed(2)),
      });
      continue;
    }
    used += cost;
    selected.push({
      path: entry.path,
      decision,
      reason: item.reason,
      score: Number(item.score.toFixed(2)),
      hits: item.hits,
      lang: entry.lang,
      loc: entry.loc,
      risk: entry.risk,
      hash: entry.hash.slice(0, 10),
      importedBy: entry.importedBy?.length ?? 0,
      tokens: cost,
      digest: decision === 'read-digest'
        ? {
          purpose: entry.digest?.purpose ?? null,
          exports: entry.digest?.exports ?? [],
          invariants: entry.digest?.invariants ?? [],
        }
        : null,
    });
  }

  const pendingDigest = files.filter((f) => f.digest?.status === 'pending' && f.kind === 'text').length;
  const staleDigest = files.filter((f) => f.digest?.stale).length;

  // 项目规则与项目事实必须随任务包一起给出：
  // 否则"用户新加的约束"与"当前引擎能力"在下次开工时不会被看到——
  // 而这两者恰恰最容易被漏掉（它们不在源码里，也不在索引摘要里）。
  const rules = rulesDigest(projectRoot);
  const facts = loadFacts(projectRoot);

  return {
    schemaVersion: 1,
    id: `${formatDate(now)}-${slug ?? slugify(prompt)}`,
    createdAt: now.toISOString(),
    prompt,
    tokens,
    budget,
    estimate: {
      total: used,
      mandatory: always.reduce((acc, a) => acc + a.tokens, 0),
      selected: selected.reduce((acc, s) => acc + s.tokens, 0),
      remaining: Math.max(0, budget - used),
      overBudget: used > budget,
    },
    always,
    readList: selected,
    dropped,
    indexHealth: { pendingDigest, staleDigest, totalFiles: files.length },
    rules,
    facts: facts
      ? {
        engine: facts.engine ?? null,
        capabilities: (facts.capabilities ?? []).map((c) => ({
          id: c.id,
          label: c.label,
          available: c.available,
          reasons: c.reasons,
          whatItDoesNot: c.whatItDoesNot,
        })),
      }
      : null,
    scope: { in: [], out: [] },
    acceptance: [],
  };
}

export function slugify(text) {
  const ascii = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (ascii.length >= 4) return ascii.slice(0, 48);
  const cjk = String(text).replace(/[^\u4e00-\u9fff]/g, '');
  if (cjk.length > 0) return 'task-' + hash32(String(text)).toString(36);
  return 'task';
}

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function renderTaskPackMarkdown(pack) {
  const lines = [];
  lines.push('---');
  lines.push(`taskId: ${pack.id}`);
  lines.push(`createdAt: ${pack.createdAt}`);
  lines.push(`budget: ${pack.budget}`);
  lines.push(`estimatedTokens: ${pack.estimate.total}`);
  lines.push('---');
  lines.push('');
  lines.push(`# 任务包：${pack.prompt}`);
  lines.push('');
  lines.push('> 本文件由 `node .ai/bin/ai-arch.mjs task "<描述>"` 生成。**请先按读取清单读取，不要满仓库搜索。**');
  lines.push('> 标注 `read-digest` 的文件：hash 未变，只读摘要即可，**不要打开源码**。');
  lines.push('');

  lines.push('## 0. 索引健康度');
  lines.push('');
  lines.push(`- 索引文件总数：${pack.indexHealth.totalFiles}`);
  lines.push(`- 待写摘要：${pack.indexHealth.pendingDigest} 个${pack.indexHealth.pendingDigest > 0 ? '（先跑 `ai-arch index --stale`，或在本任务结束时补齐）' : ''}`);
  lines.push(`- 摘要已过期（hash 变化）：${pack.indexHealth.staleDigest} 个`);
  lines.push('');

  lines.push('## 1. 必读（每次任务固定成本）');
  lines.push('');
  lines.push('| 层 | 文件 | 说明 | hash | 估算 token |');
  lines.push('|---|---|---|---|---|');
  for (const a of pack.always) {
    lines.push(`| ${a.level} | \`${a.path}\`${a.exists ? '' : ' ⚠️ 不存在'} | ${a.label} | ${a.hash ?? '-'} | ~${a.tokens} |`);
  }
  lines.push('');

  // 项目规则：必须在正文里逐条列出。规则是"用户提出的约束"，最容易在下次开工时被漏掉。
  if (pack.rules?.present) {
    lines.push(`## 1.5 项目规则（\`.ai/rules.json\`，hash ${pack.rules.hash}，共 ${pack.rules.count} 条）`);
    lines.push('');
    if (pack.rules.count === 0) {
      lines.push('_规则集为空。若本次任务产生了新的长期约束，先入库再写代码：_');
      lines.push('');
      lines.push('```bash');
      lines.push('node .ai/bin/ai-arch.mjs rules add "<可判定的规则>" --category <类别> --enforcement <tool|review|manual> --check "<怎么判定>"');
      lines.push('```');
    } else {
      lines.push('**这些是必须遵守的项目约束。判定方式为 tool 的先跑命令；review/manual 的请在交付时逐条自查并说明。**');
      lines.push('');
      lines.push('| ID | 规则 | 类别 | 判定方式 | 怎么判定 | 存量违规 |');
      lines.push('|---|---|---|---|---|---|');
      for (const r of pack.rules.rules) {
        lines.push(`| ${r.id} | ${r.statement} | ${r.category} | ${r.enforcement} | ${r.check} | ${r.debt > 0 ? `**${r.debt} 处待迁移**` : '—'} |`);
      }
      lines.push('');
      const scoped = pack.rules.rules.filter((r) => r.scope && r.scope !== '**');
      if (scoped.length > 0) {
        lines.push('带范围的规则（仅适用于部分路径）：');
        for (const r of scoped) lines.push(`- ${r.id}：\`${r.scope}\``);
        lines.push('');
      }
      lines.push('> 规则有变时，本文件的 hash 会随之变化——**下次任务看到 hash 变了就必须重读 `.ai/rules.json`**。');
    }
    lines.push('');
  }

  // 项目事实与能力：影响"哪种做法可行"（例如引擎是否支持编辑器 MCP）
  const caps = pack.facts?.capabilities ?? [];
  if (pack.facts?.engine || caps.length > 0) {
    lines.push('## 1.6 项目事实与可用能力（影响"哪种做法可行"）');
    lines.push('');
    if (pack.facts?.engine) {
      const e = pack.facts.engine;
      lines.push(`- 引擎：**${e.kind} ${e.version ?? '未知'}**（\`${e.uproject ?? '-'}\`）｜ 模块：${(e.modules ?? []).join('、') || '未声明'}`);
    }
    for (const c of caps) {
      lines.push(`- ${c.available ? '✅' : '❌'} **${c.label}**`);
      for (const r of c.reasons ?? []) lines.push(`  - ${r}`);
      if (c.whatItDoesNot) lines.push(`  - ⚠️ 边界：${c.whatItDoesNot}`);
    }
    if (caps.length > 0) {
      lines.push('');
      lines.push('> 事实会随引擎版本/插件启用变化。更新：`node .ai/bin/ai-arch.mjs facts refresh`');
    }
    lines.push('');
  }

  lines.push('## 2. 读取清单（按优先级）');
  lines.push('');
  if (pack.readList.length === 0) {
    lines.push('_没有匹配到文件。请检查任务描述关键词，或用 `--area <目录>` 限定范围。_');
  } else {
    lines.push('| # | 文件 | 决策 | 为何入选 | hash | 风险 | 被依赖 | 估算 token |');
    lines.push('|---|---|---|---|---|---|---|---|');
    pack.readList.forEach((s, i) => {
      const why = s.hits.length > 0 ? `关键词: ${s.hits.slice(0, 4).join(', ')}` : s.reason;
      lines.push(`| ${i + 1} | \`${s.path}\` | ${s.decision === 'read-source' ? '**读源码**' : '读摘要'} | ${why} | ${s.hash} | ${s.risk} | ${s.importedBy} | ~${s.tokens} |`);
    });
  }
  lines.push('');

  const digests = pack.readList.filter((s) => s.digest && s.digest.purpose);
  if (digests.length > 0) {
    lines.push('### 2.1 已知摘要（hash 未变，直接使用，不要重读源码）');
    lines.push('');
    for (const s of digests) {
      lines.push(`- **\`${s.path}\`** — ${s.digest.purpose}`);
      if (s.digest.exports?.length) lines.push(`  - 对外接口：${s.digest.exports.map((e) => '`' + e + '`').join('、')}`);
      if (s.digest.invariants?.length) lines.push(`  - 不变量：${s.digest.invariants.join('；')}`);
    }
    lines.push('');
  }

  if (pack.dropped.length > 0) {
    lines.push('## 2.2 因预算被丢弃');
    lines.push('');
    lines.push('这些文件与任务相关但超出预算。若确实需要，请缩小任务范围或提高 `--budget`：');
    lines.push('');
    lines.push('| 文件 | 原因 | 估算 token |');
    lines.push('|---|---|---|');
    for (const d of pack.dropped.slice(0, 15)) lines.push(`| \`${d.path}\` | ${d.reason} | ~${d.tokens} |`);
    lines.push('');
  }

  lines.push('## 3. 范围');
  lines.push('');
  lines.push('**做：**');
  lines.push('');
  lines.push('- （开工前填写：本次要改什么，边界在哪）');
  lines.push('');
  lines.push('**不做（明确排除，避免范围蔓延）：**');
  lines.push('');
  lines.push('- （填写：本次不碰什么）');
  lines.push('');
  lines.push('## 4. 验收标准');
  lines.push('');
  lines.push('- [ ] （可检查的条件，例如"`npm test` 全绿"）');
  lines.push('- [ ] 变更影响面已按 `.ai/index/impact-map.json` 更新');
  lines.push('- [ ] 索引摘要已同步（`ai-arch index`）');
  lines.push('');
  lines.push('## 5. 结果');
  lines.push('');
  lines.push('（完成后填写：实际改了什么、为什么这么改）');
  lines.push('');
  lines.push('## 6. 证据');
  lines.push('');
  lines.push('```text');
  lines.push('（粘贴验证命令与输出摘要，不要只说"测试通过"）');
  lines.push('```');
  lines.push('');
  lines.push('## 7. 遗留风险与假设');
  lines.push('');
  lines.push('- `ASSUMPTION:` （任何猜测的接口/字段/行为都必须写在这里）');
  lines.push('- `RISK:` （未覆盖的边界、已知缺陷、后续任务）');
  lines.push('');
  lines.push('## 8. 预算决算');
  lines.push('');
  lines.push(`- 预估：~${pack.estimate.total} tokens（上限 ${pack.budget}）`);
  lines.push(`- 固定成本（L0/L1）：~${pack.estimate.mandatory}`);
  lines.push(`- 实际：待填（完成后对比：预估 vs 真实际读取量，偏差超过 50% 请回写索引预算参数）`);
  lines.push('');
  return lines.join('\n');
}

export function writeTaskPack(projectRoot, pack, { out = null } = {}) {
  const dir = path.join(projectRoot, '.ai', 'tasks');
  ensureDir(dir);
  const file = out ? path.resolve(out) : path.join(dir, `${pack.id}.md`);
  fs.writeFileSync(file, renderTaskPackMarkdown(pack), 'utf8');
  return file;
}

export function isIgnoredForTask(rel, patterns) {
  return matchesAny(rel, patterns);
}
