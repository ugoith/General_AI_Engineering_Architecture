# CLI 参考（ai-arch）

> 零依赖 Node CLI。两种运行方式：
> - **项目内（推荐）**：`node .ai/bin/ai-arch.mjs <命令>`（`init` 会把工具链复制进项目，离线可用）
> - **框架仓库内**：`node cli/ai-arch.mjs <命令>`（用于新建项目）

## 全局选项

| 选项 | 说明 |
|---|---|
| `--root <目录>` | 显式指定项目根（`index`/`doctor`/`upgrade`/`scale` 也可直接把项目目录作为首个位置参数；`task`/`review`/`skill` 的首个位置参数是业务内容，必须用 `--root`） |
| `--json` | 机器可读输出（供 AI 解析）；不得混入人类可读文本 |
| `--quiet` | 精简输出 |
| `-h, --help` / `-v, --version` | 帮助 / 版本 |

**不在项目内运行时的行为**：若未找到 `.ai/framework.json` 或 `.ai/constitution.md`，命令会明确报错并给出下一步命令，而不是静默按当前目录处理。

## `init` 生成的四类东西

| 类别 | 位置 | 说明 |
|---|---|---|
| AI 上下文 | `AGENTS.md`、`.ai/constitution.md`、`.ai/index/`、`.ai/registry.json`、`.ai/decisions/`、`.ai/tasks/` | **项目内容**，需要你填写与维护 |
| 任务知识 | `.ai/skills/<id>/` | 项目资产，可自由增删改；`upgrade` 不覆盖改过的文件 |
| 项目文档骨架 | `docs/**`（按模板包） | 需要填写的带格式骨架 |
| 框架只读快照 | `.ai/framework/docs/`、`.ai/framework/templates/`、`.ai/bin/`、`.ai/lib/` | **框架资产**：不进索引、不写摘要、不进任务读取清单；由 `upgrade` 维护 |

快照的意义：项目**离线可用**——`.ai/bin/ai-arch.mjs` 能在项目内直接运行 `index`/`task`/`review`/`upgrade`，`.ai/framework/docs/` 提供规范离线查阅，`.ai/framework/templates/` 让项目内也能执行 `init`/`upgrade`（两者需要模板）。

## 命令总览

| 命令 | 作用 | 主要产出 |
|---|---|---|
| `quickstart [--root <目录>]` | **生成可粘贴给 AI 的接入提示词**（自动识别项目类型、项目名、引擎版本） | stdout / `--json` |
| `install [--root <目录>]` | **一条命令接入**：识别类型 + 生成骨架 + 写 agent 指针 + 建基线索引 | 同 `init`，另加 `--json` 里的检测证据 |
| `install-shim [--bin <目录>] [--from <文件>]` | 把 `ai-arch` 装成命令（像 git 一样随处可用） | `<bin>/ai-arch(.cmd)` + `<bin>/ai-arch.mjs` |
| `init [dir] --pack <id>` | 用模板包初始化项目（已知类型时用） | 项目骨架 + `.ai/` 上下文体系 + 工具链副本 |
| `index` | 构建/更新文件索引 | `.ai/index/files.json` |
| `index --stale` | 列出待写摘要的文件，并输出 AI 提示词载荷 | stdout / `--json` |
| `index --apply <file>` | 把 AI 产出的摘要写回索引（校验 hash） | `.ai/index/files.json` |
| `task "<描述>"` | 生成任务上下文包 | `.ai/tasks/<日期>-<slug>.md` |
| `review --drift` | 规范漂移检测 | stdout / 退出码（`--strict`） |
| `review --task [<id>]` | **任务闭环**：任务包里的计划 vs 实际（前提失效 / 摘要回写 / 注册表同步 / 证据填写） | stdout / 退出码（`--strict`） |
| `review --impact <文件>` | 影响面分析 | 受影响文件、应跑测试、需同步的文档 |
| `review --decisions` | 列出所有 ADR | stdout |
| `scale` | 规模等级评估 | 等级结论 + 证据链 |
| `scale --gaps` | 列出当前等级要求的缺失文件 | stdout |
| `patterns` | 设计模式选择矩阵 | stdout / `--json` |
| `skill list\|show\|add` | 管理项目内任务知识 | `.ai/skills/<id>/` |
| `rules <list\|add\|audit>` | 项目规则：新增约束必须先入库并传播 | `.ai/rules.json` |
| `facts [refresh]` | 项目事实与可用能力（引擎版本、编辑器能力） | `.ai/project-facts.json` |
| `registry audit\|suggest` | 实体注册表（契约层）校验 + 值得登记的候选 | stdout / 退出码 |
| `doctor` | 项目健康检查 | stdout / 退出码 |
| `packs` | 列出可用模板包 | stdout / `--json` |
| `upgrade` | 同步框架文件到当前版本 | 四态报告；`--apply` 生效 |

