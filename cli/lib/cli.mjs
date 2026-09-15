/**
 * CLI 命令实现与分发。契约见 docs/system/07-cli.md。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, flagString, flagBool, flagNumber, normalizeVarFlags } from './args.mjs';
import { table, estimateTokens } from './report.mjs';
import {
  exists, isFile, isDir, readJsonSafe, writeJson, normalizeRel, ensureDir, walk, matchesAny,
} from './fsx.mjs';
import {
  frameworkRoot, frameworkVersion, findProjectRoot, findFrameworkRepo, templatesDir, skillsDir,
} from './framework.mjs';
import { listPacks, loadPackById, skillExists, listAvailableSkills } from './pack.mjs';
import { initProject, upgradeProject, loadProjectMeta, SCALE_NAME } from './scaffold.mjs';
import {
  scanProject, saveIndex, loadIndex, assessScale, staleFiles, digestRequest, applyDigests,
} from './indexer.mjs';
import { buildTaskPack, writeTaskPack } from './taskpack.mjs';
import { reviewDrift, listDecisions } from './review.mjs';
import { doctor, renderDoctor } from './doctor.mjs';
import { impactOf } from './neighbors.mjs';
import { PATTERNS, MATRIX_RULES, antiPatterns } from './patterns.mjs';
import { PACK_LIMITS, DEFAULT_TASK_BUDGET as DEFAULT_BUDGET } from './limits.mjs';

const USAGE = `ai-arch — AI 原生工程级架构框架 CLI（零依赖）

用法：
  ai-arch init [dir] --pack <id> [选项]     用模板包初始化一个项目
  ai-arch index [--stale|--apply <file>|--json]  构建/查看/回填文件索引
  ai-arch task "<任务描述>" [--area <目录>]  生成任务上下文包（该读什么、值多少 token）
  ai-arch review [--drift|--decisions|--impact <文件>]  规范漂移与影响面检查
  ai-arch scale [--gaps]                    评估项目规模等级并列出欠账
  ai-arch patterns [--level S|M|L|XL] [--problem <关键词>]  设计模式选择矩阵
  ai-arch skill <list|show <id>|add <id>>   管理项目内的任务知识（skills）
  ai-arch doctor                            项目健康检查
  ai-arch packs                             列出可用模板包
  ai-arch upgrade [--apply|--force]         把项目里的框架文件同步到当前版本
  ai-arch help | version

全局选项：
  --json      机器可读输出（供 AI 解析）
  --quiet     精简输出
  -h, --help  帮助
`;

const PROJECT_COMMANDS = new Set(['index', 'task', 'review', 'scale', 'skill', 'doctor', 'upgrade', 'patterns']);

/**
 * 命令自身的选项名：只跳过 kebab→camel 归一化，**仍然原样保留**。
 *
 * 这个清单必须覆盖 USAGE 里列出的每一个命令选项。漏写不会报错，但会静默改变行为：
 * 一是选项被错误地归一化（多了个 camelCase 别名），二是用户传的值可能被下游当成变量。
 * scripts/selftest.mjs 有一条回归测试覆盖这个清单与实际行为的一致性。
 */
const COMMAND_FLAGS = [
  'pack', 'name', 'dry-run', 'force', 'refresh', 'json', 'quiet', 'help', 'version',
  'root', 'description', 'owner', 'src-dir', 'tests-dir', 'budget',
  'max-files', 'area', 'expand', 'changed', 'slug', 'out', 'limit', 'depth',
  'apply', 'strict', 'stale', 'decisions', 'impact', 'gaps', 'contributors',
  'problem', 'level', 'verbose', 'prompt', 'yes', 'list', 'all', 'deep',
];

