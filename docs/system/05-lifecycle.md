# 索引与规范如何随项目演进

> 对应 CLI：`ai-arch review --task`、`ai-arch index`、`ai-arch review --drift`、`ai-arch review --impact`、`ai-arch scale`、`ai-arch upgrade`。
> 核心主张：**规范腐化的根因是没有触发时机**。因此本框架把"更新"挂在三个已经必然发生的动作上。

## 一、三类触发时机

| 时机 | 触发者 | 动作 | 自动化程度 |
|---|---|---|---|
| **变更时** | 写代码的人/AI | 按影响矩阵同步文档与索引 | **全自动**：`review --impact` 按判据报出命中的规则；`review --task` 核对 `mustUpdate` 是否真的改了 |
| **任务收尾时** | 完成一次任务 | 计划 vs 实际对账、回写摘要、同步注册表 | 全自动（`review --task` 对账任务包记录的 hash） |
| **提交前** | 每次提交 | 漂移检测、上下文预算检查 | 全自动（`review --drift`） |
| **定期** | 里程碑/季度/规模变化 | 架构评审，产出 ADR 或整改清单 | 半自动（`review --drift` + 评审清单） |
| **契约变更时** | 改到已登记实体 | 核对不变量、更新注册表与 ADR | 半自动（`review --drift` 报 `entity-hash-stale`） |

没有这些时机，任何"有空再整理"的约定都会失效。这是设计上的取舍，理由见 `docs/04-design-notes.md` 第 5 节。

**"任务收尾时"与"提交前"的区别**（两者都要，不能互相替代）：

- `review --task` 对账的是**本次任务**：任务包记录了开工时每个文件的 hash，所以它能回答"当时让我只读摘要的文件是不是已经变了"——这是全项目漂移检查回答不了的问题（它只知道"现在有没有漂移"，不知道"哪个漂移是这次任务造成的、哪条前提你已经不能再用了"）。
- `review --drift` 对账的是**整个项目与索引/规范的关系**，与任务无关。

## 二、变更时：影响矩阵

`.ai/index/impact-map.json` 是机器可读的影响矩阵。每条规则有四个字段：

| 字段 | 含义 |
|---|---|
| `trigger` | 变更类型名（`data-model-change` 等），可自定义 |
| `when` | **触发判据**（机器求值）：`entityKinds[]` / `paths[]` / `manifest` / `build`，任一匹配即算命中 |
| `mustUpdate[]` | 命中后必须同步更新的文件 |
| `adrRequired` | 是否必须先写 ADR |

种子内容（`init` 生成）：

| 触发 | 判据（`when`） | 必须同步更新 | 需要 ADR |
|---|---|---|---|
| `data-model-change` | 注册表 `data-model` 实体 / `**/models/**` 等路径 | `.ai/registry.json`、`docs/architecture/data-model.md` | 是 |
| `api-contract-change` | 注册表 `api`/`contract` 实体 / `**/api/**` 等路径 | `.ai/registry.json`、`docs/architecture/interfaces.md`、契约测试 | 是 |
| `module-boundary-change` | 注册表 `module` 实体 / 模块与依赖规则文档 | `docs/architecture/overview.md`、依赖规则文件 | 是 |
| `dependency-change` | 依赖清单（`package.json`、`*.csproj`、`pyproject.toml` …） | `.ai/constitution.md`（技术栈一节）、`.ai/decisions/` | 是 |
| `build-tooling-change` | 构建与工具链配置（`tsconfig`、`Makefile`、CI、`*.Build.cs` …） | `docs/runbooks/local-dev.md`、CI 配置说明 | 否 |
| `public-behavior-change` | 公开入口路径（`**/api/**`、`**/cli/**`、`**/main.*` …） | `CHANGELOG.md`、README 用法一节 | 否 |

使用方式：

```bash
node .ai/bin/ai-arch.mjs review --impact src/auth/token.ts
```