## rules：新增约束的落地流程（入库 → 传播 → 验收）

开发中用户随时会加约束（"if 嵌套别太深""日志必须带 requestId"）。**只把这句话写进某处文档，它必然失效**：agent 下次读不到、评审时没人看、也没法判定是否遵守。因此新增约束走固定流程：

```bash
ai-arch rules add "if 嵌套深度不超过 3 层" \
  --category style --enforcement review \
  --check "评审时数嵌套层数，超过则要求提前 return 或抽函数" \
  --rationale "降低认知负担，if 深嵌套是缺陷高发区"
```

| 环节 | 机制 |
|---|---|
| **入库** | 写入 `.ai/rules.json`，分配稳定 ID（`R-001`…）；引用时只引 ID（对应"稳定标识"原则） |
| **传播** | CLI 输出精确的传播清单（宪法红线 / 影响矩阵 / 评审清单 / ADR / lint 配置），并**自动**写入 `.ai/index/impact-map.json`，使改动相关文件时 `review --impact` 会提醒复查 |
| **验收** | `enforcement` 三选一：`tool`（工具自动判定，最可靠，必须给可执行命令）/ `review`（评审时人工判定）/ `manual`（只能靠人，应尽量避免）；`--check` **必填** |
| **传播验收** | `rules audit` 会**搜索规则 ID 是否真的出现在**宪法 / 影响矩阵 / 评审清单里。只存在于 `rules.json` 的规则报 `rule-not-propagated`——"打印了传播清单"不等于"传播发生了" |

**两条硬规则**（CLI 强制）：

1. **判定不了的规则等于没有规则**——`statement` 含"整洁/合理/优雅/尽量"等不可判定措辞且无数字或禁止项时直接拒绝入库。
2. **新增约束必须先入库再改代码**——顺序反了，规则就只存在于这次对话里。

**存量违规迁移**：规则的 `debt` 字段记录已知违规清单；迁移期允许存在（`doctor` 报 info 级 `rules-debt`），但要有清账计划，`rules audit` 汇总。

**为什么规则会出现在任务包里**：任务包正文渲染 `## 1.5 项目规则` 小节并逐条列出，并带上 `rules.json` 的内容 hash。hash 变化即表示规则被改过，**下一次任务必须重读**——这是"规则在下次开工真的被看到"的唯一保证。

## facts：项目事实与可用能力

**新能力会改变"什么做法可行"**，所以这些事实必须落盘、可查询、可随探测更新，而不是散落在文档里靠人记。

```bash
ai-arch facts            # 查看（不存在则自动探测一次）
ai-arch facts refresh    # 重新探测（改引擎版本 / 启用插件后）
```

已知能力（声明式，见 `cli/lib/facts.mjs` 的 `CAPABILITIES`）：

| 能力 | 要求 | 能做什么 | **不能**做什么 |
|---|---|---|---|
| `unreal-mcp`（官方 Epic） | 引擎 **≥ 5.8** + `.uproject` 启用 `ModelContextProtocol`（需同时启用 AllToolsets） | 编辑器运行时调用工具：spawn/检查 actor、配置灯光、创建材质实例、检查 Slate 控件、跑自动化测试 | **不是**读取 `.uasset` 的通道；必须编辑器在跑；状态 Experimental（API 会变）；产出不入库 |
| `third-party-unreal-mcp` | 社区项目（非 Epic），使用前先写 ADR | 宣称低 token 蓝图读取与持久项目索引 | 非官方、需评估可持续性；其产物不能替代本项目的资产索引约定 |

官方文档：[Unreal MCP in Unreal Editor](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-mcp-in-unreal-editor)。

