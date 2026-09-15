# 项目 skills（任务知识）

> `.ai/skills/` 里放**项目自己的任务知识**：某类任务该按什么步骤做、先看哪些文件、有哪些坑。
> `init` 时由框架把所选 skill 复制到这里；**从此它是项目资产**——可以改写、新增、删除，框架升级不会覆盖你改过的内容。

## 什么时候用

- 开工前：任务类型命中某个 skill 的 `description` 时，先读该 skill 再动手。
- 收工后：踩到新坑或摸索出更好步骤，就更新对应 skill，而不是把知识留在聊天记录里。
- 判断标准：**"下次做同类任务时，我希望有人提前告诉我这件事吗？"** 会 → 写进 skill。

## 目录约定

```
{{aiDir}}/skills/
  <skill-id>/
    SKILL.md          # 必需：frontmatter（name / description）+ 步骤正文
    examples/         # 可选：真实例子、样例输入输出
    scripts/          # 可选：辅助脚本（同样受"零依赖、跨平台"硬约束）
```

SKILL.md 的 frontmatter 至少两项（AI 靠 `description` 决定是否加载）：

```markdown
---
name: <skill-id，kebab-case，与目录名一致>
description: <什么时候用这个 skill，一句话>
---
```

## 加载与优先级

1. 只加载命中当前任务类型的 skill，不要一次读完所有 skill（见 `AGENTS.md` 的上下文纪律）。
2. 冲突时：**流程类**问题以 skill 为准（先做什么、怎么验证）；**规范类**问题以 `{{aiDir}}/constitution.md` 与 `{{docsDir}}/` 为准。
3. skill 里出现的命令必须能在宪法的"验证命令"里找到，或明确标注为"可选"。参考资料见 `.ai/framework-docs/`（框架规范快照）。

## 管理命令

| 动作 | 怎么做 |
|---|---|
| 查看可用 | `node {{aiDir}}/bin/ai-arch.mjs skill list` |
| 装入项目 | `node {{aiDir}}/bin/ai-arch.mjs skill add <skill-id>` |
| 读某个 skill | 直接打开 `{{aiDir}}/skills/<skill-id>/SKILL.md` |
| 新增 | 建 `<skill-id>/SKILL.md`，写清触发条件与步骤，在提交信息里说明为什么值得沉淀 |
| 修改 | 只改被证明有问题的步骤；不要为了"更完整"扩写——skill 越长越不会被读 |
| 删除 | 命中率长期为 0 或已被 `{{docsDir}}/` 覆盖时删除，并在任务包里说明理由 |

反例：把架构规范全文抄进 skill —— 那是 `{{docsDir}}/` 的职责；skill 只回答"这件事怎么做"。
