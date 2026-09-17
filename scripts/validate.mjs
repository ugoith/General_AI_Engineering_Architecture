#!/usr/bin/env node
/**
 * 框架结构校验（零依赖，跨平台）。
 *
 * 检查项（对应 docs/system/09-change-protocol.md 的影响矩阵）：
 *  1. pack.json 结构与字段（schema/pack.schema.json）
 *  2. 模板变量：未声明变量、base 层使用 pack-local 变量、不存在的 shared 片段
 *  3. 渲染可行性：base + 每个 archetype 用默认变量试渲染
 *  4. skills 引用存在、frontmatter 完整
 *  5. 规模门槛一致性（cli/lib/patterns.mjs ↔ docs/system/02-scales.md）
 *  6. 设计模式一致性（cli/lib/patterns.mjs ↔ docs/system/03-pattern-selection.md）
 *  7. token 预算一致性（cli/lib/limits.mjs ↔ docs/system/04-context-discipline.md）
 *  8. 文档相对链接存在
 *  9. 本仓库自身的上下文预算（AGENTS.md ≤ 120 行等）
 * 10. selftest 的 PACKS 列表覆盖全部模板包
 *
 * 用法：
 *   node scripts/validate.mjs            # 全部检查
 *   node scripts/validate.mjs --quiet    # 只输出问题
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const cliLib = path.join(repo, 'cli', 'lib');

const { listPacks, auditPackVariables, loadPackById, loadShared } = await import(pathToFileURL(path.join(cliLib, 'pack.mjs')).href);
const { buildRenderMap } = await import(pathToFileURL(path.join(cliLib, 'pack.mjs')).href);
const { walk, isFile, readJsonSafe, normalizeRel, exists } = await import(pathToFileURL(path.join(cliLib, 'fsx.mjs')).href);
const { PATTERNS, MATRIX_RULES } = await import(pathToFileURL(path.join(cliLib, 'patterns.mjs')).href);
const { PACK_LIMITS, DEFAULT_TASK_BUDGET } = await import(pathToFileURL(path.join(cliLib, 'limits.mjs')).href);
const { resolveVariables } = await import(pathToFileURL(path.join(cliLib, 'scaffold.mjs')).href);

const problems = [];
const notes = [];
const fail = (code, msg) => problems.push({ code, msg });
const note = (msg) => notes.push(msg);
const quiet = process.argv.includes('--quiet');
const say = (msg) => { if (!quiet) process.stdout.write(msg + '\n'); };

/* -------------------------------------------------------------- 1. packs */

const packs = listPacks();
say(`[1/10] 模板包：发现 ${packs.length} 个`);
if (packs.length === 0) fail('no-packs', 'templates/archetypes 下没有任何模板包');

const REQUIRED_PACK_FIELDS = ['id', 'title', 'description', 'category', 'scaleLevel', 'variables', 'dirs', 'skills'];
const CATEGORIES = new Set(['software', 'game', 'data', 'embedded', 'automation']);
const LEVELS = new Set(['S', 'M', 'L', 'XL']);

for (const pack of packs) {
  const label = `templates/archetypes/${pack.id}`;
  if (pack.__error) {
    fail('pack-json-invalid', `${label}/pack.json 不是合法 JSON：${pack.__error}`);
    continue;
  }
  for (const field of REQUIRED_PACK_FIELDS) {
    if (pack[field] === undefined) fail('pack-field-missing', `${label}/pack.json 缺少字段 ${field}`);
  }
  if (path.basename(pack.dir) !== pack.id) {
    fail('pack-id-mismatch', `${label}：pack.id "${pack.id}" 与目录名不一致`);
  }
  if (!CATEGORIES.has(pack.category)) fail('pack-category', `${label}：category "${pack.category}" 非法`);
  if (!LEVELS.has(pack.scaleLevel)) fail('pack-scale', `${label}：scaleLevel "${pack.scaleLevel}" 非法`);
  const keys = new Set();
  for (const v of pack.variables ?? []) {
    if (!v.key || !v.prompt || v.default === undefined) {
      fail('pack-variable-incomplete', `${label}：变量 ${JSON.stringify(v)} 缺少 key/prompt/default`);
    }
    if (keys.has(v.key)) fail('pack-variable-dup', `${label}：变量 ${v.key} 重复声明`);
    keys.add(v.key);
  }
  for (const dir of pack.dirs ?? []) {
    if (path.isAbsolute(dir) || dir.includes('..')) fail('pack-dir-unsafe', `${label}：dirs 含非法路径 ${dir}`);
  }
}

