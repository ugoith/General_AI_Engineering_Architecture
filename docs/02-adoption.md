# 采用指南：把框架接入一个真实项目

> 面向"我现在手上有一个项目，想用上这套东西"。目标：**第一次接入 ≤ 1 小时**，且不改动任何业务代码。

## 一、先做判断：你需要哪一档

| 你的情况 | 建议做法 | 时间 |
|---|---|---|
| 单人小工具/脚本（< 2k 行） | 只接 `software-cli-small`，只维护 README + AGENTS.md + 验证命令 | 15 分钟 |
| 有多人协作的应用（2k–30k 行） | 接 `software-app-medium`，建立宪法 + 索引 + ADR + 影响矩阵 | 1 小时 |
| 多模块系统/平台雏形 | 接 `software-system-large`，额外做契约与性能预算 | 半天（要评审） |
| 游戏项目 | 接对应引擎模板，**重点做资产索引**（scene/prefab/blueprint 不整读） | 1 小时 |

不确定就先跑：

```bash
node ~/ai-arch/cli/ai-arch.mjs init . --pack software-app-medium --dry-run
node ~/ai-arch/cli/ai-arch.mjs packs
```

## 二、接入步骤（以既有项目为例）

### 第 0 步（最快路径）：把提示词交给 AI

如果你只是想让它跑起来，最省事的路径是让 agent 自己做：

```bash
node ~/ai-arch/cli/ai-arch.mjs quickstart --root . > 接入提示词.md
# 把该文件内容贴给任意 AI 助手
```

或一条命令直接接入（它会自动识别项目类型、写 agent 指针、建索引）：

```bash
node ~/ai-arch/cli/ai-arch.mjs install --root . --dry-run   # 先看会写什么
node ~/ai-arch/cli/ai-arch.mjs install --root .
```

下面的手工步骤用于你想逐步控制、或识别不准时。

### 第 1 步：确认工作区干净

```bash
git status          # 有未提交改动时先提交或 stash，便于 review 生成的 diff
```

### 第 1 步：预演 + 生成

```bash
node ~/ai-arch/cli/ai-arch.mjs init . --pack <id> --dry-run     # 看会写哪些文件
node ~/ai-arch/cli/ai-arch.mjs init . --pack <id>
```

**安全保证**：已存在的文件默认**不覆盖**，只新建缺失的。重复执行结果一致（幂等）。

生成物分三类：

| 类别 | 位置 | 说明 |
|---|---|---|
| AI 上下文 | `AGENTS.md`、`.ai/` | 需要你填内容（见第 2 步） |
| 项目文档骨架 | `docs/`（按模板包） | 带格式的占位，需填写 |
| 工具链副本 | `.ai/bin/`、`.ai/lib/`、`.ai/framework-docs/` | 离线可用，`upgrade` 负责更新 |

### 第 2 步：填宪法（这是最重要的一步，10 分钟）

打开 `.ai/constitution.md`，至少填完这四项：

1. **项目定位**：一句话说明做什么、给谁用。
2. **技术栈与版本**：语言/运行时/框架/数据库的确切版本。
3. **验证命令**：表格形式，例如：

   | 动作 | 命令 | 通过标准 |
   |---|---|---|
   | 类型检查 | `npm run typecheck` | 无错误 |
   | 单元测试 | `npm test` | 全绿 |
   | 端到端 | `npm run e2e` | 主流程通过 |
   | 构建 | `npm run build` | 产物生成 |

   **要求**：AI 必须能原样执行这些命令并用输出证明完成。没写清楚，AI 就只能说"看起来没问题"。
4. **红线**：不可协商的 3–5 条（例如"所有外部输入必须校验""不得在 UI 层直接访问数据库"）。

### 第 3 步：建立索引

```bash
node .ai/bin/ai-arch.mjs index
node .ai/bin/ai-arch.mjs doctor
```

此时索引里所有文件都是"待写摘要"。**不要一次全写**——先只写高价值的：

