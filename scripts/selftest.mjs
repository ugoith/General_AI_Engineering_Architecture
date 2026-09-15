#!/usr/bin/env node
/**
 * 端到端自测（零依赖）。
 *
 * 对 `PACKS` 里的**每一个**模板包，在临时目录里真实执行一遍完整工作流：
 *   init → index → index --stale → index --apply → task → review(--drift/--impact/--decisions)
 *   → scale → scale --gaps → patterns → skill(list/show/add) → doctor → upgrade
 * 并额外验证：幂等生成、默认不覆盖、upgrade 保护本地改动、任务包预算与摘要机制真实生效。
 *
 * 用法：
 *   node scripts/selftest.mjs            # 全部
 *   node scripts/selftest.mjs --keep     # 保留临时目录（排查用）
 *   node scripts/selftest.mjs --pack game-unity
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const cliLib = path.join(repo, 'cli', 'lib');

/** 必须覆盖仓库内全部模板包；scripts/validate.mjs 会校验这一点。 */
const PACKS = [
  'software-cli-small',
  'software-app-medium',
  'software-system-large',
  'game-unity',
  'game-unreal',
  'game-godot',
  'game-web',
];

const { main } = await import(pathToFileURL(path.join(cliLib, 'cli.mjs')).href);
const { sha256, isFile, readJsonSafe, walk, normalizeRel } = await import(pathToFileURL(path.join(cliLib, 'fsx.mjs')).href);
const { loadIndex } = await import(pathToFileURL(path.join(cliLib, 'indexer.mjs')).href);

const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const packFilter = argv.includes('--pack') ? argv[argv.indexOf('--pack') + 1] : null;

const results = [];
let currentTest = 'setup';

function begin(name) {
  currentTest = name;
  process.stdout.write(`  ▸ ${name}\n`);
}

function pass(detail = '') {
  results.push({ test: currentTest, ok: true, detail });
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertFile(root, rel, { minBytes = 1 } = {}) {
  const abs = path.join(root, rel);
  assert(isFile(abs), `期望存在文件：${rel}`);
  const size = fs.statSync(abs).size;
  assert(size >= minBytes, `文件过小（${size} 字节）：${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

async function run(args, { expectCode = 0, quiet = true } = {}) {
  const out = [];
  const err = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  let code;
  try {
    code = await main(args);
  } catch (error) {
    process.stdout.write = origOut;
    process.stderr = origErr;
    throw new Error(`命令 ai-arch ${args.join(' ')} 抛出异常：${error.message}`);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  const stdout = out.join('');
  const stderr = err.join('');
  if (expectCode !== null && code !== expectCode) {
    throw new Error(`命令 ai-arch ${args.join(' ')} 退出码 ${code}，期望 ${expectCode}\n${stderr || stdout}`);
  }
  if (!quiet && stdout) origOut(stdout);
  return { code, stdout, stderr };
}

function tmpDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-arch-${label}-`));
  return dir;
}

/**
 * 项目级命令统一用 `--root <目录>` 指定项目（等价于"cd 到项目内运行"）。
 * 位置参数一律留给业务内容，避免目录与内容混淆（见 cli/lib/cli.mjs 的 resolveProject）。
 */
async function prun(root, args, opts) {
  const cmd = args[0];
  return run([cmd, '--root', root, ...args.slice(1)], opts);
}

/* ------------------------------------------------------------------ 主流程 */

process.stdout.write(`\nai-arch 自测 — 框架根 ${repo}\n`);
process.stdout.write(`临时目录：${os.tmpdir()}\n\n`);

