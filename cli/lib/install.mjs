/**
 * 面向 agent 的接入通道：`quickstart`（可粘贴提示词）与 `install`（一条命令接入）。
 *
 * 设计要点（见 docs/system/07-cli.md）：
 *  1. **提示词是主入口**：用户把提示词粘给任意 agent，agent 自己判断项目类型并接入。
 *  2. **agent 目录只放指针**：`.ai/` 是单一事实来源（入库、工具无关）；
 *     `.claude/`、`.cursor/`、`.github/copilot-instructions.md` 等只放"指向 .ai/ 的一行指针"，
 *     可随时删除，且**只在对应目录已存在时才写**（不凭空造目录）。
 *     为什么不把核心放进这些目录：会破坏工具无关性、破坏 AGENTS.md 的根目录发现约定、
 *     且 `.claude/settings.local.json` 这类是"每机私有"语义（git 不共享给同事）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { exists, isDir, isFile, normalizeRel, ensureDir, walk, readJsonSafe } from './fsx.mjs';
import { detectPack, suggestProjectName, suggestEngineVersion } from './detect.mjs';
import { frameworkRoot, frameworkVersion, templatesDir } from './framework.mjs';
import { listPacks } from './pack.mjs';
import { initProject, readManaged } from './scaffold.mjs';

/** 生成的适配文件的统一标记：让用户敢删、让工具知道它是派生物。 */
export const ADAPTER_MARK = (agent) =>
  `<!-- 由 ai-arch 安装时生成（agent 适配指针）。可随时删除：删除后本文件指向的 .ai/ 仍然有效。 -->`;

/**
 * agent 目录适配表。
 *
 * 字段含义：
 *  - `detectDir`：**用于探测项目是否在用这个 agent** 的目录（必须是 agent 的根目录，且不能是嵌套子目录，
 *     否则"目录已存在才写"的判定永远为假——真实故障：`.cursor/rules` 这种子目录导致探测失败）。
 *  - `file`：实际写入的相对路径（agent 约定的规则文件位置）。
 *  - `body`：指针正文（只有"去读 AGENTS.md 与 .ai/"的指示，不复制知识）。
 *
 * 注意：刻意**不**生成 `.claude/settings.json`——那属于用户的 agent 配置，框架不应改。
 */
export const AGENT_ADAPTERS = [
  {
    id: 'claude',
    label: 'Claude Code',
    detectDir: '.claude',
    file: '.claude/CLAUDE.md',
    body: () => `# CLAUDE.md

本项目的唯一 AI 入口是仓库根目录的 [\`AGENTS.md\`](../AGENTS.md)。请先完整读取它，再按其"工作路由"表决定后续读哪些文件。

- 工程规范权威：\`AISpec/spec/rules.json\`（人读版 \`AISpec/spec/CORE.md\`）；本项目的红线与验证命令在 \`.ai/constitution.md\`。
- 索引与任务包在 \`.ai/\`：先用 \`node .ai/bin/ai-arch.mjs task "<任务描述>"\` 拿读取清单，不要满仓库搜索。
- 本文件只是指针，不要在这里写知识（知识放 \`.ai/\`，见 \`.ai/index/README.md\`）。
`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    detectDir: '.cursor',
    file: '.cursor/rules/ai-arch.mdc',
    body: () => `---
description: 项目 AI 工程架构入口（指针）
alwaysApply: true
---

# 项目 AI 入口

先读仓库根的 \`AGENTS.md\`，再按它的路由表读文件。

- 工程规范权威：\`AISpec/spec/rules.json\`（人读版 \`AISpec/spec/CORE.md\`）。
- 接入与索引说明：\`.ai/index/README.md\`；项目红线与验证命令：\`.ai/constitution.md\`。
- 接任务前先跑 \`node .ai/bin/ai-arch.mjs task "<任务描述>"\` 拿读取清单。

本文件是指针，不要在这里复制知识。
`,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    detectDir: '.codex',
    file: '.codex/AGENTS.md',
    body: () => `# AGENTS.md（Codex 指针）

仓库根的 \`AGENTS.md\` 是唯一入口，请先完整读取它。

- 索引与任务包在 \`.ai/\`：\`node .ai/bin/ai-arch.mjs task "<任务描述>"\` 生成读取清单。
- 工程规范权威：\`AISpec/spec/rules.json\`；项目红线与验证命令：\`.ai/constitution.md\`。
`,
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    detectDir: '.github',
    file: '.github/copilot-instructions.md',
    body: () => `# Copilot 指令（指针）

本项目的 AI 入口是仓库根的 \`AGENTS.md\`，请先读它再动手。

- 任务开始前先跑 \`node .ai/bin/ai-arch.mjs task "<任务描述>"\`，按它给出的读取清单读文件，不要全仓库搜索。
- 项目红线、验证命令：\`.ai/constitution.md\`；索引说明：\`.ai/index/README.md\`。
- 工程规范权威：\`AISpec/spec/rules.json\`。
`,
  },
  {
    id: 'workbuddy',
    label: 'WorkBuddy',
    detectDir: '.workbuddy',
    file: '.workbuddy/AGENTS.md',
    body: () => `# AGENTS.md（WorkBuddy 指针）

本项目的 AI 入口是仓库根的 \`AGENTS.md\`，请先读它。

- 索引 / 任务包 / 决策记录都在 \`.ai/\`（工具无关，不要搬进本目录）。
- 接任务：\`node .ai/bin/ai-arch.mjs task "<任务描述>"\`。
`,
  },
  {
    id: 'continue',
    label: 'Continue',
    detectDir: '.continue',
    file: '.continue/rules/ai-arch.md',
    body: () => `# 项目 AI 入口（指针）

先读仓库根的 \`AGENTS.md\`。

- 接任务前跑 \`node .ai/bin/ai-arch.mjs task "<任务描述>"\`，按读取清单读文件。
- 红线与验证命令：\`.ai/constitution.md\`；工程规范权威：\`AISpec/spec/rules.json\`。
`,
  },
];