**这个区分是架构性的**：MCP 让 agent **驱动编辑器**，不等于能**读仓库里的资产**。因此 `.ai/index/asset-index.md` 仍然必要——它离线可读、可入库、可跨会话、不依赖编辑器状态。但"绝不整读资产"这条指导的**替代路径变了**：以前只能"请人在编辑器里看"，5.8+ 项目现在可以让 agent 通过 MCP 查。

`doctor` 会检查记录的事实是否与实测一致（引擎版本变了报 `facts-stale`），任务包会带上能力结论，避免 AI 用过期前提做判断。

## registry：契约层，索引给不出的那一半

**索引回答"文件在不在、内容变没变"；注册表回答"这个契约的语义是什么、什么必须恒成立"。** 两者职责不重叠，缺了后者就检不出**契约静默漂移**。

```bash
ai-arch registry audit      # 结构自检 + 与索引对账（默认子命令）
ai-arch registry suggest    # 列出值得优先登记的高风险 / 被多方依赖文件
```

`.ai/registry.json` 的每条实体：

| 字段 | 必填 | 作用 |
|---|---|---|
| `name` / `kind` | 是 | 稳定标识；`kind` ∈ `data-model`/`api`/`module`/`class`/`config`/`contract`/`asset` |
| `file` | 是 | 指向具体文件——没有它就无法与索引对账，漂移检测无从谈起 |
| `hash` | 强烈建议 | 索引里该文件 hash 的前 10 位。**没有它就只能靠人记得"改过要同步"** |
| `invariants` | 强烈建议 | 改它时必须保持什么。这是注册表存在的理由；只写名字等于没登记 |
| `tests` | 强烈建议 | 能发现不变量被破坏的测试文件。**没有测试引用的不变量只能靠人记得** |
| `signature` / `owner` | 否 | 对外签名、负责人 |

**为什么要记 hash**：注册表说实体 X 在 F、hash 为 H，而索引里 F 的 hash 已是 H′——机械可判定地说明"契约被改但注册表没同步"，后续 AI 会继续拿旧不变量做判断。这是 `review --drift` 的 `entity-hash-stale`（见 `docs/system/05-lifecycle.md` 第三节）。漂移报告会直接列出该实体声明的 `tests`，即"该重跑哪些测试"。

**为什么要记 tests**：不变量是"必须恒成立"的断言，而**没人能发现它被破坏**的断言就是文档里的一句话。所以"有 invariants 但没有 tests"会被 `registry audit` 指出——与"判定不了的规则等于没有规则"同一标准。它不检查测试写了什么（那判定不了），只保证**这条不变量至少有一个机械可执行的归属**。

**判定不了的条目等于没有条目**（与规则集同一标准）：缺 `invariants`、不变量写成"尽量合理"、缺 `tests`、缺 `hash`，都会被 `registry audit` 指出来。

**注册表为空不是错误，是欠账**：`registry audit` 在注册表为空时会以 info 报 `registry-empty` 并附上候选清单，避免这一层建了却永远不被用起来。

## 项目类型自动识别（`install` / `quickstart`）

依据"该类型必然存在的标记文件"，权重最高的信号决定类型；**多个引擎标记接近时返回"无法确定"并要求 `--pack`，不猜**。

| 信号 | 判定为 |
|---|---|
| `*.uproject` / `*.Build.cs` / `.uplugin` / `Content/` / `Plugins/` | `game-unreal` |
| `ProjectSettings/ProjectVersion.txt` / `*.asmdef` / `*.unity` / `Assets/` | `game-unity` |
| `project.godot` / `*.tscn` / `*.tres` / `scenes/` | `game-godot` |
| `package.json` 含 phaser/pixi/three/babylon 等引擎依赖 | `game-web` |
| `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `*.sln` | `software-app-medium` |

注意：`package.json` 的解析必须容忍 BOM（Windows 工具常写出带 BOM 的文件），否则"含游戏引擎依赖"这一信号会被静默丢弃。实现见 `cli/lib/detect.mjs`。

## agent 适配：核心在 `.ai/`，agent 目录只放指针

`install` 会在**项目里已存在**的 agent 目录下写一行指针（内容只有"去读 `AGENTS.md` 与 `.ai/`"）：

| agent | 写入位置 | 探测依据 |
|---|---|---|
| Claude Code | `.claude/CLAUDE.md` | `.claude/` 存在 |
| Cursor | `.cursor/rules/ai-arch.mdc` | `.cursor/` 存在 |
| Codex CLI | `.codex/AGENTS.md` | `.codex/` 存在 |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/` 存在 |
| WorkBuddy | `.workbuddy/AGENTS.md` | `.workbuddy/` 存在 |
| Continue | `.continue/rules/ai-arch.md` | `.continue/` 存在 |

