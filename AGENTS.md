# AGENTS.md — 本仓库的 AI 入口

本文件是**指针，不是百科**。目标是让任何 AI 编码工具在 60 秒内知道：这是什么、该读哪几个文件、有哪些硬约束。
知识在 `docs/`，任务知识在 `skills/`，机器可读契约在 `schema/`。

## 这是什么

一个**通用的、AI 原生的工程级架构框架**。它不是某个具体项目的架构，也不是某一门语言的脚手架：
它定义"一个项目应当如何被组织，才能让 AI 与人类都低成本、可追溯、可持续地推进"，
并以**可复制式脚手架**的形式交付——用 CLI 把规范、索引体系、模板渲染进任意新项目。

三个要解决的问题（对应三份核心规范）：

| 问题 | 机制 | 规范 |
|---|---|---|
| 每次都要重读相同文件，浪费上下文 | 分层上下文 + 文件摘要 + 任务上下文包 | `docs/system/04-context-discipline.md` |
| 新项目/新类型从零再来 | archetype 模板包 + 规模分级 + 模式矩阵 | `docs/system/02-scales.md`、`docs/system/03-pattern-selection.md` |
| 规范随时间腐化，无人维护 | 变更影响协议 + 漂移检测 + 定期架构评审 | `docs/system/05-lifecycle.md`、`docs/system/06-memory.md` |

## 硬约束（不可协商）

- 语言：面向用户的文档默认中文；**代码标识符、JSON 字段、CLI 参数、目录名一律英文**。
- 零运行时依赖：`cli/` 与模板里的脚本只允许 Node.js 内置模块（`node:fs` 等）。禁止引入 npm 包。
- 跨平台：不得依赖 bash-only 语法；路径拼接必须用 `node:path`；脚本入口一律 `.mjs`。
- 单一事实来源：规范只写在 `docs/system/`。`templates/` 里不得复制规范正文，只能通过 `{{> SHARED:...}}` 引用片段。
- 不猜：任何阈值（文件数、行数、模块数）都必须能在 `docs/system/` 里找到出处；新增阈值必须同时更新文档。

## 工作路由（先读这个表，再动手）

| 你的任务 | 先读 | 然后 |
|---|---|---|
| 新增/修改一套 archetype 模板 | `templates/_schema/pack.schema.md` | `docs/system/02-scales.md`、`docs/system/08-documentation.md` |
| 修改 CLI 命令行为 | `docs/system/07-cli.md` | `cli/README.md`、`cli/lib/args.mjs` |
| 改索引/上下文包的格式 | `schema/index.schema.json` | `docs/system/04-context-discipline.md`（改格式必须同时升 `schemaVersion`） |
| 改规范正文（`docs/system/*`） | `docs/system/01-constitution.md` | 检查 `docs/system/09-change-protocol.md` 的影响矩阵 |
| 实现/更新某个 skill | `skills/README.md` | 对应 `skills/*/SKILL.md` |
| 想理解设计取舍与反例 | `docs/04-design-notes.md` | `docs/system/03-pattern-selection.md`（含反模式清单） |

## 提交前必须做

```bash
node scripts/validate.mjs      # 校验 schema、模板变量、覆盖完整性、文档链接、token 预算
node scripts/selftest.mjs      # 端到端：把每个模板包 init 到临时目录并跑全部命令
```

两条都通过才算完成。任何新增命令都要在 `scripts/selftest.mjs` 里补一条端到端用例。

## 度量脚本（改预算或改共享片段前先跑）

| 脚本 | 作用 |
|---|---|
| `node scripts/measure-budget.mjs` | 列出每个模板包生成的 `AGENTS.md` / `constitution.md` 行数与 token（上限出处：`cli/lib/limits.mjs`） |
| `node scripts/measure-digest.mjs` | 量化"读源码 vs 读摘要"的 token 倍率（README 的 68 倍出自此脚本） |

## 目录边界（别放错地方）

```
docs/        面向人的论述与规范正文（唯一事实来源）
templates/   生成到用户项目的文件；base/ 通用，archetypes/<id>/ 专项
skills/      任务知识（AI 在特定任务类型下按需加载）
schema/      机器可读契约（JSON Schema / 格式说明）
cli/         零依赖 Node CLI 实现
scripts/     仓库自身的校验与自测
```

## 不要做的事

- 不要往 `AGENTS.md` 里塞规范正文或流程教程——它膨胀会直接抬高每次任务的成本。
- 不要在 `templates/` 里硬编码项目的具体业务名，一切通过 `{{变量}}`。
- 不要引入"看起来高级"的设计模式：小规模项目里它们是被明确禁止的，见 `docs/system/03-pattern-selection.md`。