/* ------------------------------------------- 2. 变量与片段引用 + 3. 渲染 */

say('[2/10] 模板变量与共享片段');
say('[3/10] 渲染可行性（base + 每个 archetype）');
const knownSkills = new Set(
  fs.existsSync(path.join(repo, 'skills'))
    ? fs.readdirSync(path.join(repo, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && isFile(path.join(repo, 'skills', e.name, 'SKILL.md')))
      .map((e) => e.name)
    : [],
);

for (const pack of packs) {
  if (pack.__error) continue;
  const label = `templates/archetypes/${pack.id}`;
  const audit = auditPackVariables(pack, path.join(repo, 'templates'));
  for (const issue of audit.issues) fail('template-variable', issue);

  for (const id of pack.skills ?? []) {
    if (!knownSkills.has(id)) fail('pack-skill-missing', `${label}：引用了不存在的 skill "${id}"（已有：${[...knownSkills].join(', ')}）`);
  }
  if (pack.category === 'game' && !(pack.skills ?? []).includes('game-engine-conventions')) {
    fail('pack-game-skill', `${label}：游戏类模板包必须包含 game-engine-conventions skill`);
  }

  const { vars, errors } = resolveVariables(pack, { dir: path.join(repo, 'tmp', pack.id) });
  if (errors.length > 0) {
    fail('pack-vars-resolve', `${label}：变量解析失败 ${errors.join('; ')}`);
    continue;
  }
  try {
    const { files } = buildRenderMap(pack, vars, { templates: path.join(repo, 'templates'), strict: true });
    const count = Object.keys(files).length;
    if (count === 0) fail('pack-render-empty', `${label}：渲染结果为空`);
    else note(`${pack.id}: 渲染 ${count} 个文件`);
    // alwaysRead 的路径必须真实存在，否则就是一个"指向空文件的必读项"
    for (const item of pack.alwaysRead ?? []) {
      if (!item?.path) {
        fail('pack-always-read-invalid', `${label}：alwaysRead 条目缺少 path`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(files, item.path)) {
        fail('pack-always-read-missing',
          `${label}：alwaysRead 指向的 ${item.path} 不在该 pack 的渲染结果里（必读项会指向不存在的文件）`);
      }
      if (!item.fallback) {
        fail('pack-always-read-no-fallback', `${label}：alwaysRead 的 ${item.path} 缺少 fallback 提示`);
      }
    }
    for (const [rel, node] of Object.entries(files)) {
      if (rel.includes('{{') || rel.includes('}}')) {
        fail('pack-path-unrendered', `${label}：路径未完全渲染：${rel}`);
      }
      if (node.text.includes('{{')) {
        const残留 = node.text.match(/\{\{[^}]{0,40}\}\}/g)?.slice(0, 3).join(' ');
        fail('pack-text-unrendered', `${label}：${rel} 渲染后仍含模板语法：${残留}`);
      }
    }
  } catch (error) {
    fail('pack-render-failed', `${label}：渲染失败 —— ${error.message}`);
  }
}

const shared = loadShared(path.join(repo, 'templates'));
say(`      共享片段：${Object.keys(shared).join(', ') || '(无)'}`);

/* ------------------------------- 3b. 覆盖语义：同名文件不得丢失 base 的标题 */

say('[3b/10] 层次覆盖完整性（覆盖 = 整份替换）');
const { readFileSync: rf, readdirSync, statSync } = fs;
const baseFilesDir = path.join(repo, 'templates', 'base', 'files');
const collectFiles = (dir, prefix = '') => {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  const visit = (cur, rel) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(abs, relPath);
      else out.set(relPath, abs);
    }
  };
  visit(dir, prefix);
  return out;
};
const baseFiles = collectFiles(baseFilesDir);
/**
 * 取"结构标题"：忽略纯注释文件的首行说明（日期/版本号这类动态内容不应参与比对）。
 * 对 .gitignore 这类注释型文件，标题即注释块的首行。
 */
