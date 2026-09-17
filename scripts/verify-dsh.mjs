#!/usr/bin/env node
/**
 * DSH 插件的**离线**冒烟验证（不需要运行中的 DSH 实例）。
 *
 * 为什么需要它：本机没有可启动的 DSH profile，无法端到端验证插件；
 * 但插件真正的风险点都能离线证伪：
 *   1. host 入口能否被 ESM 导入（语法、`import.meta.dirname`、依赖导入）
 *   2. 是否导出了 DSH 要求的 name / inject / apply
 *   3. apply(ctx) 是否只依赖声明的服务，并真的把工具注册进来
 *   4. 每个注册的工具能否真正执行（用临时项目跑一遍），且**不修改项目文件**
 *   5. cordis.patch.yml 的形状与行 id
 *   6. 随包 skills 是否符合 DSH 的 frontmatter 要求（name/description/whenToUse）
 *
 * 它**不能**证明的：工具在真实 DSH 会话中被模型调用的表现、UI/事件集成。
 * 因此结论里会明确区分"已验证"与"未验证"。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const pluginDir = path.join(repo, 'dist', 'plugins', 'dsh');

const results = [];
const ok = (name, detail = '') => results.push({ ok: true, name, detail });
const bad = (name, detail) => results.push({ ok: false, name, detail });

function assert(cond, name, detail) {
  if (cond) ok(name, detail);
  else bad(name, detail);
}

if (!fs.existsSync(pluginDir)) {
  process.stderr.write('未找到 dist/plugins/dsh，请先执行：node scripts/dist.mjs\n');
  process.exit(2);
}

/* 1. 包元数据与补丁 */
const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
assert(pkg.name === 'dsh-ai-engineering-arch', 'package.json name', pkg.name);
assert(pkg.type === 'module', 'package.json type=module');
assert(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch 已声明');
assert(typeof pkg.main === 'string' && fs.existsSync(path.join(pluginDir, pkg.main)), 'main 入口文件存在', pkg.main);

const patch = fs.readFileSync(path.join(pluginDir, 'cordis.patch.yml'), 'utf8');
assert(/^- insert:/m.test(patch), 'cordis.patch.yml 顶层为 insert 数组');
const patchedName = patch.match(/name:\s*(\S+)/)?.[1];
assert(patchedName === pkg.name, 'cordis.patch.yml 的 name 等于包名（名册按包名解析）', patchedName);
const patchId = patch.match(/id:\s*(\S+)/)?.[1];
assert(Boolean(patchId), 'cordis.patch.yml 声明了行 id', patchId);

/* 2. host 入口：导入 + 导出形状 + apply 注册工具 */
const seenTools = new Map();
const fakeCtx = {
  tools: {
    register(spec) {
      if (!spec?.name) throw new Error('注册了没有 name 的工具');
      seenTools.set(spec.name, spec);
      return () => {};
    },
  },
  effect() { return () => {}; },
  get() { return undefined; },
  on() {},
};

let mod = null;
try {
  mod = await import(pathToFileURL(path.join(pluginDir, pkg.main)).href);
  ok('host 入口可被 ESM 导入（含 import.meta.dirname 用法）');
} catch (error) {
  bad('host 入口可被 ESM 导入', error.message);
}

if (mod) {
  assert(mod.name === 'ai-engineering-arch', '导出 name', mod.name);
  assert(Array.isArray(mod.inject), '导出 inject 数组', JSON.stringify(mod.inject));
  assert(typeof mod.apply === 'function', '导出 apply 函数');
  try {
    mod.apply(fakeCtx, {});
    ok('apply(ctx) 在最小 ctx 下执行成功', `注册了 ${seenTools.size} 个工具`);
  } catch (error) {
    bad('apply(ctx) 执行', error.message);
  }
  // 工具数量与命名
  assert(seenTools.size >= 6, '注册工具数量 >= 6', String(seenTools.size));
  for (const name of ['ai_arch_doctor', 'ai_arch_task_pack', 'ai_arch_rules', 'ai_arch_rules_add', 'ai_arch_facts', 'ai_arch_review_drift']) {
    assert(seenTools.has(name), `工具 ${name} 已注册`);
  }
  // 每个工具的形状符合 defineTool 要求
  for (const [name, spec] of seenTools) {
    assert(typeof spec.description === 'string' && spec.description.length > 30, `${name} 有足够详细的 description（模型看到的契约）`);
    assert(spec.output?.schema?.type === 'object', `${name} 声明了 object 形状的 output.schema`);
    assert(typeof spec.execute === 'function', `${name} 有 execute`);
  }
  // 工具描述里不得泄露具体项目（通用性要求）
  const allDesc = [...seenTools.values()].map((s) => s.description).join('\n');
  assert(!/\bAGLS\b|AISpec/.test(allDesc), '工具描述不含具体项目耦合');
}

/* 3. 真实执行：用临时项目跑只读工具，并确认不改动项目 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-verify-'));
try {
  // 造一个最小的 UE 项目（用于让 install 能识别类型）
  fs.writeFileSync(path.join(tmp, 'Game.uproject'), JSON.stringify({ EngineAssociation: '5.8' }), 'utf8');
  fs.mkdirSync(path.join(tmp, 'Source', 'Game'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'Source', 'Game', 'Game.Build.cs'), '// build\n', 'utf8');

  // 用内置 bundle 的 CLI 初始化（这一步会写文件，属于"人要确认的动作"，此处仅用于造场景）
  const bundleCli = path.join(pluginDir, 'bundle', 'cli', 'ai-arch.mjs');
  assert(fs.existsSync(bundleCli), '随包内置 CLI 存在', path.relative(pluginDir, bundleCli));

  const { spawnSync } = await import('node:child_process');
  const init = spawnSync(process.execPath, [bundleCli, 'install', tmp], { encoding: 'utf8' });
  assert(init.status === 0, '内置 CLI 可在临时项目上完成接入', (init.stdout || init.stderr || '').split('\n')[0]);

  // 快照：只读工具不得改变任何文件
  const snapshot = () => {
    const out = new Map();
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.set(path.relative(tmp, p), fs.statSync(p).mtimeMs + ':' + fs.statSync(p).size);
      }
    };
    walk(tmp);
    return out;
  };
  const before = snapshot();

  // 逐个执行只读工具（rules_add 会写文件，故不在此列——它属于"要人确认的动作"，只验证形状）
  const readOnly = ['ai_arch_doctor', 'ai_arch_rules', 'ai_arch_facts', 'ai_arch_review_drift'];
  for (const name of readOnly) {
    const spec = seenTools.get(name);
    if (!spec) continue;
    try {
      const value = await spec.execute({ root: tmp }, {});
      assert(value && typeof value === 'object', `${name} 执行返回对象`);
      assert(typeof value.report === 'string' && value.report.length > 0, `${name} 返回了可读报告`);
    } catch (error) {
      bad(`${name} 执行`, error.message);
    }
  }
    const taskSpec = seenTools.get('ai_arch_task_pack');
  let declaredArtifact = null;
  if (taskSpec) {
    try {
      const value = await taskSpec.execute({ prompt: '改角色移动逻辑', root: tmp }, {});
      assert(value.ok === true, 'ai_arch_task_pack 成功生成任务包');
      assert(/\.ai[\\/]tasks[\\/].+\.md/.test(value.taskFile || ''), '返回了任务包文件路径', value.taskFile);
      assert(fs.existsSync(path.join(tmp, value.taskFile)), '任务包文件确实存在');
      declaredArtifact = value.taskFile ? path.normalize(value.taskFile) : null;
    } catch (error) {
      bad('ai_arch_task_pack 执行', error.message);
    }
  }

  const after = snapshot();
  // 只读工具的判定：允许**它自己声明的那一个产物**（任务包就是它的交付物），其余一律不得变动。
  // 注意要在两处都排除：新增文件同时会出现在"新增"与"改动"（mtime 变化）两类里。
  const isDeclared = (rel) => declaredArtifact !== null && path.normalize(rel) === declaredArtifact;
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k) && !isDeclared(k));
  const added = [...after.keys()].filter((k) => !before.has(k) && !isDeclared(k));
  const removed = [...before.keys()].filter((k) => !after.has(k) && !isDeclared(k));
  assert(changed.length === 0 && added.length === 0 && removed.length === 0,
    '除自声明产物外，不修改/新增/删除任何项目文件',
    changed.length + added.length + removed.length > 0
      ? `改动 ${changed.length}、新增 ${added.length}、删除 ${removed.length}：${[...changed, ...added, ...removed].slice(0, 5).join(', ')}`
      : '');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* 4. 随包 skills 的 frontmatter */
const skillsDir = path.join(pluginDir, 'skills');
const skillIds = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];
assert(skillIds.length >= 7, '随包 skills 数量 >= 7', String(skillIds.length));
for (const id of skillIds) {
  const file = path.join(skillsDir, id, 'SKILL.md');
  if (!fs.existsSync(file)) {
    bad(`skill ${id} 含 SKILL.md`);
    continue;
  }
  const fm = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const hasRequired = fm && /^name:/m.test(fm[1]) && /^description:/m.test(fm[1]) && /^whenToUse:/m.test(fm[1]);
  assert(hasRequired, `skill ${id} frontmatter 符合 DSH 要求（name/description/whenToUse）`);
  if (fm && /^when:/m.test(fm[1])) bad(`skill ${id} 使用了非标准键 when`, 'DSH 不识别 when，会丢弃该 skill');
}
// DSH 刻意不支持嵌套 SKILL.md：确认没有多余的嵌套层
const nested = [];
const findNested = (d, depth) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(d, e.name);
    if (depth > 0 && fs.existsSync(path.join(p, 'SKILL.md'))) nested.push(path.relative(skillsDir, p));
    findNested(p, depth + 1);
  }
};
if (fs.existsSync(skillsDir)) findNested(skillsDir, 0);
assert(nested.length === 0, 'skills 无嵌套 SKILL.md（DSH 不支持嵌套发现）', nested.join(', '));

/* ------------------------------------------------------------- 结论 */
const failed = results.filter((r) => !r.ok);
process.stdout.write('\nDSH 插件离线冒烟验证\n\n');
for (const r of results) {
  process.stdout.write(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}\n`);
}
process.stdout.write(`\n共 ${results.length} 项，失败 ${failed.length} 项\n`);
process.stdout.write('\n已验证：包元数据与补丁形状、host 入口可导入、导出符合 DSH 契约、\n');
process.stdout.write('        工具注册与描述、只读工具在真实项目上可执行且不改动文件、skills frontmatter。\n');
process.stdout.write('未验证：真实 DSH 会话中被模型调用的表现（本机无可用 profile）；peer 依赖范围随内测版本可能变化。\n');
process.exit(failed.length > 0 ? 1 : 0);
