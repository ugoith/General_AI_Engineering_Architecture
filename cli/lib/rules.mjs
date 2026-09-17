/**
 * 项目规则（`.ai/rules.json`）：把"用户临时提出的一条约束"变成**可执行、可传播、可验收**的东西。
 *
 * 为什么需要这个模块（真实场景）：
 *   开发中经常出现"这次顺便加个规则"——例如"if 嵌套不超过 3 层""日志必须带 requestId"。
 *   如果只是记在一处文档里，它会有三个必然的失败：
 *     1. **不落地**：agent 下次不会读到它（不在任务包里）；
 *     2. **不传播**：评审清单、宪法、影响矩阵里都没有它；
 *     3. **不验收**：没办法判断代码是否遵守，于是规则退化成"建议"。
 *
 * 本模块给出统一的落地流程：**入库 → 传播 → 验收**，并强制每条规则声明
 * "怎么判定"（enforcement）——判定不了的规则会被标为 manual，并在评审时逐条人工过。
 */

import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, writeJson, sha256, stripBom, isFile } from './fsx.mjs';

export const RULE_CATEGORIES = ['style', 'naming', 'architecture', 'process', 'security', 'performance', 'testing'];
export const RULE_ENFORCEMENT = ['tool', 'review', 'manual'];

/**
 * 规则字段说明（写进生成的文件头部，便于人直接读懂）：
 *  - `id`         ：稳定 ID（R-001…），引用时只引 ID，不复述正文（稳定标识：引用只引 ID，正文改了引用不失效）
 *  - `statement`  ：一句话规则，必须可判定（禁止"代码要整洁"这类不可判定的表述）
 *  - `category`   ：style/naming/architecture/process/security/performance/testing
 *  - `enforcement`：tool（有工具可自动判定）/ review（评审时人工判定）/ manual（只能靠人）
 *  - `check`      ：tool 类必填：可复制执行的命令或配置位置；review/manual 类写"怎么判定的步骤"
 *  - `scope`      ：适用路径 glob（默认全项目）
 *  - `rationale`  ：为什么需要它（便于将来复审时判断是否还成立）
 *  - `since`      ：引入日期；`source`：谁/什么触发引入
 *  - `debt`       ：已知存量违规（迁移期用；为空表示已清零）
 */
export const RULE_FIELDS = ['id', 'statement', 'category', 'enforcement', 'check', 'scope', 'rationale', 'since', 'source', 'debt'];

export function loadRules(root) {
  const file = path.join(root, '.ai', 'rules.json');
  const data = readJsonSafe(file, null);
  if (!data) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      note: '项目规则集。新增约束必须先入库（ai-arch rules add），再改代码——顺序反了规则就会漏。',
      rules: [],
    };
  }
  return data;
}

export function saveRules(root, data) {
  data.generatedAt = new Date().toISOString();
  const file = path.join(root, '.ai', 'rules.json');
  writeJson(file, data);
  return file;
}