/** 探测项目里已存在的 agent **目录名**（给提示词用）。 */
export function detectAgents(root) {
  return AGENT_ADAPTERS
    .filter((a) => isDir(path.join(root, a.detectDir)))
    .map((a) => a.id);
}

/** 探测项目里已存在的 agent 适配器对象（给写入逻辑用）。 */
function presentAdapters(root) {
  return AGENT_ADAPTERS.filter((a) => isDir(path.join(root, a.detectDir)));
}

/**
 * 生成 agent 适配指针。**只写**：
 *  - 用户显式指定的 agent（`--agent claude`）
 *  - 或 `auto`/`all` 时项目里**已存在**对应目录的 agent
 * 已存在且内容非本框架生成的文件一律不动（项目原有文件优先级最高）。
 */
export function writeAgentAdapters(root, { agents = 'auto', dryRun = false, aiDir = '.ai' } = {}) {
  const all = AGENT_ADAPTERS;
  let targets;
  if (agents === 'all') targets = all;
  else if (agents === 'auto') targets = presentAdapters(root);
  else {
    const wanted = String(agents).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((id) => !all.some((a) => a.id === id));
    if (unknown.length > 0) {
      throw new Error(`未知 agent：${unknown.join(', ')}。可用：${all.map((a) => a.id).join(', ')}`);
    }
    // 显式指定时即使目录不存在也写（用户明确要求），但会提示
    targets = all.filter((a) => wanted.includes(a.id));
  }

  const written = [];
  const skipped = [];
  const refused = [];
  for (const agent of targets) {
    const abs = path.join(root, agent.file);
    const body = `${ADAPTER_MARK(agent.id)}\n${agent.body({ aiDir })}`;
    if (isFile(abs)) {
      const current = fs.readFileSync(abs, 'utf8');
      if (current.includes('由 ai-arch 安装时生成')) {
        if (current === body) { skipped.push(agent.file); continue; }
        if (!dryRun) fs.writeFileSync(abs, body, 'utf8');
        written.push(agent.file);
        continue;
      }
      // 项目里已有的同名文件（例如项目自己写的 CLAUDE.md）→ 绝不覆盖
      refused.push(agent.file);
      continue;
    }
    if (!dryRun) {
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, body, 'utf8');
    }
    written.push(agent.file);
  }
  return { written, skipped, refused, detected: detectAgents(root) };
}

