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
const { sha256, isFile, isDir, readJsonSafe, walk, normalizeRel, matchesAny } = await import(pathToFileURL(path.join(cliLib, 'fsx.mjs')).href);
const { loadIndex } = await import(pathToFileURL(path.join(cliLib, 'indexer.mjs')).href);
const { PACK_LIMITS } = await import(pathToFileURL(path.join(cliLib, 'limits.mjs')).href);

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
    assert(agentsLines <= PACK_LIMITS['AGENTS.md'],
      `AGENTS.md 有 ${agentsLines} 行，超过 ${PACK_LIMITS['AGENTS.md']} 行上限`);
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
    // 未匹配到任何文件时也必须返回完整形状（早期会在读 impact.tests 时抛 TypeError）
    const noHit = JSON.parse((await prun(root, ['review', '--impact', 'does/not/exist.ts', '--json'])).stdout);
    assert(Array.isArray(noHit.tests) && noHit.changed.length === 0, 'review --impact 命中不到文件时返回形状不完整');
    // 影响矩阵按判据分类：命中 / 未声明判据 / 不适用。不再把整张表打印出来让人自己挑。
    assert(impact.impact && Array.isArray(impact.impact.applicable), 'review --impact 未返回分类后的影响矩阵');
    assert(impact.impact.summary.total >= 6, '影响矩阵规则少于 6 条');
    assert(impact.impact.summary.unknown === 0, `种子矩阵不应有"未声明判据"的规则（${impact.impact.summary.unknown} 条）`);
    assert(impact.impact.applicable.length + impact.impact.skipped.length === impact.impact.summary.total,
      '分类结果与规则总数不一致（有规则被漏掉）');
    assert(impact.impact.applicable.every((r) => r.evidence.length > 0), '命中的规则必须给出判据');
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
    begin('行为：glob 语义（规则 scope / 影响判据 / .gitignore 共用同一套匹配）');
    // 这条用例来自一个真实缺陷：`**/dir/**` 形式的模式曾经永远匹配不上。
    // 它的后果是**静默失效**——规则 scope 写 `**/ui/**` 时该规则不会出现在任何检查里，
    // 影响矩阵的 paths 判据、.gitignore 的 `**/Intermediate/**` 同样形同不存在。
    assert(matchesAny('src/models/user.ts', ['**/models/**']), '`**/dir/**` 未匹配子路径');
    assert(matchesAny('models/user.ts', ['**/models/**']), '`**/dir/**` 未匹配根下的同名目录');
    assert(matchesAny('a/b/models/user.ts', ['**/models/**']), '`**/dir/**` 未匹配深层同名目录');
    assert(!matchesAny('src/models2/user.ts', ['**/models/**']), '`**/dir/**` 误匹配了同前缀的兄弟目录');
    assert(matchesAny('Binaries/x.pdb', ['Binaries/**']), '`dir/**` 未匹配目录内容');
    assert(matchesAny('src/ui/button.tsx', ['src/ui/**']), '`dir/**` 未匹配（锚定路径）');
    assert(matchesAny('src/a.ts', ['**/*.ts', '!src/b.ts']) || matchesAny('src/a.ts', ['**/*.ts']), '扩展名 glob 失效');
    assert(!matchesAny('src/a.ts', ['**/*.tsx']), '扩展名 glob 误匹配');
    pass();

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
    const dirsToMake = ['Source/MyGame/Private', 'Plugins/Foo/Intermediate/Build/UHT', 'Plugins/Foo/Binaries/Win64', 'Intermediate/Build', 'DerivedDataCache', 'Content', 'node_modules/pkg'];
    for (const d of dirsToMake) fs.mkdirSync(path.join(gi, d), { recursive: true });
    const write = (rel, text) => fs.writeFileSync(path.join(gi, rel), text, 'utf8');
    write('Source/MyGame/Private/Real.cpp', 'int main(){return 0;}\n');
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
    assert(paths.includes('Source/MyGame/Private/Real.cpp'), '真实源码未被索引');
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

    // init --force 同样不得触碰项目原有文件（真实事故：--force 两次覆盖了项目的 .gitignore）
    const forcedInit = JSON.parse((await run(['init', legacy, '--pack', 'software-app-medium', '--force', '--json'])).stdout);
    assert(fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8') === ownGitignore,
      'init --force 覆盖了项目原有的 .gitignore');
    assert(fs.readFileSync(path.join(legacy, 'AGENTS.md'), 'utf8') === ownAgents,
      'init --force 覆盖了项目原有的 AGENTS.md');
    assert(Array.isArray(forcedInit.refused) && forcedInit.refused.includes('.gitignore'),
      `init --force 未把项目原有文件报告为 refused（实际：${JSON.stringify(forcedInit.refused ?? [])}）`);
    assert(Array.isArray(forcedInit.refused) && forcedInit.refused.includes('AGENTS.md'),
      'init --force 未把项目原有的 AGENTS.md 报告为 refused');
    const metaAfterForce = readJsonSafe(path.join(legacy, '.ai', 'framework.json'), null);
    assert(!Object.keys(metaAfterForce?.managed ?? {}).includes('.gitignore'),
      'init --force 之后 .gitignore 又被登记为框架托管（会导致 upgrade 再次覆盖它）');

    // 反向校验：收紧不能收过头 —— 框架自己的文件仍必须能被 --force 重置
    const frameworkFile = path.join(legacy, '.ai', 'constitution.md');
    const originalFrameworkText = fs.readFileSync(frameworkFile, 'utf8');
    fs.writeFileSync(frameworkFile, originalFrameworkText + '\n<!-- 本地乱改 -->\n', 'utf8');
    const reset = JSON.parse((await run(['init', legacy, '--pack', 'software-app-medium', '--force', '--json'])).stdout);
    assert(fs.readFileSync(frameworkFile, 'utf8') === originalFrameworkText,
      'init --force 未能重置框架自己的文件（收得过头，用户将无法恢复被改坏的框架文件）');
    assert(reset.written.includes('.ai/constitution.md'), 'init --force 未报告重置了框架文件');

    // 反向校验 2：历史记录（无 origin 字段）的框架文件必须仍能被 upgrade 更新。
    // 真实故障：origin 机制上线后，老项目里所有 managed 记录都被迁移成 legacy-adopted，
    // 于是 upgrade 认为"这些都不是框架文件"，框架自己创建的文件再也升不了级。
    const legacyMetaFile = path.join(legacy, '.ai', 'framework.json');
    const legacyMetaData = readJsonSafe(legacyMetaFile, {});
    // 模拟老格式：把记录降级为纯字符串 + 把一个框架文件改成旧内容
    const downgraded = {};
    for (const [k, v] of Object.entries(legacyMetaData.managed ?? {})) {
      downgraded[k] = typeof v === 'string' ? v : v.hash;
    }
    legacyMetaData.managed = downgraded;
    fs.writeFileSync(legacyMetaFile, JSON.stringify(legacyMetaData, null, 2), 'utf8');
    const staleFile = path.join(legacy, '.ai', 'registry.json');
    const staleContent = `${fs.readFileSync(staleFile, 'utf8')}\n<!-- 旧版本内容 -->\n`;
    fs.writeFileSync(staleFile, staleContent, 'utf8');
    legacyMetaData.managed['.ai/registry.json'] = sha256(staleContent);
    fs.writeFileSync(legacyMetaFile, JSON.stringify(legacyMetaData, null, 2), 'utf8');
    const upgradedLegacy = JSON.parse((await run(['upgrade', legacy, '--apply', '--json'])).stdout);
    assert(upgradedLegacy.updated.includes('.ai/registry.json'),
      `upgrade 未能更新老格式记录下的框架文件（updated=${JSON.stringify(upgradedLegacy.updated.slice(0, 5))}）`);
    assert(!fs.readFileSync(staleFile, 'utf8').includes('旧版本内容'), '老格式记录下的框架文件未被真正更新');
    assert(fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8') === ownGitignore,
      'upgrade 在处理老格式记录时误伤了项目原有文件');

    fs.rmSync(legacy, { recursive: true, force: true });
    pass();

    begin('行为：init 的命令选项不会被当成 pack 变量丢弃');
    // 回归测试：真实事故——COMMAND_FLAGS 漏了 `name`，导致 `--name <项目名>` 被静默忽略，
    // 项目名退化成目录名派生的带空格名字，还生成了同名的幽灵目录（真实事故）。
    const named = tmpDir('MyGameV1.5.0');
    const namedOut = JSON.parse((await run([
      'init', named, '--pack', 'game-unreal', '--name', 'MyGame', '--ueVersion', '5.7', '--dry-run', '--json',
    ])).stdout);
    assert(namedOut.variables.projectName === 'MyGame',
      `--name 未生效：projectName=${namedOut.variables.projectName}（期望 MyGame）`);
    assert(namedOut.variables.projectTitle === 'MyGame',
      `--name 派生的 projectTitle 异常：${namedOut.variables.projectTitle}`);
    assert(namedOut.variables.ueVersion === '5.7', `--ueVersion 未生效：${namedOut.variables.ueVersion}`);
    assert(!namedOut.written.some((w) => /\s/.test(w)),
      `生成路径含空格（幽灵目录）：${namedOut.written.filter((w) => /\s/.test(w)).slice(0, 3).join(', ')}`);
    assert(namedOut.written.includes('Source/MyGame/README.md'),
      `项目名未落到源码目录：${namedOut.written.filter((w) => w.startsWith('Source/')).join(', ')}`);
    fs.rmSync(named, { recursive: true, force: true });
    pass();

    begin('行为：quickstart 生成可粘贴的接入提示词');    const qsRoot = tmpDir('qs');
    fs.writeFileSync(path.join(qsRoot, 'project.godot'), '[application]\n', 'utf8');
    fs.mkdirSync(path.join(qsRoot, 'scenes'), { recursive: true });
    fs.writeFileSync(path.join(qsRoot, 'scenes', 'main.tscn'), '[gd_scene]\n', 'utf8');
    const qs = await run(['quickstart', '--root', qsRoot]);
    assert(qs.stdout.includes('install'), '提示词里没有安装命令');
    assert(qs.stdout.includes('ai-arch.mjs install --root .'), '提示词里的安装命令不是可直接执行的形式');
    assert(qs.stdout.includes('game-godot'), '提示词未包含识别出的项目类型');
    assert(qs.stdout.includes('验收标准'), '提示词没有验收标准');
    assert(qs.stdout.includes('不要覆盖项目原有文件'), '提示词没有强调"不覆盖项目原有文件"这条硬约束');
    assert(qs.stdout.includes('.ai/'), '提示词没有说明核心放在 .ai/');
    const qsJson = JSON.parse((await run(['quickstart', '--root', qsRoot, '--json'])).stdout);
    assert(typeof qsJson.prompt === 'string' && qsJson.prompt.length > 500, 'quickstart --json 输出异常');
    fs.rmSync(qsRoot, { recursive: true, force: true });
    pass();

    begin('行为：install 一条命令接入（自动识别 + agent 指针 + 索引）');
    const instRoot = tmpDir('install');
    fs.writeFileSync(path.join(instRoot, 'Demo.uproject'), JSON.stringify({ FileVersion: 3, EngineAssociation: '5.7' }), 'utf8');
    fs.mkdirSync(path.join(instRoot, 'Content', 'Maps'), { recursive: true });
    fs.mkdirSync(path.join(instRoot, 'Source', 'Demo'), { recursive: true });
    fs.writeFileSync(path.join(instRoot, 'Source', 'Demo', 'Demo.Build.cs'), '// build\n', 'utf8');
    // 项目原有的文件：必须原样保留
    const ownIgnore = '# 项目原有\nBinaries/*\n';
    const ownClaude = '# 项目自己的 CLAUDE.md\n\n不要覆盖我\n';
    fs.writeFileSync(path.join(instRoot, '.gitignore'), ownIgnore, 'utf8');
    fs.mkdirSync(path.join(instRoot, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(instRoot, '.claude', 'CLAUDE.md'), ownClaude, 'utf8');

    const inst = JSON.parse((await run(['install', instRoot, '--json'])).stdout);
    assert(inst.detection.packId === 'game-unreal', `类型识别错误：${inst.detection.packId}`);
    assert(inst.detection.confidence === 'high', `置信度异常：${inst.detection.confidence}`);
    assert(inst.variables.name === 'Demo', `项目名未从 .uproject 推断：${inst.variables.name}`);
    assert(inst.variables.ueVersion === '5.7', `引擎版本未从 .uproject 推断：${inst.variables.ueVersion}`);
    assert(inst.written.includes('AGENTS.md') && inst.written.includes('.ai/constitution.md'), 'install 未生成核心文件');
    assert(inst.index && inst.index.fileCount > 0, 'install 未建立基线索引');
    assertFile(instRoot, '.ai/index/files.json');
    // 项目原有文件必须完好
    assert(fs.readFileSync(path.join(instRoot, '.gitignore'), 'utf8') === ownIgnore, 'install 覆盖了项目原有的 .gitignore');
    assert(fs.readFileSync(path.join(instRoot, '.claude', 'CLAUDE.md'), 'utf8') === ownClaude, 'install 覆盖了项目原有的 .claude/CLAUDE.md');
    assert(inst.refused.includes('.gitignore'), 'install 未把项目原有的 .gitignore 报告为 refused');
    assert(inst.agentAdapters.refused.includes('.claude/CLAUDE.md'), '未把项目原有的 CLAUDE.md 报告为 refused');
    // 索引不应包含被忽略的生成物
    assert(!inst.written.some((w) => w.startsWith('Binaries/')), 'install 生成了被忽略目录下的文件');
    fs.rmSync(instRoot, { recursive: true, force: true });
    pass();

    begin('行为：install 把技能装进各 agent 的技能根目录');
    // 真实缺口：技能只放 .ai/skills/ 时，Claude Code 与 DSH 都不会去那里找，等于没装。
    // 依据：Claude 扫描项目/插件 skills/；DSH dsh-skill-filesystem 扫描 .dsh/skills/（不支持嵌套）。
    const skillRoot = tmpDir('skills-deploy');
    fs.mkdirSync(path.join(skillRoot, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(skillRoot, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'main.mjs'), 'export const x = 1;\n', 'utf8');
    const skillInstall = JSON.parse((await run(['install', skillRoot, '--pack', 'software-cli-small', '--json'])).stdout);
    assert(Array.isArray(skillInstall.agentAdapters.detected) && skillInstall.agentAdapters.detected.includes('claude'),
      '未探测到 .claude 目录');
    assert(skillInstall.agentAdapters.detected.includes('dsh'), '未探测到 .dsh 目录');
    const deployed = skillInstall.agentAdapters.skills ?? [];
    assert(deployed.length > 0, '未部署任何技能');
    for (const agentDir of ['.claude/skills', '.dsh/skills']) {
      const dir = path.join(skillRoot, ...agentDir.split('/'));
      assert(isDir(dir), `未创建技能根目录：${agentDir}`);
      const ids = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      assert(ids.length >= 7, `${agentDir} 下技能数不足：${ids.length}`);
      for (const id of ids) {
        assertFile(skillRoot, `${agentDir}/${id}/SKILL.md`, { minBytes: 100 });
      }
    }
    // 技能必须是**平铺的技能目录**（DSH 不支持嵌套 SKILL.md）
    const nestedSkill = [];
    const scanNested = (d, depth) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const p = path.join(d, e.name);
        if (depth > 0 && isFile(path.join(p, 'SKILL.md'))) nestedSkill.push(path.relative(skillRoot, p));
        scanNested(p, depth + 1);
      }
    };
    scanNested(path.join(skillRoot, '.dsh', 'skills'), 0);
    assert(nestedSkill.length === 0, `技能目录出现嵌套 SKILL.md（DSH 不会发现）：${nestedSkill.join(', ')}`);
    // frontmatter 必须是标准键
    const sample = fs.readFileSync(path.join(skillRoot, '.dsh', 'skills', deployed[0].split('/')[2], 'SKILL.md'), 'utf8');
    const fmSample = sample.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert(fmSample && /^whenToUse:/m.test(fmSample[1]),
      '部署的技能缺 whenToUse（DSH 与 Claude 均不识别自定义键）');
    fs.rmSync(skillRoot, { recursive: true, force: true });
    pass();

    begin('行为：install 覆盖多 agent（技能根、路径级规则、扩展清单）');
    // 逐家核实过的落点：
    //  Claude .claude/skills；DSH .dsh/skills；Cursor .cursor/skills **与** .agents/skills（两个都认）；
    //  Copilot 路径级指令 .github/instructions/*.instructions.md（applyTo）；Gemini 扩展清单。
    const multi = tmpDir('multi-agent');
    for (const d of ['.claude', '.dsh', '.cursor', '.github', '.gemini', '.codex']) {
      fs.mkdirSync(path.join(multi, d), { recursive: true });
    }
    fs.writeFileSync(path.join(multi, 'main.mjs'), 'export const x = 1;\n', 'utf8');
    const multiRes = JSON.parse((await run(['install', multi, '--pack', 'software-cli-small', '--json'])).stdout);
    const detected = multiRes.agentAdapters.detected;
    for (const id of ['claude', 'dsh', 'cursor', 'copilot', 'gemini', 'codex']) {
      assert(detected.includes(id), `未探测到 agent：${id}`);
    }
    // 技能根：四个（含 Cursor 的跨工具目录 .agents/skills）
    for (const root of ['.claude/skills', '.dsh/skills', '.cursor/skills', '.agents/skills']) {
      const n = fs.readdirSync(path.join(multi, ...root.split('/')), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length;
      assert(n >= 7, `${root} 技能数不足：${n}`);
    }
    // 路径级规则：Cursor 用 .mdc（含 globs），Copilot 用 .instructions.md（含 applyTo）
    const mdc = fs.readdirSync(path.join(multi, '.cursor', 'rules')).filter((f) => f.endsWith('.mdc'));
    assert(mdc.length >= 2, `Cursor 路径级规则未生成：${mdc.length} 条`);
    const mdcScoped = mdc.filter((f) => f !== 'ai-arch.mdc');
    assert(mdcScoped.length >= 3, `Cursor 路径级规则过少：${mdcScoped.length} 条`);
    for (const f of mdcScoped) {
      const text = fs.readFileSync(path.join(multi, '.cursor', 'rules', f), 'utf8');
      assert(/^globs:/m.test(text) && /^alwaysApply:\s*false/m.test(text),
        `Cursor 路径级规则 ${f} 缺 globs 或 alwaysApply:false`);
    }
    const instr = fs.readdirSync(path.join(multi, '.github', 'instructions')).filter((f) => f.endsWith('.instructions.md'));
    assert(instr.length >= 3, `Copilot 路径级指令过少：${instr.length} 个`);
    for (const f of instr) {
      const text = fs.readFileSync(path.join(multi, '.github', 'instructions', f), 'utf8');
      assert(/^applyTo:/m.test(text), `Copilot 指令 ${f} 缺 applyTo`);
    }
    // Gemini 扩展：name 必须等于扩展目录名
    const extDir = path.join(multi, '.gemini', 'extensions', 'ai-engineering-arch');
    assert(isDir(extDir), 'Gemini 扩展目录未创建');
    const extManifest = readJsonSafe(path.join(extDir, 'gemini-extension.json'), null);
    assert(extManifest?.name === 'ai-engineering-arch', 'Gemini 扩展 name 与目录名不一致（官方要求）');
    assert(extManifest?.contextFileName === 'GEMINI.md', 'Gemini 扩展未声明 contextFileName');
    assert(isFile(path.join(extDir, 'GEMINI.md')), 'Gemini 扩展的 contextFileName 指向的文件不存在');
    // 指针都要指向仓库根 AGENTS.md 与 .ai/
    for (const rel of ['.claude/CLAUDE.md', '.dsh/AGENTS.md', '.cursor/rules/ai-arch.mdc', '.github/copilot-instructions.md', '.gemini/GEMINI.md']) {
      const text = fs.readFileSync(path.join(multi, rel), 'utf8');
      assert(/AGENTS\.md/.test(text) && /\.ai\//.test(text), `指针 ${rel} 未同时指向 AGENTS.md 与 .ai/`);
    }
    fs.rmSync(multi, { recursive: true, force: true });
    pass();

    begin('行为：registry——契约漂移必须被机械检出');
    // 这一层补的是"验证"维度的缺口：索引只能答"文件变没变"，
    // 注册表记录"改它时必须保持什么"，两者用 hash 对账才能发现"契约被改但注册表未同步"。
    const regRoot = tmpDir('registry');
    fs.mkdirSync(path.join(regRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(regRoot, 'main.mjs'), 'export const x = 1;\n', 'utf8');
    await run(['install', regRoot, '--pack', 'software-cli-small']);
    const contractPath = path.join(regRoot, 'src', 'session.mjs');
    const contractV1 = 'export function createSession(userId) { return { userId, expiresAt: 0 }; }\n';
    fs.writeFileSync(contractPath, contractV1, 'utf8');
    fs.mkdirSync(path.join(regRoot, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(regRoot, 'tests', 'session.spec.mjs'),
      '// 断言 createSession 的不变量：expiresAt 为 UTC 毫秒时间戳\n', 'utf8');
    await prun(regRoot, ['index']);

    const idxReg = loadIndex(regRoot);
    const cEntry = idxReg.files.find((f) => f.path === 'src/session.mjs');
    assert(cEntry, '前置：契约文件已进索引');
    const regFile = path.join(regRoot, '.ai', 'registry.json');
    const regData = readJsonSafe(regFile, null);
    assert(regData, '前置：registry.json 存在');
    regData.entities = [{
      kind: 'api',
      name: 'createSession',
      file: 'src/session.mjs',
      signature: 'createSession(userId): Session',
      invariants: ['expiresAt 必须是 UTC 毫秒时间戳', 'userId 不得为空'],
      tests: ['tests/session.spec.mjs'],
      owner: '@team-auth',
      hash: cEntry.hash.slice(0, 10),
    }];
    fs.writeFileSync(regFile, JSON.stringify(regData, null, 2), 'utf8');

    // A) 未改契约 → 不应误报
    let regDrift = JSON.parse((await prun(regRoot, ['review', '--drift', '--json'])).stdout);
    assert(regDrift.findings.filter((f) => f.code === 'entity-hash-stale').length === 0,
      '未改契约时误报了 entity-hash-stale');
    assert(regDrift.registry && regDrift.registry.checked === 1, 'review 未带上注册表对账汇总');

    // B) 改了契约但没更新注册表 → 必须报出
    fs.writeFileSync(contractPath, 'export function createSession(userId, ttlMs) { return { userId, expiresAt: Date.now() + ttlMs }; }\n', 'utf8');
    await prun(regRoot, ['index']);
    regDrift = JSON.parse((await prun(regRoot, ['review', '--drift', '--json'])).stdout);
    const staleHits = regDrift.findings.filter((f) => f.code === 'entity-hash-stale');
    assert(staleHits.length === 1, `改契约后未检出漂移（实际 ${staleHits.length} 条）`);
    assert(staleHits[0].message.includes('注册表未同步'), '漂移说明未点明原因');
    assert(/[0-9a-f]{10}/.test(staleHits[0].message), '漂移信息未给出新旧 hash');
    assert(staleHits[0].action.includes('tests/session.spec.mjs'), '漂移未指出该重跑哪些测试');

    // C) 契约文件被搬走 → 必须报文件缺失
    fs.renameSync(contractPath, path.join(regRoot, 'src', 'session2.mjs'));
    await prun(regRoot, ['index']);
    regDrift = JSON.parse((await prun(regRoot, ['review', '--drift', '--json'])).stdout);
    assert(regDrift.findings.filter((f) => f.code === 'entity-file-missing').length === 1,
      '契约文件被搬走后未报 entity-file-missing');

    // D) 结构校验：判定不了的条目等于没有条目（缺 invariants / 缺 tests / 缺 hash）
    regData.entities = [
      { kind: 'api', name: 'x', file: 'src/session2.mjs' },
      {
        kind: 'api', name: 'y', file: 'src/session2.mjs',
        invariants: ['过期时间必须为 UTC 毫秒时间戳'], tests: ['tests/nope.mjs'], hash: 'deadbeef00',
      },
      {
        kind: 'contract', name: 'z', file: 'src/session2.mjs',
        invariants: ['字段只增不删'], hash: 'deadbeef00',
      },
    ];
    fs.writeFileSync(regFile, JSON.stringify(regData, null, 2), 'utf8');
    const regAudit = JSON.parse((await prun(regRoot, ['registry', 'audit', '--json'])).stdout);
    const msgs = regAudit.audit.issues.map((i) => i.message).join(' ');
    assert(/invariants/.test(msgs), '未指出实体缺少 invariants');
    assert(/hash/.test(msgs), '未指出实体缺少 hash');
    assert(/没有任何测试引用/.test(msgs), '未指出"有不变量却没有测试"（不变量会退化成文档里的一句话）');
    assert(/tests 指向的文件不在索引中/.test(msgs), '未指出 tests 指向的测试文件不存在');
    assert(regAudit.audit.summary.withoutTests >= 1, 'withoutTests 汇总缺失');
    // E) suggest 在完全未登记时给出候选与模板
    const suggest = JSON.parse((await prun(regRoot, ['registry', 'suggest', '--json'])).stdout);
    assert(Array.isArray(suggest.candidates), 'registry suggest 未返回候选数组');
    fs.rmSync(regRoot, { recursive: true, force: true });
    pass();

    begin('行为：rules——新增约束必须入库、可判定、并自动传播');
    const rulesRoot = tmpDir('rules');
    fs.mkdirSync(path.join(rulesRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rulesRoot, 'main.mjs'), 'export const x = 1;\n', 'utf8');
    await run(['install', rulesRoot, '--pack', 'software-cli-small']);

    // 空规则集：应给出可复制的 add 命令
    const emptyList = await prun(rulesRoot, ['rules', 'list']);
    assert(emptyList.stdout.includes('rules add'), '空规则集时未给出新增命令示例');

    // 不可判定的规则必须被拒（"判定不了的规则等于没有规则"）
    const ruleBad = await prun(rulesRoot, ['rules', 'add', '代码要整洁优雅', '--check', '看感觉'], { expectCode: null });
    assert(ruleBad.code === 1, `不可判定的规则应被拒绝，实际退出码 ${ruleBad.code}`);
    assert(ruleBad.stderr.includes('不可判定'), '未说明拒绝原因（不可判定）');

    // 缺少 check 必须被拒
    const ruleNoCheck = await prun(rulesRoot, ['rules', 'add', 'if 嵌套深度不超过 3 层'], { expectCode: null });
    assert(ruleNoCheck.code === 1, `缺少 --check 应被拒绝，实际 ${ruleNoCheck.code}`);
    assert(ruleNoCheck.stderr.includes('check'), '未说明缺少 check');

    // 合规规则：入库 + 传播清单 + 自动写影响矩阵
    const ruleAdded = await prun(rulesRoot, [
      'rules', 'add', 'if 嵌套深度不超过 3 层',
      '--category', 'style', '--enforcement', 'review',
      '--check', '评审时数嵌套层数，超过则要求提前 return 或抽函数',
      '--rationale', '降低认知负担',
    ]);
    assert(ruleAdded.stdout.includes('R-001'), '未分配稳定规则 ID');
    assert(ruleAdded.stdout.includes('传播'), '未输出传播清单');
    assert(ruleAdded.stdout.includes('constitution.md'), '传播清单未包含宪法（规则必须在每会话必读处可见）');
    assert(ruleAdded.stdout.includes('code-review'), 'review 类规则未进入评审清单');
    const rulesJson = readJsonSafe(path.join(rulesRoot, '.ai', 'rules.json'), null);
    assert(rulesJson?.rules?.length === 1, '规则未写入 .ai/rules.json');
    const impactMap = readJsonSafe(path.join(rulesRoot, '.ai', 'index', 'impact-map.json'), null);
    assert(impactMap.rules.some((r) => r.trigger === 'r-001-rule-check'),
      '规则未自动写入影响矩阵（改动相关文件时不会被复查）');

    // rules audit 应通过
    const rulesAudit = JSON.parse((await prun(rulesRoot, ['rules', 'audit', '--json'])).stdout);
    assert(rulesAudit.summary.total === 1 && rulesAudit.issues.filter((i) => i.level === 'error').length === 0,
      `rules audit 异常：${JSON.stringify(rulesAudit.summary)}`);

    // 规则必须出现在任务包里（否则下次开工读不到）
    await prun(rulesRoot, ['index']);
    const rulesTask = JSON.parse((await prun(rulesRoot, ['task', '改 main 逻辑', '--json'])).stdout);
    assert(rulesTask.rules?.present === true, '任务包未带上规则集');
    assert(rulesTask.rules.count === 1, `任务包规则数异常：${rulesTask.rules.count}`);
    assert(Array.isArray(rulesTask.rules.rules) && rulesTask.rules.rules[0].id === 'R-001', '任务包未列出规则明细');
    const taskMd = fs.readFileSync(path.join(rulesRoot, '.ai', 'tasks', `${rulesTask.id}.md`), 'utf8');
    assert(taskMd.includes('## 1.5 项目规则'), '任务包正文未渲染规则小节');
    assert(taskMd.includes('R-001'), '任务包正文未逐条列出规则');
    assert(taskMd.includes('if 嵌套深度不超过 3 层'), '任务包正文未包含规则内容');

    // 传播验收：规则 ID 必须真的出现在"会被读到的地方"，而不只是被打印出来
    assert(rulesAudit.summary.notPropagated === 0, '自动传播后不应报"未传播"');
    const handEdited = readJsonSafe(path.join(rulesRoot, '.ai', 'rules.json'), null);
    handEdited.rules.push({
      id: 'R-002',
      statement: '日志必须带 requestId',
      category: 'style',
      enforcement: 'review',
      check: '评审时检查每条日志调用是否带 requestId',
      scope: '**',
      rationale: null,
      since: '2026-01-01',
      source: 'user-request',
      debt: [],
    });
    fs.writeFileSync(path.join(rulesRoot, '.ai', 'rules.json'), JSON.stringify(handEdited, null, 2), 'utf8');
    const audit2 = JSON.parse((await prun(rulesRoot, ['rules', 'audit', '--json'])).stdout);
    assert(audit2.summary.notPropagated === 1,
      `手工塞进 rules.json 的规则应被报"未传播"（实际 ${audit2.summary.notPropagated}）`);
    const notProp = audit2.issues.find((i) => i.code === 'rule-not-propagated');
    assert(notProp && notProp.action, '未传播问题缺少可行动提示');
    const docNotProp = (await prun(rulesRoot, ['rules', 'audit'])).stdout;
    assert(docNotProp.includes('rule-not-propagated'), '人读输出未给出问题代码');
    fs.rmSync(rulesRoot, { recursive: true, force: true });
    pass();

    begin('行为：索引必须覆盖上下文文件本身（否则 L1/L2 无法对账）');
    // 早期实现把整个 `.ai/` 排除在索引外，于是宪法/注册表/影响矩阵改了不会被任何机制发现，
    // 任务包也拿不到它们的 hash——"每会话必读的文件"反而成了唯一没有对账的文件。
    const scopeRoot = tmpDir('index-scope');
    await run(['install', scopeRoot, '--pack', 'software-cli-small']);
    await prun(scopeRoot, ['index']);
    const sIdx = loadIndex(scopeRoot);
    for (const rel of ['.ai/constitution.md', '.ai/registry.json', '.ai/index/impact-map.json', '.ai/index/README.md']) {
      assert(sIdx.files.some((f) => f.path === rel), `索引缺少上下文文件 ${rel}（它改了不会被任何机制发现）`);
    }
    assert(!sIdx.files.some((f) => /^\.ai\/(bin|lib|framework|tasks|cache|templates|decisions)\//.test(f.path)),
      '框架快照/任务包/技能副本/ADR 不应进索引（会污染任务读取清单与行数）');
    assert(sIdx.summary.contextLoc > 0 && sIdx.summary.totalLoc > 0,
      '上下文行数与源行数必须分开统计（否则规模评估会凭空升一级）');

    // 任务包必须记录宪法的 hash，否则收尾时无法对账
    const scopePack = JSON.parse((await prun(scopeRoot, ['task', '任意任务', '--json'])).stdout);
    const constItem = scopePack.always.find((a) => a.path === '.ai/constitution.md');
    assert(constItem && constItem.hash, '任务包未记录 .ai/constitution.md 的 hash（无法对账）');

    // 条件必读：第二次任务不该再为"只需读一次"的说明书付固定成本
    const secondPack = JSON.parse((await prun(scopeRoot, ['task', '第二个任务', '--json'])).stdout);
    assert(secondPack.alwaysSkipped.some((s) => s.path === '.ai/index/README.md'),
      '条件必读项在第二次任务仍被计入固定成本（框架一边说"只需读一次"，一边每次都收这份钱）');
    assert(secondPack.estimate.mandatory < scopePack.estimate.mandatory, '固定成本没有下降');
    assert(secondPack.id !== scopePack.id, '同一天的同名任务包互相覆盖（收尾对账的依据被写没了）');
    fs.rmSync(scopeRoot, { recursive: true, force: true });

    // 模板包声明的必读项也必须能对账：game-unreal 的 alwaysRead 指向 .ai/index/asset-index.md
    const scopeUe = tmpDir('index-scope-ue');
    await run(['init', scopeUe, '--pack', 'game-unreal', '--name', 'ue-scope']);
    await prun(scopeUe, ['index']);
    const ueIdx = loadIndex(scopeUe);
    assert(ueIdx.files.some((f) => f.path === '.ai/index/asset-index.md'),
      '模板包声明为必读的资产索引没进索引（任务包会给不出它的 hash，收尾无法对账）');
    const uePack = JSON.parse((await prun(scopeUe, ['task', '改存档', '--json'])).stdout);
    const assetItem = uePack.always.find((a) => a.path === '.ai/index/asset-index.md');
    assert(assetItem && assetItem.hash, '必读的资产索引在任务包里没有 hash');
    const ueClose = JSON.parse((await prun(scopeUe, ['review', '--task', '--json'])).stdout);
    assert(!ueClose.findings.some((f) => f.code === 'task-file-unhashed'),
      '刚 init 的项目不该出现"必读项没有 hash、无法对账"');
    fs.rmSync(scopeUe, { recursive: true, force: true });
    pass();

    begin('行为：review --task——任务闭环必须机械可对账');
    // 这一段验证的是"运行链路的最后一段"：任务包记录了"计划读什么"，
    // 收尾时必须能机械回答"实际改了什么、当时的前提还成立吗、该补的补了吗"。
    const closeRoot = tmpDir('taskclose');
    await run(['install', closeRoot, '--pack', 'software-cli-small']);
    const closeSrc = path.join(closeRoot, 'src', 'main.mjs');
    fs.writeFileSync(closeSrc, 'export function run() { return 1; }\n', 'utf8');
    await prun(closeRoot, ['index']);

    const cIdx = loadIndex(closeRoot);
    const sEntry = cIdx.files.find((f) => f.path === 'src/main.mjs');
    assert(sEntry, '前置：src/main.mjs 已进索引');
    const digestFile = path.join(closeRoot, 'digest.json');
    const writeDigest = (hash, purpose) => fs.writeFileSync(digestFile, JSON.stringify([{
      path: 'src/main.mjs',
      hash,
      purpose,
      exports: ['run'],
      invariants: ['未知命令必须返回退出码 2'],
      risk: 'medium',
      tags: ['entry'],
    }]), 'utf8');
    writeDigest(sEntry.hash, 'CLI 入口与子命令分发');
    await prun(closeRoot, ['index', '--apply', digestFile]);
    await prun(closeRoot, ['index']);

    const closePack = JSON.parse((await prun(closeRoot, ['task', '入口 分发', '--changed', 'src/main.mjs', '--json'])).stdout);
    const listed = closePack.readList.find((r) => r.path === 'src/main.mjs');
    assert(listed && listed.decision === 'read-digest', `前置：hash 未变时应判定为读摘要（实际 ${listed?.decision}）`);

    // 未开工前：证据一节必然还是占位符
    let close = JSON.parse((await prun(closeRoot, ['review', '--task', '--json'])).stdout);
    assert(close.findings.some((f) => f.code === 'task-evidence-missing'), '未指出证据一节仍是占位符');

    // 改了文件但没回写索引 → "当时只读摘要"的前提失效 + 索引过期，两者都必须报出
    fs.writeFileSync(closeSrc, 'export function run() { return 2; }\n', 'utf8');
    close = JSON.parse((await prun(closeRoot, ['review', '--task', '--json'])).stdout);
    assert(close.task.changedCount === 1, `未对账出"实际改了 1 个文件"（实际 ${close.task.changedCount}）`);
    assert(close.findings.some((f) => f.code === 'task-premise-stale'),
      '未检出"当时让我只读摘要、现在内容已变"——这是最危险的一类过期前提');
    assert(close.findings.some((f) => f.code === 'task-index-stale'), '未检出索引未回写');
    assert(close.checklist.find((c) => c.item.includes('索引摘要已同步'))?.verdict === 'fail', '验收项未判失败');
    assert(close.summary.ready === false, 'summary.ready 应为 false');

    // --strict 必须给非 0 退出码（可直接当提交门禁），且人读输出要带问题代码
    const strictRun = await prun(closeRoot, ['review', '--task', '--strict'], { expectCode: null });
    assert(strictRun.code === 1, `--strict 应返回 1，实际 ${strictRun.code}`);
    assert(strictRun.stdout.includes('task-premise-stale'), '人读输出未给出问题代码');

    // 回写索引 + 重写摘要 + 补齐任务包三节 → 应收尾就绪
    await prun(closeRoot, ['index']);
    const afterEntry = loadIndex(closeRoot).files.find((f) => f.path === 'src/main.mjs');
    writeDigest(afterEntry.hash, 'CLI 入口与子命令分发（run 的返回值已改）');
    await prun(closeRoot, ['index', '--apply', digestFile]);

    // 影响矩阵：src/main.mjs 命中 public-behavior-change（**/main.*），它要求同步 .ai/registry.json。
    // 先把这一步做了，收尾才有资格通过——这正是"改了 A 忘了 B"的机械检查。
    let closeMid = JSON.parse((await prun(closeRoot, ['review', '--task', '--json'])).stdout);
    assert(closeMid.impact.applicable.some((r) => r.trigger === 'public-behavior-change'),
      `未按判据命中 public-behavior-change：${JSON.stringify(closeMid.impact.applicable.map((r) => r.trigger))}`);
    assert(closeMid.findings.some((f) => f.code === 'task-impact-not-updated'),
      '未检出"影响矩阵要求的文件本次没有被改动"');
    const regFile2 = path.join(closeRoot, '.ai', 'registry.json');
    const regData2 = readJsonSafe(regFile2, null);
    regData2.entities = [{
      kind: 'api', name: 'cli-entry', file: 'src/main.mjs',
      invariants: ['未知命令必须返回退出码 2'], tests: [], hash: afterEntry.hash.slice(0, 10),
    }];
    fs.writeFileSync(regFile2, JSON.stringify(regData2, null, 2), 'utf8');

    const packFile = path.join(closeRoot, '.ai', 'tasks', `${closePack.id}.md`);
    let packMd = fs.readFileSync(packFile, 'utf8');
    packMd = packMd.replace(/（粘贴验证命令与输出摘要[^\n]*\n/, 'node --test tests/ → pass 12 / fail 0\n');
    packMd = packMd.replace(/（完成后填写[^\n]*\n/, '改 run 的返回值；原因是回归用例要求 2\n');
    packMd = packMd.replace(/（开工前填写[^\n]*\n/, '- 只改 src/main.mjs 的 run\n');
    packMd = packMd.replace(/（填写：本次不碰什么）\n/, '不动 CLI 参数解析\n');
    fs.writeFileSync(packFile, packMd, 'utf8');

    close = JSON.parse((await prun(closeRoot, ['review', '--task', '--json'])).stdout);
    assert(close.task.sections.evidenceFilled === true, '证据节判定未生效（占位符还在却被判为已填）');
    assert(close.summary.ready === true,
      `补齐后仍未就绪：${close.findings.map((f) => f.code).join(', ')}`);
    // 指定任务包 id 也要能选中（--task <id>）
    const byId = JSON.parse((await prun(closeRoot, ['review', '--task', closePack.id, '--json'])).stdout);
    assert(byId.task.id === closePack.id, '按 id 指定任务包失败');
    fs.rmSync(closeRoot, { recursive: true, force: true });
    pass();

    begin('行为：facts——能力判定随引擎版本变化，且明确边界');
    const factsRoot = tmpDir('facts');
    // UE 5.7：Unreal MCP 需要 5.8 → 应判定不可用
    fs.writeFileSync(path.join(factsRoot, 'Old.uproject'),
      JSON.stringify({ FileVersion: 3, EngineAssociation: '5.7', Modules: [{ Name: 'Old' }] }), 'utf8');
    fs.mkdirSync(path.join(factsRoot, 'Source', 'Old'), { recursive: true });
    fs.writeFileSync(path.join(factsRoot, 'Source', 'Old', 'Old.Build.cs'), '// b\n', 'utf8');
    await run(['install', factsRoot, '--pack', 'game-unreal', '--name', 'Old']);
    const facts57 = JSON.parse((await run(['facts', '--root', factsRoot, '--json'])).stdout);
    const mcp57 = facts57.capabilities.find((c) => c.id === 'unreal-mcp');
    assert(mcp57, '未探测到 unreal-mcp 能力条目');
    assert(mcp57.available === false, 'UE 5.7 不应判定 Unreal MCP 可用');
    assert(mcp57.reasons.join(' ').includes('5.8'), '未说明版本要求');
    assert(String(mcp57.whatItDoesNot).includes('不是'), '未声明该能力的边界（不能读 .uasset）');

    // 升级到 5.8 并启用插件 → 应变为可用
    fs.writeFileSync(path.join(factsRoot, 'Old.uproject'), JSON.stringify({
      FileVersion: 3,
      EngineAssociation: '5.8',
      Modules: [{ Name: 'Old' }],
      Plugins: [{ Name: 'ModelContextProtocol', Enabled: true }],
    }), 'utf8');
    await run(['facts', 'refresh', '--root', factsRoot]);
    const facts58 = JSON.parse((await run(['facts', '--root', factsRoot, '--json'])).stdout);
    const mcp58 = facts58.capabilities.find((c) => c.id === 'unreal-mcp');
    assert(mcp58.available === true, `UE 5.8 且启用插件后应判定可用，实际理由：${mcp58.reasons.join('；')}`);
    // 任务包必须带上能力结论
    await run(['index', '--root', factsRoot]);
    const factsTask = JSON.parse((await prun(factsRoot, ['task', '改移动逻辑', '--json'])).stdout);
    assert(factsTask.facts?.engine?.version === '5.8', '任务包未带上引擎版本');
    assert(factsTask.facts.capabilities.some((c) => c.id === 'unreal-mcp' && c.available),
      '任务包未带上能力可用性结论');
    fs.rmSync(factsRoot, { recursive: true, force: true });
    pass();

    begin('行为：类型识别——无标记时回落，有互斥证据时拒绝猜');
    // 情况 A：完全无标记（全新项目）→ 应回落到最小档，而不是失败
    const vague = tmpDir('vague');
    fs.writeFileSync(path.join(vague, 'notes.txt'), 'nothing recognizable\n', 'utf8');
    const fallbackRes = JSON.parse((await run(['install', vague, '--json'])).stdout);
    assert(fallbackRes.detection.confidence === 'fallback',
      `无标记项目应回落（confidence=fallback），实际 ${fallbackRes.detection.confidence}`);
    assert(fallbackRes.detection.packId === 'software-cli-small',
      `回落档应为最小档，实际 ${fallbackRes.detection.packId}`);
    assert(fallbackRes.detection.evidence.join(' ').includes('未发现任何项目类型标记'), '回落时未说明原因');
    fs.rmSync(vague, { recursive: true, force: true });

    // 情况 B：两个引擎标记并存（互斥证据）→ 必须拒绝猜并要求 --pack
    const conflict = tmpDir('conflict');
    fs.writeFileSync(path.join(conflict, 'Game.uproject'), '{"EngineAssociation":"5.8"}', 'utf8');
    fs.writeFileSync(path.join(conflict, 'project.godot'), '[application]\n', 'utf8');
    const conflictRes = await run(['install', conflict], { expectCode: null, quiet: true });
    assert(conflictRes.code === 1,
      `存在互斥证据时应返回 1（要求人确认），实际 ${conflictRes.code}`);
    assert(conflictRes.stderr.includes('无法确定项目类型'), '未给出"无法确定类型"的提示');
    assert(conflictRes.stderr.includes('--pack'), '未提示用 --pack 指定');
    assert(conflictRes.stderr.includes('冲突'), '未说明冲突的证据');
    fs.rmSync(conflict, { recursive: true, force: true });
    pass();
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
