#!/usr/bin/env node
/**
 * 分发物的格式验证（离线，不需要安装任何 agent 产品）。
 *
 * 每个分发物都要符合**对方官方文档规定的**清单与字段要求。这些要求都是核实过的：
 *  - Claude Code 插件：清单必须在 `.claude-plugin/plugin.json`；`name` 必填且 kebab-case；
 *    `version` 语义化；组件路径须以 `./` 开头且不得用 `../`
 *  - Cursor：规则是 `.cursor/rules/*.mdc`，frontmatter 三字段 `description`/`globs`/`alwaysApply`；
 *    skill 是 `<root>/SKILL.md` 目录 bundle，必填 `name` 与 `description`
 *  - GitHub Copilot：`.github/instructions/<name>.instructions.md`，frontmatter 必填 `applyTo`
 *  - Gemini CLI 扩展：`<ext>/gemini-extension.json`，`name` 必须等于目录名，`contextFileName` 指向上下文文件
 *  - DSH：npm 包 + `cordis.patch.yml`（`insert` 一行，`name` 必须等于包名）；skill 来自
 *    `dsh-skill-filesystem`，必填 `name`/`description`，可选 `whenToUse`，且**不支持嵌套 SKILL.md**
 *
 * 它**不能**证明的：各产品在真实运行时的行为（本机没有安装这些产品）。
 * 因此输出会明确区分"格式已验证"与"未做运行时验证"。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const dist = path.join(repo, 'dist');

const results = [];
const ok = (name, detail = '') => results.push({ ok: true, name, detail });
const bad = (name, detail) => results.push({ ok: false, name, detail });
const assert = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

if (!fs.existsSync(dist)) {
  process.stderr.write('未找到 dist/，请先执行：node scripts/dist.mjs\n');
  process.exit(2);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);

/** 列出目录下的直接子目录名 */
function subdirs(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** 读 SKILL.md frontmatter 的键值 */
function fm(file) {
  if (!exists(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/* ---------------------------------------------- 1. 标准 skills 包 */

{
  const root = path.join(dist, 'skills');
  const ids = subdirs(root);
  assert(ids.length >= 7, 'skills 包：技能数 >= 7', String(ids.length));
  for (const id of ids) {
    const f = fm(path.join(root, id, 'SKILL.md'));
    assert(Boolean(f), `skills/${id}：有 SKILL.md 与 frontmatter`);
    if (!f) continue;
    assert(Boolean(f.name), `skills/${id}：frontmatter 有 name`);
    assert(f.name === id, `skills/${id}：name 等于目录名`, f.name);
    assert(Boolean(f.description), `skills/${id}：frontmatter 有 description`);
    assert(Boolean(f.whenToUse), `skills/${id}：frontmatter 有 whenToUse（DSH/标准要求）`);
    assert(!f.when, `skills/${id}：未使用非标准键 when`);
  }
  // 不支持嵌套 SKILL.md：确认根下没有更深层的 SKILL.md
  const nested = [];
  const scan = (d, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (depth > 0 && exists(path.join(p, 'SKILL.md'))) nested.push(path.relative(root, p));
      scan(p, depth + 1);
    }
  };
  scan(root, 0);
  assert(nested.length === 0, 'skills 包：无嵌套 SKILL.md', nested.join(', '));
}

/* ------------------------------------- 2. Claude Code 插件清单 */

{
  const root = path.join(dist, 'plugins', 'claude-code');
  const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
  assert(exists(manifestPath), 'Claude 插件：清单位于 .claude-plugin/plugin.json（官方硬要求）');
  if (exists(manifestPath)) {
    const m = readJson(manifestPath);
    assert(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(m.name ?? ''), 'Claude 插件：name 为 kebab-case', m.name);
    assert(/^\d+\.\d+\.\d+/.test(m.version ?? ''), 'Claude 插件：version 语义化', m.version);
    assert(typeof m.description === 'string' && m.description.length >= 20, 'Claude 插件：有意义的 description');
    for (const field of ['commands', 'agents', 'hooks', 'mcpServers']) {
      const v = m[field];
      const list = Array.isArray(v) ? v : v ? [v] : [];
      for (const p of list) {
        if (typeof p === 'string' && !p.startsWith('./')) bad(`Claude 插件：${field} 路径必须以 ./ 开头`, p);
        if (typeof p === 'string' && p.includes('../')) bad(`Claude 插件：${field} 路径不得用 ../`, p);
      }
    }
    ok('Claude 插件：组件路径符合相对路径规则');
  }
  const ids = subdirs(path.join(root, 'skills'));
  assert(ids.length >= 7, 'Claude 插件：skills/ 下有技能（默认目录自动发现）', String(ids.length));
}

/* ---------------------------------------- 3. Cursor 插件与规则 */

{
  const root = path.join(dist, 'plugins', 'cursor');
  const plugin = path.join(root, '.cursor-plugin', 'plugin.json');
  const market = path.join(root, '.cursor-plugin', 'marketplace.json');
  assert(exists(plugin), 'Cursor 插件：有 .cursor-plugin/plugin.json');
  assert(exists(market), 'Cursor 插件：有 .cursor-plugin/marketplace.json');
  if (exists(plugin)) {
    const m = readJson(plugin);
    assert(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(m.name ?? ''), 'Cursor 插件：name 为 kebab-case', m.name);
    assert(/^\d+\.\d+\.\d+/.test(m.version ?? ''), 'Cursor 插件：version 语义化', m.version);
  }
  const rules = exists(path.join(root, '.cursor', 'rules'))
    ? fs.readdirSync(path.join(root, '.cursor', 'rules')).filter((f) => f.endsWith('.mdc'))
    : [];
  assert(rules.length >= 2, 'Cursor 插件：有入口规则 + 路径级规则（.mdc）', `${rules.length} 条`);
  let always = 0;
  for (const f of rules) {
    const meta = fm(path.join(root, '.cursor', 'rules', f));
    assert(Boolean(meta), `Cursor 规则 ${f}：有 frontmatter`);
    if (!meta) continue;
    const keys = Object.keys(meta);
    const allowed = keys.every((k) => ['description', 'globs', 'alwaysApply'].includes(k));
    assert(allowed, `Cursor 规则 ${f}：frontmatter 仅含官方三字段`, keys.join(','));
    if (meta.alwaysApply === 'true') always += 1;
    if (meta.alwaysApply === 'false') {
      assert(Boolean(meta.globs), `Cursor 规则 ${f}：非 alwaysApply 时必须给 globs`);
    }
  }
  assert(always === 1, 'Cursor 插件：恰好一条 alwaysApply 入口规则', String(always));
  const ids = subdirs(path.join(root, '.cursor', 'skills'));
  assert(ids.length >= 7, 'Cursor 插件：.cursor/skills 下有技能', String(ids.length));
}

/* ------------------------------------- 4. Copilot 指令包 */

{
  const root = path.join(dist, 'instructions', 'copilot');
  assert(exists(path.join(root, 'copilot-instructions.md')), 'Copilot 包：有 .github/copilot-instructions.md');
  const dir = path.join(root, 'instructions');
  const files = exists(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.instructions.md')) : [];
  assert(files.length >= 3, 'Copilot 包：有路径级指令文件（*.instructions.md）', `${files.length} 个`);
  for (const f of files) {
    const meta = fm(path.join(dir, f));
    assert(Boolean(meta?.applyTo), `Copilot 指令 ${f}：frontmatter 有 applyTo（官方要求）`);
  }
}

/* ------------------------------------- 5. Gemini CLI 扩展 */

{
  const root = path.join(dist, 'extensions', 'ai-engineering-arch');
  const manifestPath = path.join(root, 'gemini-extension.json');
  assert(exists(manifestPath), 'Gemini 扩展：有 gemini-extension.json');
  if (exists(manifestPath)) {
    const m = readJson(manifestPath);
    assert(m.name === path.basename(root), 'Gemini 扩展：name 等于扩展目录名（官方要求）', m.name);
    assert(Boolean(m.version), 'Gemini 扩展：有 version');
    assert(m.contextFileName === 'GEMINI.md', 'Gemini 扩展：声明 contextFileName', m.contextFileName);
    assert(exists(path.join(root, m.contextFileName)), 'Gemini 扩展：contextFileName 指向的文件存在');
  }
}

/* ------------------------------------- 6. DSH 插件 */

{
  const root = path.join(dist, 'plugins', 'dsh');
  const pkgPath = path.join(root, 'package.json');
  assert(exists(pkgPath), 'DSH 插件：有 package.json');
  if (exists(pkgPath)) {
    const p = readJson(pkgPath);
    assert(p.dsh?.bundle?.patch === './cordis.patch.yml', 'DSH 插件：声明 dsh.bundle.patch');
    const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
    assert(/^- insert:/m.test(patch), 'DSH 插件：cordis.patch.yml 顶层为 insert 数组');
    assert(patch.match(/name:\s*(\S+)/)?.[1] === p.name, 'DSH 插件：补丁的 name 等于包名');
    assert(exists(path.join(root, 'bundle', 'cli', 'ai-arch.mjs')), 'DSH 插件：内置 CLI 随包分发');
  }
  const ids = subdirs(path.join(root, 'skills'));
  assert(ids.length >= 7, 'DSH 插件：随包 skills 数量 >= 7', String(ids.length));
  for (const id of ids) {
    const meta = fm(path.join(root, 'skills', id, 'SKILL.md'));
    assert(Boolean(meta?.name && meta?.description && meta?.whenToUse),
      `DSH 随包 skill ${id}：frontmatter 含 name/description/whenToUse`);
  }
}

/* ------------------------------------- 7. 统一 agent kit */

{
  const root = path.join(dist, 'agent-kit');
  const expected = [
    ['.claude/CLAUDE.md', '.claude/skills'],
    ['.dsh/AGENTS.md', '.dsh/skills'],
    ['.cursor/rules/ai-arch.mdc', '.cursor/skills'],
    ['.github/copilot-instructions.md', null],
    ['.gemini/GEMINI.md', null],
    ['.codex/AGENTS.md', null],
  ];
  for (const [file, skillsRoot] of expected) {
    assert(exists(path.join(root, file)), `agent-kit：含 ${file}`);
    if (skillsRoot) {
      const n = subdirs(path.join(root, skillsRoot)).length;
      assert(n >= 7, `agent-kit：${skillsRoot} 有技能`, String(n));
    }
  }
  assert(exists(path.join(root, '.agents/skills')), 'agent-kit：含跨工具约定的 .agents/skills');
  // 所有指针必须指向仓库根的 AGENTS.md 或 .ai/（不能指向别处，否则解包后失效）
  const pointers = ['.claude/CLAUDE.md', '.dsh/AGENTS.md', '.cursor/rules/ai-arch.mdc', '.github/copilot-instructions.md', '.gemini/GEMINI.md', '.codex/AGENTS.md'];
  for (const p of pointers) {
    const text = fs.readFileSync(path.join(root, p), 'utf8');
    assert(/AGENTS\.md/.test(text) && /\.ai\//.test(text), `agent-kit：${p} 指向 AGENTS.md 与 .ai/`);
  }
}

/* ------------------------------------------------------------- 结论 */

const failed = results.filter((r) => !r.ok);
process.stdout.write('\n分发物格式验证（逐项对照各产品官方文档）\n\n');
let lastPrefix = '';
for (const r of results) {
  const prefix = r.name.split('：')[0];
  if (prefix !== lastPrefix) {
    process.stdout.write(`\n[${prefix}]\n`);
    lastPrefix = prefix;
  }
  const short = r.name.includes('：') ? r.name.split('：').slice(1).join('：') : r.name;
  process.stdout.write(`  ${r.ok ? '✓' : '✗'} ${short}${r.detail ? `  — ${r.detail}` : ''}\n`);
}
process.stdout.write(`\n共 ${results.length} 项，失败 ${failed.length} 项\n`);
process.stdout.write('\n已验证：各产品官方清单格式、字段名与取值、frontmatter 标准键、目录布局、指针可达性。\n');
process.stdout.write('未验证：各产品运行时的实际加载行为（本机未安装这些产品）。\n');
process.exit(failed.length > 0 ? 1 : 0);
