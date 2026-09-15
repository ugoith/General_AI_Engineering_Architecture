# Skills：任务知识层

`skills/` 存放**任务知识**：如何完成某一类工作。它与 `AGENTS.md`（项目上下文）互补——前者回答"这类活怎么干"，后者回答"这个项目是什么、有什么约束"。

## 目录约定

```
skills/<skill-id>/
  SKILL.md          # 必填：frontmatter + 正文
  scripts/          # 可选：该任务专用的零依赖脚本
  references/       # 可选：该任务需要按需读取的参考材料
```

`SKILL.md` 的 frontmatter：

```yaml
---
name: skill-id                # 与目录名一致
description: 一句话说明用途（会被 CLI `skill list` 展示）
when: 什么情况下加载这个 skill
---
```

## 与项目的关系

- `init` 会把模板包 `pack.json` 里 `skills` 字段声明的 skill **复制**进项目的 `.ai/skills/`。
- 项目里的 `.ai/skills/` 是**项目资产**：可以改、可以删、可以自己加。`upgrade` 不会覆盖被改动过的文件。
- 项目自己写的 skill 也放 `.ai/skills/`，并建议在项目 `AGENTS.md` 的路由表里登记。

## 框架内置 skill

| id | 用途 | 何时加载 |
|---|---|---|
| `context-indexing` | 维护文件索引与语义摘要 | 接手新任务、大改动后、索引漂移时 |
| `adr-writing` | 写决策记录 | 命中 `decision-trigger` 清单时 |
| `change-impact` | 变更影响面分析与同步更新 | 改接口/数据/模块边界前后 |
| `code-review` | 代码与架构评审清单 | 提交前、定期架构评审 |
| `test-strategy` | 测试策略与分层 | 新增行为、修 bug、写回归 |
| `bugfix-triage` | 系统性排错流程 | 出现缺陷、验证失败、线上问题 |
| `game-engine-conventions` | 引擎特有约定与资产不可整读规则 | Unity / Unreal / Godot / Web 游戏项目 |

## 新增 skill 的步骤

1. 建 `skills/<id>/SKILL.md`，frontmatter 三个字段必填。
2. 正文必须包含：**判断条件**（何时用/不用）、**具体步骤**（含命令）、**反例**（常见错误做法）。
3. 若要让某类项目默认加载，把 id 加进对应 `pack.json` 的 `skills` 数组。
4. 更新本文件的表格。
5. `node scripts/validate.mjs` 通过（会检查 skill 引用与 frontmatter 完整性）。
