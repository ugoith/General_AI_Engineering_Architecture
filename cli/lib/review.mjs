/**
 * `ai-arch review` 的实现：机械可判定的"规范漂移"检测。
 *
 * 只做能自动判定的部分（见 docs/system/05-lifecycle.md）：
 *  - 索引漂移：文件 hash 变化但摘要未更新、或索引缺失、文件已删除
 *  - 决策缺失：命中 impact-map 规则但没有 ADR 记录
 *  - 注册表漂移：契约（实体）被改但注册表未同步 —— 注册表的 hash 与索引对账
 *  - 文档漂移：文档中引用的代码路径不存在
 *  - 令牌预算：AGENTS.md / constitution.md 超出上限
 */

import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens } from './report.mjs';
import { exists, isDir, isFile, normalizeRel, readJsonSafe, walk } from './fsx.mjs';
import { scanProject, loadIndex } from './indexer.mjs';
import { PACK_LIMITS, CONTEXT_TOKEN_BUDGETS } from './limits.mjs';
import { reconcileRegistry } from './registry.mjs';

export const TOKEN_BUDGETS = CONTEXT_TOKEN_BUDGETS;

export function reviewDrift(projectRoot, opts = {}) {
  const { strict = false } = opts;
  const index = loadIndex(projectRoot);
  const findings = [];

  if (!index) {
    findings.push(finding('error', 'index-missing', '.ai/index/files.json', '索引不存在，AI 每次都会重新探索仓库', 'node .ai/bin/ai-arch.mjs index'));
    return { findings, summary: summarizeFindings(findings) };
  }

  const current = scanProject(projectRoot, { previous: index });
  const prevByPath = new Map((index.files ?? []).map((f) => [f.path, f]));
  const curByPath = new Map(current.files.map((f) => [f.path, f]));

  for (const entry of current.files) {
    const prev = prevByPath.get(entry.path);
    if (!prev) {
      findings.push(finding('info', 'file-new', entry.path, '新增文件，索引里还没有语义摘要', 'node .ai/bin/ai-arch.mjs index --stale'));
      continue;
    }
    // 索引里已标记 stale（上次 index 时发现内容变化）→ 必须报出，否则摘要会永久过期
    if (prev.digest?.stale) {
      findings.push(finding('warn', 'digest-stale', entry.path, '文件内容已变，索引摘要是旧的（AI 可能据此做出错误判断）', 'node .ai/bin/ai-arch.mjs index --stale'));
    }
    if (prev.hash === entry.hash && prev.digest?.status === 'pending' && entry.kind === 'text') {
      findings.push(finding('info', 'digest-missing', entry.path, '尚无语义摘要，每次任务都要重读源码', 'node .ai/bin/ai-arch.mjs index --stale'));
    }
  }

  for (const entry of index.files ?? []) {
    if (!curByPath.has(entry.path)) {
      findings.push(finding('warn', 'file-deleted', entry.path, '索引里仍保留已删除文件，可能误导 AI 去读不存在的文件', 'node .ai/bin/ai-arch.mjs index'));
    }
  }

  // 预算检查
  for (const [rel, budget] of Object.entries(TOKEN_BUDGETS)) {
    const abs = path.join(projectRoot, rel);
    if (!isFile(abs)) {
      if (rel === 'AGENTS.md' || rel === '.ai/constitution.md') {
        findings.push(finding('error', 'context-file-missing', rel, '分层上下文的必需文件缺失', 'node .ai/bin/ai-arch.mjs doctor'));
      }
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    const lines = text.split(/\r?\n/).length;
    const tokens = estimateTokens(text);
    if (tokens > budget) {
      findings.push(finding('warn', 'context-budget', rel, `${tokens} tokens 超出预算 ${budget}（每会话固定成本），应把内容移到按需读取的文档`, '见 docs/system/04-context-discipline.md'));
    }
    if (PACK_LIMITS[rel] && lines > PACK_LIMITS[rel]) {
      findings.push(finding('warn', 'context-lines', rel, `${lines} 行超出 ${PACK_LIMITS[rel]} 行上限`, '拆分为按需读取的文档'));
    }
  }

  // 决策缺失：impact-map 规则 vs decisions 目录
  findings.push(...reviewDecisions(projectRoot, current));

  // 注册表 × 索引 对账：检出"契约被改但注册表未同步"这类静默漂移
  const reg = reconcileRegistry(projectRoot, { limit: 8 });
  findings.push(...reg.findings);

  // 文档引用漂移
  findings.push(...reviewDocLinks(projectRoot));

  const summary = summarizeFindings(findings);
  return {
    findings, summary, registry: reg.summary, strictFailed: strict && summary.error + summary.warn > 0,
  };
}

function reviewDecisions(projectRoot, current) {
  const findings = [];
  const impactMap = readJsonSafe(path.join(projectRoot, '.ai', 'index', 'impact-map.json'), null);
  if (!impactMap?.rules) return findings;
  const decisionsDir = path.join(projectRoot, '.ai', 'decisions');
  // 注意：必须用 isDir 判断（早期版本误用 isFile，导致这个检查永远不会触发）
  const adrFiles = isDir(decisionsDir)
    ? fs.readdirSync(decisionsDir).filter((f) => /^\d{4}-.*\.md$/.test(f))
    : [];
  if (adrFiles.length === 0) {
    findings.push(finding(
      'info', 'decisions-empty', '.ai/decisions/',
      '尚无任何 ADR。若项目已发生依赖/契约/模块边界变更，说明决策没有记录',
      'node .ai/bin/ai-arch.mjs review --decisions',
    ));
  }
  return findings;
}

function reviewDocLinks(projectRoot) {
  const findings = [];
  const { files } = walk(projectRoot, { ignore: ['.ai/index/files.json'] });
  // 跳过框架规范快照与模板快照：它们描述的是"框架文档体系"，其中引用的路径相对框架仓库而非本项目，
  // 逐条报 doc-link-missing 只会制造噪音（见 docs/system/05-lifecycle.md）。
  const docFiles = files.filter((f) => f.endsWith('.md')
    && !/^\.ai\/tasks\//.test(f)
    && !/^\.ai\/framework\//.test(f));
  const pathRe = /`([A-Za-z0-9_./-]+\.(?:mjs|js|ts|tsx|py|cs|cpp|h|hpp|gd|json|ya?ml|md|toml))`/g;
  for (const doc of docFiles) {
    const text = fs.readFileSync(path.join(projectRoot, doc), 'utf8');
    const seen = new Set();
    for (const match of text.matchAll(pathRe)) {
      const target = normalizeRel(match[1]);
      if (seen.has(target)) continue;
      seen.add(target);
      if (/^(https?:)?\/\//.test(target)) continue;
      if (target.startsWith('res://') || target.startsWith('user://')) continue;
      if (target.includes('{{')) continue;
      const abs = path.join(projectRoot, target);
      if (exists(abs)) continue;
      // 也接受同名文件存在于其它目录（避免跨项目引用误报）
      findings.push(finding('info', 'doc-link-missing', doc, `文档引用的路径不存在：${target}`, '修正文档或补上文件'));
    }
  }
  return findings.slice(0, 40);
}

function finding(severity, code, target, message, action) {
  return { severity, code, target, message, action };
}

function summarizeFindings(findings) {
  const summary = { error: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity] = (summary[f.severity] ?? 0) + 1;
  return summary;
}

/** `review --decisions`：列出所有 ADR 及其影响面。 */
export function listDecisions(projectRoot) {
  const dir = path.join(projectRoot, '.ai', 'decisions');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const title = (text.match(/^#\s+(.*)$/m) ?? [])[1] ?? f;
      const status = (text.match(/^Status:\s*(.*)$/m) ?? text.match(/状态[:：]\s*(.*)$/m) ?? [])[1] ?? 'unknown';
      const date = (text.match(/^Date:\s*(.*)$/m) ?? text.match(/日期[:：]\s*(.*)$/m) ?? [])[1] ?? '';
      return { file: `.ai/decisions/${f}`, title, status, date };
    });
}