for (const packId of PACKS) {
  if (packFilter && packFilter !== packId) continue;
  const root = tmpDir(packId);
  try {
    begin(`${packId}: init`);
    const init = await run(['init', root, '--pack', packId]);
    assert(init.stdout.includes('模板包'), 'init 输出缺少模板包信息');
    assertFile(root, 'AGENTS.md', { minBytes: 200 });
    assertFile(root, '.ai/constitution.md', { minBytes: 200 });
    assertFile(root, '.ai/framework.json');
    assertFile(root, '.ai/bin/ai-arch.mjs');
    assertFile(root, '.ai/lib/cli.mjs');
    assertFile(root, '.ai/index/files.json');
    const meta = readJsonSafe(path.join(root, '.ai', 'framework.json'), null);
    assert(meta?.packId === packId, `framework.json 的 packId=${meta?.packId}，期望 ${packId}`);
    assert(Object.keys(meta.managed ?? {}).length > 5, 'managed 记录过少');
    const agentsLines = assertFile(root, 'AGENTS.md').replace(/\r\n/g, '\n').split('\n').length;
    assert(agentsLines <= 130, `AGENTS.md 有 ${agentsLines} 行，超过 130 行上限`);
    // 渲染残留检查。
    // 跳过两类**框架自身内容的原样快照**（它们包含 `{{...}}` 语法示例，属预期内容）：
    //   `.ai/framework/**` —— 框架规范与模板快照（内含模板语法示例）
    //   `.ai/lib/**`       —— CLI 实现快照（其正则里就有模板语法字面量）
    for (const rel of walk(root, {}).files) {
      if (/\.(png|jpg|ico|woff2?)$/i.test(rel)) continue;
      if (rel.startsWith('.ai/framework/') || rel.startsWith('.ai/lib/')) continue;
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      assert(!/\{\{[A-Za-z#/]/.test(text), `渲染残留模板语法：${rel}`);
    }
    // skills 复制
    for (const id of meta.skills ?? []) {
      assertFile(root, `.ai/skills/${id}/SKILL.md`, { minBytes: 100 });
    }
    pass();

    begin(`${packId}: 幂等与"默认不覆盖"`);
    const hashBefore = new Map(walk(root, {}).files.map((rel) => [rel, sha256(fs.readFileSync(path.join(root, rel), 'utf8'))]));
    const markerFile = path.join(root, 'AGENTS.md');
    const markerText = fs.readFileSync(markerFile, 'utf8') + '\n<!-- 本地标记 -->\n';
    fs.writeFileSync(markerFile, markerText, 'utf8');
    const second = await run(['init', root, '--pack', packId]);
    assert(second.stdout.includes('跳过'), '重复 init 未报告跳过项');
    assert(fs.readFileSync(markerFile, 'utf8') === markerText, '重复 init 覆盖了已存在的本地文件');
    const hashAfter = new Map(walk(root, {}).files.map((rel) => [rel, sha256(fs.readFileSync(path.join(root, rel), 'utf8'))]));
    for (const [rel, h] of hashBefore) {
      if (rel === 'AGENTS.md') continue;
      if (!hashAfter.has(rel)) continue;
      if (hashAfter.get(rel) !== h) throw new Error(`重复 init 改变了未改动文件：${rel}`);
    }
    pass();

    begin(`${packId}: index`);
    await run(['index', root]);
    const index = loadIndex(root);
    assert(index?.fileCount > 5, `索引文件数异常：${index?.fileCount}`);
    assert(Array.isArray(index.files) && index.files.length === index.fileCount, 'files 数组与 fileCount 不一致');
    const agents = index.files.find((f) => f.path === 'AGENTS.md');
    assert(agents?.hash?.length === 64, '索引 missing AGENTS.md hash');
    assert(index.summary.pendingDigest > 0, '新项目应当有待写摘要的文件');
    pass();

    begin(`${packId}: index --stale / --apply`);
    const stale = await prun(root, ['index', '--stale', '--json']);
    const request = JSON.parse(stale.stdout);
    assert(Array.isArray(request.files) && request.files.length > 0, '--stale 未给出待写清单');
    assert(typeof request.instructions === 'string' && request.instructions.length > 20, '--stale 缺少 AI 提示词');
    const targets = request.files.slice(0, 3).map((f) => ({
      path: f.path,
      reviewedHash: f.hash,
      purpose: `自测占位摘要：${f.path}`,
      exports: [],
      invariants: ['自测不变量：不得为空'],
      risk: 'medium',
      tags: ['selftest'],
    }));
    // 故意塞一条 hash 不匹配的，验证拒绝逻辑
    const bogus = { path: request.files[0].path, reviewedHash: 'deadbeef'.repeat(8), purpose: 'x' };
    const applyFile = path.join(root, '.ai', 'cache', 'digests.json');
    fs.mkdirSync(path.dirname(applyFile), { recursive: true });
    fs.writeFileSync(applyFile, JSON.stringify([...targets, bogus], null, 2), 'utf8');
    const applied = await prun(root, ['index', '--apply', applyFile, '--json']);
    const applyResult = JSON.parse(applied.stdout);
    assert(applyResult.applied.length === targets.length, `写回摘要数 ${applyResult.applied.length}，期望 ${targets.length}`);
    assert(applyResult.rejected.length === 1, '未拒绝 hash 不匹配的摘要');
    const index2 = loadIndex(root);
    const updated = index2.files.find((f) => f.path === targets[0].path);
    assert(updated.digest.purpose === targets[0].purpose, '摘要未写入索引');
    assert(updated.digest.reviewedHash === updated.hash, 'reviewedHash 未记录');
    assert(updated.digest.stale === false, '刚写入的摘要不应标记 stale');
    pass();

    begin(`${packId}: task`);
    const task = await prun(root, ['task', 'README 文档 说明 项目结构 如何运行', '--budget', '20000']);
    assert(task.stdout.includes('任务包已生成'), 'task 未生成任务包');
    const tasksDir = path.join(root, '.ai', 'tasks');
    const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md');
    assert(taskFiles.length >= 1, `期望至少 1 个任务包，实际 ${taskFiles.length}`);
    const taskText = fs.readFileSync(path.join(tasksDir, taskFiles[0]), 'utf8');
    for (const section of ['## 0. 索引健康度', '## 1. 必读', '## 2. 读取清单', '## 3. 范围', '## 4. 验收标准', '## 7. 遗留风险与假设']) {
      assert(taskText.includes(section), `任务包缺少小节：${section}`);
    }
    assert(/read-(digest|source)/.test(taskText), '任务包未给出决策列');
    assert(!/\.ai\/framework\//.test(taskText), '任务包把框架快照文件也列进了读取清单（会浪费上下文）');

    // 用"刚写过摘要的真实文件名"作为查询词，验证 read-digest 判定（真实使用中查询词来自任务描述）
    const digestQuery = targets.map((t) => path.basename(t.path, path.extname(t.path))).join(' ');
    const taskJson = JSON.parse((await prun(root, ['task', digestQuery, '--budget', '60000', '--json'])).stdout);
    const digestHits = taskJson.readList.filter((s) => s.decision === 'read-digest').map((s) => s.path);
    assert(digestHits.length > 0,
      `已写摘要的文件未被判定为 read-digest（查询词 "${digestQuery}"；清单：${taskJson.readList.map((s) => `${s.path}:${s.decision}`).join(', ') || '(空)'}）`);
    assert(taskJson.estimate.total > 0, '任务包未给出 token 估算');
    assert(taskJson.estimate.total <= taskJson.budget || taskJson.estimate.overBudget, '预算字段自相矛盾');

    const tiny = JSON.parse((await prun(root, ['task', 'README 文档 说明 项目 结构 运行 测试', '--budget', '1500', '--json'])).stdout);
    assert(tiny.dropped.length > 0, '极小预算下应出现被丢弃文件');
    assert(tiny.estimate.total <= 1500 || tiny.always.reduce((a, b) => a + b.tokens, 0) > 1500, '预算控制失效');
    pass();

    begin(`${packId}: review`);
    const drift = await prun(root, ['review', '--drift', '--json'], { expectCode: null });
    let report;
    try {
      report = JSON.parse(drift.stdout);
    } catch {
      throw new Error(`review --drift --json 输出不是合法 JSON（code=${drift.code}，长度=${drift.stdout.length}）：${drift.stdout.slice(0, 200)}`);
    }
    assert(Array.isArray(report.findings),
      `review --drift 未返回 findings（code=${drift.code}，长度=${drift.stdout.length}，keys=${Object.keys(report).join(',')}）`);
    assert(report.findings.some((f) => f.code === 'decisions-empty'), '新项目应提示尚无 ADR');
    assert(report.findings.some((f) => f.code === 'digest-missing'), '新项目应提示存在无摘要的文件');
    const decisions = JSON.parse((await prun(root, ['review', '--decisions', '--json'])).stdout);
    assert(Array.isArray(decisions), 'review --decisions 未返回数组');
    const impactTarget = (loadIndex(root).files.find((f) => f.importedBy?.length > 0) ?? { path: 'AGENTS.md' }).path;
    const impact = JSON.parse((await prun(root, ['review', '--impact', impactTarget, '--json'])).stdout);
    assert(Array.isArray(impact.dependents), 'review --impact 未返回 dependents');
    assert(Array.isArray(impact.rules) && impact.rules.length >= 6, '影响矩阵规则少于 6 条');
    pass();

    begin(`${packId}: scale / patterns`);
    const scale = JSON.parse((await prun(root, ['scale', '--gaps', '--json'])).stdout);
    assert(['S', 'M', 'L', 'XL'].includes(scale.assessment.level), `规模等级异常：${scale.assessment.level}`);
    assert(scale.assessment.reasons.length === 3, '规模评估缺少证据链');
    const patterns = JSON.parse((await run(['patterns', '--level', scale.assessment.level, '--json'])).stdout);
    assert(patterns.antiPatterns.length > 0, '禁止清单为空');
    if (scale.assessment.level === 'S') {
      // S 级允许的设计模式本来就应该是零个（矩阵里所有模式 minLevel ≥ M）——这是设计结论，不是缺数据
      assert(patterns.patterns.length === 0, `S 级不应有允许的设计模式，实际 ${patterns.patterns.length} 个`);
      const text = await run(['patterns', '--level', 'S']);
      assert(text.stdout.includes('零个'), 'S 级应明确说明"允许零个模式"，而不是留白');
    } else {
      assert(patterns.patterns.length > 0, `${scale.assessment.level} 级的模式矩阵为空`);
    }
    pass();

    begin(`${packId}: skill / doctor`);
    const skills = JSON.parse((await prun(root, ['skill', 'list', '--json'])).stdout);
    assert(skills.available.length >= 7, `可用 skill 少于 7 个：${skills.available.length}`);
    assert(skills.installed.length >= 2, '项目未装入任何 skill');
    const shown = await prun(root, ['skill', 'show', 'code-review']);
    assert(shown.stdout.includes('评审'), 'skill show 输出异常');
    const added = await prun(root, ['skill', 'add', 'bugfix-triage']);
    assert(added.stdout.includes('已装入 skill'), 'skill add 失败');
    assertFile(root, '.ai/skills/bugfix-triage/SKILL.md', { minBytes: 100 });

    const doc = JSON.parse((await prun(root, ['doctor', '--json'], { expectCode: null })).stdout);
    const errors = doc.checks.filter((c) => c.level === 'error');
    assert(errors.length === 0, `doctor 报错：${errors.map((e) => `${e.target} ${e.message}`).join('; ')}`);
    pass();

    begin(`${packId}: packs 列表`);
    const packsOut = JSON.parse((await run(['packs', '--json'])).stdout);
    const self = packsOut.find((p) => p.id === packId);
    assert(self, `packs --json 未包含当前模板包 ${packId}`);
    assert(self.scaleLevel === meta.scaleLevel, 'packs 的规模等级与 framework.json 不一致');
    assert(Array.isArray(self.variables) && self.variables.length > 0, 'packs 未列出模板变量');
    pass();

    begin(`${packId}: upgrade`);
    // 场景一：本地改动过的框架文件，upgrade 不得覆盖（三态里的"保留并报告"）
    const localFile = path.join(root, '.ai', 'constitution.md');
    const localMarker = '\n<!-- 本地改动 -->\n';
    fs.writeFileSync(localFile, fs.readFileSync(localFile, 'utf8') + localMarker, 'utf8');
    const dry = JSON.parse((await prun(root, ['upgrade', '--json'])).stdout);
    assert(dry.dryRun === true, 'upgrade 默认应为 dry-run');
    assert(dry.changedLocally.includes('.ai/constitution.md'),
      `dry-run 未识别本地改动过的文件（changedLocally=${JSON.stringify(dry.changedLocally.slice(0, 5))}）`);
    assert(fs.readFileSync(localFile, 'utf8').endsWith(localMarker), 'dry-run 不应写盘');
    const applied2 = JSON.parse((await prun(root, ['upgrade', '--apply', '--json'])).stdout);
    assert(applied2.changedLocally.includes('.ai/constitution.md'), 'upgrade --apply 未识别本地改动过的文件');
    assert(fs.readFileSync(localFile, 'utf8').includes('本地改动'), 'upgrade 覆盖了本地改动');
    // 场景二：幂等 —— 再跑一次不应有新的 updated/created
    const after = JSON.parse((await prun(root, ['upgrade', '--apply', '--json'])).stdout);
    assert(after.updated.length === 0 && after.created.length === 0, `二次 upgrade 不幂等：updated=${after.updated.length} created=${after.created.length}`);
    const assetsProtected = packId.startsWith('game-');
    const protectedHit = after.protectedFiles.length > 0;
    assert(!assetsProtected || protectedHit, `${packId}: 游戏包应当有受保护路径`);
    pass();

    results.push({ test: packId, ok: true, detail: '完整工作流通过' });
  } catch (error) {
    results.push({ test: currentTest, ok: false, detail: error.message });
    process.stdout.write(`    ✗ ${error.message}\n`);
    if (!keep) fs.rmSync(root, { recursive: true, force: true });
    else process.stdout.write(`    （保留临时目录：${root}）\n`);
  }
}

/* ------------------------------------------------- 额外：真实项目行为验证 */

async function extraTests() {
  const root = tmpDir('behaviour');
  try {
    begin('行为：索引摘要机制真的省 token');
    await run(['init', root, '--pack', 'software-app-medium']);
    await prun(root, ['index']);
    const before = JSON.parse((await prun(root, ['task', '模块 边界 README modules 项目结构', '--budget', '100000', '--json'])).stdout);
    const readSourceBefore = before.readList.filter((s) => s.decision === 'read-source').length;
    // 只给项目自己的源码写摘要：`.ai/` 快照与框架副本不参与摘要生成（见 indexer 的 aiContextPriority）
    const index = loadIndex(root);
    const projectFiles = index.files.filter((f) => f.kind === 'text'
      && !f.path.startsWith('.ai/')
      && /^(src|Source|Assets|scenes|scripts|tests)\//.test(f.path)).slice(0, 8);
    assert(projectFiles.length > 0, '测试前置：项目里应有被测源码文件');
    const digests = projectFiles.map((f) => ({
      path: f.path, reviewedHash: f.hash, purpose: '自测摘要', exports: [], invariants: [], risk: 'low', tags: [],
    }));
    const file = path.join(root, '.ai', 'cache', 'd.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(digests), 'utf8');
    await prun(root, ['index', '--apply', file]);
    const after = JSON.parse((await prun(root, ['task', '模块 边界 README modules 项目结构', '--budget', '100000', '--json'])).stdout);
    const readSourceAfter = after.readList.filter((s) => s.decision === 'read-source').length;
    const digestDecisions = after.readList.filter((s) => s.decision === 'read-digest').map((s) => s.path);
    assert(digestDecisions.length > 0,
      `写入摘要后仍未出现 read-digest（已写摘要：${projectFiles.map((f) => f.path).join(', ')}；清单：${after.readList.map((s) => `${s.path}:${s.decision}`).join(', ')}）`);
    assert(readSourceAfter <= readSourceBefore, '写入摘要后需要读源码的文件数未下降');
    assert(after.estimate.total <= before.estimate.total, '写入摘要后任务包估算反而升高');
    pass();

    begin('行为：内容变化使摘要标记 stale 并被 review 检出');
    const idxBefore = loadIndex(root);
    const targetEntry = idxBefore.files.find((f) => f.kind === 'text'
      && !f.path.startsWith('.ai/')
      && /^(src|Source|Assets|scenes|scripts|tests)\//.test(f.path));
    assert(targetEntry, '测试前置：项目里应有被测源码文件');
    const target = path.join(root, targetEntry.path);
    assert(isFile(target), `测试前置文件不存在：${targetEntry.path}`);
    fs.appendFileSync(target, '\n// 自测：新增一行内容\n', 'utf8');
    await prun(root, ['index']);
    const idx = loadIndex(root);
    const entry = idx.files.find((f) => f.path === targetEntry.path);
    assert(entry?.digest?.stale === true, '内容变化后摘要未标记 stale');
    const drift = JSON.parse((await prun(root, ['review', '--drift', '--json'], { expectCode: null })).stdout);
    assert(drift.findings.some((f) => f.code === 'digest-stale' && f.target === targetEntry.path), 'review 未检出摘要过期');
    pass();

    begin('行为：--strict 在有漂移时返回非 0');
    const strict = await prun(root, ['review', '--drift', '--strict'], { expectCode: null });
    assert(strict.code === 1, `--strict 应返回 1，实际 ${strict.code}`);
    pass();

    begin('行为：.gitignore 的目录规则被正确解析（防止生成物污染索引）');
    // 回归测试：真实事故——UE 项目 .gitignore 写 `Binaries/*`、`Intermediate/*`，
    // 旧解析器把它当成普通 glob，导致 Plugins/*/Intermediate 下 UHT 生成的 .gen.cpp 被索引。
    const gi = tmpDir('gitignore');
    fs.writeFileSync(path.join(gi, '.gitignore'), [
      '# 依赖',
      'node_modules/',
      'Binaries/*',
      'Plugins/*/Binaries/*',
      'Intermediate/*',
      'Plugins/*/Intermediate/*',
      'DerivedDataCache/*',
      '*.log',
      '!keep.log',
      '',
    ].join('\n'), 'utf8');
    const dirsToMake = ['Source/AGLS/Private', 'Plugins/Foo/Intermediate/Build/UHT', 'Plugins/Foo/Binaries/Win64', 'Intermediate/Build', 'DerivedDataCache', 'Content', 'node_modules/pkg'];
    for (const d of dirsToMake) fs.mkdirSync(path.join(gi, d), { recursive: true });
    const write = (rel, text) => fs.writeFileSync(path.join(gi, rel), text, 'utf8');
    write('Source/AGLS/Private/Real.cpp', 'int main(){return 0;}\n');
    write('Plugins/Foo/Intermediate/Build/UHT/Gen.gen.cpp', '// 生成物\n');
    write('Plugins/Foo/Binaries/Win64/Foo.modules', 'artifact\n');
    write('Intermediate/Build/Thing.obj', 'x\n');
    write('DerivedDataCache/cache.bin', 'x\n');
    write('Content/keep.uasset', 'not-really-binary-for-this-test\n');
    write('debug.log', 'log\n');
    write('node_modules/pkg/index.js', 'x\n');
    await run(['init', gi, '--pack', 'software-app-medium']);
    await prun(gi, ['index']);
    const giIdx = loadIndex(gi);
    const paths = giIdx.files.map((f) => f.path);
    assert(paths.includes('Source/AGLS/Private/Real.cpp'), '真实源码未被索引');
    for (const bad of [
      'Plugins/Foo/Intermediate/Build/UHT/Gen.gen.cpp',
      'Plugins/Foo/Binaries/Win64/Foo.modules',
      'Intermediate/Build/Thing.obj',
      'DerivedDataCache/cache.bin',
      'debug.log',
      'node_modules/pkg/index.js',
    ]) {
      assert(!paths.includes(bad), `.gitignore 中的目录规则未生效，生成物被索引：${bad}`);
    }
    fs.rmSync(gi, { recursive: true, force: true });
    pass();

    begin('行为：接入既有项目时，框架绝不覆盖项目原有文件');
    // 回归测试：真实事故——某 UE 项目接入后，upgrade 把项目自己的 .gitignore 覆盖成模板版。
    // 根因：upgrade 把"未登记在 managed 里的现存文件"误判为"框架新增文件"从而写入。
    const legacy = tmpDir('legacy');
    const ownGitignore = '# 项目原有的忽略规则（框架不得触碰）\nBinaries/*\nIntermediate/*\nDerivedDataCache/*\n';
    const ownAgents = '# 项目原有的 AGENTS.md（框架不得触碰）\n\n## 硬约束（不可协商）\n\n- 保留这一行\n\n## 工作路由表（先查表，再动手）\n\n| 任务 | 做法 |\n|---|---|\n| x | y |\n\n## 提交前必须做\n\n- 保留\n';
    fs.writeFileSync(path.join(legacy, '.gitignore'), ownGitignore, 'utf8');
    fs.writeFileSync(path.join(legacy, 'AGENTS.md'), ownAgents, 'utf8');
    await run(['init', legacy, '--pack', 'software-app-medium']);

    // init 之后：两个文件必须原样
    assert(fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8') === ownGitignore, 'init 覆盖了项目原有的 .gitignore');
    assert(fs.readFileSync(path.join(legacy, 'AGENTS.md'), 'utf8') === ownAgents, 'init 覆盖了项目原有的 AGENTS.md');
    // 且它们不得被登记为框架托管
    const legacyMeta = readJsonSafe(path.join(legacy, '.ai', 'framework.json'), null);
    assert(!Object.keys(legacyMeta?.managed ?? {}).includes('.gitignore'),
      '.gitignore 被错误登记为框架托管文件（upgrade 会据此覆盖它）');

    // upgrade（含 --apply 与 --force）都不得触碰项目原有文件
    await prun(legacy, ['upgrade', '--apply']);
    assert(fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8') === ownGitignore, 'upgrade 覆盖了项目原有的 .gitignore');
    assert(fs.readFileSync(path.join(legacy, 'AGENTS.md'), 'utf8') === ownAgents, 'upgrade 覆盖了项目原有的 AGENTS.md');
    const forced = JSON.parse((await prun(legacy, ['upgrade', '--apply', '--force', '--json'])).stdout);
    assert(fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8') === ownGitignore, 'upgrade --force 覆盖了项目原有的 .gitignore（--force 只能用于框架托管文件）');
    assert(fs.readFileSync(path.join(legacy, 'AGENTS.md'), 'utf8') === ownAgents, 'upgrade --force 覆盖了项目原有的 AGENTS.md');
    assert(Array.isArray(forced.notManaged) && forced.notManaged.includes('.gitignore'),
      `upgrade 未把项目原有文件报告为 notManaged（实际：${JSON.stringify(forced.notManaged ?? [])}）`);
    fs.rmSync(legacy, { recursive: true, force: true });
    pass();

    begin('行为：未初始化目录给出可行动报错');
    const empty = tmpDir('empty');
    const res = await run(['index', empty], { expectCode: null, quiet: true });
    fs.rmSync(empty, { recursive: true, force: true });
    assert(res.code === 1, `在未初始化目录执行 index 应返回 1，实际 ${res.code}`);
    assert(res.stderr.includes('不是由本框架初始化的项目'), '报错未说明"这不是框架初始化的项目"');
    pass();

    begin('行为：未知模板包与未知变量被拒绝');
    const bad = await run(['init', tmpDir('bad'), '--pack', 'nope'], { expectCode: null });
    assert(bad.code === 1, '未知模板包应返回 1');
    assert(bad.stderr.includes('未知模板包'), '未知模板包未给出提示');
    const badVar = await run(['init', tmpDir('bad2'), '--pack', 'software-cli-small', '--packageManager', 'cargo'], { expectCode: null });
    assert(badVar.code === 1, '变量取值非法应返回 1');
    assert(badVar.stderr.includes('不在允许范围'), '变量校验未生效');
    pass();
  } catch (error) {
    results.push({ test: currentTest, ok: false, detail: error.message });
    process.stdout.write(`    ✗ ${error.message}\n`);
  } finally {
    if (!keep) fs.rmSync(root, { recursive: true, force: true });
    else process.stdout.write(`    （保留临时目录：${root}）\n`);
  }
}

await extraTests();

/* ------------------------------------------------------------------ 汇总 */

const failed = results.filter((r) => !r.ok);
process.stdout.write('\n' + '─'.repeat(78) + '\n');
process.stdout.write(`自测结果：${results.length - failed.length}/${results.length} 通过\n`);
if (failed.length > 0) {
  process.stdout.write('\n失败项：\n');
  for (const f of failed) process.stdout.write(`  ✗ ${f.test}\n      ${f.detail}\n`);
  process.stdout.write('─'.repeat(78) + '\n');
  process.exit(1);
}
process.stdout.write('✓ 全部通过\n');
process.stdout.write('─'.repeat(78) + '\n');
process.exit(0);