export async function main(argv) {
  const parsed = parseArgs(argv);
  const { command, args, flags } = parsed;

  if (!command || command === 'help' || flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === 'version' || flags.version) {
    process.stdout.write(`ai-arch ${frameworkVersion()}  (framework: ${frameworkRoot()})\n`);
    return 0;
  }

  try {
    if (command === 'packs') return cmdPacks(flags);
    if (command === 'init') return cmdInit(args, flags);
    if (command === 'patterns') return cmdPatterns(flags);
    if (PROJECT_COMMANDS.has(command)) return cmdProject(command, args, flags);
    process.stderr.write(`未知命令：${command}\n\n${USAGE}`);
    return 2;
  } catch (error) {
    process.stderr.write(`[ai-arch] 执行失败：${error.message}\n`);
    if (flagBool(flags, 'verbose')) process.stderr.write(error.stack + '\n');
    return 1;
  }
}

/* ------------------------------------------------------------------ packs */

function cmdPacks(flags) {
  const packs = listPacks();
  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify(packs.map(publicPack), null, 2) + '\n');
    return 0;
  }
  const rows = [['id', '规模', '分类', '标题', '适用场景']];
  for (const p of packs) {
    rows.push([p.id, p.scaleLevel ?? '?', p.category ?? '?', p.title ?? '', p.description ?? '']);
  }
  process.stdout.write(table('可用模板包（archetype）', rows) + '\n\n');
  process.stdout.write(`模板目录：${templatesDir()}\n`);
  process.stdout.write('选择方法：见 docs/system/02-scales.md；新增模板包见 templates/_schema/pack.schema.md\n');
  return 0;
}

function publicPack(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    scaleLevel: p.scaleLevel,
    scaleHint: p.scaleHint ?? null,
    language: p.language ?? [],
    runtime: p.runtime ?? null,
    skills: p.skills ?? [],
    variables: (p.variables ?? []).map((v) => ({
      key: v.key, prompt: v.prompt, default: v.default, choices: v.choices ?? null,
    })),
  };
}

/* ------------------------------------------------------------------- init */

function cmdInit(args, flags) {
  const targetDir = args[0] ?? process.cwd();
  const packId = flagString(flags, 'pack', null);
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');
  const refresh = flagBool(flags, 'refresh');

  if (!packId) {
    const packs = listPacks();
    process.stderr.write('必须指定 --pack <id>。可选：\n\n');
    process.stderr.write(table('', [['id', '规模', '标题']].concat(packs.map((p) => [p.id, p.scaleLevel ?? '?', p.title ?? ''])) ) + '\n');
    return 2;
  }

  const result = initProject(targetDir, {
    packId,
    flags: normalizeVarFlags(flags, { reserved: COMMAND_FLAGS }),
    force: force || refresh,
    dryRun,
  });
  if (!result.ok) {
    process.stderr.write(`[ai-arch] ${result.error}\n`);
    return 1;
  }

  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify({
      ok: true,
      packId: result.pack.id,
      scaleLevel: result.pack.scaleLevel,
      dir: result.dir,
      written: result.written,
      skipped: result.skipped,
      refused: result.refused ?? [],
      variables: result.vars,
      missingSkills: result.missingSkills,
      dryRun: result.dryRun,
    }, null, 2) + '\n');
    return 0;
  }

  // 注意：scaleName 由 resolveVariables 派生在 vars 上，不在 pack 对象上
  process.stdout.write(`模板包 ${result.pack.id}（${result.pack.title}，规模 ${result.vars.scaleLevel}/${result.vars.scaleName}）\n`);
  process.stdout.write(`目标目录：${result.dir}${result.dryRun ? '  [dry-run，未写盘]' : ''}\n\n`);
  process.stdout.write(`已生成 ${result.written.length} 项：\n`);
  for (const w of result.written) process.stdout.write(`  + ${w}\n`);
  if (result.skipped.length > 0) {
    process.stdout.write(`\n已存在，跳过 ${result.skipped.length} 项（这些是框架文件或你改过的文件，用 --force 重置框架文件）：\n`);
    for (const s of result.skipped.slice(0, 20)) process.stdout.write(`  = ${s}\n`);
  }
  if ((result.refused ?? []).length > 0) {
    process.stdout.write(`\n项目原有文件，框架拒绝触碰 ${result.refused.length} 项（--force 也不会写）：\n`);
    for (const s of result.refused.slice(0, 20)) process.stdout.write(`  ! ${s}\n`);
    process.stdout.write('  这些文件由你维护。如果确实想用框架版本替换，请先自行删除它再重跑 init。\n');
  }
  if (result.missingSkills.length > 0) {
    process.stdout.write(`\n警告：模板引用了不存在的 skill：${result.missingSkills.join(', ')}\n`);
  }

  process.stdout.write('\n下一步（务必按顺序）：\n');
  process.stdout.write('  1. 填 .ai/constitution.md 的项目定位、技术栈与验证命令（这是 AI 的红线来源）\n');
  process.stdout.write('  2. 建立基线索引：node .ai/bin/ai-arch.mjs index\n');
  process.stdout.write('  3. 让 AI 为高风险文件生成摘要：node .ai/bin/ai-arch.mjs index --stale\n');
  process.stdout.write('  4. 健康检查：node .ai/bin/ai-arch.mjs doctor\n');
  if ((result.pack.compile ?? []).length > 0) {
    process.stdout.write('\n本项目还需要人工确认：\n');
    for (const c of result.pack.compile) process.stdout.write(`  - ${c.file}：${c.hint ?? c.action}\n`);
  }
  return 0;
}

