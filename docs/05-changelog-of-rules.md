# 规则变更记录

> 记录**规则级**变更（新增/修改/删除硬约束、阈值、强制流程）。普通内容修订（错别字、示例更新）不记录。
> 格式与要求见 `docs/system/09-change-protocol.md` 第四节。

## 2026-03-04 — 初始规则集

- **变更**：新增（框架首次发布）
- **内容**：
  - 上下文分层与预算：`AGENTS.md` ≤ 120 行 / ≤ 1200 token；`.ai/constitution.md` 同；任务包默认预算 40000 token。
  - 规模四级（S/M/L/XL）与各自"必须有 / 禁止"清单。
  - 设计模式 `minLevel` 门槛：低于当前规模引入视为缺陷。
  - 零依赖、跨平台、不猜变量、阈值有出处（见 `docs/system/01-constitution.md`）。
  - 提交前必须通过 `scripts/validate.mjs` 与 `scripts/selftest.mjs`。
- **原因**：解决 AI 协作中的重复读取、从零搭架、规范腐化三个问题。
- **影响**：全部模板包、CLI、skills。
- **替代机制**：不适用（初始版本）。

## 2026-09-17 — 新增约束必须先入库（规则集 + 项目事实）

- **变更**：新增
- **内容**：
  - 任何新增约束必须先进 `.ai/rules.json`（含稳定 ID、`enforcement`、必填 `--check`）再改代码；不可判定的措辞被 CLI 拒绝入库。
  - 新能力/新事实必须落盘 `.ai/project-facts.json`，并由 `doctor` 检查是否与实测一致。
  - 项目规则与事实的 hash 进入任务包，hash 变化即要求下次任务重读。
- **原因**：约束只在对话里说过一次，下一次开工必然失效；能力变化会改变"什么做法可行"，靠人记不住。
- **影响**：全部模板包（新增 `rules.json` / `project-facts.json` 种子）、`review --impact`、任务包渲染。
- **替代机制**：不适用（新增约束，未删除旧规则）。

## 2026-09-17 — 契约层必须可对账（实体注册表）

- **变更**：新增
- **内容**：
  - `.ai/registry.json` 的实体新增两项要求：`hash`（与该实体文件在 `.ai/index/files.json` 中的 hash 前 10 位一致）与 `tests`（能发现不变量被破坏的测试文件）。两者缺失会被 `ai-arch registry audit` 指出。
  - `review --drift` 与 `doctor` 新增机械检查：`entity-hash-stale`（契约被改但注册表未同步）、`entity-file-missing`、`entity-unindexed`、`high-risk-unregistered`、`registry-empty`。
  - 判定标准与规则集一致：**判定不了的条目等于没有条目**（缺 `invariants`、不变量不可判定、有不变量却无 `tests`，都会被指出）。
- **原因**：索引只能回答"文件变没变"，回答不了"契约的语义变了吗"。缺少 `hash` 与 `tests` 时，契约静默漂移无法被任何机制发现，后续 AI 会拿**旧的不变量**做判断。
- **影响**：`.ai/registry.json` 格式（向后兼容：两个字段均为可选，但缺失会被报告）、`review --drift` 输出、`doctor`、任务无关的 CI 接入方式。
- **替代机制**：不适用（新增检查，未删除旧规则）。

## 2026-09-17 — 任务收尾必须机械对账（计划 vs 实际）

- **变更**：新增
- **内容**：
  - 新增 `ai-arch review --task [<id>]`：拿任务包记录的 hash 重新对账任务包列过的文件，检出 `task-premise-stale`（当时只让读摘要的文件已变且摘要仍旧）、`task-index-stale`、`task-digest-stale`、`task-entity-stale`、`task-evidence-missing` 等项；`--strict` 下有问题即退出码 1，可直接做提交门禁。
  - 收尾顺序固定为 **`review --task` → `index --stale` → `review --drift`**，且第 1 步必须在回写索引之前（否则看不到本次漏了什么）。
  - 任务包的"验收标准"里，可机械判定的两项（索引摘要已同步、契约影响面已同步）由 CLI 判定，不再要求人自己声称；判定不了的标 ⬜ 而不是假装 ✅。
  - 任务包新增 `indexSchemaVersion` 字段；同名任务包不再互相覆盖（加序号后缀）。
- **原因**：任务包此前是**单向**产物——它说"计划读什么"，却没有任何机制检查"实际改了什么、当时的前提还成立吗"。于是收尾动作只能靠人记得，而"记得"在 AI 协作里等于不存在。
- **影响**：全部模板包、`review` 命令、任务包格式（向后兼容：旧任务包缺少 `indexSchemaVersion` 时会被当作"格式未知"，多读一次索引说明）、`docs/system/04-context-discipline.md`、`05-lifecycle.md`、`07-cli.md`、`09-change-protocol.md`。
- **替代机制**：不适用（新增检查，未删除旧规则）。

