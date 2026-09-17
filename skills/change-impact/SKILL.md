---
name: change-impact
description: 改动前后做影响面分析，避免"改了 A 忘了 B"
user-invocable: true
whenToUse: 修改接口/数据模型/模块边界/公共行为前后
---

# 变更影响面分析与同步更新

## 为什么需要

改动本身通常不难，难的是**同步更新被它影响的一切**。AI 尤其容易漏掉这一步，因为它看不到"上次的口头约定"。

## 改动前：拿影响面

```bash
node .ai/bin/ai-arch.mjs review --impact src/api/user.ts --depth 2
```

输出三类信息：

1. **受影响文件**（按依赖深度排序，含风险与摘要）——这些是要读、可能要改的。
2. **应运行的测试**——不是"跑全部测试"，而是真正覆盖这次改动的。
3. **影响矩阵要求的同步更新**——来自 `.ai/index/impact-map.json`。

## 分类判断

| 改动类型 | 典型同步动作 | 需要 ADR |
|---|---|---|
| 数据模型 | `.ai/registry.json`、`docs/architecture/data-model.md`、迁移脚本 | 是 |
| 接口/契约 | `.ai/registry.json`、`docs/architecture/interfaces.md`、契约测试 | 是 |
| 模块边界 | `docs/architecture/overview.md`、依赖规则 | 是 |
| 依赖/引擎版本 | `.ai/constitution.md` 技术栈一节 | 是 |
| 构建/工具链 | `docs/runbooks/local-dev.md`、CI 配置说明 | 否 |
| 公共行为 | `CHANGELOG.md`、README 用法 | 否 |

## 改动后：三件收尾事

```bash
node .ai/bin/ai-arch.mjs index                 # 更新 hash/行数/依赖
node .ai/bin/ai-arch.mjs index --stale         # 看是否有摘要要重写
node .ai/bin/ai-arch.mjs review --drift        # 确认无遗留漂移
```

再检查任务包的第 5/6/7 节（结果/证据/遗留风险）是否填完。

## 发现遗漏时的正确动作

当你发现"改了 A 却忘了改 B"，**不要只是这次补上**——往 `.ai/index/impact-map.json` 加一条规则：

```json
{
  "trigger": "session-storage-change",
  "mustUpdate": [".ai/registry.json", "docs/runbooks/local-dev.md", "部署配置说明"],
  "adrRequired": true
}
```

规则比记性可靠，而且 AI 下次会自动读到。

## 反例

- ❌ 改完接口直接提交，靠"我记得还有一处"。
- ❌ 用"跑一遍全部测试"代替影响面分析 —— 全量测试通常很慢，实际结果是没人跑。
- ❌ 影响面只看直接调用方，忽略通过配置/反射/事件间接依赖的地方。**间接依赖要靠人补**：`review --impact` 只能看静态 import。发现间接依赖时，把它写进影响矩阵作为人工检查项。
- ❌ `review --drift` 报了一堆 `digest-missing` 就当作噪音忽略 —— 那意味着下次任务会重读这些文件。

## 与其他 skill 的分工

- 需要写决策 → `adr-writing`
- 需要写测试 → `test-strategy`
- 提交前评审 → `code-review`
- 摘要怎么更新 → `context-indexing`