/* ------------------------------------------------------- project commands */

function resolveProject(flags, positional = []) {
  const explicit = flagString(flags, 'root', null);
  if (explicit) return path.resolve(explicit);

  // 允许 `ai-arch index <目录>`：若首个位置参数是一个"看起来像项目根"的目录，则用它。
  const first = positional[0];
  if (first && !/^[-.]/.test(first)) {
    const candidate = path.resolve(first);
    if (isDir(candidate)) {
      if (isFile(path.join(candidate, '.ai', 'framework.json'))
        || isFile(path.join(candidate, '.ai', 'constitution.md'))) {
        return candidate;
      }
      // 明确给了目录但不是本框架的项目 → 直接报错，不要退化成"cwd 恰好是项目"的歧义行为
      throw new Error(
        `${candidate} 不是由本框架初始化的项目（缺少 .ai/framework.json 与 .ai/constitution.md）。\n`
        + '  新项目请先初始化：node cli/ai-arch.mjs init <目录> --pack <模板包 id>',
      );
    }
  }

  const root = findProjectRoot(process.cwd());
  if (!root) {
    throw new Error(
      '未找到被本框架初始化的项目（缺少 .ai/framework.json 或 .ai/constitution.md）。\n'
      + '  请在项目内运行，或用 --root <目录> 指定（也可直接把项目目录作为首个参数）；新项目请先 init。',
    );
  }
  return root;
}

function cmdProject(command, args, flags) {
  // `index` / `doctor` / `upgrade` / `scale` 等命令不带业务位置参数，
  // 因此首个位置参数可能是项目目录；带业务参数的命令（task/review/skill）第一个参数是内容，不做目录解析。
  const positionalForRoot = ['index', 'doctor', 'upgrade', 'scale', 'patterns'].includes(command) ? args : [];
  const root = resolveProject(flags, positionalForRoot);
  switch (command) {
    case 'index': return cmdIndex(root, flags);
    case 'task': return cmdTask(root, args, flags);
    case 'review': return cmdReview(root, args, flags);
    case 'scale': return cmdScale(root, flags);
    case 'skill': return cmdSkill(root, args, flags);
    case 'doctor': return cmdDoctor(root, flags);
    case 'upgrade': return cmdUpgrade(root, flags);
    case 'patterns': return cmdPatterns(flags);
    default: return 2;
  }
}

