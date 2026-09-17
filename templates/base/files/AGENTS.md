# {{aiEntry}} — {{projectTitle}} 的 AI 入口

> 本文件是**指针，不是百科**：只放硬约束、路由表、提交前检查。知识在 `{{aiDir}}/`、`{{docsDir}}/` 与源码里，按需读取，不要一次读完整个仓库。

**这是什么项目**：{{description}}
**项目名**：`{{projectName}}` ｜ **负责人**：{{owner}} ｜ **规模**：{{scaleLevel}} / {{scaleName}} ｜ **框架版本**：{{frameworkVersion}}

开工前必读（两份，不要跳过）：

1. `{{aiDir}}/constitution.md` —— 定位、技术栈、**验证命令**、红线、规模门槛（L1，≤150 行）。
2. `{{aiDir}}/index/README.md` —— 索引体系说明书：files.json 的摘要字段、impact-map.json 与任务包怎么用。

## 硬约束（不可协商）

- **语言**：面向人的文档用中文；代码标识符、JSON 字段、CLI 参数、文件名一律英文。
- **依赖**：新增运行时依赖前先写 ADR（`{{aiDir}}/decisions/`）；能用标准库解决就不要引入依赖。
- **跨平台**：路径拼接用语言标准库的 path API；不写 bash-only 语法、不硬编码分隔符；脚本入口用可移植扩展名。
- **单一事实来源**：每条规则只写一处；文件摘要只写在 `{{aiDir}}/index/files.json`，其它地方只引用不复制。
- **不猜**：外部字段名、错误码、超时语义必须查文档或问人；不得已的猜测标 `ASSUMPTION:` 并写进任务包。
- **可追溯**：任何改动都要能回答"改了哪些文件、依据哪条规则、用什么命令验证"；答不上来就是没做完。
{{#IF isGame}}
- **引擎与资源**：引擎/工具链版本升级必须先写 ADR；资源命名与导入规范以本 archetype 的文档为准。
{{/IF}}

{{> SHARED:context-discipline}}

{{> SHARED:verification-loop}}

{{> SHARED:decision-trigger}}

{{> SHARED:scope-guard}}

## 工作路由表（先查表，再动手）

| 你的任务 | 先读 | 命令 |
|---|---|---|
| 接新任务 | `{{aiDir}}/index/README.md`、`{{aiDir}}/tasks/TEMPLATE.md` | `node {{aiDir}}/bin/ai-arch.mjs task "<任务描述>"` |
| 改模块边界 | `{{aiDir}}/index/impact-map.json`、`{{docsDir}}/architecture/` 的 overview | 先写 ADR（规则 `module-boundary-change`）再改代码 |
| 改数据/接口契约 | `{{aiDir}}/registry.json`、`{{docsDir}}/architecture/` 的 data-model / interfaces | 先写 ADR（规则 `data-model-change` / `api-contract-change`） |
| 修 bug | 任务包"读取清单"里的目标文件与 `digest` | `node {{aiDir}}/bin/ai-arch.mjs task "fix: <现象>"` |
| 重构 | `{{aiDir}}/index/files.json` 中目标文件的 `importedBy` | `node {{aiDir}}/bin/ai-arch.mjs task "refactor: <范围>"` |
| 写测试 | `{{aiDir}}/constitution.md` 的"验证命令"、`{{testsDir}}/` 现有用例 | 跑宪法里列出的测试命令 |
| 更新文档/索引 | `{{aiDir}}/index/README.md`、`{{aiDir}}/index/impact-map.json` | `node {{aiDir}}/bin/ai-arch.mjs index --stale` |
| 架构评审 | `{{aiDir}}/constitution.md`、`{{aiDir}}/decisions/` 的全部 ADR | `node {{aiDir}}/bin/ai-arch.mjs review --drift` |

> 表里提到的 `{{docsDir}}/architecture/*.md` 只在项目确实有这些文件时才读；缺失时按 `{{aiDir}}/index/impact-map.json` 的 `mustUpdate` 判断是"本规模不需要"（记进宪法"本项目的例外"）还是"该补了"。

## 任务收尾必须做（顺序不能颠倒）

```bash
node {{aiDir}}/bin/ai-arch.mjs review --task    # 1. 闭环对账：实际改动 vs 任务包里的计划
node {{aiDir}}/bin/ai-arch.mjs index --stale    # 2. 按上一步清单补摘要（顺带刷新 hash）
node {{aiDir}}/bin/ai-arch.mjs review --drift   # 3. 终检：hash / 决策 / 链接
```

- 三条命令都不允许出现**新增**未处理项；处理不了的写进任务包"遗留风险"一节。
- 验证命令的**真实输出摘要**必须贴进任务包"证据"一节，不要只写"测试通过"。
- 索引没更新的改动视为未完成：hash 会漂移，下一个任务会读到过期摘要。
- `review --task` 报 `task-premise-stale` 时必须**重读那个文件**：任务包当时判定它没变、只让你读摘要，而它已经变了。
