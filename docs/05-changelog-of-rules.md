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
- **原因**：索引只能回答"文件变没变"，回答不了"契约的语义变了吗"。缺少 `hash` 与 `tests` 时，契约静默漂移无法被任何机制发现，后续 AI 会拿**旧的不变量**做判断（来源：`docs/07-research-landscape.md` §6.1）。
- **影响**：`.ai/registry.json` 格式（向后兼容：两个字段均为可选，但缺失会被报告）、`review --drift` 输出、`doctor`、任务无关的 CI 接入方式。
- **替代机制**：不适用（新增检查，未删除旧规则）。

<!--
新增规则时复制下面的模板：

## YYYY-MM-DD — <规则名>
- 变更：新增 | 修改 | 删除
- 原因：<触发这次变更的具体问题>
- 影响：<受影响的项目/模板/命令>
- 替代机制：<删除规则时必须有>
-->