export function nextRuleId(data) {
  const nums = (data.rules ?? [])
    .map((r) => Number(String(r.id ?? '').replace(/\D/g, '')))
    .filter((n) => Number.isFinite(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `R-${String(max + 1).padStart(3, '0')}`;
}

/**
 * 新增一条规则。**不做善意默认**：判定方式没写清就报错，因为"判定不了的规则等于没有规则"。
 */
export function addRule(root, input, { now = new Date() } = {}) {
  const errors = [];
  const statement = String(input.statement ?? '').trim();
  if (statement.length < 6) errors.push('statement 太短：请写一句可判定的规则（禁止"代码要整洁"这类表述）');
  if (/整洁|合理|优雅|规范一点|注意|尽量/.test(statement) && !/[0-9≤≥<>=]|禁止|必须/.test(statement)) {
    errors.push(`statement 不可判定："${statement}"。请给出可检查的条件（例如"if 嵌套深度 ≤ 3"）`);
  }
  const category = String(input.category ?? 'style');
  if (!RULE_CATEGORIES.includes(category)) errors.push(`category 非法：${category}（可选：${RULE_CATEGORIES.join('/')}）`);
  const enforcement = String(input.enforcement ?? 'review');
  if (!RULE_ENFORCEMENT.includes(enforcement)) errors.push(`enforcement 非法：${enforcement}（可选：${RULE_ENFORCEMENT.join('/')}）`);
  if (enforcement === 'tool' && !input.check) {
    errors.push('enforcement=tool 必须给出 check（可复制执行的命令，或写清在哪个 lint 配置里实现）');
  }
  if (enforcement !== 'tool' && !input.check) {
    errors.push(`enforcement=${enforcement} 必须给出 check：评价时"怎么判定"的具体步骤`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const data = loadRules(root);
  const id = String(input.id ?? nextRuleId(data));
  if ((data.rules ?? []).some((r) => r.id === id)) {
    return { ok: false, errors: [`规则 ID ${id} 已存在`] };
  }
  const rule = {
    id,
    statement,
    category,
    enforcement,
    check: String(input.check),
    scope: input.scope ? String(input.scope) : '**',
    rationale: input.rationale ? String(input.rationale) : null,
    since: formatDate(now),
    source: input.source ? String(input.source) : 'user-request',
    debt: [],
  };
  data.rules = [...(data.rules ?? []), rule];
  const file = saveRules(root, data);
  return { ok: true, rule, file, propagation: propagationFor(rule) };
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 一条新规则应当传播到哪些位置。
 *
 * 这是"第 4 条"的核心：**用户提出约束 = 触发框架更新**。
 * 返回的是可执行清单（谁需要改、为什么），而不是一句"记得同步"。
 */
export function propagationFor(rule) {
  const items = [
    { file: '.ai/rules.json', action: '已写入（本函数之前完成）', reason: '规则入库，成为可引用的稳定 ID' },
    { file: '.ai/constitution.md', action: '把该规则加入红线或"本项目约定"一节（引用 ID）', reason: '宪法是每会话必读，红线必须出现在这里' },
    { file: '.ai/index/impact-map.json', action: `检查是否需要新增 trigger，使改动相关文件时强制复查该规则`, reason: '让规则在变更时被自动想起' },
  ];
  if (rule.enforcement === 'tool') {
    items.push({
      file: '项目已有的 lint / 格式化 / CI 配置',
      action: `把规则实现为可执行检查：${rule.check}`,
      reason: 'tool 类规则的唯一可靠落地方式是让工具判定，人工判定会漏',
    });
  } else {
    items.push({
      file: '.ai/skills/code-review/SKILL.md',
      action: `在对应评审清单里加入一条：${rule.statement}`,
      reason: `${rule.enforcement} 类规则必须在评审时被逐条看到`,
    });
  }
  if (rule.category === 'architecture') {
    items.push({
      file: '.ai/decisions/',
      action: '写一条 ADR 说明为何引入该架构约束（含将来回退条件）',
      reason: '架构约束会长期影响设计选择，必须有决策记录与回退条件',
    });
  }
  items.push({
    file: '（当次任务包）',
    action: '任务包会自动带上 rules.json 的 hash；若规则有变，本次任务会被提示重读',
    reason: '保证规则在"下一次开工"时真的被看到',
  });
  return items;
}

/** 校验规则集自身的一致性。 */
export function auditRules(root, { propagation = true } = {}) {
  const data = loadRules(root);
  const issues = [];
  const seen = new Set();
  for (const r of data.rules ?? []) {
    if (!r.id) issues.push({ level: 'error', id: null, message: '规则缺少 id' });
    else if (seen.has(r.id)) issues.push({ level: 'error', id: r.id, message: '规则 ID 重复' });
    seen.add(r.id);

    if (!r.statement || String(r.statement).length < 6) {
      issues.push({ level: 'error', id: r.id, message: 'statement 缺失或过短' });
    } else if (/整洁|合理|优雅|尽量|注意/.test(r.statement) && !/[0-9≤≥<>=]|禁止|必须/.test(r.statement)) {
      issues.push({ level: 'warn', id: r.id, message: `statement 可能不可判定："${r.statement}"` });
    }
    if (!RULE_CATEGORIES.includes(r.category)) {
      issues.push({ level: 'error', id: r.id, message: `category 非法：${r.category}` });
    }
    if (!RULE_ENFORCEMENT.includes(r.enforcement)) {
      issues.push({ level: 'error', id: r.id, message: `enforcement 非法：${r.enforcement}` });
    }
    if (!r.check) {
      issues.push({ level: 'warn', id: r.id, message: '未写 check：评审时无法判定' });
    }
    if (r.enforcement === 'tool' && r.check && /待补|TODO|以后|稍后/.test(String(r.check))) {
      issues.push({ level: 'warn', id: r.id, message: 'check 里含"待补"：tool 类规则必须真的可执行' });
    }
    const debt = Array.isArray(r.debt) ? r.debt.length : 0;
    if (debt > 0) {
      issues.push({ level: 'info', id: r.id, message: `存量违规 ${debt} 处待迁移（迁移期允许，但要有清账计划）` });
    }
  }
  if (propagation) issues.push(...propagationIssues(root, data));

  return { issues, summary: {
    total: (data.rules ?? []).length,
    tool: (data.rules ?? []).filter((r) => r.enforcement === 'tool').length,
    review: (data.rules ?? []).filter((r) => r.enforcement === 'review').length,
    manual: (data.rules ?? []).filter((r) => r.enforcement === 'manual').length,
    withDebt: (data.rules ?? []).filter((r) => (r.debt ?? []).length > 0).length,
    notPropagated: issues.filter((i) => i.code === 'rule-not-propagated').length,
  } };
}

/**
 * 规则的**传播验收**：规则 ID 是否真的出现在"会被读到的地方"。
 *
 * 为什么需要这一步：`rules add` 会打印一份传播清单，但**打印清单不等于传播发生**。
 * 一条只存在于 `.ai/rules.json` 的规则有三条腿，缺了两条：
 *   ① 每次任务包会带上它（这条腿由 rulesDigest 保证，一定成立）；
 *   ② 改到相关文件时会被影响矩阵触发（缺 → 改动当时想不起来它）；
 *   ③ 评审清单里逐条出现（缺 → 交付时没人逐条核对）。
 * ②③ 是否成立是**机械可判定**的：搜 ID 即可。判定得了的约束就不该只靠人记得。
 *
 * 匹配用**大小写不敏感**：`rules add` 自动写入的影响矩阵 trigger 是小写的 `r-001-rule-check`，
 * 它同样是一处真实引用（把大写区分开会把已经自动传播过的规则误报成没传播）。
 */
function propagationIssues(root, data) {
  const carriers = [
    { rel: '.ai/constitution.md', why: '宪法（每会话必读）' },
    { rel: '.ai/index/impact-map.json', why: '影响矩阵（变更时触发）' },
    { rel: '.ai/skills/code-review/SKILL.md', why: '评审清单（交付时逐条过）' },
  ]
    .map((c) => {
      const abs = path.join(root, c.rel);
      return isFile(abs) ? { ...c, text: fs.readFileSync(abs, 'utf8').toLowerCase() } : null;
    })
    .filter(Boolean);

  const issues = [];
  for (const r of data.rules ?? []) {
    if (!r.id) continue;
    const id = String(r.id).toLowerCase();
    if (carriers.some((c) => c.text.includes(id))) continue;
    issues.push({
      level: 'warn',
      code: 'rule-not-propagated',
      id: r.id,
      message: `规则 ${r.id} 只存在于 .ai/rules.json：${carriers.map((c) => c.rel).join('、')} 里都没有引用它`,
      action: `把它加进 .ai/constitution.md（每会话必读）或 .ai/index/impact-map.json（变更时触发）；`
        + '`rules add` 的输出里有完整传播清单',
    });
  }
  return issues;
}

/** 供任务包使用：规则集的内容指纹（变了就提示重读）+ 精简清单。 */
export function rulesDigest(root) {
  const file = path.join(root, '.ai', 'rules.json');
  if (!isFile(file)) return { present: false, hash: null, count: 0, rules: [] };
  const text = stripBom(fs.readFileSync(file, 'utf8'));
  const data = JSON.parse(text);
  return {
    present: true,
    hash: sha256(text).slice(0, 10),
    count: (data.rules ?? []).length,
    rules: (data.rules ?? []).map((r) => ({
      id: r.id,
      statement: r.statement,
      category: r.category,
      enforcement: r.enforcement,
      scope: r.scope,
      check: r.check,
      rationale: r.rationale ?? null,
      debt: (r.debt ?? []).length,
    })),
  };
}