/** 项目内可用的接入命令（写进提示词，保证 agent 拿到的是当前版本的真实命令）。 */
export function installCommandFor(frameworkDir, projectRoot) {
  const rel = path.relative(projectRoot, frameworkDir);
  const isInside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  const fw = isInside ? normalizeRel(rel) : frameworkDir;
  const quoted = /\s/.test(fw) ? `"${fw}"` : fw;
  const sep = path.sep === '\\' ? '\\' : '/';
  return `node ${quoted}${sep}cli${sep}ai-arch.mjs install --root .`;
}

/**
 * 把启动器装进用户 bin 目录，让 `ai-arch` 像 `git` 一样在任何目录可用。
 *
 * 装到用户目录（不是系统目录），因此不需要管理员权限；只新增文件，失败可手删。
 * 注意：**不改 PATH**——那是用户的系统配置，只告诉用户该怎么加。
 */
export function installShim({ binDir = null, dryRun = false, source = null } = {}) {
  const win = process.platform === 'win32';
  const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
  const target = binDir || path.join(home, 'bin');

  // 两种来源：
  //  - 单文件分发版（scripts/pack.mjs 的产物）：`ai-arch.mjs` 自包含，复制这一个文件即可
  //  - 源码仓库：入口 `cli/ai-arch.mjs` 依赖同级的 `cli/lib/`，必须**保留目录结构**一起复制
  //    （真实故障：只复制入口文件 → 运行时找不到 lib）
  const bundled = source ? path.resolve(source) : null;
  const repoEntry = path.join(frameworkRoot(), 'cli', 'ai-arch.mjs');
  const usingBundle = bundled && isFile(bundled);
  const payloadSrc = usingBundle ? bundled : repoEntry;
  if (!isFile(payloadSrc)) {
    return { ok: false, error: `找不到 CLI 入口：${payloadSrc}` };
  }

  const payloadDest = path.join(target, 'ai-arch.mjs');
  const shimDest = path.join(target, win ? 'ai-arch.cmd' : 'ai-arch');
  const written = [];
  const copies = [];

  if (usingBundle) {
    copies.push({ from: payloadSrc, to: payloadDest });
  } else {
    // 复制 cli/ 整棵树到 <bin>/.ai-arch/cli/，入口放 <bin>/ai-arch.mjs 并指向它。
    // 同时复制 package.json：frameworkVersion() 从它读版本号，缺了会显示 0.0.0。
    const cliRoot = path.join(frameworkRoot(), 'cli');
    for (const abs of listTree(cliRoot)) {
      const rel = normalizeRel(path.relative(cliRoot, abs));
      if (rel === 'ai-arch.mjs') continue;
      copies.push({ from: abs, to: path.join(target, '.ai-arch', 'cli', rel) });
    }
    const pkgFile = path.join(frameworkRoot(), 'package.json');
    if (isFile(pkgFile)) {
      copies.push({ from: pkgFile, to: path.join(target, '.ai-arch', 'package.json') });
    }
  }
  written.push(payloadDest, shimDest);

  if (!dryRun) {
    ensureDir(target);
    for (const c of copies) {
      ensureDir(path.dirname(c.to));
      fs.copyFileSync(c.from, c.to);
    }
    if (usingBundle) {
      fs.copyFileSync(payloadSrc, payloadDest);
    } else {
      // 入口用一层转发，避免把仓库路径写死（换目录后仍可用）
      fs.writeFileSync(payloadDest, [
        '#!/usr/bin/env node',
        '// ai-arch —— 由 `ai-arch install-shim` 生成。可随时删除。',
        "import { pathToFileURL, fileURLToPath } from 'node:url';",
        "import path from 'node:path';",
        'const here = path.dirname(fileURLToPath(import.meta.url));',
        "const cli = await import(pathToFileURL(path.join(here, '.ai-arch', 'cli', 'lib', 'cli.mjs')).href);",
        'process.exitCode = await cli.main(process.argv.slice(2));',
        '',
      ].join('\n'), 'utf8');
    }
    const shim = win
      ? [
        '@echo off',
        'rem ai-arch —— 由 `ai-arch install-shim` 生成。可随时删除。',
        'setlocal',
        'set "PAYLOAD=%~dp0ai-arch.mjs"',
        'if not exist "%PAYLOAD%" (echo [ai-arch] 找不到载荷：%PAYLOAD% & exit /b 1)',
        'node "%PAYLOAD%" %*',
        'exit /b %ERRORLEVEL%',
      ].join('\r\n') + '\r\n'
      : '#!/bin/sh\n# ai-arch —— 由 `ai-arch install-shim` 生成。可随时删除。\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/ai-arch.mjs" "$@"\n';
    fs.writeFileSync(shimDest, shim, 'utf8');
    if (!win) { try { fs.chmodSync(shimDest, 0o755); } catch { /* ignore */ } }
  }

  const pathEntries = (process.env.PATH || '')
    .split(path.delimiter).map((p) => p.replace(/[\\/]+$/, '').toLowerCase());
  const onPath = pathEntries.includes(target.replace(/[\\/]+$/, '').toLowerCase());

  return {
    ok: true, target, written, files: copies.length + (usingBundle ? 1 : 1), onPath, dryRun, platform: process.platform, mode: usingBundle ? 'bundle' : 'repo',
  };
}

