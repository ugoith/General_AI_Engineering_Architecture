#!/usr/bin/env node
/**
 * 产出「供其它 agent 安装」的分发物。三种目标形态，一份源：
 *
 *   1. dist/skills/                     — 标准 Agent Skills 包（DSH、Claude Code、以及任何
 *                                          遵循 Agent Skills 标准的工具都能直接吃）
 *   2. dist/plugins/claude-code/        — Claude Code 插件（.claude-plugin/plugin.json + skills/）
 *   3. dist/plugins/dsh/                — DeepSeek Harness bundle 插件（Cordis 插件行 + 内置 CLI，
 *                                          把 ai-arch 的检查类命令暴露成模型可直接调用的工具）
 *
 * 为什么源只留一份 skills/、其余全部**生成**：
 *   同一份知识复制成三套目录必然漂移。生成物不入库（.gitignore 忽略 dist/），
 *   每次发布重建，因此不存在"改了源忘了改副本"的可能。
 *
 * 用法：
 *   node scripts/dist.mjs            # 产出全部
 *   node scripts/dist.mjs --report   # 只打印将要产出的内容与目标工具要求
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const dist = path.join(repo, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));

const REPORT_ONLY = process.argv.includes('--report');

/** 递归复制目录。 */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) n += copyDir(src, dst);
    else {
      fs.copyFileSync(src, dst);
      n += 1;
    }
  }
  return n;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

/** 列出全部 skill id（以目录内含 SKILL.md 为准）。 */
function listSkills() {
  const dir = path.join(repo, 'skills');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}

