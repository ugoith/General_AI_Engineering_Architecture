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
| `review --impact <文件>` | 影响面分析 | 受影响文件、应跑测试、需同步的文档 |
| `review --decisions` | 列出所有 ADR | stdout |
| `scale` | 规模等级评估 | 等级结论 + 证据链 |
| `scale --gaps` | 列出当前等级要求的缺失文件 | stdout |
| `patterns` | 设计模式选择矩阵 | stdout / `--json` |
| `skill list\|show\|add` | 管理项目内任务知识 | `.ai/skills/<id>/` |
| `rules <list\|add\|audit>` | 项目规则：新增约束必须先入库并传播 | `.ai/rules.json` |
| `facts [refresh]` | 项目事实与可用能力（引擎版本、编辑器能力） | `.ai/project-facts.json` |
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
因为 Claude Code 与 DSH 都不会去 `.ai/skills/` 找技能，只放那里等于没装。

| agent | 指针文件 | 技能根目录 | 依据 |
|---|---|---|---|
| Claude Code | `.claude/CLAUDE.md` | `.claude/skills/<id>/SKILL.md` | 扫描项目/插件的 `skills/` |
| DeepSeek Harness | `.dsh/AGENTS.md` | `.dsh/skills/<id>/SKILL.md` | `dsh-skill-filesystem` 扫描项目 `.dsh/skills/`，**不支持嵌套 SKILL.md** |
| Cursor | `.cursor/rules/ai-arch.mdc` | —— | 规则文件足以承载指针 |
| Codex / Copilot / WorkBuddy / Continue | 各自指针文件 | —— | 同上 |

**技能 frontmatter 必须工具中立**（`scripts/validate.mjs` 强制）：

```yaml
---
name: code-review              # 必填，须等于目录名
description: 提交前评审与定期架构评审的可执行清单   # 必填
user-invocable: true           # 建议：允许用户直接点名调用
whenToUse: 提交前自查、评审他人改动、定期架构评审   # 必填
---
```

**注意**：不要用自造键（例如 `when`）。DSH 的 skill 发现只认标准键，**键名不符会让整个 skill 被丢弃**
（不是静默放行）——这类"skill 装了但从不触发"的问题极难排查，因此校验器直接拦住。

## 分发给其它 agent：`scripts/dist.mjs`

一份源（`skills/`、`cli/`、`templates/`），产出三种目标形态：

```bash
node scripts/dist.mjs --report   # 先看将产出什么、各目标的要求
node scripts/dist.mjs            # 产出
```

| 产出 | 目标 | 形态与要求 |
|---|---|---|
| `dist/skills/` | 任何遵循 Agent Skills 标准的工具 | 纯目录 bundle，无构建步骤；DSH 与 Claude 通吃 |
| `dist/plugins/claude-code/` | Claude Code | `.claude-plugin/plugin.json`（`name` 必填 kebab-case、`version` 语义化）+ `skills/`（默认扫描） |
| `dist/plugins/dsh/` | DeepSeek Harness | npm 包 + `cordis.patch.yml`（Cordis 插件行）；host 入口导出 `name`/`inject`/`apply`，注册只读工具 |

**为什么源只留一份、其余全部生成**：同一份知识复制成三套目录必然漂移。生成物不入库（`.gitignore` 忽略 `dist/`），
每次发布重建，因此不存在"改了源忘了改副本"。

**DSH 插件只暴露只读命令**（`doctor` / `task` / `rules` / `rules add` / `facts` / `review --drift`）：
初始化与升级会写文件，属于"需要人确认的动作"，不由模型直接触发。

**离线验证**（本机没有可启动的 DSH profile，因此把能证伪的风险点全部离线覆盖）：

```bash
node scripts/verify-dsh.mjs
```

它检查：包元数据与补丁形状、host 入口可否被 ESM 导入（含 `import.meta.dirname` 用法）、
导出是否符合 DSH 契约、工具是否注册且有足够详细的描述、**只读工具在真实项目上可执行且不改动文件**、
随包 skills 的 frontmatter 与"无嵌套 SKILL.md"。当前 61 项全通过。
它**不能**证明：工具在真实 DSH 会话中被模型调用的表现——这一点在产出物的 README 里也如实标注。

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
node .ai/bin/ai-arch.mjs review --drift --strict     # CI：有 error/warn 则退出码 1
node .ai/bin/ai-arch.mjs review --impact src/api/user.ts --depth 2
node .ai/bin/ai-arch.mjs review --decisions
```

`--drift` 只能发现机械可判定的漂移；架构层面的评审清单在 `.ai/skills/code-review/SKILL.md`。

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