function cmdIndex(root, flags) {
  const previous = loadIndex(root);
  const index = scanProject(root, { previous });
  const isJson = flagBool(flags, 'json');

  if (flagString(flags, 'apply', null)) {
    const file = path.resolve(flagString(flags, 'apply'));
    const payload = readJsonSafe(file, null);
    const digests = Array.isArray(payload) ? payload : payload?.files;
    if (!Array.isArray(digests)) throw new Error(`${file} 不是摘要数组，也不是含 files 数组的 JSON`);
    const { applied, rejected } = applyDigests(index, digests);
    saveIndex(root, index);
    if (isJson) {
      process.stdout.write(JSON.stringify({ ok: true, applied, rejected }, null, 2) + '\n');
    } else {
      process.stdout.write(`已写回摘要 ${applied.length} 条；拒绝 ${rejected.length} 条。\n`);
      for (const r of rejected) process.stdout.write(`  ! ${r.path} — ${r.reason}\n`);
    }
    return rejected.length > 0 && flagBool(flags, 'strict') ? 1 : 0;
  }

  saveIndex(root, index);

  if (flagBool(flags, 'stale')) {
    const request = digestRequest(index, { limit: flagNumber(flags, 'limit', 40) });
    if (isJson) {
      process.stdout.write(JSON.stringify(request, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`需要生成/更新摘要的文件：${request.files.length} 个（待写总数 ${request.pendingTotal}）\n\n`);
    if (request.files.length === 0) {
      process.stdout.write('索引摘要齐全。\n');
      return 0;
    }
    const rows = [['#', '文件', '原因', '行数', '风险', '被依赖']];
    request.files.forEach((f, i) => {
      rows.push([String(i + 1), f.path, f.reason === 'hash-changed' ? '内容已变' : '无摘要', String(f.loc ?? '-'), '-', String(f.importedBy?.length ?? 0)]);
    });
    process.stdout.write(table('', rows) + '\n\n');
    process.stdout.write('让 AI 按下面的提示处理（或直接用 --json 输出交给 AI）：\n\n');
    process.stdout.write('  node .ai/bin/ai-arch.mjs index --stale --json > .ai/cache/digest-request.json\n');
    process.stdout.write('  # AI 读取该文件与对应源码后，产出 JSON 数组，再执行：\n');
    process.stdout.write('  node .ai/bin/ai-arch.mjs index --apply .ai/cache/digest-request.json\n');
    return 0;
  }

  if (isJson) {
    process.stdout.write(JSON.stringify({
      ok: true,
      fileCount: index.fileCount,
      summary: index.summary,
      generated: index.generated,
    }, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`索引已更新：${index.fileCount} 个文件，共 ${index.summary.totalLoc} 行\n`);
  process.stdout.write(table('', [
    ['风险 high', String(index.summary.byRisk.high ?? 0)],
    ['风险 medium', String(index.summary.byRisk.medium ?? 0)],
    ['风险 low', String(index.summary.byRisk.low ?? 0)],
    ['待写摘要', String(index.summary.pendingDigest)],
    ['摘要过期', String(index.summary.staleDigest)],
  ]) + '\n');
  process.stdout.write(`写入：${path.join(root, '.ai', 'index', 'files.json')}\n`);
  if (index.summary.pendingDigest > 0) {
    process.stdout.write('\n下一步：node .ai/bin/ai-arch.mjs index --stale   # 生成待写摘要清单\n');
  }
  return 0;
}

function cmdTask(root, args, flags) {
  const prompt = args.join(' ').trim() || flagString(flags, 'prompt', '');
  if (!prompt) throw new Error('缺少任务描述。用法：ai-arch task "把登录接口改成 token 刷新"');
  const index = loadIndex(root);
  if (!index) throw new Error('索引不存在，请先运行：node .ai/bin/ai-arch.mjs index');

  const changed = [];
  if (flags.changed) changed.push(...String(flags.changed).split(',').map((s) => s.trim()).filter(Boolean));

  const pack = buildTaskPack(root, prompt, {
    index,
    budget: flagNumber(flags, 'budget', DEFAULT_BUDGET),
    maxFiles: flagNumber(flags, 'max-files', 25),
    expandDepth: flagNumber(flags, 'expand', 1),
    area: flagString(flags, 'area', null),
    changed,
    slug: flagString(flags, 'slug', null),
  });

  const out = flagString(flags, 'out', null);
  const file = writeTaskPack(root, pack, { out });

  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify({ ...pack, file }, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`任务包已生成：${normalizeRel(path.relative(root, file))}\n\n`);
  process.stdout.write(`预估 token：~${pack.estimate.total} / 预算 ${pack.budget}`
    + `（固定 L0+L1 ~${pack.estimate.mandatory}，按需 ~${pack.estimate.selected}）\n`);
  process.stdout.write(`读取清单：${pack.readList.length} 个文件`
    + `（其中需读源码 ${pack.readList.filter((s) => s.decision === 'read-source').length} 个，读摘要 ${pack.readList.filter((s) => s.decision === 'read-digest').length} 个）\n`);
  if (pack.dropped.length > 0) process.stdout.write(`预算外丢弃：${pack.dropped.length} 个（详见任务包 2.2 节）\n`);
  if (pack.indexHealth.pendingDigest > 0) {
    process.stdout.write(`\n注意：还有 ${pack.indexHealth.pendingDigest} 个文件没有摘要，它们会被判定为"必须读源码"，成本偏高。\n`);
    process.stdout.write('  建议先跑：node .ai/bin/ai-arch.mjs index --stale\n');
  }
  process.stdout.write('\n接下来：把该文件交给 AI，让它按读取清单执行，不要满仓库搜索。\n');
  return 0;
}

function cmdReview(root, args, flags) {
  if (flagBool(flags, 'decisions')) {
    const decisions = listDecisions(root);
    if (flagBool(flags, 'json')) {
      process.stdout.write(JSON.stringify(decisions, null, 2) + '\n');
      return 0;
    }
    if (decisions.length === 0) {
      process.stdout.write('尚无 ADR。判断是否需要：见 .ai/skills/adr-writing/SKILL.md\n');
      return 0;
    }
    const rows = [['文件', '标题', '状态', '日期']];
    for (const d of decisions) rows.push([d.file, d.title, d.status, d.date]);
    process.stdout.write(table('ADR 清单', rows) + '\n');
    return 0;
  }

  const impactTarget = flagString(flags, 'impact', null) ?? (args.length > 0 ? args.join(',') : null);
  if (impactTarget) {
    const index = loadIndex(root);
    if (!index) throw new Error('索引不存在，请先运行：node .ai/bin/ai-arch.mjs index');
    const changed = impactTarget.split(',').map((s) => s.trim()).filter(Boolean);
    const impact = impactOf(index, changed, { depth: flagNumber(flags, 'depth', 2), limit: 60 });
    const impactMap = readJsonSafe(path.join(root, '.ai', 'index', 'impact-map.json'), null);
    const result = { ...impact, rules: impactMap?.rules ?? [] };

    if (flagBool(flags, 'json')) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`变更文件：${impact.changed.join(', ') || '(未匹配到)'}\n`);
    if (impact.dependents.length > 0) {
      process.stdout.write(`\n受影响（深度 ≤ ${impact.depth}）：${impact.dependents.length} 个\n`);
      const rows = [['文件', '深度', '风险', '摘要']];
      for (const d of impact.dependents) rows.push([d.path, String(d.depth), d.risk, d.digest ?? '-']);
      process.stdout.write(table('', rows) + '\n');
    } else {
      process.stdout.write('\n没有其他文件依赖它。\n');
    }
    if (impact.tests.length > 0) {
      process.stdout.write(`\n应运行的测试：\n`);
      for (const t of impact.tests) process.stdout.write(`  - ${t}\n`);
    }
    if (impactMap?.rules) {
      process.stdout.write('\n影响矩阵要求的同步更新（.ai/index/impact-map.json）：\n');
      for (const rule of impactMap.rules) {
        process.stdout.write(`  - ${rule.trigger} → ${(rule.mustUpdate ?? []).join(', ')}${rule.adrRequired ? '（需 ADR）' : ''}\n`);
      }
    }
    return 0;
  }

  const report = reviewDrift(root, { strict: flagBool(flags, 'strict') });
  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.strictFailed ? 1 : 0;
  }
  process.stdout.write('规范漂移检查（机械可判定部分）\n\n');
  if (report.findings.length === 0) {
    process.stdout.write('  未发现漂移。\n');
  } else {
    for (const f of report.findings.slice(0, 60)) {
      const icon = f.severity === 'error' ? '✗' : f.severity === 'warn' ? '!' : 'i';
      process.stdout.write(`  ${icon} [${f.code}] ${f.target}\n      ${f.message}\n      → ${f.action}\n`);
    }
    if (report.findings.length > 60) process.stdout.write(`  … 其余 ${report.findings.length - 60} 条省略（用 --json 获取全部）\n`);
  }
  const s = report.summary;
  process.stdout.write(`\n汇总：${s.error} 错误 / ${s.warn} 警告 / ${s.info} 提示\n`);
  process.stdout.write('说明：本命令只能发现机械可判定的漂移；架构层面的评审清单见 .ai/skills/code-review/SKILL.md\n');
  return report.strictFailed ? 1 : 0;
}

function cmdScale(root, flags) {
  const index = loadIndex(root);
  if (!index) throw new Error('索引不存在，请先运行：node .ai/bin/ai-arch.mjs index');
  const meta = loadProjectMeta(root);
  const assessment = assessScale(index, {
    contributors: flags.contributors ? Number(flags.contributors) : null,
    srcDir: meta?.variables?.srcDir ?? 'src',
  });

  const order = ['S', 'M', 'L', 'XL'];
  const declared = meta?.scaleLevel ?? null;
  const required = {
    S: ['AGENTS.md', '.ai/constitution.md'],
    M: ['AGENTS.md', '.ai/constitution.md', '.ai/registry.json', '.ai/decisions/README.md'],
    L: ['AGENTS.md', '.ai/constitution.md', '.ai/registry.json', '.ai/decisions/README.md', '.ai/index/impact-map.json'],
    XL: ['AGENTS.md', '.ai/constitution.md', '.ai/registry.json', '.ai/decisions/README.md', '.ai/index/impact-map.json'],
  };
  const gaps = [];
  for (const level of order.slice(0, order.indexOf(assessment.level) + 1)) {
    for (const rel of required[level]) {
      if (!isFile(path.join(root, rel))) gaps.push({ level, file: rel });
    }
  }

  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify({ assessment, declared, gaps }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write('规模评估（依据 docs/system/02-scales.md，取四项最高档）\n\n');
  for (const r of assessment.reasons) process.stdout.write(`  - ${r}\n`);
  process.stdout.write(`\n结论：${assessment.level} / ${SCALE_NAME[assessment.level] ?? ''}\n`);
  if (declared) {
    const cmp = order.indexOf(assessment.level) - order.indexOf(declared);
    if (cmp > 0) {
      process.stdout.write(`注意：项目声明为 ${declared}，实测已达 ${assessment.level}。按规范必须写 ADR 并补齐流程。\n`);
    } else if (cmp < 0) {
      process.stdout.write(`提示：项目声明为 ${declared}，实测为 ${assessment.level}。若已收缩，可考虑降级并写 ADR。\n`);
    } else {
      process.stdout.write('与声明一致。\n');
    }
  }
  if (flagBool(flags, 'gaps') || gaps.length > 0) {
    if (gaps.length === 0) {
      process.stdout.write('当前等级要求的文件齐全。\n');
    } else {
      process.stdout.write('\n欠账（当前等级要求但缺失）：\n');
      for (const g of gaps) process.stdout.write(`  - [${g.level}] ${g.file}\n`);
    }
  }
  return 0;
}

function cmdSkill(root, args, flags) {
  // 容错：`skill <目录> list` 与 `skill list` 等价（项目目录既可作 --root，也可作首个位置参数）
  const cleaned = [...args];
  if (cleaned.length > 1 && path.resolve(cleaned[0]) === path.resolve(root)) cleaned.shift();
  const sub = cleaned[0] ?? 'list';
  const rest = cleaned.slice(1);
  const projectSkillsDir = path.join(root, '.ai', 'skills');
  const available = listAvailableSkills();

  if (sub === 'list') {
    const installed = isDir(projectSkillsDir)
      ? fs.readdirSync(projectSkillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      : [];
    if (flagBool(flags, 'json')) {
      process.stdout.write(JSON.stringify({ available, installed }, null, 2) + '\n');
      return 0;
    }
    const rows = [['skill', '已装入项目', '说明']];
    for (const id of available) {
      rows.push([id, installed.includes(id) ? '是' : '否', skillSummary(id)]);
    }
    process.stdout.write(table('任务知识（skills）', rows) + '\n\n');
    process.stdout.write('装入：node .ai/bin/ai-arch.mjs skill add <id>\n');
    return 0;
  }

  if (sub === 'show') {
    const id = args[1];
    if (!id) throw new Error('用法：ai-arch skill show <id>');
    const file = path.join(skillsDir(), id, 'SKILL.md');
    if (!isFile(file)) throw new Error(`skill "${id}" 不存在。可用：${available.join(', ')}`);
    process.stdout.write(fs.readFileSync(file, 'utf8'));
    return 0;
  }

  if (sub === 'add') {
    const id = args[1];
    if (!id) throw new Error('用法：ai-arch skill add <id>');
    if (!skillExists(id)) throw new Error(`skill "${id}" 不存在。可用：${available.join(', ')}`);
    const from = path.join(skillsDir(), id);
    const to = path.join(projectSkillsDir, id);
    const written = [];
    for (const rel of deepFiles(from)) {
      const dest = path.join(to, rel);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, fs.readFileSync(path.join(from, rel)));
      written.push(normalizeRel(path.relative(root, dest)));
    }
    process.stdout.write(`已装入 skill "${id}"：${written.length} 个文件\n`);
    for (const w of written) process.stdout.write(`  + ${w}\n`);
    return 0;
  }

  throw new Error(`未知子命令 "${sub}"。用法：ai-arch skill <list|show|add>`);
}

function skillSummary(id) {
  const file = path.join(skillsDir(), id, 'SKILL.md');
  if (!isFile(file)) return '';
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const desc = fm[1].match(/description:\s*(.*)/);
    if (desc) return desc[1].trim();
  }
  const h2 = text.match(/^>\s*(.*)$/m);
  return h2 ? h2[1].trim() : '';
}

function deepFiles(dir) {
  const { files } = walk(dir, {});
  return files;
}

function cmdDoctor(root, flags) {
  const report = doctor(root);
  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.hasErrors ? 1 : 0;
  }
  process.stdout.write(`项目健康检查：${root}\n\n`);
  process.stdout.write(renderDoctor(report) + '\n');
  return report.hasErrors ? 1 : 0;
}

function cmdUpgrade(root, flags) {
  const apply = flagBool(flags, 'apply');
  const force = flagBool(flags, 'force');
  const result = upgradeProject(root, {
    dryRun: !apply,
    force,
    flags: normalizeVarFlags(flags, { reserved: COMMAND_FLAGS }),
  });
  if (!result.ok) {
    process.stderr.write(`[ai-arch] ${result.error}\n`);
    return 1;
  }
  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`框架升级${result.dryRun ? '（dry-run，未写盘；加 --apply 生效）' : ''}\n`);
  process.stdout.write(`  版本：${result.fromVersion} → ${result.toVersion}   模板包：${result.packId}\n\n`);
  const section = (title, list) => {
    if (!list || list.length === 0) return;
    process.stdout.write(`${title}（${list.length}）：\n`);
    for (const f of list.slice(0, 30)) process.stdout.write(`  - ${f}\n`);
    if (list.length > 30) process.stdout.write(`  … 其余 ${list.length - 30} 项\n`);
    process.stdout.write('\n');
  };
  section('将更新（本地未改动）', result.updated);
  section('将新增', result.created);
  section('本地已改动，保留不动（需人工合并）', result.changedLocally);
  section('项目原有文件，框架不接管也不覆盖', result.notManaged);
  section('本地已删除（不会被恢复）', result.removed);
  section('受保护，跳过', result.protectedFiles);
  process.stdout.write(`工具链同步 ${result.toolchain} 个文件；skills ${result.skills} 个；框架规范快照 ${result.frameworkDocs} 个。\n`);
  if (result.notManaged.length > 0) {
    process.stdout.write('\n说明：上面"项目原有文件"是 init 时已存在、由你维护的文件（例如你自己的 .gitignore）。\n'
      + '框架永不覆盖它们。若确实想用框架版本替换，请先自行删除该文件再跑 init。\n');
  }
  if (result.changedLocally.length > 0 && !force) {
    process.stdout.write('\n提示：上面"本地已改动"的文件是你的项目资产，框架不会覆盖。若确认要用框架版本覆盖，加 --force。\n');
  }
  return 0;
}

