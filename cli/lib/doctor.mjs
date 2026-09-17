/**
 * `ai-arch doctor`：项目健康检查（静态、快、无需索引）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens } from './report.mjs';
import { exists, isFile, readJsonSafe, walk } from './fsx.mjs';
import { PACK_LIMITS, DEFAULT_TASK_BUDGET } from './limits.mjs';
import { loadIndex } from './indexer.mjs';
import { auditRules } from './rules.mjs';
import { detectFacts } from './facts.mjs';

const REQUIRED = [
  { path: 'AGENTS.md', why: 'AI 入口，缺失等于每次任务都要重新摸索项目' },
  { path: '.ai/constitution.md', why: '项目宪法：红线与验证命令' },
  { path: '.ai/index/files.json', why: '文件索引：增量读取的基础', optional: true },
  { path: '.ai/index/impact-map.json', why: '变更影响矩阵' },
  { path: '.ai/registry.json', why: '关键实体注册表' },
  { path: '.ai/tasks/TEMPLATE.md', why: '任务包模板', optional: true },
  { path: '.ai/decisions/README.md', why: 'ADR 目录索引' },
];

export function doctor(projectRoot) {
  const checks = [];
  const push = (level, code, target, message, action = null) => checks.push({ level, code, target, message, action });

  for (const item of REQUIRED) {
    const abs = path.join(projectRoot, item.path);
    if (isFile(abs)) {
      push('ok', 'file-present', item.path, '存在');
    } else if (item.optional) {
      push('warn', 'file-missing', item.path, `缺失（可选）：${item.why}`, 'node .ai/bin/ai-arch.mjs init --refresh');
    } else {
      push('error', 'file-missing', item.path, `缺失：${item.why}`, 'node .ai/bin/ai-arch.mjs init --refresh');
    }
  }

  for (const [rel, limit] of Object.entries(PACK_LIMITS)) {
    const abs = path.join(projectRoot, rel);
    if (!isFile(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const lines = text.replace(/\r\n/g, '\n').split('\n').length;
    const tokens = estimateTokens(text);
    if (lines > limit) {
      push('warn', 'context-too-long', rel, `${lines} 行 > 上限 ${limit} 行：每会话固定成本过高`, '把细节移到按需读取的文档');
    } else {
      push('ok', 'context-size', rel, `${lines}/${limit} 行，~${tokens} tokens`);
    }
  }

  // 规则集：新增约束是否已入库、是否可判定
  const rulesFile = path.join(projectRoot, '.ai', 'rules.json');
  if (isFile(rulesFile)) {
    const { issues, summary } = auditRules(projectRoot);
    const errors = issues.filter((i) => i.level === 'error');
    const warns = issues.filter((i) => i.level === 'warn');
    if (errors.length > 0) {
      push('error', 'rules-invalid', '.ai/rules.json', `${errors.length} 条规则有结构错误：${errors[0].message}`, 'node .ai/bin/ai-arch.mjs rules audit');
    } else if (warns.length > 0) {
      push('warn', 'rules-unverifiable', '.ai/rules.json', `${warns.length} 条规则判定方式不明确（判定不了的规则等于没有规则）`, 'node .ai/bin/ai-arch.mjs rules audit');
    } else {
      push('ok', 'rules', '.ai/rules.json', `${summary.total} 条规则（tool ${summary.tool} / review ${summary.review} / manual ${summary.manual}）`);
    }
    if (summary.withDebt > 0) {
      push('info', 'rules-debt', '.ai/rules.json', `${summary.withDebt} 条规则有存量违规待迁移（迁移期允许，但要有清账计划）`);
    }
  } else {
    push('info', 'rules-missing', '.ai/rules.json', '尚无项目规则集：用户提出的代码风格/工程约束会无处落地', 'node .ai/bin/ai-arch.mjs rules add "<可判定的规则>" ...');
  }

  // 项目事实：引擎能力是否与记录一致（版本/插件变了要刷新）
  const factsFile = path.join(projectRoot, '.ai', 'project-facts.json');
  const storedFacts = readJsonSafe(factsFile, null);
  if (!storedFacts) {
    push('info', 'facts-missing', '.ai/project-facts.json', '尚未探测项目事实（引擎版本与可用能力）', 'node .ai/bin/ai-arch.mjs facts refresh');
  } else {
    const { facts: fresh } = detectFacts(projectRoot);
    const storedEngine = storedFacts.engine?.version ?? null;
    const freshEngine = fresh.engine?.version ?? null;
    if (storedEngine !== freshEngine) {
      push('warn', 'facts-stale', '.ai/project-facts.json', `记录的引擎版本 ${storedEngine ?? '无'} 与实测 ${freshEngine ?? '无'} 不一致`, 'node .ai/bin/ai-arch.mjs facts refresh');
    } else {
      const avail = (fresh.capabilities ?? []).filter((c) => c.available).map((c) => c.id);
      const unavail = (fresh.capabilities ?? []).filter((c) => !c.available).map((c) => c.id);
      push('ok', 'facts', '.ai/project-facts.json',
        `引擎 ${freshEngine ?? '未检测'}；可用能力 ${avail.length > 0 ? avail.join('、') : '无'}${unavail.length > 0 ? `；不可用 ${unavail.join('、')}` : ''}`);
    }
  }

  // 索引健康
  const index = loadIndex(projectRoot);
  if (!index) {
    push('error', 'index-missing', '.ai/index/files.json', '索引不存在', 'node .ai/bin/ai-arch.mjs index');
  } else if ((index.fileCount ?? 0) === 0) {
    push('warn', 'index-empty', '.ai/index/files.json',
      '索引为空（刚 init 且尚未建立基线）', 'node .ai/bin/ai-arch.mjs index');
  } else {
    const pending = (index.files ?? []).filter((f) => f.digest?.status === 'pending' && f.kind === 'text').length;
    const stale = (index.files ?? []).filter((f) => f.digest?.stale).length;
    if (pending === 0 && stale === 0) {
      push('ok', 'index-health', '.ai/index/files.json', `${index.fileCount} 个文件，摘要齐全`);
    } else {
      push('warn', 'index-health', '.ai/index/files.json', `待写摘要 ${pending}，摘要过期 ${stale}`, 'node .ai/bin/ai-arch.mjs index --stale');
    }
    if ((index.fileCount ?? 0) > 400) {
      push('info', 'index-large', '.ai/index/files.json', `索引 ${index.fileCount} 个文件：建议任务包用 --area 限定范围以控制成本`);
    }
  }

  // 任务包是否在提交范围内的检查
  const frameworkMeta = readJsonSafe(path.join(projectRoot, '.ai', 'framework.json'), null);
  if (!frameworkMeta) {
    push('info', 'framework-meta-missing', '.ai/framework.json', '缺少框架元数据：upgrade 无法判断哪些文件被本地改动过', 'node .ai/bin/ai-arch.mjs init --refresh');
  } else {
    push('ok', 'framework-meta', '.ai/framework.json', `pack=${frameworkMeta.packId} scale=${frameworkMeta.scaleLevel} framework=${frameworkMeta.frameworkVersion}`);
  }

  // 危险文件检查
  const { files } = walk(projectRoot, {});
  for (const rel of files) {
    if (/(^|\/)\.env$/.test(rel)) {
      push('error', 'secret-tracked', rel, '疑似包含密钥的文件存在于工作区', '加入 .gitignore 并从索引中排除');
    }
    if (/\.(dll|exe|pdb|lib|so|dylib|bin)$/i.test(rel) && !/node_modules|Library|Binaries|Intermediate/.test(rel)) {
      push('info', 'binary-committed', rel, '二进制产物出现在仓库中，确认是否应该入库');
    }
  }

  const counts = checks.reduce((acc, c) => ({ ...acc, [c.level]: (acc[c.level] ?? 0) + 1 }), {});
  return {
    checks,
    summary: {
      ok: counts.ok ?? 0,
      info: counts.info ?? 0,
      warn: counts.warn ?? 0,
      error: counts.error ?? 0,
      taskBudget: DEFAULT_TASK_BUDGET,
    },
    hasErrors: (counts.error ?? 0) > 0,
  };
}

export function renderDoctor(report) {
  const lines = [];
  for (const c of report.checks) {
    const icon = c.level === 'ok' ? '✓' : c.level === 'info' ? 'i' : c.level === 'warn' ? '!' : '✗';
    lines.push(`  ${icon} [${c.code}] ${c.target} — ${c.message}`);
    if (c.action && c.level !== 'ok') lines.push(`      → ${c.action}`);
  }
  lines.push('');
  const s = report.summary;
  lines.push(`  结果：${s.ok} 项通过，${s.warn} 项警告，${s.error} 项错误，${s.info} 项提示`);
  if (s.error > 0) lines.push('  建议：先修复错误项，否则 AI 会在缺少上下文的情况下工作。');
  return lines.join('\n');
}

export { exists };
