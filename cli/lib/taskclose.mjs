/**
 * 任务闭环检查（`ai-arch review --task`）。
 *
 * 解决的问题（运行链路的最后一段）：
 *   `task` 生成了"计划读什么"，但**没有任何机制检查计划与实际的差异**。
 *   于是收尾动作（更新摘要、同步注册表、逐条自查规则、贴证据）只能靠人/AI 记得，
 *   而"记得"在 AI 协作里等于不存在——下一个会话不会知道这次漏了什么。
 *
 * 本模块把收尾变成**机械可判定的对账**，而且**不需要全树扫描**：
 *   任务包里已经记录了每个文件当时的 hash 与当时的决策（读源码 / 读摘要），
 *   只需重新 hash 这些文件，就能回答四个具体问题：
 *     1. 当时让我"只读摘要"的文件，内容是不是已经变了？（**前提失效**——最危险的一类）
 *     2. 变了的文件，索引摘要更新了吗？（没更新 → 下个任务读到旧摘要）
 *     3. 变了的文件，注册表里的契约 hash 同步了吗？（没同步 → AI 拿旧不变量做判断）
 *     4. 任务包自己的范围/结果/证据三节填了吗？（占位符还在 = 没填）
 *
 * **判定不了的不做**：本模块不检查"测试是否真的跑过"（无法机械判定），只列出"应运行什么"，
 * 并在输出里明确写清这是"应做"而不是"已做"。这与 docs/04-design-notes.md §9.2 的取舍一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256, isFile, isDir, normalizeRel, matchesAny, readJsonSafe } from './fsx.mjs';
import { loadIndex } from './indexer.mjs';
import { loadRegistry } from './registry.mjs';
import { loadRules } from './rules.mjs';
import { impactOf } from './neighbors.mjs';
import { classifyImpactRules, impactTargetsState } from './impactmap.mjs';
import { TASK_PLACEHOLDERS } from './taskpack.mjs';

const MAX_LIST = 12;

/** 列出项目里的任务包，最近改动的在前。 */
export function listTaskPacks(root) {
  const dir = path.join(root, '.ai', 'tasks');
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md')
    .map((f) => {
      const abs = path.join(dir, f);
      return { rel: `.ai/tasks/${f}`, abs, mtime: fs.statSync(abs).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * 解析生成版任务包。**只解析生成的表格与 front-matter**，不试图理解正文——
 * 正文是人/AI 写的，格式不受控；表格与 front-matter 由 CLI 生成，格式可控。
 */
export function parseTaskPack(text) {
  const front = {};
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
      if (m) front[m[1]] = m[2].trim();
    }
  }

  const rows = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  const cellsOf = (line) => line.split('|').map((c) => c.trim());
  const hashOf = (cells) => cells.find((c) => /^[0-9a-f]{8,64}$/.test(c)) ?? null;
  const pathOf = (cells) => {
    for (const c of cells) {
      const m = c.match(/^`([^`]+)`/);
      if (m) return m[1];
    }
    return null;
  };

  const always = [];
  const readList = [];
  for (const line of rows) {
    const cells = cellsOf(line);
    if (cells.length < 5) continue;
    const p = pathOf(cells);
    if (!p) continue;
    const hash = hashOf(cells);
    // 必读表第一列是层级（L0/L1/L2…），读取清单第一列是序号。
    if (/^L\d$/.test(cells[1])) {
      always.push({ level: cells[1], path: p, hash, decision: 'read-source' });
    } else if (/^\d+$/.test(cells[1])) {
      const decision = /读源码/.test(line) ? 'read-source' : (/读摘要/.test(line) ? 'read-digest' : 'unknown');
      readList.push({ level: 'L3', path: p, hash, decision });
    }
  }

  const section = (title) => {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => new RegExp(`^#{1,3}\\s*\\d*\\.?\\s*${title}`).test(l));
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^#{1,3}\s/.test(l));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
  };

  return {
    front,
    taskId: front.taskId ?? null,
    createdAt: front.createdAt ?? null,
    indexSchemaVersion: front.indexSchemaVersion ?? null,
    always,
    readList,
    sections: {
      scope: section('范围'),
      result: section('结果'),
      evidence: section('证据'),
      acceptance: section('验收标准'),
    },
  };
}

/** 某一节是否还停留在占位符状态：占位符还在 = 没填。 */
export function isPlaceholder(sectionText, placeholders) {
  if (sectionText === null || sectionText === undefined) return true;
  const list = Array.isArray(placeholders) ? placeholders : [placeholders];
  return list.some((p) => sectionText.includes(p));
}

const sev = (severity, code, target, message, action) => ({ severity, code, target, message, action });

/**
 * 任务闭环检查。
 *
 * @param {string} root 项目根
 * @param {{id?: string|null, index?: object|null, limit?: number}} [opts]
 */
export function closeTask(root, opts = {}) {
  const { id = null, limit = MAX_LIST } = opts;
  const drafts = opts.index ?? null;
  const findings = [];
  const changed = [];

  const packs = listTaskPacks(root);
  if (packs.length === 0) {
    findings.push(sev(
      'error', 'task-pack-missing', '.ai/tasks/',
      '还没有任何任务包：没有"计划读什么"，就无所谓"计划与实际的差异"',
      'node .ai/bin/ai-arch.mjs task "<任务描述>"',
    ));
    return { task: null, packs: [], changed, findings, summary: summarize(findings, 0, 0) };
  }
  const chosen = id
    ? packs.find((p) => p.rel.endsWith(`${id}.md`) || p.rel.includes(id))
    : packs[0];
  if (!chosen) {
    findings.push(sev(
      'error', 'task-pack-not-found', id,
      `找不到任务包 "${id}"`,
      `可用：${packs.slice(0, 5).map((p) => p.rel.replace('.ai/tasks/', '').replace(/\.md$/, '')).join('、')}`,
    ));
    return { task: null, packs, changed, findings, summary: summarize(findings, 0, 0) };
  }

  const text = fs.readFileSync(chosen.abs, 'utf8');
  const pack = parseTaskPack(text);
  const index = drafts ?? loadIndex(root);
  const idxByPath = new Map((index?.files ?? []).map((f) => [f.path, f]));

  // ---- 1/2. 计划 vs 实际：只重新 hash 任务包里列过的文件（不做全树扫描）
  // 必读项与读取清单可能有重叠（例如宪法既必读、又被关键词命中）：按路径去重，必读优先。
  const packed = [];
  const seenPath = new Set();
  for (const item of [...pack.always, ...pack.readList]) {
    if (seenPath.has(item.path)) continue;
    seenPath.add(item.path);
    packed.push(item);
  }
  for (const item of packed) {
    const abs = path.join(root, item.path);
    if (!isFile(abs)) {
      findings.push(sev(
        'warn', 'task-file-missing', item.path,
        '任务包列出的文件现在不存在（被删除、改名或移走）',
        '确认是预期变更；若是，索引与引用它的文档需要同步更新',
      ));
      continue;
    }
    const now = sha256(fs.readFileSync(abs, 'utf8'));
    const recorded = item.hash;
    if (!recorded) {
      // 生成任务包时这个文件不在索引里，没有 hash 可对账：明说"对不了账"，不要伪装成"没变"或"变了"。
      findings.push(sev(
        'info', 'task-file-unhashed', item.path,
        '任务包里没有该文件的 hash（生成时它不在索引里），本次无法对账',
        'node .ai/bin/ai-arch.mjs index  之后重新生成任务包即可纳入对账',
      ));
      continue;
    }
    const differs = now.slice(0, recorded.length) !== recorded;
    if (!differs) continue;

    changed.push({
      path: item.path,
      decision: item.decision,
      hashThen: recorded,
      hashNow: now.slice(0, 10),
    });

    const entry = idxByPath.get(normalizeRel(item.path));
    // "摘要是否已经跟上新内容"——这是判断**前提有没有被修复**的唯一依据。
    // 对账的基准是任务包当时记录的 hash（不会变），所以只看"内容变了"会把
    // "已经重读并重写摘要"的正确收尾也一直报成问题，那样的门禁是不可用的。
    const digestFresh = Boolean(entry && entry.digest
      && entry.digest.status !== 'pending'
      && entry.digest.reviewedHash === now);
    changed[changed.length - 1].premiseReconciled = digestFresh;

    // **前提失效**：任务包当时判定"hash 未变，只读摘要即可"，而它现在已经变了、
    // 且摘要还是旧的 —— 这是最危险的一类：你据以决策的内容已经不是当前内容。
    if (item.decision === 'read-digest' && !digestFresh) {
      findings.push(sev(
        'warn', 'task-premise-stale', item.path,
        '任务包把它标为"读摘要"（当时 hash 未变），但内容已变且摘要仍是旧的：你据以决策的摘要已不是当前内容',
        'node .ai/bin/ai-arch.mjs index --stale  然后回填：index --apply <清单>',
      ));
    }

    if (!entry) {
      findings.push(sev(
        'info', 'task-file-unindexed', item.path,
        '文件不在索引里（新增或被忽略规则排除），无法用 hash 对账',
        'node .ai/bin/ai-arch.mjs index',
      ));
      continue;
    }
    if (entry.hash !== now) {
      findings.push(sev(
        'warn', 'task-index-stale', item.path,
        '索引里的 hash 还是旧的：本次改动没有回写索引，下个任务会读到过期条目',
        'node .ai/bin/ai-arch.mjs index',
      ));
    } else if (entry.kind === 'text' && (entry.digest?.status === 'pending' || entry.digest?.reviewedHash !== now)) {
      findings.push(sev(
        'warn', 'task-digest-stale', item.path,
        '索引条目已刷新，但语义摘要对应的仍是旧内容',
        'node .ai/bin/ai-arch.mjs index --stale  然后回填：index --apply <清单>',
      ));
    }
  }

  // ---- 3. 契约层：本次改动到的实体，注册表同步了吗
  const reg = loadRegistry(root);
  const entities = Array.isArray(reg?.entities) ? reg.entities : [];
  const changedSet = new Set(changed.map((c) => c.path));
  const declaredTests = new Set();
  let entitiesTouched = 0;
  for (const e of entities) {
    const rel = normalizeRel(String(e?.file ?? ''));
    if (!changedSet.has(rel)) continue;
    entitiesTouched += 1;
    for (const t of Array.isArray(e.tests) ? e.tests : []) {
      if (typeof t === 'string' && t.trim()) declaredTests.add(t.trim());
    }
    const nowEntry = idxByPath.get(rel);
    const now = nowEntry ? nowEntry.hash.slice(0, 10) : null;
    if (e.hash && now && String(e.hash).slice(0, 10) !== now) {
      const tests = Array.isArray(e.tests) ? e.tests.filter((t) => typeof t === 'string' && t.trim()) : [];
      findings.push(sev(
        'warn', 'task-entity-stale', `${e.name} → ${rel}`,
        `本次改到的契约（${e.name}）在注册表里还是旧 hash ${String(e.hash).slice(0, 10)} → ${now}`,
        '重新核对 signature 与 invariants，然后更新 .ai/registry.json 的 hash'
          + (tests.length > 0 ? `；并重跑：${tests.join('、')}` : '；该实体未声明 tests，不变量是否还成立只能靠人工确认'),
      ));
    }
  }

  // ---- 该跑什么：只声明"应运行"，不声称"已运行"
  const tests = new Set(declaredTests);
  if (index && changed.length > 0) {
    for (const t of impactOf(index, changed.map((c) => c.path), { depth: 1, limit: 20 }).tests) tests.add(t);
  }

  // ---- 影响矩阵：本次改动命中了哪几条规则，它们要求的同步更新真的做了吗
  // 这是变更协议里此前**唯一没有验收**的一步（"按影响矩阵同步更新文档与注册表"只是要求，没人核对）。
  const impactMap = readJsonSafe(path.join(root, '.ai', 'index', 'impact-map.json'), null);
  const impactClass = classifyImpactRules({
    changed: changed.map((c) => c.path), impactMap, index, registry: reg,
  });
  const sinceMs = pack.createdAt ? Date.parse(pack.createdAt) : NaN;
  const impact = {
    summary: impactClass.summary,
    applicable: [],
    unknown: impactClass.unknown.map((r) => ({ trigger: r.trigger, evidence: r.evidence })),
  };
  const notUpdatedTargets = [];
  const missingTargets = [];
  for (const rule of impactClass.applicable) {
    const state = impactTargetsState(root, rule, { sinceMs: Number.isFinite(sinceMs) ? sinceMs : null });
    impact.applicable.push({
      trigger: rule.trigger,
      adrRequired: rule.adrRequired,
      matched: rule.matched,
      evidence: rule.evidence,
      mustUpdate: rule.mustUpdate,
      updated: state.updated.map((u) => u.target),
      notUpdated: state.notUpdated.map((u) => u.target),
      missing: state.missing.map((u) => u.target),
      skipped: state.skipped,
    });
    for (const item of state.notUpdated) {
      notUpdatedTargets.push({ trigger: rule.trigger, target: item.target });
      findings.push(sev(
        'warn', 'task-impact-not-updated', `${rule.trigger} → ${item.target}`,
        `本次改动命中了影响矩阵规则 ${rule.trigger}，它要求同步更新 ${item.target}，但该文件在任务包创建之后没有被改动过`,
        `要么现在补上，要么说明为什么不需要（写进 .ai/constitution.md 的"本项目的例外"，或调整 .ai/index/impact-map.json 的 mustUpdate）`,
      ));
    }
    for (const item of state.missing) {
      missingTargets.push({ trigger: rule.trigger, target: item.target });
    }
  }
  for (const item of missingTargets.slice(0, 3)) {
    findings.push(sev(
      'info', 'task-impact-target-missing', `${item.trigger} → ${item.target}`,
      '影响矩阵要求同步更新这个文件，但项目里没有它',
      '要么按骨架补上，要么在宪法"本项目的例外"里写明本规模不需要——不要静默忽略',
    ));
  }
  if (missingTargets.length > 3) {
    findings.push(sev('info', 'task-impact-target-missing', '.ai/index/impact-map.json',
      `另有 ${missingTargets.length - 3} 个 mustUpdate 目标不存在（已省略）`, '同上的两种处理方式'));
  }
  if (impact.unknown.length > 0) {
    findings.push(sev(
      'info', 'task-impact-undeclared', '.ai/index/impact-map.json',
      `有 ${impact.unknown.length} 条矩阵规则没有声明触发判据（when）：${impact.unknown.slice(0, 4).map((r) => r.trigger).join('、')}`
        + `${impact.unknown.length > 4 ? ' 等' : ''}——本次无法判断它们是否适用`,
      '给这些 trigger 补 when（支持 entityKinds / paths / manifest / build，见 docs/system/05-lifecycle.md）',
    ));
  }

  // ---- 4. 任务包自己填完了吗（机械可判定的部分）
  const { sections } = pack;
  if (isPlaceholder(sections.scope, [TASK_PLACEHOLDERS.scopeIn, TASK_PLACEHOLDERS.scopeOut])) {
    findings.push(sev('info', 'task-scope-missing', chosen.rel, '任务包"范围"一节仍是占位符：没有写清本次做与不做', '补上范围，交付时才有边界可对照'));
  }
  if (isPlaceholder(sections.result, TASK_PLACEHOLDERS.result)) {
    findings.push(sev('info', 'task-result-missing', chosen.rel, '任务包"结果"一节仍是占位符', '写下实际改了什么、为什么这么改'));
  }
  if (isPlaceholder(sections.evidence, TASK_PLACEHOLDERS.evidence)) {
    findings.push(sev(
      'warn', 'task-evidence-missing', chosen.rel,
      '任务包"证据"一节仍是占位符：完成定义要求贴**真实命令输出**，不接受"应该没问题"',
      '把验证命令与输出摘要贴进该节，或写进"遗留风险"说明为什么没有证据',
    ));
  }

  // ---- 适用规则：本次改动落到哪些规则的范围内（规则不能只在开工时出现一次）
  const rules = (loadRules(root).rules ?? []).filter((r) => changed.length === 0
    || !r.scope || r.scope === '**'
    || changed.some((c) => matchesAny(c.path, [r.scope])));
  const rulesToCheck = rules.slice(0, limit).map((r) => ({
    id: r.id, statement: r.statement, enforcement: r.enforcement, check: r.check, scope: r.scope ?? '**',
  }));

  // ---- 机械验收项：CLI 自己判定，不要求人声称
  const staleIndex = findings.filter((f) => f.code === 'task-index-stale' || f.code === 'task-digest-stale').length;
  const staleEntity = findings.filter((f) => f.code === 'task-entity-stale').length;
  const impactMissed = notUpdatedTargets.length;
  const checklist = [
    {
      item: '变更影响面已按 .ai/index/impact-map.json 更新',
      verdict: impactMissed === 0 ? 'pass' : 'fail',
      note: impactMissed === 0
        ? (impactClass.applicable.length === 0
          ? `本次改动没有命中任何矩阵规则${impact.unknown.length > 0 ? `（另有 ${impact.unknown.length} 条未声明判据，无法判定）` : ''}`
          : `命中的 ${impactClass.applicable.length} 条规则，其 mustUpdate 文件都已改动过（改得对不对判定不了）`)
        : `${impactMissed} 个矩阵要求同步的文件本次没有改动`,
    },
    {
      item: '索引摘要已同步',
      verdict: staleIndex === 0 ? 'pass' : 'fail',
      note: staleIndex === 0 ? '任务包列出的文件，索引与摘要都是当前内容' : `${staleIndex} 个文件的索引/摘要是旧的`,
    },
    {
      item: '契约注册表已同步',
      verdict: staleEntity === 0 ? 'pass' : 'fail',
      note: entitiesTouched === 0
        ? `本次改动没有触及任何已登记的契约实体（注册表共 ${entities.length} 条）`
        : (staleEntity === 0
          ? `${entitiesTouched} 条涉及的实体，注册表 hash 都已同步`
          : `${staleEntity} 个契约实体的 hash 未同步`),
    },
  ];

  return {
    task: {
      rel: chosen.rel,
      id: pack.taskId ?? path.basename(chosen.rel, '.md'),
      createdAt: pack.createdAt,
      packedCount: packed.length,
      changedCount: changed.length,
      sections: {
        scopeFilled: !isPlaceholder(sections.scope, [TASK_PLACEHOLDERS.scopeIn, TASK_PLACEHOLDERS.scopeOut]),
        resultFilled: !isPlaceholder(sections.result, TASK_PLACEHOLDERS.result),
        evidenceFilled: !isPlaceholder(sections.evidence, TASK_PLACEHOLDERS.evidence),
      },
    },
    packs: packs.map((p) => p.rel),
    changed: changed.slice(0, limit),
    tests: [...tests].slice(0, limit),
    rulesToCheck,
    impact,
    checklist,
    findings,
    summary: summarize(findings, packed.length, changed.length),
  };
}

function summarize(findings, packedCount, changedCount) {
  const s = { error: 0, warn: 0, info: 0, packedCount, changedCount };
  for (const f of findings) s[f.severity] = (s[f.severity] ?? 0) + 1;
  s.ready = s.error === 0 && s.warn === 0;
  return s;
}

const ICON = { error: '✗', warn: '!', info: 'i' };

/** 人读输出。`--json` 走 `closeTask` 的原始对象。 */
export function renderTaskClose(report) {
  const lines = [];
  if (!report.task) {
    lines.push('任务闭环检查：没有可检查的任务包\n');
    for (const f of report.findings) lines.push(`  ${ICON[f.severity]} [${f.code}] ${f.target}\n      ${f.message}\n      → ${f.action}`);
    return lines.join('\n') + '\n';
  }

  const t = report.task;
  lines.push(`任务闭环检查：${t.rel}`);
  lines.push(`  任务包列出 ${t.packedCount} 个文件，其中 ${t.changedCount} 个自我上次开工以来内容已变`);
  lines.push('');

  if (report.changed.length > 0) {
    lines.push('  计划 vs 实际（按任务包记录的 hash 对账）：');
    for (const c of report.changed) {
      const tag = c.decision === 'read-digest'
        ? (c.premiseReconciled ? '当时只给了摘要；摘要已按新内容更新' : '当时只给了摘要；**摘要仍是旧的**')
        : '当时读了源码';
      lines.push(`    ${c.path}  ${c.hashThen} → ${c.hashNow}  （${tag}）`);
    }
    lines.push('');
  }

  if (report.findings.length === 0) {
    lines.push('  未发现未处理的收尾项。');
  } else {
    lines.push('  待处理：');
    for (const f of report.findings) {
      lines.push(`    ${ICON[f.severity]} [${f.code}] ${f.target}`);
      lines.push(`        ${f.message}`);
      lines.push(`        → ${f.action}`);
    }
  }
  lines.push('');

  lines.push('  影响矩阵（.ai/index/impact-map.json）——本次改动命中了哪几条：');
  const imp = report.impact ?? { applicable: [], unknown: [], summary: {} };
  if (imp.applicable.length === 0) {
    lines.push(`    （没有命中任何规则；矩阵共 ${imp.summary?.total ?? 0} 条，其中未声明判据 ${imp.summary?.unknown ?? 0} 条）`);
  }
  for (const rule of imp.applicable) {
    lines.push(`    ✅ ${rule.trigger}${rule.adrRequired ? '（需 ADR）' : ''}`);
    for (const e of rule.evidence ?? []) lines.push(`        判据：${e}`);
    if (rule.mustUpdate.length > 0) {
      lines.push(`        要求同步：${rule.mustUpdate.join('、')}`);
      if (rule.updated.length > 0) lines.push(`        已改动：${rule.updated.join('、')}`);
      if (rule.notUpdated.length > 0) lines.push(`        **未改动：${rule.notUpdated.join('、')}**`);
      if (rule.missing.length > 0) lines.push(`        本项目没有：${rule.missing.join('、')}`);
    }
  }
  if (imp.unknown.length > 0) {
    lines.push(`    ⬜ 未声明判据 ${imp.unknown.length} 条：${imp.unknown.slice(0, 5).map((r) => r.trigger).join('、')}`
      + `${imp.unknown.length > 5 ? ' 等' : ''}（无法判断是否适用）`);
  }
  lines.push('');

  lines.push('  验收标准（机械可判定部分由 CLI 判定）：');
  for (const c of report.checklist) {
    const mark = c.verdict === 'pass' ? '✅' : (c.verdict === 'fail' ? '❌' : '⬜');
    lines.push(`    ${mark} ${c.item} —— ${c.note}`);
  }
  const s = report.task.sections;
  lines.push(`    ${s.scopeFilled ? '✅' : '⬜'} 任务包"范围"已填`);
  lines.push(`    ${s.resultFilled ? '✅' : '⬜'} 任务包"结果"已填`);
  lines.push(`    ${s.evidenceFilled ? '✅' : '❌'} 任务包"证据"已填（贴真实命令输出）`);
  lines.push('');

  if (report.tests.length > 0) {
    lines.push('  应运行的测试（**本命令不能证明它们跑过**，只说明该跑什么）：');
    for (const x of report.tests) lines.push(`    - ${x}`);
    lines.push('');
  }
  if (report.rulesToCheck.length > 0) {
    lines.push('  适用规则（本次改动的路径落在这些规则范围内，逐条给结论）：');
    for (const r of report.rulesToCheck) {
      lines.push(`    - ${r.id} [${r.enforcement}] ${r.statement}`);
      lines.push(`        判定：${r.check}`);
    }
    lines.push('');
  }

  const sum = report.summary;
  lines.push(`  汇总：${sum.error} 错误 / ${sum.warn} 警告 / ${sum.info} 提示 —— ${sum.ready ? '可以收尾' : '还有未处理项'}`);
  lines.push('  说明：本命令只对账"机械可判定"的收尾项；架构是否合理仍由 .ai/skills/code-review/SKILL.md 的清单承担。');
  return lines.join('\n') + '\n';
}
