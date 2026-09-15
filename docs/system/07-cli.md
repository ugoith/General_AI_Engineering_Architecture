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
| `doctor` | 项目健康检查 | stdout / 退出码 |
| `packs` | 列出可用模板包 | stdout / `--json` |
| `upgrade` | 同步框架文件到当前版本 | 三态报告；`--apply` 生效 |

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