规则：① 探测依据是 **agent 根目录**（不是嵌套子目录，否则判定永远为假——真实缺陷）；② 已存在且非框架生成的同名文件**绝不覆盖**，只报告；③ 生成的文件带统一标记，**可随时删除**；④ 不用 `--agent <id>` 时只处理已存在的目录，**不凭空造目录**；⑤ 刻意不碰 `.claude/settings.json` 这类用户配置。

**为什么不把核心放进这些目录**：会破坏工具无关性（换工具要搬家）、破坏 `AGENTS.md` 的仓库根发现约定、且这些目录常含"每机私有"内容（如被全局 gitignore 的 settings.local.json），团队无法共享。完整理由见 `docs/04-design-notes.md`。

## 单文件分发（`scripts/pack.mjs`）

```bash
node scripts/pack.mjs        # → dist/ai-arch.mjs + dist/ai-arch.cmd + dist/ai-arch
```

- `dist/ai-arch.mjs` 是**自包含单文件**：内联 `cli/` + `templates/` + `skills/` + `schema/` + `docs/system/`，约 600KB，运行时解包到 `~/.ai-arch/bundled/<版本>-<内容哈希>/`。
- **缓存键是内容哈希而不是版本号**：早期用版本号做键，导致"同一版本内改了行为"时继续用旧解包，新命令静默消失（真实故障）。
- 环境变量：`AI_ARCH_HOME`（改缓存位置）、`AI_ARCH_BUNDLE_ROOT`（打包版自用）、`AI_ARCH_SELF`（打包版指向自身，供 `install-shim` 复制）。
- 真 `.exe`（单文件可执行）需要 Node 的 SEA + postject，或 Node 26+ 的内建支持；本框架不引入该构建依赖，用"单 `.mjs` + 启动器"替代。

## 技能部署：装到 agent 自己的技能根目录才算数

`install` 除了写 `.ai/skills/`（框架内的副本），还会把技能复制到**每个 agent 自己的技能根目录**——
因为各 agent 都不会去 `.ai/skills/` 找技能，只放那里等于没装。落点**逐个对照官方文档核实过**：

| agent | 指针文件 | 技能根目录 | 路径级规则 | 依据 |
|---|---|---|---|---|
| Claude Code | `.claude/CLAUDE.md` | `.claude/skills/` | —— | 扫描项目/插件的 `skills/` |
| DeepSeek Harness | `.dsh/AGENTS.md` | `.dsh/skills/` | —— | `dsh-skill-filesystem`；**不支持嵌套 SKILL.md** |
| Cursor | `.cursor/rules/ai-arch.mdc` | `.cursor/skills/` **与** `.agents/skills/` | `.cursor/rules/ai-arch-<skill>.mdc`（`globs` + `alwaysApply: false`） | Cursor 同时认自己的 `.cursor/skills` 与跨工具约定的 `.agents/skills`；规则 frontmatter 为 `description`/`globs`/`alwaysApply` 三字段 |
| GitHub Copilot | `.github/copilot-instructions.md` | —— | `.github/instructions/<skill>.instructions.md`（`applyTo`） | 路径级指令靠 `applyTo` glob 自动附加 |
| Gemini CLI | `.gemini/GEMINI.md` + `.gemini/extensions/ai-engineering-arch/` | —— | —— | 扩展清单 `gemini-extension.json`，`name` **必须等于扩展目录名**，`contextFileName` 指向上下文文件 |
| Codex / WorkBuddy / Continue | 各自指针文件 | —— | —— | 只有单一上下文文件，无目录式技能 |

**只有声明了 `globs` 的 skill 才生成路径级规则**：通用型技能（如 `adr-writing`）与文件类型无关，
本就该全局可用；给它们编造 glob 只会制造噪音。

**技能 frontmatter 必须工具中立**（`scripts/validate.mjs` 强制）：