const headingsOf = (text, rel = '') => {
  const normalized = text.replace(/\r\n/g, '\n');
  const raw = [...normalized.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
  if (rel.endsWith('.gitignore') || rel.endsWith('.gitattributes')) {
    const comments = [...normalized.matchAll(/^##\s*(.+?)\s*$/gm)].map((m) => m[1].trim());
    return comments.filter((h) => !/\{\{(date|frameworkVersion)\}\}/.test(h));
  }
  return raw;
};
const sharedRefsOf = (text) => new Set(
  [...text.matchAll(/\{\{>\s*SHARED:([A-Za-z0-9_-]+)\s*\}\}/g)].map((m) => m[1]),
);

for (const pack of packs) {
  if (pack.__error) continue;
  const label = `templates/archetypes/${pack.id}`;
  const packFilesAbs = collectFiles(path.join(pack.dir, 'files'));

  // 整个 archetype 里所有片段引用（用于判断片段是"丢失"还是"迁移到别的文件"）
  const packWideShared = new Set();
  for (const abs of packFilesAbs.values()) {
    for (const name of sharedRefsOf(rf(abs, 'utf8'))) packWideShared.add(name);
  }

  for (const [rel, abs] of packFilesAbs) {
    if (!baseFiles.has(rel)) continue; // 新文件，无覆盖问题
    if (rel.includes('{{')) continue; // 路径含模板变量，无法按名比对
    const overText = rf(abs, 'utf8');
    const baseText = rf(baseFiles.get(rel), 'utf8');

    const overHeadings = headingsOf(overText, rel);
    // 用"包含"而非"完全相等"判定：允许改写措辞，但 base 的每个小节必须仍能被识别到。
    // 比对前归一化空白与破折号（覆盖文件里常把 " —— " 写成 " "）。
    const norm = (s) => s.replace(/[\s—–-]+/g, ' ').trim();
    const overNorm = norm(overText);
    const lost = headingsOf(baseText, rel)
      .filter((h) => !overNorm.includes(norm(h)));
    if (lost.length > 0) {
      fail(
        'override-loses-content',
        `${label}/files/${rel} 整份覆盖了 base 的同名文件，但丢失了小节：${lost.join(' / ')}`
        + '\n      覆盖语义是"整份替换"（见 templates/_schema/pack.schema.md）：要么保留 base 全部小节，要么不要提供同名文件。',
      );
    }

    // 片段引用：允许迁移到同 archetype 的其它文件（例如 AGENTS.md 的片段移到 constitution.md），
    // 但整个 archetype 里必须仍然引用它，否则等于把那段规则删掉了。
    const lostShared = [...sharedRefsOf(baseText)].filter((s) => !packWideShared.has(s));
    if (lostShared.length > 0) {
      fail(
        'override-loses-shared',
        `${label}/files/${rel} 覆盖后，整个 archetype 都不再引用共享片段：${lostShared.join(', ')}`
        + '\n      片段可以移到别的文件里引用，但不能消失（见 docs/04-design-notes.md）。',
      );
    }
  }
}

/* ------------------------------------------------------------- 4. skills */

say('[4/10] skills frontmatter');for (const id of knownSkills) {
  const text = fs.readFileSync(path.join(repo, 'skills', id, 'SKILL.md'), 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) {
    fail('skill-frontmatter', `skills/${id}/SKILL.md 缺少 frontmatter`);
    continue;
  }
  for (const field of ['name', 'description', 'when']) {
    if (!new RegExp(`^${field}:`, 'm').test(fm[1])) {
      fail('skill-frontmatter', `skills/${id}/SKILL.md frontmatter 缺少 ${field}`);
    }
  }
  const nameMatch = fm[1].match(/^name:\s*(.*)$/m);
  if (nameMatch && nameMatch[1].trim() !== id) {
    fail('skill-name-mismatch', `skills/${id}/SKILL.md 的 name=${nameMatch[1].trim()} 与目录名不一致`);
  }
}
// 文档里声明的 skill 表必须与实际一致
const skillsReadme = fs.readFileSync(path.join(repo, 'skills', 'README.md'), 'utf8');
for (const id of knownSkills) {
  if (!skillsReadme.includes(`\`${id}\``)) fail('skill-readme', `skills/README.md 未登记 skill "${id}"`);
}

/* ------------------------------------- 5/6/7. 机器可读数据与文档一致性 */

say('[5/10] 规模门槛一致性');
const scalesDoc = fs.readFileSync(path.join(repo, 'docs', 'system', '02-scales.md'), 'utf8');
for (const rule of MATRIX_RULES) {
  if (!scalesDoc.includes(rule.loc)) fail('scale-loc-mismatch', `patterns.mjs 的 ${rule.level} 级 loc="${rule.loc}" 未在 02-scales.md 出现`);
  if (!scalesDoc.includes(rule.modules)) fail('scale-modules-mismatch', `patterns.mjs 的 ${rule.level} 级 modules="${rule.modules}" 未在 02-scales.md 出现`);
  for (const banned of rule.banned) {
    if (!scalesDoc.includes(banned)) fail('scale-banned-mismatch', `patterns.mjs 中 ${rule.level} 级禁止项 "${banned}" 未在 02-scales.md 出现`);
  }
}

say('[6/10] 设计模式一致性');
const patternDoc = fs.readFileSync(path.join(repo, 'docs', 'system', '03-pattern-selection.md'), 'utf8');
for (const p of PATTERNS) {
  if (!patternDoc.includes(p.name)) fail('pattern-doc-missing', `patterns.mjs 的模式 "${p.name}" 未在 03-pattern-selection.md 的矩阵中出现`);
}
// 反向：文档矩阵表里的模式名也必须存在
const docNames = [...patternDoc.matchAll(/^\|\s*([^|]+?)\s*\|\s*[^|]+\|\s*(S|M|L|XL)\s*\|/gm)].map((m) => m[1].trim());
for (const name of docNames) {
  if (/^模式$|^-+$/.test(name)) continue;
  if (!PATTERNS.some((p) => p.name === name)) {
    fail('pattern-code-missing', `03-pattern-selection.md 的模式 "${name}" 在 patterns.mjs 中不存在`);
  }
}

say('[7/10] token 预算一致性');
const ctxDoc = fs.readFileSync(path.join(repo, 'docs', 'system', '04-context-discipline.md'), 'utf8');
const budgetRow = ctxDoc.match(/\|\s*\*\*L0 入口\*\*\s*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/);
if (!budgetRow) {
  fail('budget-doc', '04-context-discipline.md 未找到 L0 预算行');
} else if (!budgetRow[1].includes(String(PACK_LIMITS['AGENTS.md']))) {
  fail('budget-mismatch', `limits.mjs 中 AGENTS.md 上限 ${PACK_LIMITS['AGENTS.md']} 行与文档 "${budgetRow[1].trim()}" 不一致`);
}
if (!ctxDoc.includes(String(DEFAULT_TASK_BUDGET))) {
  fail('budget-mismatch', `limits.mjs 的 DEFAULT_TASK_BUDGET=${DEFAULT_TASK_BUDGET} 未在 04-context-discipline.md 出现`);
}

/* -------------------------------------------------------- 8. 文档相对链接 */

say('[8/10] 文档链接与路径引用');
const docFiles = [
  'AGENTS.md', 'CLAUDE.md', 'README.md', 'skills/README.md', 'templates/_schema/pack.schema.md',
  'templates/_schema/variables.md',
  ...walk(path.join(repo, 'docs'), {}).files.map((f) => `docs/${f}`),
];
const repoFiles = new Set(walk(repo, {}).files.map((f) => normalizeRel(f)));
const repoDirs = new Set(walk(repo, {}).dirs.map((d) => normalizeRel(d)));
for (const rel of docFiles) {
  const abs = path.join(repo, rel);
  if (!isFile(abs)) {
    fail('doc-missing', `${rel} 不存在`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  const dir = path.posix.dirname(normalizeRel(rel));
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = normalizeRel(path.posix.join(dir === '.' ? '' : dir, target));
    if (repoFiles.has(resolved) || repoDirs.has(resolved)) continue;
    if (exists(path.join(repo, resolved))) continue;
    fail('doc-link-broken', `${rel} → 链接目标不存在：${target}`);
  }
}
// 文档里用反引号引用的仓库内路径。
// 注意：`docs/architecture/*`、`docs/runbooks/*`、`.ai/...` 等是**生成到用户项目**里的路径，
// 在本仓库中不存在是正常的，不视为断链。
const PROJECT_RELATIVE = [
  /^docs\/(architecture|runbooks|adr)\//,
  /^\.ai\//,
  /^templates\/shared\/name\.md$/,
];
for (const rel of docFiles) {
  const abs = path.join(repo, rel);
  if (!isFile(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  for (const match of text.matchAll(/`((?:docs|cli|schema|skills|scripts|templates)\/[A-Za-z0-9_./{}()*#-]+)`/g)) {
    const target = match[1];
    if (target.includes('*') || target.includes('{') || target.includes('}')) continue;
    if (PROJECT_RELATIVE.some((re) => re.test(target))) continue;
    if (target.endsWith('/')) {
      if (!repoDirs.has(target.slice(0, -1))) fail('doc-path-broken', `${rel} → 路径不存在：${target}`);
      continue;
    }
    if (!repoFiles.has(target) && !repoDirs.has(target)) fail('doc-path-broken', `${rel} → 路径不存在：${target}`);
  }
}

/* ------------------------------------------------- 9. 本仓库上下文预算 */

say('[9/10] 本仓库上下文预算');
const rootBudget = { 'AGENTS.md': 130, 'CLAUDE.md': 30 };
for (const [rel, limit] of Object.entries(rootBudget)) {
  const abs = path.join(repo, rel);
  if (!isFile(abs)) {
    fail('root-context-missing', `${rel} 不存在`);
    continue;
  }
  const lines = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n').length;
  if (lines > limit) fail('root-context-budget', `${rel} 有 ${lines} 行，超过 ${limit} 行上限`);
  else note(`${rel}: ${lines}/${limit} 行`);
}

/* ------------------------------------------------------ 10. selftest 覆盖 */

say('[10/10] selftest 覆盖与 CLI 契约');
const selftest = fs.readFileSync(path.join(repo, 'scripts', 'selftest.mjs'), 'utf8');
const packListMatch = selftest.match(/const PACKS = \[([\s\S]*?)\];/);
if (!packListMatch) {
  fail('selftest-packs', 'scripts/selftest.mjs 未找到 const PACKS = [...] 列表');
} else {
  const listed = [...packListMatch[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  for (const pack of packs) {
    if (!pack.__error && !listed.includes(pack.id)) {
      fail('selftest-pack-missing', `scripts/selftest.mjs 的 PACKS 未覆盖模板包 "${pack.id}"`);
    }
  }
}
const cliSource = fs.readFileSync(path.join(cliLib, 'cli.mjs'), 'utf8');
for (const command of ['init', 'index', 'task', 'review', 'scale', 'patterns', 'skill', 'doctor', 'upgrade', 'packs']) {
  if (!new RegExp(`\\b${command}\\b`).test(cliSource)) fail('cli-command-missing', `cli.mjs 未实现命令 ${command}`);
  if (!selftest.includes(`'${command}'`) && !selftest.includes(`"${command}"`) && !selftest.includes(` ${command}`)) {
    fail('selftest-command-missing', `scripts/selftest.mjs 未覆盖命令 ${command}`);
  }
}
if (!fs.readFileSync(path.join(repo, 'docs', 'system', '07-cli.md'), 'utf8').includes('ai-arch')) {
  fail('cli-doc', 'docs/system/07-cli.md 缺少 CLI 说明');
}

/* ------------------------------------- 11. 框架自身不得耦合具体项目 */

say('[11/11] 框架通用性（不得耦合任何具体项目）');
/**
 * 为什么要有这条检查：框架的价值在于"方法的提炼"。一旦把某个真实项目的名字、插件清单、
 * 私有仓库地址或本机路径写进模板与代码，所有其他用户都会看到别人的项目细节，
 * 更糟的是它会被当成规范的一部分被复制。这类污染只能靠机械检查挡住。
 *
 * 检查的是**项目专有标识**，不是"任何具体字符串"：中性占位名（MyGame / Foo / Demo）
 * 与通用示例值（例如把 5.7 当示例版本号）都是允许的。
 */
const PROJECT_SPECIFIC = [
  { re: /\bAGLS\b/i, why: '具体项目名' },
  { re: /\bAISpec\b/, why: '具体项目的规范体系名' },
  { re: /git\.tencent\.com|berserkwang/i, why: '私有仓库地址' },
  { re: /\b(ClimbingNavigation|HelpfulFunctions|IWALS_AbilitySystem|JakubAnimNodes|JakubCableComponent|GraphDebbuger)\b/, why: '具体项目的插件清单' },
  { re: /D:\\UE_\d/i, why: '本机绝对路径' },
];
const SCAN_EXT = /\.(mjs|js|json|md|txt|yml|yaml|toml|cs|cpp|h|gd|ts)$/i;
const selfFiles = walk(repo, { ignore: ['.git/', 'dist/', 'node_modules/'] }).files
  .filter((f) => SCAN_EXT.test(f))
  // validate 自身持有这些模式的定义，跳过以免自报
  .filter((f) => normalizeRel(f) !== 'scripts/validate.mjs');
for (const rel of selfFiles) {
  const text = fs.readFileSync(path.join(repo, rel), 'utf8');
  for (const sig of PROJECT_SPECIFIC) {
    if (sig.re.test(text)) {
      fail('project-coupling', `${rel} 含${sig.why}：框架必须与具体项目解耦，请改用中性示例`);
    }
  }
}

/* --------------------------------------------------------------- 输出 */

const width = 78;
process.stdout.write('\n' + '─'.repeat(width) + '\n');
if (problems.length === 0) {
  process.stdout.write(`✓ 校验通过（${notes.length} 条信息）\n`);
  if (!quiet) for (const n of notes) process.stdout.write(`  · ${n}\n`);
  process.stdout.write('─'.repeat(width) + '\n');
  process.exit(0);
}
process.stdout.write(`✗ 校验失败：${problems.length} 个问题\n\n`);
const byCode = new Map();
for (const p of problems) {
  if (!byCode.has(p.code)) byCode.set(p.code, []);
  byCode.get(p.code).push(p.msg);
}
for (const [code, msgs] of byCode) {
  process.stdout.write(`[${code}] ${msgs.length} 处\n`);
  for (const m of msgs.slice(0, 12)) process.stdout.write(`  - ${m}\n`);
  if (msgs.length > 12) process.stdout.write(`  … 其余 ${msgs.length - 12} 处省略\n`);
  process.stdout.write('\n');
}
process.stdout.write('─'.repeat(width) + '\n');
process.exit(1);