输出把规则分成三类——**命中的**（附判据与 `mustUpdate`）、**未声明判据的**（明确说"无法判断是否适用"，而不是列出来让人自己挑）、**不适用的**（只报数量）。
改动完成后 `review --task` 会核对：命中的规则，其 `mustUpdate` 文件在本次任务里是否真的被改动过（没改报 `task-impact-not-updated`）。

**为什么要有 `when`**：没有它，影响矩阵就只是一张人读的表——`review --impact` 只能把全部规则打印出来，"这次命中了哪几条"完全靠人判断。而**判断不了的条目等于没有条目**（与规则集同一把尺子：没有判据的规则会被报成"未声明判据"）。自己加的 trigger 请一并补 `when`；`rules add` 写入的 trigger 会自动带上 `when.paths`（取自规则的作用范围）。

**重要**：影响矩阵是**项目资产**，必须随项目演进修改。当发现"改了 A 却没人想到要改 B"时，正确动作是**往矩阵里加一条规则**，而不是提醒大家小心。

## 三、提交前：漂移检测

```bash
node .ai/bin/ai-arch.mjs review --drift          # 人看
node .ai/bin/ai-arch.mjs review --drift --json   # CI 用
node .ai/bin/ai-arch.mjs review --drift --strict # 有 error/warn 则退出码 1
```

检测项（只做机械可判定的部分）：

| 代码 | 含义 | 严重度 |
|---|---|---|
| `index-missing` | 索引不存在 | error |
| `digest-stale` | 文件已变但摘要未更新（AI 会据此误判） | warn |
| `digest-missing` | 没有摘要，每次任务都要重读源码 | info |
| `file-new` / `file-deleted` | 索引与工作区不一致 | info / warn |
| `context-budget` | `AGENTS.md`/宪法超出 token 或行数预算 | warn |
| `context-file-missing` | L0/L1 缺失 | error |
| `doc-link-missing` | 文档里引用的代码路径不存在 | info |
| `decisions-empty` | 项目已有变更但没有任何 ADR | info |
| `entity-hash-stale` | **契约漂移**：注册表记录的 hash 与索引不一致（契约被改，注册表未同步） | warn |
| `entity-file-missing` | 注册表指向的文件不存在（契约被搬运/删除） | warn |
| `entity-unindexed` | 登记路径是目录或不在索引中，无法用 hash 对账 | info |
| `high-risk-unregistered` | 高风险 / 被多方依赖的文件尚未登记（工作队列，非错误） | info |
| `registry-empty` | 注册表尚无任何实体（这一层建了没被用起来） | info |

**为什么单列"契约漂移"**：前 8 项只回答"文件在不在、内容变没变"。`entity-hash-stale` 回答的是更贵的问题——**这个契约的语义变了吗**。摘要过期最多让你多读一次源码；契约漂移会让你**拿旧的不变量去做判断**，而且不会有任何报错。这正是 `docs/04-design-notes.md` §9.2 说的、主流"spec → 可评审产物"路线刻意留白的部分。

建议接到 git 钩子（框架不自动安装钩子，避免污染用户仓库）：

```bash
# .git/hooks/pre-commit（可选，由你自行创建）
node .ai/bin/ai-arch.mjs review --drift --strict || exit 1
```

**它检测不到什么**（必须由评审补上）：架构是否合理、模块边界是否被绕过、抽象是否过度、命名是否表达意图、测试是否测了该测的东西。这些列在 `.ai/skills/code-review/SKILL.md` 的评审清单里。

## 四、定期：架构评审

### 触发条件（满足任一即做）

1. **规模等级变化**：`ai-arch scale` 的结论与声明的等级不一致。
2. **里程碑**：一个可交付版本发布前后。
3. **时间**：M 级每季度、L 级每月、XL 级双周（S 级不需要定期评审，随项目结束自然终结）。
4. **症状**：连续 5 次以上都是"补丁式修改"（在同一个文件里反复加 if）；或出现"没人敢改"的模块；或新人上手时间超过 1 天。
5. **技术栈变动**：升级运行时/引擎/框架大版本。

### 评审怎么做（M/L 级各 ≤ 1 小时）