/** 递归列出一个目录下的全部文件（绝对路径）。 */
function listTree(dir) {
  const out = [];
  if (!isDir(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTree(abs));
    else out.push(abs);
  }
  return out;
}

/**
 * 生成可粘贴给 agent 的提示词。
 * @param {{projectRoot: string, frameworkDir: string, agent?: string, target?: string}} opts
 */
export function buildQuickstartPrompt(opts) {
  const {
    projectRoot, frameworkDir, agent = null, target = null,
  } = opts;

  const fileList = walk(projectRoot, {}).files.map((f) => normalizeRel(f));
  const detection = target ? { packId: target, confidence: 'explicit', evidence: ['由 --pack 指定'], candidates: [] } : detectPack(projectRoot, fileList);
  const name = suggestProjectName(projectRoot, fileList);
  const engine = suggestEngineVersion(projectRoot, fileList);
  const agentsPresent = detectAgents(projectRoot);

  const packList = listPacks().map((p) => `${p.id}（${p.scaleLevel} ${p.title}）`).join('、');
  const version = frameworkVersion();

  const lines = [];
  lines.push('# 把 AI 工程架构接入本项目');
  lines.push('');
  lines.push(`请为当前项目接入 \`General AI Engineering Architecture\`（框架版本 ${version}）。`);
  lines.push('');
  lines.push('## 这个框架做什么（30 秒理解）');
  lines.push('');
  lines.push('- 它给项目装一套 **AI 上下文体系**：分层入口（`AGENTS.md` → `.ai/constitution.md` → `.ai/index/` → 源码）、文件索引与语义摘要、任务上下文包、决策记录（ADR）、漂移检测。');
  lines.push('- 目的是让你（agent）**不必每次重读同样的文件**：hash 未变的文件只读摘要即可（实测 320 行文件从 ~3550 token 降到 ~52 token）。');
  lines.push('- 它还会按项目规模（S/M/L/XL）给出"允许与禁止的架构做法"，避免小项目被塞进重架构。');
  lines.push('');
  lines.push('## 你要做的事');
  lines.push('');
  lines.push('### 第 1 步：跑安装命令（一条命令，不要手工创建目录）');
  lines.push('');
  lines.push('```bash');
  lines.push(installCommandFor(frameworkDir, projectRoot));
  lines.push('```');
  lines.push('');
  lines.push('如果框架不在本机，先取一份（二选一）：');
  lines.push('');
  lines.push('```bash');
  lines.push('# 方式 A：已有本地副本');
  lines.push(`#   框架目录：${frameworkDir}`);
  lines.push('# 方式 B：从 GitHub 取');
  lines.push('git clone https://github.com/ugoith/General_AI_Engineering_Architecture.git .ai-arch-framework');
  lines.push('node .ai-arch-framework/cli/ai-arch.mjs install --root .');
  lines.push('```');
  lines.push('');
  lines.push('### 第 2 步：报告你识别到的项目类型，等我确认');
  lines.push('');
  if (detection.packId) {
    lines.push(`我检测到本项目像 **${detection.packId}**（置信度 ${detection.confidence}）。依据：`);
    for (const e of detection.evidence.slice(0, 6)) lines.push(`- ${e}`);
  } else {
    lines.push('我无法确定项目类型，请从下面的模板包里选一个（或告诉我实际情况）：');
    if (detection.conflict) lines.push(`- 检测到多个引擎标记冲突：${detection.conflict.join(' / ')}`);
  }
  lines.push('');
  lines.push(`可选模板包：${packList}`);
  lines.push('');
  lines.push(`建议项目名：\`${name}\`${engine ? `；建议引擎版本参数：\`--${engine.key} ${engine.value}\`` : ''}`);
  lines.push('');
  lines.push('如果识别正确，命令是：');
  lines.push('');
  lines.push('```bash');
  lines.push(`node <框架目录>/cli/ai-arch.mjs install --root . --pack ${detection.packId ?? '<pack-id>'} --name ${name}${engine ? ` --${engine.key} "${engine.value}"` : ''}`);
  lines.push('```');
  lines.push('');
  lines.push('### 第 3 步：安装后必须做的三件事（不要跳过）');
  lines.push('');
  lines.push('1. **填 `.ai/constitution.md` 的验证命令**——这是你自证"任务完成"的唯一依据。不知道命令就问用户，不要猜、不要写"看起来没问题"。');
  lines.push('2. **建立基线索引**：`node .ai/bin/ai-arch.mjs index`。');
  lines.push('3. **为高风险文件写摘要**（收益最大的一步）：');
  lines.push('');
  lines.push('```bash');
  lines.push('node .ai/bin/ai-arch.mjs index --stale --json > .ai/cache/digest-request.json');
  lines.push('# 读该清单列出的源码，产出 JSON 数组（字段见 .ai/skills/context-indexing/SKILL.md）');
  lines.push('node .ai/bin/ai-arch.mjs index --apply .ai/cache/digests.json');
  lines.push('```');
  lines.push('');
  lines.push('先做 `risk: high` 的文件，通常 10–20 个就够；**不要一次给几百个文件写摘要**。');
  lines.push('');
  lines.push('## 硬约束（安装时必须遵守）');
  lines.push('');
  lines.push('- **不要覆盖项目原有文件**：框架的 `install`/`init` 默认拒绝触碰它没创建过的文件（包括 `.gitignore`）。看到"项目原有文件，框架拒绝触碰"就跳过，不要用 `--force` 硬来。');
  lines.push('- **核心放在 `.ai/`**，不要搬进 `.claude/`、`.cursor/`、`.workbuddy/` 等目录。原因：那些目录是工具私有的，搬进去会让索引与决策记录无法在团队间共享、也会让项目绑定单一工具。');
  if (agentsPresent.length > 0) {
    lines.push(`- **agent 目录只放指针**：本项目已检测到 ${agentsPresent.map((a) => '.' + a).join('、')}，框架只在这些目录下写一行指向 \`AGENTS.md\` 与 \`.ai/\` 的指针文件，且绝不覆盖同名已有文件。`);
  } else {
    lines.push('- **agent 目录只放指针**：框架只在**已存在**的 agent 目录（`.claude/`、`.cursor/`、`.codex/`、`.github/`、`.workbuddy/`、`.continue/`）下写一行指向 `AGENTS.md` 与 `.ai/` 的指针文件，不会凭空创建目录，也绝不覆盖同名已有文件。');
  }
  lines.push('- **不要在 `AGENTS.md` 里堆知识**：它是 ≤140 行的指针（硬约束 + 路由表 + 提交前检查），知识放 `.ai/` 与 `docs/`。');
  lines.push('- 环境要求：Node.js >= 18（框架零依赖、离线可用、跨平台）。');
  lines.push('');
  lines.push('## 验收标准（做完请逐条报告）');
  lines.push('');
  lines.push('- [ ] `node .ai/bin/ai-arch.mjs doctor` 无 error');
  lines.push('- [ ] `.ai/index/files.json` 已生成且只含文本文件（生成物目录已被忽略）');
  lines.push('- [ ] `.ai/constitution.md` 的"验证命令"一节已填入**真实可执行**命令（或明确标注待用户提供）');
  lines.push('- [ ] 已用 `node .ai/bin/ai-arch.mjs task "<一个真实任务>"` 试生成过一次任务包');
  lines.push('- [ ] 报告里写清：识别到的类型、置信度、生成了哪些文件、哪些被拒绝、以及你没能确定的地方');
  lines.push('');
  lines.push('## 这个框架的边界（避免误用）');
  lines.push('');
  lines.push('- 它不生成业务代码、不做代码检索（没有向量库）、不改你的源码、不自动提交 git。它只做三件事：生成骨架、维护索引、检测漂移。');
  lines.push('- `install` 产生的 diff 应当**单独提交**，便于整体回退。');
  return lines.join('\n');
}