/** 从 SKILL.md frontmatter 读 description（用于生成各插件清单里的技能说明）。 */
function skillMeta(id) {
  const text = fs.readFileSync(path.join(repo, 'skills', id, 'SKILL.md'), 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const desc = fm?.[1].match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? '';
  const when = fm?.[1].match(/^whenToUse:\s*(.*)$/m)?.[1]?.trim() ?? '';
  return { id, description: desc, whenToUse: when };
}

const SKILLS = listSkills();

/* ------------------------------------------------ 1. 标准 skills 包 */

function buildSkillsPack() {
  const root = path.join(dist, 'skills');
  const count = copyDir(path.join(repo, 'skills'), root);
  writeFile(path.join(root, 'README.md'), `# AI 工程架构 · Skills 包（标准 Agent Skills）

本包内含 ${SKILLS.length} 个 skill，每个是一个目录 bundle（\`<name>/SKILL.md\`），
frontmatter 遵循 Agent Skills 标准：\`name\`、\`description\`、\`whenToUse\`、\`user-invocable\`。

## 安装（把 skills/ 的内容放进你的 agent 的 skill 根目录）

| 工具 | 技能根目录 | 说明 |
|---|---|---|
| DeepSeek Harness | 项目 \`.dsh/skills/\` 或用户级 skill 目录 | 目录 bundle 或平铺 \`<name>.md\`；**不支持嵌套的 SKILL.md**，必须直接放在根下 |
| Claude Code | 项目 \`.claude/skills/\`（插件内为 \`skills/\`） | 同上，一个 skill 一个目录 |
| 其它遵循 Agent Skills 标准的工具 | 见各自文档 | 本包不需要任何构建步骤 |

## 一条命令安装

\`\`\`bash
node <框架目录>/cli/ai-arch.mjs install --root .        # 自动装入已存在的 agent 目录
node <框架目录>/cli/ai-arch.mjs install --root . --agent dsh,claude
\`\`\`

## 可用 skill

${SKILLS.map((id) => {
  const m = skillMeta(id);
  return `- **${id}** — ${m.description}\n  - 何时用：${m.whenToUse}`;
}).join('\n')}

> 这些 skill 是**任务知识**：回答"这类活怎么干"。项目上下文（这个项目是什么、有什么约束）
> 由安装到项目里的 \`AGENTS.md\` 与 \`.ai/\` 承担，两者互补。
`);
  return { dir: 'dist/skills', files: count + 1 };
}

/* ------------------------------------------- 2. Claude Code 插件 */

function buildClaudePlugin() {
  const root = path.join(dist, 'plugins', 'claude-code');
  const manifest = {
    name: 'ai-engineering-arch',
    version: pkg.version,
    description: '把 AI 工程架构接入当前项目：分层上下文、文件索引与语义摘要、任务上下文包、项目规则与漂移检测。',
    author: { name: 'ugoith' },
    homepage: 'https://github.com/ugoith/General_AI_Engineering_Architecture',
    repository: 'https://github.com/ugoith/General_AI_Engineering_Architecture',
    license: 'MIT',
    keywords: ['ai-agents', 'architecture', 'context-engineering', 'agents-md', 'code-review', 'adr'],
  };
  writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');

  const n = copyDir(path.join(repo, 'skills'), path.join(root, 'skills'));
  writeFile(path.join(root, 'README.md'), `# AI 工程架构（Claude Code 插件）

## 安装

\`\`\`bash
# 方式 A：作为本地插件目录
claude plugin add ${'<'}本插件目录${'>'}

# 方式 B：直接从仓库的 dist 目录安装（先构建）
node scripts/dist.mjs
claude plugin add dist/plugins/claude-code
\`\`\`

## 它给你什么

- **${SKILLS.length} 个 skill**：任务知识层，Claude Code 从 \`skills/\` 自动发现，按 \`whenToUse\` 触发。
- 安装 skill 只是第一步。**项目上下文**（\`AGENTS.md\`、\`.ai/\` 索引与任务包）需要一次初始化：

\`\`\`bash
node <框架目录>/cli/ai-arch.mjs install --root .
\`\`\`

之后接任务前先拿任务包（该读什么、值多少 token、hash 是否变化）：

\`\`\`bash
node .ai/bin/ai-arch.mjs task "<任务描述>"
\`\`\`

## 内容

${SKILLS.map((id) => `- \`${id}\` — ${skillMeta(id).description}`).join('\n')}
`);
  return { dir: 'dist/plugins/claude-code', files: n + 2 };
}

/* --------------------------------------- 3. DeepSeek Harness 插件 */

/**
 * DSH 的 bundle 插件 = 一个 npm 包 + 一行 Cordis 补丁。
 * host 侧入口导出 name/inject/Config/apply，在 apply 里注册工具。
 * 这里把 ai-arch 的**只读检查类命令**暴露成模型可直接调用的工具：
 * 它们都是"读项目状态并给结论"，不修改任何东西，因此适合作为工具暴露。
 *
 * 已知限制（务必如实告知使用者）：
 *  - DSH 处于内测，工具 DSL 与 peer 依赖范围会随版本变化；本插件按当前文档编写，
 *    **未在运行中的 DSH 实例上端到端验证过**（本机没有可启动的 profile）。
 *  - 因此同时提供 skill 通道（dist/skills），它在 DSH 上零风险可用。
 */
function buildDshPlugin() {
  const root = path.join(dist, 'plugins', 'dsh');
  const bundle = path.join(root, 'bundle');
  const cliFiles = copyDir(path.join(repo, 'cli'), path.join(bundle, 'cli'));
  const tplFiles = copyDir(path.join(repo, 'templates'), path.join(bundle, 'templates'));
  const skillFiles = copyDir(path.join(repo, 'skills'), path.join(bundle, 'skills'));
  copyDir(path.join(repo, 'schema'), path.join(bundle, 'schema'));
  copyDir(path.join(repo, 'docs', 'system'), path.join(bundle, 'docs', 'system'));
  writeFile(path.join(bundle, 'package.json'), JSON.stringify({
    name: 'ai-arch-bundled', version: pkg.version, type: 'module',
  }, null, 2) + '\n');

  writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dsh-ai-engineering-arch',
    version: pkg.version,
    description: '把 AI 工程架构接入当前项目：项目体检、规则集、项目事实、任务上下文包、漂移检查。',
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: ['lib', 'bundle', 'cordis.patch.yml', 'README.md'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    peerDependencies: {
      '@deepseek-ai/cordis': '*',
      '@deepseek-ai/dsh-tools': '*',
    },
    license: 'MIT',
  }, null, 2) + '\n');

  writeFile(path.join(root, 'cordis.patch.yml'), `# DSH bundle 补丁：把本插件作为一行插入 host 组合树
- insert:
    - id: ai-engineering-arch
      name: dsh-ai-engineering-arch
`);

  // host 入口：注册工具（全部只读）
  writeFile(path.join(root, 'lib', 'index.js'), `/**
 * DSH 插件（host 侧）：把 ai-arch 的只读检查能力暴露为模型可调用的工具。
 *
 * 设计取舍：
 *  - **只暴露只读命令**。install / upgrade / rules add 会改项目文件，属于"要人确认的动作"，
 *    不由模型直接触发；它们仍可通过终端执行（skill 里有说明）。
 *  - 每个工具都在工具描述里写清"何时用"，因为描述就是模型看到的契约。
 *  - 项目根默认取调用者 agent 的会话 cwd，避免出现"在错误的项目上执行"。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const name = 'ai-engineering-arch';
export const inject = ['tools'];

export function apply(ctx) {
  const bundleRoot = path.join(import.meta.dirname, '..', 'bundle');

  // 让内置的 ai-arch CLI 认为"框架根"就是这个 bundle 目录
  process.env.AI_ARCH_BUNDLE_ROOT = process.env.AI_ARCH_BUNDLE_ROOT || bundleRoot;

  let cliPromise = null;
  const loadCli = () => {
    cliPromise ??= import(pathToFileURL(path.join(bundleRoot, 'cli', 'lib', 'cli.mjs')).href);
    return cliPromise;
  };

  /** 在进程内调用 ai-arch，捕获其 stdout（工具返回结构化结果，不直接吐给用户）。 */
  async function runAiArch(args) {
    const cli = await loadCli();
    const out = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
    process.stderr.write = (chunk) => { out.push(String(chunk)); return true; };
    let code = 0;
    try {
      code = await cli.main(args);
    } catch (error) {
      out.push('ai-arch 执行异常：' + error.message);
      code = 1;
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    return { exitCode: code, output: out.join('') };
  }

  const define = (spec) => {
    ctx.tools.register(spec);
  };

  define({
    name: 'ai_arch_doctor',
    description:
      '检查一个项目的 AI 工程架构是否健康：必需文件、上下文文件是否超预算、索引与摘要状态、'
      + '项目规则集、项目事实与可用能力。只读，不修改任何文件。'
      + '当你不确定"这个项目是否已接入、接入是否完好"时使用。',
    parameters: {
      root: { type: 'string', description: '项目根目录；省略则用当前会话工作目录' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(args, exec) {
      const root = args.root || exec?.agent?.session?.header?.cwd || process.cwd();
      const { exitCode, output } = await runAiArch(['doctor', '--root', root]);
      return { ok: exitCode === 0, report: output };
    },
  });

  define({
    name: 'ai_arch_task_pack',
    description:
      '为一个任务生成**上下文包**：该读哪些文件、为什么入选、每个文件的内容 hash 与 token 估算，'
      + '并带上项目规则与项目事实。这是本框架最重要的省上下文机制——'
      + 'hash 未变的文件只需读摘要，不必打开源码。'
      + '接到任何实现/修复/重构任务时，**先调用它以获得读取清单**，不要直接全仓库搜索。',
    parameters: {
      prompt: { type: 'string', required: true, description: '任务描述（自然语言，越具体越准）' },
      root: { type: 'string', description: '项目根目录；省略则用当前会话工作目录' },
      area: { type: 'string', description: '限定目录，例如 src/auth（索引很大时强烈建议）' },
      budget: { type: 'string', description: 'token 预算，默认 40000' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          taskFile: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args, exec) {
      const root = args.root || exec?.agent?.session?.header?.cwd || process.cwd();
      const argv = ['task', args.prompt, '--root', root];
      if (args.area) argv.push('--area', args.area);
      if (args.budget) argv.push('--budget', String(args.budget));
      const { exitCode, output } = await runAiArch(argv);
      const m = output.match(/任务包已生成：(.+)/);
      return {
        ok: exitCode === 0,
        taskFile: m ? m[1].trim() : '',
        summary: output,
      };
    },
  });

  define({
    name: 'ai_arch_rules',
    description:
      '查看本项目的规则集（用户/团队提出的长期约束，含每条规则的类别、判定方式与存量违规）。'
      + '动手改代码前用它确认有哪些约束必须遵守；'
      + '当用户提出新的代码风格或工程约束时，用 ai_arch_rules_add 入库。',
    parameters: {
      root: { type: 'string', description: '项目根目录；省略则用当前会话工作目录' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, report: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(args, exec) {
      const root = args.root || exec?.agent?.session?.header?.cwd || process.cwd();
      const { exitCode, output } = await runAiArch(['rules', 'list', '--root', root]);
      return { ok: exitCode === 0, report: output };
    },
  });

  define({
    name: 'ai_arch_rules_add',
    description:
      '把用户提出的一条长期约束**入库**（这是框架的硬要求：新增约束必须先入库再改代码，'
      + '否则它只存在于这次对话里，下一次任务不会被看到）。'
      + 'statement 必须可判定（例如"if 嵌套深度不超过 3 层"）；'
      + '"代码要整洁"这类不可判定的表述会被拒绝。'
      + '入库后请按返回的传播清单逐条落实（宪法、评审清单、lint 配置等）。',
    parameters: {
      statement: { type: 'string', required: true, description: '一句话规则，必须可判定' },
      check: { type: 'string', required: true, description: '怎么判定：tool 类给可执行命令；review/manual 类给具体评审步骤' },
      category: { type: 'string', enum: ['style', 'naming', 'architecture', 'process', 'security', 'performance', 'testing'], description: '类别，默认 style' },
      enforcement: { type: 'string', enum: ['tool', 'review', 'manual'], description: '判定方式，默认 review；能被工具自动判定的优先用 tool' },
      rationale: { type: 'string', description: '为什么需要它（将来复审时用来判断是否还成立）' },
      scope: { type: 'string', description: '适用路径 glob，默认全项目' },
      root: { type: 'string', description: '项目根目录；省略则用当前会话工作目录' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          ruleId: { type: 'string', required: true },
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(args, exec) {
      const root = args.root || exec?.agent?.session?.header?.cwd || process.cwd();
      const argv = ['rules', 'add', args.statement, '--root', root, '--check', args.check];
      if (args.category) argv.push('--category', args.category);
      if (args.enforcement) argv.push('--enforcement', args.enforcement);
      if (args.rationale) argv.push('--rationale', args.rationale);
      if (args.scope) argv.push('--scope', args.scope);
      const { exitCode, output } = await runAiArch(argv);
      const id = output.match(/规则已入库：(R-\d+)/);
      return { ok: exitCode === 0, ruleId: id ? id[1] : '', report: output };
    },
  });

  define({
    name: 'ai_arch_facts',
    description:
      '查看项目的**事实与可用能力**：引擎版本、已启用插件、以及由此决定的可用能力（例如编辑器内 AI 接口）'
      + '与其边界。新能力会改变"什么做法可行"，所以判断前先查事实，不要凭印象。'
      + '加参数 refresh 可重新探测（改引擎版本或启用插件后需要）。',
    parameters: {
      refresh: { type: 'boolean', description: '重新探测并写入 .ai/project-facts.json' },
      root: { type: 'string', description: '项目根目录；省略则用当前会话工作目录' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, report: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(args, exec) {
      const root = args.root || exec?.agent?.session?.header?.cwd || process.cwd();
      const argv = ['facts', '--root', root];
      if (args.refresh) argv.splice(1, 0, 'refresh');
      const { exitCode, output } = await runAiArch(argv);
      return { ok: exitCode === 0, report: output };
    },
  });

  define({
    name: 'ai_arch_review_drift',
    description:
      '规范漂移检查：文件内容变了但索引摘要没更新、文档引用的路径已不存在、'
      + '有变更却没有决策记录、上下文文件超预算。只读。'
      + '任务收尾时调用它，确认没有留下过期知识再宣布完成。',
    parameters: {
      root: { type: 'string', description: '项目根目录；省略则用当前会话工作目录' },
      strict: { type: 'boolean', description: '有 error/warn 时退出码非 0' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, report: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(args, exec) {
      const root = args.root || exec?.agent?.session?.header?.cwd || process.cwd();
      const argv = ['review', '--root', root, '--drift'];
      if (args.strict) argv.push('--strict');
      const { output } = await runAiArch(argv);
      // 不使用退出码：--drift 默认在"发现漂移"时仍返回 0（只有 --strict 才非 0），
      // 用退出码会把"发现了问题"误报成工具失败。改为读汇总行的计数。
      const m = output.match(/(\\d+) 错误 \\/ (\\d+) 警告/);
      const errors = m ? Number(m[1]) : 0;
      return { ok: errors === 0, report: output };
    },
  });
}
`);

  // skills 随包分发（DSH 也走 skill 通道，零风险）
  const skillCount = copyDir(path.join(repo, 'skills'), path.join(root, 'skills'));

  writeFile(path.join(root, 'README.md'), `# AI 工程架构 · DeepSeek Harness 插件

把 AI 工程架构接入当前项目，并让模型直接调用其检查能力。

## 安装

\`\`\`bash
# 在框架仓库根执行，产出本插件目录
node scripts/dist.mjs

# 装进某个 profile（需要 pnpm；DSH 内测期请固定 CLI 与插件的通道一致）
npx -p @deepseek-ai/dsh dsh plugin --profile <profile> add "$(pwd)/dist/plugins/dsh"
# 装完需要重启该 profile
\`\`\`

## 它注册了什么

| 工具 | 作用 |
|---|---|
| \`ai_arch_doctor\` | 项目体检：必需文件、上下文预算、索引与摘要、规则集、能力事实 |
| \`ai_arch_task_pack\` | **生成任务上下文包**（该读什么、hash、token 估算）——接任务第一步就该调它 |
| \`ai_arch_rules\` | 查看项目规则集（用户/团队提出的长期约束及其判定方式） |
| \`ai_arch_rules_add\` | **把新约束入库**（框架硬要求：先入库再改代码） |
| \`ai_arch_facts\` | 项目事实与可用能力（引擎版本、可用的编辑器 AI 接口及其边界） |
| \`ai_arch_review_drift\` | 漂移检查：摘要过期、文档断链、决策缺失、预算超限 |

另外随包分发 **${skillCount} 个 skill**（\`skills/\`），DSH 的 skill 提供方会直接发现它们。

## 只暴露只读命令是刻意的

\`install\`、\`upgrade\`、\`rules add\` 之外，本插件不提供"自动改项目"的工具。
初始化项目（写文件）属于需要人确认的动作，由用户执行：

\`\`\`bash
node <框架目录>/cli/ai-arch.mjs install --root .
\`\`\`

## 已验证 / 未验证（如实说明）

- ✅ 已验证：内置 CLI 的全部命令、skill frontmatter 符合 DSH 的 \`dsh-skill-filesystem\` 要求
  （\`name\`/\`description\`/\`whenToUse\`，目录 bundle 形式，无嵌套）。
- ⚠️ **未在运行中的 DSH 实例上端到端验证**：DSH 处于内测，工具 DSL 与 peer 依赖范围会随版本变化，
  本插件的 host 入口按官方文档编写但未实测。若加载失败，请先用 \`node scripts/verify-dsh.mjs\` 做离线
  冒烟，再检查 \`cordis.patch.yml\` 的行 id 是否与部署内的命名冲突。
- 若只想零风险使用：装 \`dist/skills\` 那一份（纯文本，任何 DSH 版本都能用），
  检查类命令用终端执行。
`);
  return { dir: 'dist/plugins/dsh', files: cliFiles + tplFiles + skillFiles + 6 };
}

/* --------------------------------------- 4. 统一 agent kit（跨工具） */

/**
 * 一个"kit"= 按各 agent 自己的目录约定组织好的一整套文件，解包即用。
 *
 * 为什么需要它（比逐个插件更普适）：
 *   插件市场只覆盖少数产品，而且各家的市场机制还在变；但"把文件放到约定目录"是所有 agent
 *   都支持的最低公共分母。因此我们同时提供：
 *     - 可提交进仓库的 kit（dist/agent-kit/）—— 一次拷进项目，各工具自动发现
 *     - CLI 按需生成（ai-arch install）—— 只针对项目里**已存在**的 agent 目录
 *   两者生成规则完全一致（同一个 AGENT_ADAPTERS 表），因此不会漂移。
 */
async function buildAgentKit() {
  const root = path.join(dist, 'agent-kit');
  // 复用 CLI 的适配表：单一事实来源，避免 kit 与 install 两套规则
  const mod = await import(pathToFileURL(path.join(repo, 'cli', 'lib', 'install.mjs')).href);
  const adapters = mod.AGENT_ADAPTERS;

  // 造一个"目标项目根"，用 install 的写入逻辑把 kit 内容生成出来
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kit-'));
  try {
    for (const a of adapters) {
      fs.mkdirSync(path.join(staging, a.detectDir), { recursive: true });
    }
    mod.writeAgentAdapters(staging, { agents: 'all', forceSkills: true });

    // 只把 agent 目录拷进 kit（.ai/ 由 CLI install 负责，不属于 kit）
    const KEEP = new Set([
      '.claude', '.dsh', '.cursor', '.codex', '.github', '.gemini',
      '.workbuddy', '.continue', '.agents',
    ]);
    let files = 0;
    for (const entry of fs.readdirSync(staging, { withFileTypes: true })) {
      if (!KEEP.has(entry.name)) continue;
      files += copyDir(path.join(staging, entry.name), path.join(root, entry.name));
    }

    writeFile(path.join(root, 'README.md'), `# Agent Kit —— 一次拷进项目，各 AI 工具自动发现

本目录是按各家 agent **自己的目录约定**组织好的一整套文件。拷进项目根即可生效，不需要构建。

## 用法

\`\`\`bash
# 把本目录内容拷到项目根（同名的现有文件请自行合并，不要盲目覆盖）
cp -r dist/agent-kit/. <你的项目>/
\`\`\`

或让 CLI 只针对项目里**已存在**的 agent 目录生成（更保守，不会凭空造目录）：

\`\`\`bash
node <框架目录>/cli/ai-arch.mjs install --root <你的项目>
\`\`\`

## 各工具的落点（逐个核实过官方文档）

| 工具 | 上下文/规则文件 | 技能目录 |
|---|---|---|
| Claude Code | \`.claude/CLAUDE.md\` | \`.claude/skills/<id>/SKILL.md\` |
| DeepSeek Harness | \`.dsh/AGENTS.md\` | \`.dsh/skills/<id>/SKILL.md\` |
| Cursor | \`.cursor/rules/*.mdc\`（含按 glob 自动附着的路径级规则） | \`.cursor/skills/\` 与 \`.agents/skills/\` |
| GitHub Copilot | \`.github/copilot-instructions.md\` + \`.github/instructions/*.instructions.md\`（\`applyTo\` 路径级） | —— |
| Gemini CLI | \`.gemini/GEMINI.md\` + 扩展 \`.gemini/extensions/ai-engineering-arch/\` | —— |
| Codex CLI | \`.codex/AGENTS.md\` | —— |
| WorkBuddy / Continue | \`.workbuddy/AGENTS.md\` / \`.continue/rules/ai-arch.md\` | —— |

**注意**：这些文件都只是**指针**——真正的知识在项目根 \`AGENTS.md\` 与 \`.ai/\`，由
\`ai-arch install\` 生成。只拷 kit 不跑 install，agent 会找不到被指向的文件。
`);
    return { dir: 'dist/agent-kit', files: files + 1 };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/* ------------------------------------- 5. Gemini CLI 扩展 */

function buildGeminiExtension() {
  const name = 'ai-engineering-arch';
  // 关键：Gemini CLI 要求 `name` 等于扩展目录名，因此目录就按扩展名命名
  // （而不是按产品名命名），这样用户可以直接整目录拷进 .gemini/extensions/。
  const root = path.join(dist, 'extensions', name);
  writeFile(path.join(root, 'gemini-extension.json'), JSON.stringify({
    name,
    version: pkg.version,
    contextFileName: 'GEMINI.md',
  }, null, 2) + '\n');
  writeFile(path.join(root, 'GEMINI.md'), `# AI 工程架构（Gemini CLI 扩展）

> 本扩展只做一件事：把项目入口指给 Gemini。**上下文与索引由 \`ai-arch install\` 生成到项目里。**

## 安装

目录名与 \`gemini-extension.json\` 的 \`name\` 一致（官方要求），因此可以整目录拷贝：

\`\`\`bash
# 项目级
mkdir -p <你的项目>/.gemini/extensions
cp -r <框架目录>/dist/extensions/${name} <你的项目>/.gemini/extensions/
# 用户级（对所有项目生效）
cp -r <框架目录>/dist/extensions/${name} ~/.gemini/extensions/
\`\`\`

## 上下文

- 仓库根的 \`AGENTS.md\` 是唯一入口，请先完整读取它。
- 索引与任务包在 \`.ai/\`：\`node .ai/bin/ai-arch.mjs task "<任务描述>"\` 生成读取清单。
- 规则集 \`.ai/rules.json\`；事实与可用能力 \`.ai/project-facts.json\`；红线与验证命令 \`.ai/constitution.md\`。
`);
  return { dir: `dist/extensions/${name}`, files: 2 };
}

/* ------------------------------------- 6. Cursor 插件（含规则与技能） */

function buildCursorPlugin() {
  const root = path.join(dist, 'plugins', 'cursor');
  const name = 'ai-engineering-arch';
  writeFile(path.join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({
    name,
    version: pkg.version,
    description: '把 AI 工程架构接入当前项目：分层上下文、文件索引与语义摘要、任务上下文包、项目规则与漂移检测。',
    author: { name: 'ugoith' },
    homepage: 'https://github.com/ugoith/General_AI_Engineering_Architecture',
    repository: 'https://github.com/ugoith/General_AI_Engineering_Architecture',
    license: 'MIT',
    keywords: ['ai-agents', 'architecture', 'context-engineering', 'agents-md'],
  }, null, 2) + '\n');
  writeFile(path.join(root, '.cursor-plugin', 'marketplace.json'), JSON.stringify({
    name: 'ai-engineering-arch',
    plugins: [{ name, source: '.' }],
  }, null, 2) + '\n');

  // 规则：入口规则（alwaysApply）+ 每个声明了 globs 的 skill 一条路径级规则
  writeFile(path.join(root, '.cursor', 'rules', 'ai-arch.mdc'), `---
description: 项目 AI 工程架构入口（指针）
alwaysApply: true
---

# 项目 AI 入口

先读仓库根的 \`AGENTS.md\`，再按它的路由表读文件。

- 本项目的规则集在 \`.ai/rules.json\`；事实与能力在 \`.ai/project-facts.json\`。
- 接入与索引说明：\`.ai/index/README.md\`；项目红线与验证命令：\`.ai/constitution.md\`。
- 接任务前先跑 \`node .ai/bin/ai-arch.mjs task "<任务描述>"\` 拿读取清单。
`);

  let n = 2;
  for (const id of SKILLS) {
    const text = fs.readFileSync(path.join(repo, 'skills', id, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    const globs = fm.match(/^globs:\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (!globs) continue; // 通用型技能交给 skills/ 目录发现，不做路径级注入
    const description = fm.match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? id;
    writeFile(path.join(root, '.cursor', 'rules', `ai-arch-${id}.mdc`), `---
description: "AI 工程架构 skill：${description}"
globs: "${globs}"
alwaysApply: false
---

# ${id}

> 路径级投影：完整内容见 \`.ai/skills/${id}/SKILL.md\`，不要在此复制正文。

改动匹配上述 glob 的文件前，先读该 skill 并按其步骤执行。项目规则集在 \`.ai/rules.json\`。
`);
    n += 1;
  }
  // 技能（Cursor 认 .cursor/skills 与 .agents/skills，这里给 .cursor/skills）
  n += copyDir(path.join(repo, 'skills'), path.join(root, '.cursor', 'skills'));

  writeFile(path.join(root, 'README.md'), `# AI 工程架构（Cursor 插件）

## 安装

\`\`\`bash
node scripts/dist.mjs
# 方式 A：作为本地插件目录（Cursor 插件市场/本地安装）
#   指向本目录即可
# 方式 B：直接拷进项目（最简，不依赖市场机制）
cp -r dist/plugins/cursor/.cursor <你的项目>/
\`\`\`

## 内容

- \`.cursor/rules/ai-arch.mdc\` —— 入口指针（\`alwaysApply: true\`，每次对话都带上）
- \`.cursor/rules/ai-arch-*.mdc\` —— **路径级规则**：只在处理匹配 \`globs\` 的文件时注入，
  避免把所有技能都塞进每次对话
- \`.cursor/skills/*/SKILL.md\` —— ${SKILLS.length} 个技能（Cursor 也认 \`.agents/skills/\`，
  用 CLI 的 \`ai-arch install\` 会两个目录都写）

## 还需要一步

规则与技能只是"怎么干活"；**项目上下文**（\`AGENTS.md\`、\`.ai/\` 索引与任务包）需要初始化：

\`\`\`bash
node <框架目录>/cli/ai-arch.mjs install --root .
\`\`\`
`);
  return { dir: 'dist/plugins/cursor', files: n + 3 };
}

/* ------------------------------------- 7. Copilot 指令包 */

function buildCopilotInstructions() {
  const root = path.join(dist, 'instructions', 'copilot');
  writeFile(path.join(root, 'copilot-instructions.md'), `# Copilot 指令（指针）

本项目的 AI 入口是仓库根的 \`AGENTS.md\`，请先读它再动手。

- 任务开始前先跑 \`node .ai/bin/ai-arch.mjs task "<任务描述>"\`，按它给出的读取清单读文件。
- 项目红线与验证命令：\`.ai/constitution.md\`；索引说明：\`.ai/index/README.md\`。
- 项目规则集：\`.ai/rules.json\`（含每条规则的判定方式）。
- 引擎/工具链能力与边界：\`.ai/project-facts.json\`。

> 针对特定文件类型的补充指令在 \`.github/instructions/\`（按 \`applyTo\` glob 自动生效）。
`);
  let n = 1;
  for (const id of SKILLS) {
    const text = fs.readFileSync(path.join(repo, 'skills', id, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    const globs = fm.match(/^globs:\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (!globs) continue;
    const description = fm.match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? id;
    const whenToUse = fm.match(/^whenToUse:\s*(.*)$/m)?.[1]?.trim() ?? '';
    writeFile(path.join(root, 'instructions', `${id}.instructions.md`), `---
applyTo: "${globs}"
---

# ${description}

> 路径级投影：完整内容见项目内 \`.ai/skills/${id}/SKILL.md\`，不要在此复制正文。

**何时适用**：${whenToUse}

改动匹配上述 glob 的文件前，先读该 skill 并按其步骤执行。项目规则集在 \`.ai/rules.json\`。
`);
    n += 1;
  }
  writeFile(path.join(root, 'README.md'), `# AI 工程架构（GitHub Copilot 指令包）

## 安装

\`\`\`bash
node scripts/dist.mjs
cp -r dist/instructions/copilot/.github <你的项目>/     # 合并，不要覆盖已有的 copilot-instructions.md
\`\`\`

## 内容

- \`.github/copilot-instructions.md\` —— 项目级指令（指针）
- \`.github/instructions/*.instructions.md\` —— **路径级指令**，frontmatter 的 \`applyTo\` 是
  逗号分隔的 glob；只在处理匹配文件时自动注入

## 还需要一步

\`\`\`bash
node <框架目录>/cli/ai-arch.mjs install --root .
\`\`\`
`);
  return { dir: 'dist/instructions/copilot', files: n + 1 };
}

/* ------------------------------------------------------------- 主流程 */

if (REPORT_ONLY) {
  process.stdout.write('分发物产出计划（源：一份 skills/，其余全部生成）\n\n');
  process.stdout.write(`  版本：${pkg.version}\n`);
  process.stdout.write(`  skill 数：${SKILLS.length}（${SKILLS.join('、')}）\n\n`);
  process.stdout.write('  1. dist/skills/                 标准 Agent Skills 包\n');
  process.stdout.write('     → DSH（项目 .dsh/skills/ 或用户级 skill 目录）、Claude Code、其它兼容工具\n');
  process.stdout.write('     要求：目录 bundle 内含 SKILL.md；frontmatter 有 name/description/whenToUse\n\n');
  process.stdout.write('  2. dist/plugins/claude-code/    Claude Code 插件\n');
  process.stdout.write('     → 要求：.claude-plugin/plugin.json（name 必填，kebab-case；version 语义化）\n');
  process.stdout.write('     技能从 ./skills/ 自动发现\n\n');
  process.stdout.write('  3. dist/plugins/dsh/            DeepSeek Harness bundle 插件\n');
  process.stdout.write('     → 要求：npm 包 + cordis.patch.yml；host 入口导出 name/inject/apply\n');
  process.stdout.write('     注册只读工具 + 随包 skills（未实测，见其 README）\n\n');
  process.exit(0);
}

fs.rmSync(dist, { recursive: true, force: true });
const results = [buildSkillsPack(), buildClaudePlugin(), buildDshPlugin(), buildCursorPlugin(), buildCopilotInstructions(), buildGeminiExtension()];
results.push(await buildAgentKit());
process.stdout.write(`分发物已产出（框架版本 ${pkg.version}，源 skill ${SKILLS.length} 个）：\n`);
for (const r of results) process.stdout.write(`  ${r.dir.padEnd(32)} ${r.files} 个文件\n`);
process.stdout.write('\n安装方式见各目录内的 README.md；跨工具一次装完用 dist/agent-kit/。\n');