```bash
node .ai/bin/ai-arch.mjs index --stale --json > .ai/cache/digest-request.json
```

挑清单里 `risk: high` 和被依赖最多的 5–10 个文件，把源码和这份 JSON 交给 AI，要求它输出摘要 JSON，然后：

```bash
node .ai/bin/ai-arch.mjs index --apply .ai/cache/digests.json
```

### 第 4 步：补写历史决策（可选但推荐，20 分钟）

用 `ai-arch review --decisions` 看现有 ADR；把"当初为什么这么选"补成 8 行的短 ADR，日期后标注"（回溯记录）"。这能让后续 AI 不再反复质疑既有设计。

### 第 5 步：走一遍完整循环（第一次必须做）

```bash
node .ai/bin/ai-arch.mjs task "给 <某个小需求> 做实现" 
# → 把任务包交给 AI → 完成后填任务包第 5/6/7 节
node .ai/bin/ai-arch.mjs index
node .ai/bin/ai-arch.mjs review --drift
```

这一次循环的目的是**校准**：看任务包给出的读取清单是否合理、token 估算是否贴近实际。若明显偏差，调整 `--max-files` / `--expand` / `--area` 的默认值，并把结论写进项目宪法。

## 三、接入后的日常节奏

| 时机 | 动作 | 命令 |
|---|---|---|
| 接到任务 | 要任务包 | `ai-arch task "<描述>"` |
| 改之前 | 看影响面 | `ai-arch review --impact <文件>` |
| 做了取舍 | 写 ADR | `cp .ai/templates/adr.md .ai/decisions/000N-*.md` |
| 任务结束 | 更新索引与摘要 | `ai-arch index` → `index --stale` → `index --apply` |
| 提交前 | 查漂移 | `ai-arch review --drift`（可选接 git 钩子） |
| 里程碑/季度 | 架构评审 | `ai-arch scale --gaps` + `skills/code-review` 八问 |
| 框架升级 | 同步规范 | `ai-arch upgrade` → `--apply` → 处理"需人工合并" |

## 四、可选：接 CI

```yaml
# .github/workflows/ai-arch.yml
name: ai-arch
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node .ai/bin/ai-arch.mjs review --drift --strict
      - run: node .ai/bin/ai-arch.mjs doctor
```

`--strict` 会在存在 error/warn 时返回退出码 1。建议**先只做 warn 报告**（不加 `--strict`），等团队适应后再打开强制。

## 五、常见顾虑

| 顾虑 | 回答 |
|---|---|
| 会不会生成一堆没人看的文档？ | 模板刻意保持精简；`doctor` 会报超预算文件；`review --drift` 会报断链。写多了会立刻被发现。 |
| 索引维护是不是额外负担？ | 正常每次任务 3 条命令、2 分钟以内。若超过，说明索引粒度错了（见 `docs/system/05-lifecycle.md` 第七节）。 |
| AI 不遵守怎么办？ | 硬约束写在 `AGENTS.md` 第一条（模板已含），并且任务包本身就是最强指令——里面写清了"读摘要，不要打开源码"。 |
| 我们不用 AI，有用吗？ | 有用。索引 + 任务包 + 影响矩阵本身就是"可检索的项目记忆"，对新人和交接同样有效。 |
| 已有自己的规范文档，冲突吗？ | 不冲突。把项目差异写进 `.ai/constitution.md` 的"本项目的例外"一节，指出现有文档的位置即可。 |

## 六、不该做的事

- ❌ 一次性给全仓库写摘要（先把高风险文件做完）。
- ❌ 把框架文件改得面目全非后再 `upgrade --force`（会丢掉本地改动）。
- ❌ 为了让 `--strict` 变绿而删掉检查项（等于删除规则本身）。
- ❌ 在 S 级项目里照搬 L 级的全套流程（会被直接抛弃，收益归零）。
- ❌ 只生成不填：`.ai/constitution.md` 里的验证命令没填，AI 就无法证明自己完成了任务。
