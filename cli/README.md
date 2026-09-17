# cli：零依赖 CLI 实现

> 命令的用户文档在 [`docs/system/07-cli.md`](../docs/system/07-cli.md)。本文件说明**代码结构**，供维护者与 AI 使用。

## 入口与两种运行位置

```
框架仓库：node cli/ai-arch.mjs <命令>          → lib 在 cli/lib/
用户项目：node .ai/bin/ai-arch.mjs <命令>      → lib 在 .ai/lib/
```

`cli/ai-arch.mjs` 只做一件事：定位 `lib/`，动态 import `cli.mjs` 并调用 `main(process.argv.slice(2))`。
`init` 会把 `lib/` 复制到项目的 `.ai/lib/`，因此项目侧也能离线运行同一套实现。

## 模块职责

| 文件 | 职责 | 关键不变量 |
|---|---|---|
| `ai-arch.mjs` | 入口：定位 lib、转发参数、返回退出码 | 不包含业务逻辑 |
| `lib/cli.mjs` | 命令分发与输出渲染 | 新命令必须同步 `USAGE`、`docs/system/07-cli.md`、`scripts/selftest.mjs` |
| `lib/args.mjs` | 参数解析 | 未知选项不报错，由命令自行校验 |
| `lib/fsx.mjs` | 文件遍历、hash、glob、gitignore、语言识别 | 跨平台；忽略规则不得放宽（会改变索引语义） |
| `lib/render.mjs` | 模板引擎（变量/条件/片段/路径渲染） | **未声明变量必须报错**，绝不静默替换为空 |
| `lib/pack.mjs` | 模板包加载、渲染树组装、变量审计 | `base/` 层只能用 common 变量 |
| `lib/scaffold.mjs` | `init` / `upgrade` / 工具链与 skills 复制 | 默认不覆盖已存在文件；幂等 |
| `lib/indexer.mjs` | 文件索引：hash、行数、依赖、待写摘要请求、摘要回填 | 摘要必须带 `reviewedHash` 且与当前 `hash` 一致才接受 |
| `lib/neighbors.mjs` | 依赖邻域与影响面计算 | 只基于静态 import；间接依赖需人工补进影响矩阵 |
| `lib/taskpack.mjs` | 任务上下文包：打分、预算、决策（读源码/读摘要） | 超预算的文件必须列入 `dropped`，不得静默省略；条件必读项的占位符常量与 `taskclose.mjs` 同源 |
| `lib/taskclose.mjs` | 任务闭环对账（`review --task`）：计划 vs 实际、前提失效、摘要/注册表同步、任务包自填检查 | **只重新 hash 任务包列过的文件**，不做全树扫描；不声称"测试跑过" |
| `lib/review.mjs` | 漂移检测（摘要过期、文档断链、决策缺失、预算超限） | 只报机械可判定项，不猜架构问题 |
| `lib/doctor.mjs` | 项目健康检查 | 必需文件缺失必须是 error 级 |
| `lib/limits.mjs` | **所有阈值集中在此** | 每个数字必须能在 `docs/system/` 找到出处 |
| `lib/patterns.mjs` | 规模矩阵与设计模式数据 | 与 `docs/system/02-scales.md`、`03-pattern-selection.md` 一致（validate 会查） |
| `lib/report.mjs` | 表格、CJK 宽度、token 估算 | 估算误差 ±20%，见 `docs/04-design-notes.md` |

## 依赖方向（不可反向）

```
ai-arch.mjs → cli.mjs → { args, report, fsx, framework, pack, scaffold,
                          indexer, taskpack, taskclose, review, doctor, neighbors, patterns, limits }
fsx/framework 不依赖任何业务模块；render 不依赖 fsx；pack → render + fsx + framework
```

禁止：`fsx.mjs` 引入 `cli.mjs`；`render.mjs` 引入 `scaffold.mjs`（会造成循环依赖与不可测）。

## 修改 CLI 的检查清单

1. 改 `USAGE` 文本与命令分发。
2. 同步 `docs/system/07-cli.md`（选项表 + 退出码）。
3. 在 `scripts/selftest.mjs` 补端到端用例（**硬要求**，`validate.mjs` 会检查命令覆盖）。
4. 若新增阈值 → 放进 `lib/limits.mjs` 并在 `docs/system/` 注明出处。
5. 若改了索引或任务包格式 → 升 `schemaVersion` 并更新 `schema/*.schema.json`。
6. 运行：

```bash
node scripts/validate.mjs && node scripts/selftest.mjs
```

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 执行失败，或 `--strict` 下存在 error/warn |
| 2 | 用法错误 |

## 设计约束（勿违反）

- **零依赖**：只用 Node 内置模块。不允许为了"方便"引入 npm 包。
- **不做破坏性写操作**：CLI 不自动改源码、不自动提交 git、不删除用户文件。
- **输出双语分层**：面向人的输出中文；字段名、命令、路径英文。
- **所有命令支持 `--json`**（供 AI 解析），且 `--json` 输出不得混入人类可读文本。
- **错误信息必须可行动**：告诉用户下一条命令是什么，而不是只报"失败"。