```bash
node .ai/bin/ai-arch.mjs scale --gaps        # 1. 规模与欠账
node .ai/bin/ai-arch.mjs review --drift      # 2. 机械漂移（含契约漂移）
node .ai/bin/ai-arch.mjs registry audit      # 3. 契约层：不变量是否还成立
node .ai/bin/ai-arch.mjs review --decisions  # 4. 决策历史
node .ai/bin/ai-arch.mjs task "架构评审：<范围>" --budget 20000   # 5. 生成评审用上下文包
```

第 3 步问的是前两步问不出的问题：**这次改动的契约，当初声明必须恒成立的那些条件还成立吗？** 若不成立，正确动作是改不变量并写 ADR，而不是悄悄改代码。

然后按 `.ai/skills/code-review/SKILL.md` 的"架构评审清单"逐条过，**只产出两类结论**：

- **立即做**（本迭代内）：具体到文件与验收条件。
- **记录待定**（写成 ADR 的 Proposed 状态）：需要更多信息才能决定的。

### 评审的产出物

评审必须留下痕迹，否则等于没做：

1. `.ai/decisions/NNNN-*.md`：每个决策一条 ADR（含"将来回退条件"）。
2. `.ai/index/impact-map.json`：新增/修正的影响规则。
3. `.ai/index/files.json`：受影响的摘要更新。
4. 若结论是"当前架构方案要改"，则更新 `docs/architecture/*`，并在任务包里记录证据。

## 五、规范版本与升级

框架规范本身也会演进。项目与框架的关系是**复制式**（理由见 `docs/04-design-notes.md` 第 6 节）：

```bash
node .ai/bin/ai-arch.mjs upgrade            # dry-run：列出将更新的文件
node .ai/bin/ai-arch.mjs upgrade --apply    # 实际写入
```

三态处理：

| 状态 | 行为 |
|---|---|
| 本地未改动过（hash 与 `managed` 记录一致） | 覆盖为框架最新版 |
| 本地改动过 | **保留不动**，列在"需人工合并" |
| 命中 `protectedPatterns`（如 `docs/architecture/**`、`Assets/**`） | 一律跳过 |

**升级后必须做**：读一遍"需人工合并"清单；跑 `review --drift`；若框架规范变了硬约束，更新项目宪法。

## 六、什么时候该重构，而不是加补丁

以下信号出现 2 个以上，说明该做结构性调整（并写 ADR），而不是继续加 if：

- 同一个文件在最近 5 次任务里被改了 4 次以上（`git log --numstat` 可查）。
- 一个函数的参数超过 5 个，且其中多个只在特定分支使用。
- 出现"必须先调用 A 再调用 B"的隐式时序约定，且没人写下来。
- 测试需要大量 mock 才能跑（说明依赖关系错了）。
- 两个模块互相 import（循环依赖），而当前规模禁止这种做法。
- 新增一个相似功能需要复制粘贴 3 处以上。

**动作顺序**：先写 ADR 记录问题与方案 → 更新影响矩阵 → 生成任务包 → 实施 → 更新摘要 → 提交前漂移检查。

## 七、索引与规范的"最小维护成本"目标

本框架的自我约束：**每次任务结束时的维护动作应控制在 3 条命令、2 分钟以内**。

```bash
node .ai/bin/ai-arch.mjs review --task   # 1. 闭环自查：计划 vs 实际、该补的摘要、该跑的测试、适用规则
node .ai/bin/ai-arch.mjs index --stale   # 2. 按第 1 步给出的清单补摘要（顺带刷新 hash）
node .ai/bin/ai-arch.mjs review --drift  # 3. 终检：确认无残留漂移
```

顺序不能颠倒：第 1 步必须**在回写索引之前**跑，否则它看到的已经是修复后的状态，"本次任务漏了什么"就查不出来了。
第 1 步只重新 hash 任务包列过的文件（不做全树扫描），所以这一步的成本与任务规模成正比，而不是与仓库规模成正比。

如果维护动作超过这个规模，说明索引粒度设计有问题（例如把整个仓库塞进一个索引），应调整粒度而不是放弃维护。
