<div align="center">

# General AI Engineering Architecture

**一个通用的、AI 原生的工程级架构框架**

让 AI 与人类在任意项目上都做到：**不重复读文件、不从零搭架子、规范不会过期**

[快速开始](#快速开始) · [核心理念](#核心理念) · [解决什么问题](#它解决什么具体问题) · [项目类型](#可用的项目类型archetype) · [设计取舍](docs/04-design-notes.md)

</div>

---

## 这是什么

不是一个具体项目的架构，也不是某个语言的脚手架。

它定义**"一个项目应当如何被组织，才能让 AI 与人类都低成本、可追溯、可持续地推进"**，并以「复制式脚手架」交付：一条命令把规范体系、索引机制、项目骨架渲染进你的新项目（或既有项目）。

```
你的一个需求 → 读 15 个文件 → 写代码 → 跑测试 → 完成
下一次类似需求 → 又要读同样的 15 个文件？
                ↑ 本框架要消灭的就是这一步
```

## 它解决什么具体问题

| 痛点 | 机制 | 效果（实测） |
|---|---|---|
| **AI 每次都要重读相同文件，浪费上下文** | 文件级 `hash` + 语义摘要（digest）+ 任务上下文包 | 一个 320 行文件：整读 ≈ 3550 token，只读摘要 ≈ 52 token（**68 倍**）。复现命令：`node scripts/measure-digest.mjs` |
| **新项目/新类型每次从零再来** | 7 套 archetype 模板包 + 规模分级 + 模式选择矩阵 | `init` 一条命令得到完整骨架与 AI 上下文体系 |
| **需求与规模不匹配（小项目用重型模式）** | S/M/L/XL 规模门槛 + 禁止清单 + CLI 自动评估 | S 级允许的设计模式是**零个**（矩阵里所有模式 `minLevel ≥ M`），写死在规则里 |
| **规范随时间腐化，AI 照着过期文档干活** | 影响矩阵 + `review --drift` 机械检测 + 定期架构评审触发条件 | 摘要过期、文档断链、决策缺失都会被自动报出 |
| **"改完就忘"，没有交接材料** | 任务包同时是工作记录（范围/证据/遗留风险）+ ADR 决策记忆 | 接手成本从"读两天代码"降到分钟级 |
| **换 AI 工具/换人就要重来** | 一切知识落盘为纯文本 + AGENTS.md 开放标准 | 工具无关，Claude / Cursor / Copilot / 本地模型都能用 |

## 核心理念

### 1. 四层上下文，越靠上越贵

| 层 | 内容 | 何时读 | 预算（实测：`node scripts/measure-budget.mjs`） |
|---|---|---|---|
| L0 | `AGENTS.md`（指针，不是百科） | 每会话 | ≤ 130 行；软件类 ~1600 token，游戏类 ~1900–2050 |
| L1 | `.ai/constitution.md`（红线 + 验证命令） | 每会话 | ≤ 130 行；~1050–1690 token |
| L2 | `.ai/index/`、`.ai/registry.json`（索引/注册表） | 按需查询 | 按条目取，不整份读 |
| L3 | 源码 | 仅任务包列出的 | 由任务包预算控制（默认 40000 token） |

框架快照（`.ai/framework/`、`.ai/bin/`、`.ai/lib/`）是**只读框架资产**：不进索引、不写摘要、也不会出现在任务读取清单里——避免用框架自身的文件污染项目的上下文预算。

### 2. 文件摘要：省上下文的核心

```bash
node .ai/bin/ai-arch.mjs index --stale --json   # 产出一份"待写摘要"清单
# 让 AI 读清单里的源码，只输出 JSON 摘要（purpose / exports / invariants / risk）
node .ai/bin/ai-arch.mjs index --apply out.json # 回填，hash 不匹配会被拒绝
```

之后任务包对未变文件给出 `decision: read-digest` —— **明确告诉 AI：不要打开源码**。

### 3. 任务包：开工前先拿清单，而不是满仓库搜索

```bash
node .ai/bin/ai-arch.mjs task "给登录接口加 token 刷新，失败回落到重新登录"
```

产出 `.ai/tasks/2026-03-04-token-refresh.md`：必读、读取清单（含 hash/风险/token 估算/入选原因）、已知摘要正文、预算外丢弃清单、范围、验收标准、证据、遗留风险。

### 4. 规模先于设计模式

小项目引入 DI 容器、事件总线、CQRS 属于**缺陷**，不是优点。框架把禁止清单写死在规则里，并让 CLI 能自动评估、自动列出欠账：

```bash
node .ai/bin/ai-arch.mjs scale --gaps        # 我是什么规模？欠哪些作业？
node .ai/bin/ai-arch.mjs patterns --level M  # 这个规模允许/禁止什么模式
```

### 5. 规范必须有触发时机

规范腐化不是因为没人写，而是因为**没有触发时机**。框架把更新挂在三个必然发生的动作上：变更时（影响矩阵）、提交前（`review --drift`）、定期（评审触发条件）。

## 快速开始

### 场景 0：让 AI 自己装（推荐，无需你懂任何命令）

复制下面这段给任意 AI 编码助手（Claude / Cursor / Codex / Copilot / Gemini / DeepSeek Harness / 本地模型）：

```text
请为当前项目接入 General AI Engineering Architecture（一个 AI 工程架构框架）。
执行：npx -y github:ugoith/General_AI_Engineering_Architecture install --root .
（若 npx 不可用，改用：git clone https://github.com/ugoith/General_AI_Engineering_Architecture.git .ai-arch-framework
 然后 node .ai-arch-framework/cli/ai-arch.mjs install --root .）
然后告诉我：你识别到的项目类型与置信度、生成了哪些文件、哪些文件因为"项目原有"被拒绝改动，
以及 .ai/constitution.md 里还缺哪些验证命令需要我提供。不要覆盖我项目里已有的任何文件。
```

想让它更精确（含验收标准、硬约束、失败处理），直接生成一份针对**你这个项目**的提示词：

```bash
npx -y github:ugoith/General_AI_Engineering_Architecture quickstart --root .
```

`quickstart` 会自动探测项目类型、项目名、引擎版本，并把**当前版本的真实命令**写进提示词——所以你不必记住任何参数。

### 场景 1：一条命令接入（不需要克隆）

```bash
npx -y github:ugoith/General_AI_Engineering_Architecture install --root .
npx -y github:ugoith/General_AI_Engineering_Architecture install --root . --dry-run        # 先看会写什么
npx -y github:ugoith/General_AI_Engineering_Architecture install --root . --pack game-unity # 识别不准时指定
```

`install` = 自动识别项目类型 + 生成骨架 + 写各 agent 的指针与技能 + 建基线索引 + 探测项目能力。
已存在文件默认不动；**识别有冲突时拒绝猜**，要求 `--pack`。

### 场景 2：装成命令，像 git 一样随处可用

```bash
npx -y github:ugoith/General_AI_Engineering_Architecture install-shim   # 装到 ~/bin（不改系统 PATH）
ai-arch --version                                                        # 重开终端后即可直接用
```

### 场景 3：单文件分发（给别人用、离线可用）

```bash
node scripts/pack.mjs        # 产出 dist/ai-arch.mjs（~650KB，自包含）+ Windows/POSIX 启动器
```

`dist/ai-arch.mjs` 一个文件就够：内含全部 CLI、7 套模板、skills、schema 与规范快照，**零依赖、无需联网**。

```bash
node dist/ai-arch.mjs quickstart --root .     # 或 dist\ai-arch.cmd / ./dist/ai-arch
```

### 场景 4：给 AI 工具装插件/扩展（7 种形态，一份源）

```bash
node scripts/dist.mjs            # 产出全部分发物
node scripts/dist.mjs --report   # 先看将产出什么、各目标的要求
```

| 产出 | 目标 |
|---|---|
| `dist/agent-kit/` | **跨工具一次装完**：按各家目录约定组织好的整套文件，解包即用 |
| `dist/skills/` | 任何遵循 Agent Skills 标准的工具 |
| `dist/plugins/claude-code/` | Claude Code 插件 |
| `dist/plugins/cursor/` | Cursor 插件（规则 + 路径级规则 + 技能） |
| `dist/plugins/dsh/` | DeepSeek Harness 插件（注册只读工具） |
| `dist/instructions/copilot/` | GitHub Copilot 指令包（含 `applyTo` 路径级指令） |
| `dist/extensions/ai-engineering-arch/` | Gemini CLI 扩展 |

安装方式见各目录内的 `README.md`。

### 场景 5：新建项目 / 已知模板包

```bash
npx -y github:ugoith/General_AI_Engineering_Architecture packs      # 看有哪些类型
git clone https://github.com/ugoith/General_AI_Engineering_Architecture.git ~/ai-arch
node ~/ai-arch/cli/ai-arch.mjs init my-service --pack software-app-medium
```

### 场景 C：日常任务循环（这是收益所在）

```bash
# 1. 开工：拿任务包
node .ai/bin/ai-arch.mjs task "修复存档在切场景后丢失的问题" --area src/save

# 2. 把任务包交给 AI；它按清单读文件，不要满仓库搜索

# 3. 收尾：更新索引 + 补摘要 + 查漂移
node .ai/bin/ai-arch.mjs index
node .ai/bin/ai-arch.mjs index --stale
node .ai/bin/ai-arch.mjs review --drift
```

### 场景 D：改了接口/数据，想知道还影响什么

```bash
node .ai/bin/ai-arch.mjs review --impact src/api/user.ts --depth 2
```

## 可用的项目类型（archetype）

| id | 规模 | 适用 |
|---|---|---|
| `software-cli-small` | S | 小工具、CLI、一次性脚本 |
| `software-app-medium` | M | 多模块应用/服务 |
| `software-system-large` | L | 多模块系统（含契约与性能预算） |
| `game-unity` | M | Unity / C# 游戏（场景与预制体索引化） |
| `game-unreal` | M | Unreal / C++ + Blueprint |
| `game-godot` | M | Godot 4 / GDScript 或 C# |
| `game-web` | M | Web 游戏（Phaser/Pixi/Three/Babylon） |

每个模板包都针对该类型预置了：目录结构、`.ai/` 上下文体系、该类型必写的文档骨架、以及要加载的任务知识（skills）。
游戏类模板额外处理了**资产不可整读**的问题（`.ai/index/asset-index.md`），因为场景/蓝图/预制体整读会瞬间烧掉上下文。

选择方法见 [`docs/system/02-scales.md`](docs/system/02-scales.md)；新增自己的类型见 [`templates/_schema/pack.schema.md`](templates/_schema/pack.schema.md)。

## 目录结构

```
AGENTS.md              AI 入口（≤120 行指针：硬约束 + 路由表 + 提交前检查）
CLAUDE.md              Claude 系工具的转发入口
docs/                  面向人的文档
  system/              规范正文（唯一事实来源）
  *.md                 采用指南、实战、FAQ、设计取舍
templates/             生成到用户项目的文件
  base/                所有项目通用
  archetypes/<id>/     各类型专项（pack.json + files/ + docs/）
  shared/              共享片段（{{> SHARED:name}}）
skills/                任务知识（评审/ADR/排障/引擎约定…）
schema/                机器可读契约（JSON Schema）
cli/                   零依赖 Node CLI
scripts/               validate.mjs（结构校验）+ selftest.mjs（端到端自测）
```

## 命令一览

| 命令 | 作用 |
|---|---|
| `quickstart [--root <目录>]` | **生成可粘贴给 AI 的接入提示词**（自动识别项目类型） |
| `install [--root <目录>]` | **一条命令接入**：识别类型 + 生成骨架 + 写 agent 指针 + 建索引 |
| `install-shim [--bin <目录>]` | 把 `ai-arch` 装成命令（像 git 一样随处可用） |
| `init [dir] --pack <id>` | 用指定模板包初始化（已知类型时用） |
| `index` / `index --stale` / `index --apply <file>` | 维护文件索引与语义摘要 |
| `task "<描述>"` | 生成任务上下文包 |
| `review --drift` / `--impact <文件>` / `--decisions` | 漂移检测 / 影响面 / 决策清单 |
| `scale` / `scale --gaps` | 规模评估与欠账 |
| `patterns` | 设计模式选择矩阵（含禁止清单） |
| `skill list\|show\|add` | 管理项目内任务知识 |
| `doctor` | 项目健康检查 |
| `packs` | 列出可用模板包 |
| `upgrade` | 同步框架文件到当前版本（四态，默认 dry-run） |

详见 [`docs/system/07-cli.md`](docs/system/07-cli.md)。

## 与 AI 工具的关系：`.ai/` 是唯一事实来源，agent 目录只放指针

接入时会**只在你已经在用的 agent 目录**下写一行指针文件（`.claude/CLAUDE.md`、`.cursor/rules/`、`.codex/AGENTS.md`、`.github/copilot-instructions.md`、`.workbuddy/AGENTS.md`、`.continue/rules/`），内容只有"去读 `AGENTS.md` 与 `.ai/`"。这些文件**可随时删除**，项目原有同名文件**绝不覆盖**。

**为什么不把核心放进 `.claude/`、`.workbuddy/` 这类目录**（这是一个刻意的架构决定）：

| 理由 | 具体后果 |
|---|---|
| 会破坏 **工具无关** | 换 AI 工具时索引、任务包、ADR 全部要搬家；而这套架构最有价值的部分就是跨会话、跨工具的记忆 |
| 破坏 **发现约定** | `AGENTS.md` 在仓库根是行业标准（[agents.md](https://agents.md)），各工具会话启动时自动加载；塞进子目录后多数工具不会自动发现 |
| 语义是 **每机私有** | 例如 `.claude/settings.local.json` 通常被全局 gitignore；把团队知识放进去，同事看到的项目记忆都不一样 |

所以：**核心在 `.ai/`（入库、工具无关），各工具目录只放一行指针（可删、可再生）**。这既满足"目录简洁"的诉求，也不牺牲可移植性。

## 为什么是"复制式脚手架"

`init` 把框架文件**真实复制**进你的项目，而不是用 submodule 挂载：

- 项目可以自由改写框架文件（真实项目总有例外）；
- 框架升级用 `upgrade` 一条命令，且**不会覆盖你改动过的文件**（三态处理：未改动→覆盖，已改动→保留并报告，受保护→跳过）；
- 不污染你的 git 历史，对非 git 团队、zip 交付、AI 直接读文件都友好。

取舍的完整说明见 [`docs/04-design-notes.md`](docs/04-design-notes.md)。

## 常见疑问

- **这和 `AGENTS.md` / spec-kit / llms.txt 有什么关系？** 本框架建立在 `AGENTS.md` 开放标准之上，并补齐了它明确不覆盖的部分：索引与增量读取、规模分级、模式门槛、规范演进机制。对比见 [`docs/06-faq.md`](docs/06-faq.md)。
- **会不会太重？** S 级项目的全套流程就是 README + `AGENTS.md` + 验证命令；重流程只在高规模等级才强制。
- **没有 AI 工具能用吗？** 能。索引、任务包、影响矩阵本身对人也有效（它们就是"可检索的项目记忆"）。

更多见 [`docs/06-faq.md`](docs/06-faq.md)。

## 参与贡献

1. 先读 [`AGENTS.md`](AGENTS.md) 与 [`docs/system/01-constitution.md`](docs/system/01-constitution.md)（硬约束在这里）。
2. 改动前查 [`docs/system/09-change-protocol.md`](docs/system/09-change-protocol.md) 的影响矩阵。
3. 提交前必须：

```bash
node scripts/validate.mjs && node scripts/selftest.mjs
```

两条都通过才算完成。新增命令/模板包都必须在 `selftest.mjs` 里补端到端用例。

## 许可

MIT