## 2026-09-17 — 规则的"传播"必须被验收，而不只是被打印

- **变更**：新增
- **内容**：
  - `rules audit`（以及 `doctor`）新增机械检查 `rule-not-propagated`：搜索规则 ID 是否真的出现在 `.ai/constitution.md`、`.ai/index/impact-map.json`、`.ai/skills/code-review/SKILL.md` 里；只存在于 `.ai/rules.json` 的规则会被报出（匹配大小写不敏感，`rules add` 自动写入的影响矩阵 trigger 也算引用）。
- **原因**：`rules add` 会打印一份传播清单，但**打印清单不等于传播发生**。规则的三条腿（任务包可见 / 变更时触发 / 评审时逐条看到）里，后两条此前完全没有验收。
- **影响**：`rules audit`、`doctor`（新增 `rules-not-propagated`）、手工编辑 `rules.json` 的项目会立刻看到该提示。
- **替代机制**：不适用（新增检查，未删除旧规则）。

## 2026-09-17 — 上下文预算阈值与实际一致（AGENTS.md 2100 → 2500 token）

- **变更**：修改
- **内容**：
  - `AGENTS_TOKEN_BUDGET` 由 2100 调到 2500（行数上限仍是 150）。`.ai/constitution.md` 上限不变（1800 token / 150 行）。
  - 文档里所有"≤ 120 行"的旧口径统一为 **150 行**（`docs/system/01-constitution.md`、`04-context-discipline.md`、`06-memory.md`、`08-documentation.md`、`docs/04-design-notes.md`、`docs/06-faq.md`、README、模板里的提示文字）。此前存在 120 / 130 / 150 三个数字并存的情况，而实际强制值是 150。
  - `game-unreal` 的 `AGENTS.md` 把"引擎 ≥5.8 + 插件标识 + AllToolsets"这类**版本相关事实**从常驻文件里移除，改为指向 `.ai/project-facts.json` 与 `ai-arch facts`（理由见 `docs/04-design-notes.md` 第 8 节：把版本相关事实写死在文档正文里，会在版本升级后变成错误指导）。
- **原因**：`game-unreal` 实测 2392 token，**新 init 的 UE 项目一开局就报 `context-budget`**——阈值变成了噪音而不是约束。2100 是在游戏类实测 1900–2050 时定的，模板长到 2390 却没有同步上调；而按 `docs/04-design-notes.md` 的取舍，这 10 条 UE 专项硬约束与编译/测试/打包命令**不该砍**。阈值必须与实际一致，否则"检查通过"与"内容合规"就脱钩了。
- **影响**：全部模板包（`AGENTS.md`）、`cli/lib/limits.mjs`、`docs/system/04-context-discipline.md` 的预算表、`doctor` 与 `review --drift` 的 `context-budget` 判定。
- **替代机制**：不适用（调阈值并同步文档出处，未删除任何检查）。

## 2026-09-17 — 上下文文件必须进索引（否则 L1/L2 无法对账）

- **变更**：修改
- **内容**：
  - 索引范围从"排除整个 `.ai/`"改为"排除框架快照与存证类文件（`.ai/framework`、`.ai/bin`、`.ai/lib`、`.ai/tasks`、`.ai/cache`、技能副本、ADR），**收录参与判定的上下文文件**（宪法、注册表、影响矩阵、索引说明、skills 说明、规则集、项目事实）。
  - `files.json` 的 `summary` 拆成 `totalLoc`（源行数，规模等级判定用）与 `contextLoc`/`contextFiles`（上下文行数）。
  - 任务包的必读清单改为**条件必读**：`.ai/index/README.md` 只在"本项目第一次任务"或"索引 schemaVersion 变化"时列入，跳过时在任务包里写明原因。
- **原因**：文档写的是"框架快照不进索引"，实现却是 `startsWith('.ai/')` ——**每会话必读的 `constitution.md` 反而成了唯一没有 hash、无法对账的文件**；同时 `AI_CORE_PATHS`/`aiContextPriority`/`staleFiles` 这些按"它会在索引里"写的机制成了死代码。另外，固定成本不能包含框架自己声明"只需读一次"的文件。
- **影响**：`.ai/index/files.json`（结构向后兼容，新增两个 summary 字段）、任务包必读清单、`docs/system/04-context-discipline.md`、`07-cli.md`、`schema/index.schema.json`。已有项目的 `contextLoc` 会在下次 `index` 时出现。
- **替代机制**：不适用（修正实现与文档不一致，未放宽任何检查）。

<!--
新增规则时复制下面的模板：

## YYYY-MM-DD — <规则名>
- 变更：新增 | 修改 | 删除
- 原因：<触发这次变更的具体问题>
- 影响：<受影响的项目/模板/命令>
- 替代机制：<删除规则时必须有>
-->
