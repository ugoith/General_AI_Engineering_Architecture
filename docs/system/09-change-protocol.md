# 变更协议：改任何东西之前先查这张表

> 本文件是**框架自己的**变更影响矩阵。项目级的影响矩阵在 `.ai/index/impact-map.json`（更具体，且随项目演进）。
> 用途：防止"改了 A 忘了 B"——这类遗漏在 AI 协作中被放大，因为 AI 不会记得上次的口头约定。

## 一、框架变更影响矩阵

| 你改了 | 必须同步更新 | 必须做的验证 |
|---|---|---|
| `cli/lib/args.mjs`（参数解析） | `docs/system/07-cli.md` 的选项表 | `node scripts/selftest.mjs` |
| `cli/lib/render.mjs`（模板语法） | `templates/_schema/pack.schema.md`、`docs/system/07-cli.md` | 所有模板包重渲染（`selftest`） |
| `cli/lib/fsx.mjs`（遍历/忽略规则） | `docs/system/04-context-discipline.md`、`cli/lib/limits.mjs` 注释 | `selftest` + 手工确认忽略规则未放宽 |
| `cli/lib/limits.mjs`（任何阈值） | 该值出处的文档（见文件内注释） | `validate.mjs` 的阈值一致性检查 |
| `.ai/index/files.json` 结构 | `schema/index.schema.json`、`docs/system/07-cli.md`、`docs/system/04-context-discipline.md`，并**升 `schemaVersion`** | `selftest` 的索引往返用例 |
| `schema/pack.schema.json` | `templates/_schema/pack.schema.md`、`cli/lib/pack.mjs` | `validate.mjs`（所有 pack 重新校验） |
| `templates/base/**` | 所有 archetype 重渲染验证；`docs/system/08-documentation.md` 若涉及长度预算 | `validate.mjs`（common 变量检查）+ `selftest` |
| `templates/shared/**` | 所有引用它的模板（`validate.mjs` 会列引用者） | `validate.mjs` |
| `templates/archetypes/<id>/**` | 该包 `pack.json` 的变量/skills/dirs；`scripts/selftest.mjs` 的 `PACKS` 列表 | `validate.mjs` + `selftest` |
| `skills/<id>/SKILL.md` | 引用它的 pack.json；`skills/README.md` 索引 | `validate.mjs`（skill 引用检查） |
| `docs/system/01-constitution.md` | 可能影响：`AGENTS.md` 硬约束段、`validate.mjs` 的检查项 | 人工评审（宪法变更必须留下理由） |
| `docs/system/02-scales.md` 的阈值 | `cli/lib/patterns.mjs` 的 `MATRIX_RULES`、`templates/shared/scale-gate.md`、`docs/system/03-pattern-selection.md` | `validate.mjs`（两边模式名集合一致性） |
| `docs/system/03-pattern-selection.md` 的模式 | `cli/lib/patterns.mjs` 的 `PATTERNS` | `validate.mjs` |
| `docs/system/04-context-discipline.md` 的预算 | `cli/lib/limits.mjs`、`templates/shared/context-discipline.md` | `validate.mjs` |
| `package.json` 的 `version` | 无（`init` 会写入生成项目的 `.ai/framework.json`） | `selftest` |
| 新增 archetype 模板包 | `README.md` 的项目类型表、`scripts/selftest.mjs` 的 `PACKS`、`docs/02-adoption.md` | `validate.mjs` + `selftest` |

## 二、项目级变更协议（给使用者）

每个 `init` 生成的项目都有 `.ai/index/impact-map.json`。核心规则：

1. **改之前**：`ai-arch review --impact <文件>` 拿到影响面清单。
2. **改的时候**：按影响矩阵同步更新文档与注册表。
3. **改完**：`ai-arch index` → `index --stale`（补摘要）→ `review --drift`。
4. **发现遗漏时**：往影响矩阵**加一条规则**，而不是提醒大家注意。规则比记性可靠。

## 三、规范演进的三个层次

| 层次 | 载体 | 变更成本 | 谁来改 |
|---|---|---|---|
| 项目差异 | `.ai/constitution.md` 的"本项目的例外"一节 | 低 | 项目成员 |
| 项目规则 | `.ai/index/impact-map.json`、`.ai/decisions/` | 中 | 项目成员 + 评审 |
| 框架规范 | `docs/system/**` | 高（影响所有项目） | 框架维护者 + ADR |

**判断标准**：如果一个偏离只对当前项目成立，写在项目宪法里；如果它对一整类项目成立，应该改进框架的对应模板或规范。

## 四、变更记录

框架规范的**规则级**变更（新增/删除/修改硬约束）记录在 `docs/05-changelog-of-rules.md`，格式：

```markdown
## YYYY-MM-DD — <规则名>
- 变更：新增 | 修改 | 删除
- 原因：<触发这次变更的具体问题>
- 影响：<受影响的项目/模板/命令>
- 替代机制：<删除规则时必须有>
```

普通内容修订（错别字、示例更新）不需要记录。

## 五、禁止的变更方式

- ❌ 直接改 `docs/system/**` 而不更新引用了它的代码常量（会导致 CLI 输出与文档不一致）。
- ❌ 修改阈值却不改文档出处（AGENTS.md 的硬约束"不猜"）。
- ❌ 放宽 `validate.mjs`/`selftest.mjs` 的检查来让提交变绿。
- ❌ 在一个提交里混入"规范重写"与"功能新增"（无法评审、无法回退）。
- ❌ 删除规则而不记录替代机制。