```yaml
---
name: code-review              # 必填，须等于目录名
description: 提交前评审与定期架构评审的可执行清单   # 必填
user-invocable: true           # 建议：允许用户直接点名调用
whenToUse: 提交前自查、评审他人改动、定期架构评审   # 必填
globs: "**/*.{ts,py,cs,cpp}"   # 可选：仅"文件类型/路径特定"的技能才写
---
```

**注意**：不要用自造键（例如 `when`）。DSH 的 skill 发现只认标准键，**键名不符会让整个 skill 被丢弃**
（不是静默放行）——这类"skill 装了但从不触发"的问题极难排查，因此校验器直接拦住。

## 分发给其它 agent：`scripts/dist.mjs`

一份源（`skills/`、`cli/`、`templates/`），产出七种目标形态：

```bash
node scripts/dist.mjs --report   # 先看将产出什么、各目标的要求
node scripts/dist.mjs            # 产出
```

| 产出 | 目标 | 形态与要求 |
|---|---|---|
| `dist/skills/` | 任何遵循 Agent Skills 标准的工具 | 纯目录 bundle，无构建步骤 |
| `dist/agent-kit/` | **跨工具一次装完** | 按各家目录约定组织好的整套文件，解包即用（由同一张适配表生成，不会与 `install` 漂移） |
| `dist/plugins/claude-code/` | Claude Code | `.claude-plugin/plugin.json`（`name` kebab-case、`version` 语义化、路径须 `./` 开头且禁 `../`）+ `skills/` |
| `dist/plugins/cursor/` | Cursor | `.cursor-plugin/plugin.json` + `marketplace.json`；规则 `.cursor/rules/*.mdc`；`skills/` |
| `dist/plugins/dsh/` | DeepSeek Harness | npm 包 + `cordis.patch.yml`（`insert` 一行，`name` 等于包名）；host 入口导出 `name`/`inject`/`apply` |
| `dist/instructions/copilot/` | GitHub Copilot | `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`（`applyTo`） |
| `dist/extensions/ai-engineering-arch/` | Gemini CLI | `gemini-extension.json` + `GEMINI.md`（目录名即扩展名） |

**为什么源只留一份、其余全部生成**：同一份知识复制成多套目录必然漂移。生成物不入库（`.gitignore` 忽略 `dist/`），
每次发布重建，因此不存在"改了源忘了改副本"。

**DSH 插件只暴露只读命令**（`doctor` / `task` / `rules` / `rules add` / `facts` / `review --drift`）：
初始化与升级会写文件，属于"需要人确认的动作"，不由模型直接触发。

### 验证（离线，不需要安装这些产品）

```bash
node scripts/verify-dist.mjs    # 七种分发物逐项对照各产品官方格式
node scripts/verify-dsh.mjs     # DSH 插件的深度冒烟（含真实执行与"不改动项目"断言）
```

`verify-dist` 检查：清单位置与字段名、取值格式（kebab-case / 语义化版本 / 相对路径规则）、
目录布局、指针可达性、frontmatter 标准键、以及**扩展名与目录名一致**这类容易忽略的官方要求。

`verify-dsh` 更进一步：把插件在最小 ctx 下 `apply()`，用真实临时项目逐个执行只读工具，
断言"除自声明产物外不改动任何项目文件"。

**已验证 / 未验证（如实说明）**：格式与离线行为已逐项验证（`verify-dist` 115 项、`verify-dsh` 61 项）；
**运行时的实际加载行为未验证**——本机没有安装这些产品。DSH 侧额外做了一步：
用 profile 的 `cordis.patch.yml` 以 file URL 挂载插件并跑 `dsh --profile <p> --dump-config`，
确认**加载器能解析该文件并把它组合进插件树**（零错误）。注意 `dsh plugin add` 会转发给 **pnpm**，
本机未安装 pnpm，因此正式安装路径（走包管理器）未实跑。

## init

```bash
node cli/ai-arch.mjs init ../my-game --pack game-unity --name my-game --unityVersion "6000.0 LTS"
node cli/ai-arch.mjs init . --pack software-app-medium --dry-run      # 只打印不写盘
node cli/ai-arch.mjs init . --pack software-cli-small --refresh       # 补齐缺失的框架文件，不覆盖已有
```