function collectOverrides(flags) {
  return normalizeVarFlags(flags, { reserved: COMMAND_FLAGS });
}

/* --------------------------------------------------------------- patterns */

function cmdPatterns(flags) {
  const level = flagString(flags, 'level', null);
  const problem = flagString(flags, 'problem', null);

  let items = PATTERNS;
  if (level) items = items.filter((p) => appliesAt(p, level));
  if (problem) {
    const q = problem.toLowerCase();
    items = items.filter((p) => (p.problem + p.name + p.why).toLowerCase().includes(q));
  }

  if (flagBool(flags, 'json')) {
    process.stdout.write(JSON.stringify({ level, problem, rules: MATRIX_RULES, patterns: items, antiPatterns: antiPatterns(level) }, null, 2) + '\n');
    return 0;
  }

  process.stdout.write('设计模式选择矩阵（依据 docs/system/03-pattern-selection.md）\n\n');  if (!level) {
    process.stdout.write('规模判定规则（取最高档）：\n');
    const rows = [['等级', '代码行数', '模块数', '参与人', '强制要求']];
    for (const r of MATRIX_RULES) rows.push([`${r.level} ${r.name}`, r.loc, r.modules, r.team, r.must.join('、')]);
    process.stdout.write(table('', rows) + '\n\n');
  }
  if (items.length === 0) {
    if (level === 'S') {
      process.stdout.write('S 级允许的设计模式：**零个**。\n\n');
      process.stdout.write('这不是缺数据，而是设计结论：S 级（< 2k 行 / 单人 / 短周期）的默认做法是不引入任何模式，\n'
        + '只把输入输出契约与验证命令写清楚。矩阵里所有模式的 minLevel 都 ≥ M。\n'
        + '如果你确实需要其中某一项，先按 docs/system/02-scales.md 的规则升级规模等级并写 ADR。\n');
    } else {
      process.stdout.write('没有匹配的模式条目。\n');
    }
  } else {
    const rows = [['模式', '解决的问题', '最低规模', '代价', '需要 ADR']];
    for (const p of items) {
      rows.push([p.name, p.problem, p.minLevel, p.cost, p.adrRequired ? '是' : '否']);
    }
    process.stdout.write(table(level ? `适用于 ${level} 级` : '全部条目', rows) + '\n');
  }
  const anti = antiPatterns(level);
  if (anti.length > 0) {
    process.stdout.write(`\n当前规模禁止（过度设计）：\n`);
    for (const a of anti) process.stdout.write(`  ✗ ${a}\n`);
  }
  process.stdout.write('\n提醒：先判断规模，再选模式。小项目引入高级模式属于缺陷，不是优点。\n');
  return 0;
}

function appliesAt(pattern, level) {
  const order = ['S', 'M', 'L', 'XL'];
  return order.indexOf(level) >= order.indexOf(pattern.minLevel);
}

export { USAGE, PACK_LIMITS };
