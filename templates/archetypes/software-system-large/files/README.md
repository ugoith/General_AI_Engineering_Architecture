# {{projectTitle}}

{{description}}

- 项目名：`{{projectName}}` ｜ 负责人：{{owner}} ｜ 规模：{{scaleLevel}} / {{scaleName}} ｜ 运行时：`{{runtime}}` ｜ 包管理：{{packageManager}}
- 治理入口：`AGENTS.md`（AI 入口）｜ `{{aiDir}}/constitution.md`（红线与验证命令）
- L 级强制项：`{{docsDir}}/architecture/contracts/README.md`（契约版本策略）、`{{docsDir}}/architecture/dependency-rules.md`（依赖规则）、`{{docsDir}}/architecture/performance-budget.md`（性能预算）

## 快速开始

```bash
# 1. 环境准备（多模块、环境变量与排障见 docs/runbooks/local-dev.md）
<安装依赖命令>

# 2. 起本地环境（可能包含多个进程/服务）
<启动命令>

# 3. 全量验证（与 .ai/constitution.md 的“验证命令”一致）
<单元测试> && <契约测试> && <依赖规则检查> && <性能基准>
```

## 系统概览

| 子系统 / 模块 | 职责 | 公开出口 | 依赖 | owner |
|---|---|---|---|---|
| `<module-a>` | <一句话职责> | `{{srcDir}}/modules/<module-a>/public` | <依赖的模块> | <@team> |

权威版本在 `{{docsDir}}/architecture/overview.md`。模块边界、所有权与数据访问规则见 `{{srcDir}}/modules/README.md`。

## 治理规则（本规模不可省略）

1. **契约版本化**：任何对外或跨团队契约的变更，先按 `{{docsDir}}/architecture/contracts/README.md` 的流程确定版本与弃用期，并写 ADR。
2. **依赖规则自动化**：模块依赖方向由 CI 检查，违反即失败；例外必须登记在 `{{docsDir}}/architecture/dependency-rules.md` 的例外表里。
3. **性能预算**：预算超标不能"顺手放过"——要么修复，要么写 ADR 修改预算（见 `{{docsDir}}/architecture/performance-budget.md`）。
4. **评审节奏**：固定周期做一次架构评审（对照 ADR、依赖规则、预算与索引漂移）；规模变化必须写 ADR。
5. **明确禁止**：无 ADR 的跨模块重构、隐式全局状态、绕过契约层的跨模块直连、直接访问其他模块的数据表。

## 文档地图

| 你想知道 | 读这个 |
|---|---|
| 子系统怎么划分、依赖什么方向 | `{{docsDir}}/architecture/overview.md` |
| 数据归谁所有、有哪些不变量 | `{{docsDir}}/architecture/data-model.md` |
| 接口契约、错误码、兼容矩阵 | `{{docsDir}}/architecture/interfaces.md` |
| 契约清单与版本/弃用策略 | `{{docsDir}}/architecture/contracts/README.md` |
| 依赖规则与自动化检查怎么接 | `{{docsDir}}/architecture/dependency-rules.md` |
| 性能预算与测量方式 | `{{docsDir}}/architecture/performance-budget.md` |
| 本地怎么跑、怎么排障 | `{{docsDir}}/runbooks/local-dev.md` |
| 为什么当初这么选 | `{{aiDir}}/decisions/` |
| 某文件干什么（不读源码） | `{{aiDir}}/index/files.json` |

## 提交前必须做

```bash
node {{aiDir}}/bin/ai-arch.mjs index --stale     # 摘要同步
node {{aiDir}}/bin/ai-arch.mjs review --drift    # 漂移检测
node {{aiDir}}/bin/ai-arch.mjs review --impact <改动文件>   # 影响面与应跑的测试
```

不允许新增 error/warn；`ASSUMPTION:` 与未能解决的问题写进任务包的"遗留风险"。