| 选项 | 说明 |
|---|---|
| `--pack <id>` | **必填**。见 `ai-arch packs` |
| `--name <slug>` | 项目名（默认取目录名并转 kebab-case） |
| `--description`、`--owner` | 写入变量 |
| `--<变量名> <值>` | 模板包声明的任意变量，例如 `--packageManager pnpm`、`--unityVersion "6000.0 LTS"` |
| `--src-dir`、`--tests-dir` | 覆盖源码/测试目录 |
| `--force` | 覆盖已存在文件（危险） |
| `--refresh` | 等价于 `--force`，用于补齐缺失文件 |
| `--dry-run` | 只显示将写入哪些文件 |

**不变量**：同输入重复执行结果一致；默认不覆盖已存在文件。

## index

```bash
node .ai/bin/ai-arch.mjs index                 # 更新 hash/行数/依赖关系
node .ai/bin/ai-arch.mjs index --stale         # 人看：待写摘要清单
node .ai/bin/ai-arch.mjs index --stale --json > .ai/cache/digest-request.json
node .ai/bin/ai-arch.mjs index --apply .ai/cache/digests.json
```

`files.json` 每条记录：

| 字段 | 含义 |
|---|---|
| `path` / `lang` / `loc` / `bytes` | 路径、语言、行数、字节数 |
| `hash` | 内容 SHA-256（用于判定是否需要重读） |
| `kind` | `text` 或 `binary-or-large`（后者不读内容） |
| `imports` / `importedBy` | 依赖与被依赖（用于影响面与任务包扩展） |
| `risk` | `low`/`medium`/`high`（CLI 初判，AI 可修正） |
| `digest` | 语义摘要：`purpose`/`exports`/`invariants`/`risk`/`tags`/`reviewedHash`/`stale` |

`summary` 里有两组行数，**不要混用**：

| 字段 | 含义 |
|---|---|
| `totalLoc` | **源行数**（不含 `.ai/`）——规模等级判定用这个（见 `02-scales.md`） |
| `contextLoc` / `contextFiles` | `.ai/` 下参与判定的上下文文件（宪法、规则、事实、注册表、影响矩阵、索引说明）的行数与个数 |

**哪些文件进索引**：源码与文本配置 + `.ai/` 里**参与判定**的上下文文件；框架快照（`.ai/framework`、`.ai/bin`、`.ai/lib`）、
任务包、技能副本、ADR 不进索引（判定线见 `04-context-discipline.md` 第一节.5）。上下文文件必须进索引，否则它们改了没有任何机制能发现。

**注意**：`index` 不生成语义摘要。摘要必须由 AI 阅读后产出（理由见 `04-context-discipline.md`）。

## task

```bash
node .ai/bin/ai-arch.mjs task "给登录接口加 token 刷新" --area src/auth --budget 30000
node .ai/bin/ai-arch.mjs task "修复存档丢失" --changed src/save/serialize.ts
node .ai/bin/ai-arch.mjs task "重构网络层" --json --out .ai/tasks/refactor-net.md
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `--budget` | 40000 | token 上限 |
| `--max-files` | 25 | 清单长度上限 |
| `--area <dir>` | 无 | 限定目录（大索引必用） |
| `--expand` | 1 | 依赖邻居扩展深度 |
| `--changed a,b` | 无 | 显式指定的变更文件（必进清单） |
| `--out <file>` | 自动命名 | 指定输出路径 |
| `--json` | 关 | 输出机器可读任务包（含完整摘要） |

## review

```bash
node .ai/bin/ai-arch.mjs review --task               # 收尾：本次任务的计划 vs 实际（默认取最近改动的任务包）
node .ai/bin/ai-arch.mjs review --task 2026-03-04-token-refresh   # 指定任务包
node .ai/bin/ai-arch.mjs review --task --strict      # CI / 提交门禁：有 error/warn 则退出码 1
node .ai/bin/ai-arch.mjs review --drift --strict     # CI：有 error/warn 则退出码 1
node .ai/bin/ai-arch.mjs review --impact src/api/user.ts --depth 2
node .ai/bin/ai-arch.mjs review --decisions
```

`--drift` 只能发现机械可判定的漂移；架构层面的评审清单在 `.ai/skills/code-review/SKILL.md`。

### `--task`：收尾为什么需要机械对账

任务包记录了"开工时我打算读什么、每个文件当时的 hash"。收尾时**只需要重新 hash 这些文件**（不做全树扫描），就能回答四个问题：

| 检查码 | 严重度 | 含义 | 为什么必须机械检出 |
|---|---|---|---|
| `task-premise-stale` | warn | 当时判定"hash 未变，只读摘要"的文件，现在内容变了**且摘要还是旧的** | 你据以决策的摘要已不是当前内容——这类错误最适合 AI 犯、也最难自查 |
| `task-index-stale` | warn | 索引里的 hash 还是旧的（本次改动没回写索引） | 下个任务会读到过期条目 |
| `task-digest-stale` | warn | 索引已刷新，但语义摘要对应的仍是旧内容 | 摘要没重写，等于用旧结论继续判断 |
| `task-entity-stale` | warn | 本次改到的契约，注册表里的 hash 未同步 | 后续 AI 会拿旧的不变量做判断（并列出该重跑哪些测试） |
| `task-evidence-missing` | warn | 任务包"证据"一节仍是占位符 | 完成定义要求贴**真实命令输出**，不接受"应该没问题" |
| `task-file-missing` / `task-file-unindexed` / `task-file-unhashed` | warn / info | 任务包列的文件没了、不在索引里、或当时没有 hash | 明说"对不了账"，不伪装成"没变" |
| `task-scope-missing` / `task-result-missing` | info | 范围 / 结果两节未填 | 任务包同时是交接文档 |
| `task-pack-missing` / `task-pack-not-found` | error | 没有任务包，或指定 id 不存在 | 没有"计划"就无所谓"计划与实际的差异" |

输出还包含三段**不用自己声称**的内容：

1. **验收标准**：`变更影响面已按 impact-map.json 更新`（注册表对账）与`索引摘要已同步`（hash 对账）由 CLI 判定，
   人读文档是否更新判定不了，标为 ⬜ 而不是假装 ✅。
2. **应运行的测试**：来自注册表声明的 `tests` 与依赖反查。措辞是"应运行"——**本命令不能证明测试跑过**，判定不了的不做。
3. **适用规则**：本次改动路径落在哪些规则范围内（带 `check`），逐条给结论；规则只在开工时出现一次是不够的。

## scale

```bash
node .ai/bin/ai-arch.mjs scale --contributors 6
node .ai/bin/ai-arch.mjs scale --gaps --json
```

四项取最高档：代码行数、模块数、参与人数、预期寿命。阈值与出处见 `02-scales.md`。

## patterns

```bash
node .ai/bin/ai-arch.mjs patterns --level M
node .ai/bin/ai-arch.mjs patterns --problem 缓存 --json
```

`--level` 过滤掉高于当前规模的模式，并输出该规模的禁止清单。

## skill

```bash
node .ai/bin/ai-arch.mjs skill list
node .ai/bin/ai-arch.mjs skill show code-review
node .ai/bin/ai-arch.mjs skill add change-impact
```

`.ai/skills/` 是**项目资产**：可以自由修改、增删，`upgrade` 不会覆盖被改动过的文件。

## doctor

```bash
node .ai/bin/ai-arch.mjs doctor --json
```

检查：必需文件、上下文预算、索引健康度、框架元数据、疑似密钥文件、误入库二进制。

## upgrade

```bash
node .ai/bin/ai-arch.mjs upgrade              # dry-run（默认安全）
node .ai/bin/ai-arch.mjs upgrade --apply
node .ai/bin/ai-arch.mjs upgrade --apply --force   # 用框架版本覆盖本地改动（危险）
```

三态：本地未改动 → 覆盖；本地已改动 → 保留并报告；命中 `protectedPatterns` → 跳过。

## 退出码约定

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 命令执行失败，或 `--strict` 下存在 error/warn |
| 2 | 用法错误（缺参数、未知命令） |

## 与 CI 集成（示例）

```yaml
# .github/workflows/ai-arch.yml（概念示例，可按需调整）
- run: node .ai/bin/ai-arch.mjs review --drift --strict
- run: node .ai/bin/ai-arch.mjs doctor
```

## 扩展 CLI

1. 新命令加在 `cli/lib/cli.mjs` 的分发与该命令函数里，同步更新 `USAGE`。
2. 若属于项目级命令，加入 `PROJECT_COMMANDS`。
3. 本文件补一节；`scripts/selftest.mjs` 补一条端到端用例（硬要求）。
4. `node scripts/validate.mjs && node scripts/selftest.mjs` 必须全绿。
