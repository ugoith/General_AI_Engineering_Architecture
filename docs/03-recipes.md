# 实战配方：具体场景怎么做

> 每个配方都是"照着做就行"的步骤。所有命令都在项目根目录执行（`node .ai/bin/ai-arch.mjs`）。

## 配方 1：第一次接入一个 5 万行的既有后端

```bash
# 1. 接入（不覆盖已有文件）
node ~/ai-arch/cli/ai-arch.mjs init . --pack software-app-medium

# 2. 建立基线索引；大仓库用 --area 分域处理
node .ai/bin/ai-arch.mjs index
node .ai/bin/ai-arch.mjs scale --gaps          # 看规模与欠账

# 3. 只给高价值文件写摘要（通常 10 个以内，收益最高）
node .ai/bin/ai-arch.mjs index --stale --json > .ai/cache/digest-request.json
# → 交给 AI：只处理 risk=high 且 importedBy 最多的 8 个
node .ai/bin/ai-arch.mjs index --apply .ai/cache/digests.json

# 4. 填宪法里的验证命令（没有这一步，后续 AI 无法自证完成）
# 5. 第一次任务前先看影响面
node .ai/bin/ai-arch.mjs task "重构鉴权中间件" --area src/auth --budget 30000
```

**预期效果**：第二次做同类任务时，读取清单里的文件大多标为"读摘要"，估算 token 下降到首次的 1/5 – 1/10。

## 配方 2：新增一个功能（标准闭环）

```bash
# 1. 需求转任务包
node .ai/bin/ai-arch.mjs task "支持导出 CSV，字段与列表页一致，含表头"

# 2. 让 AI 先只做"读取 + 计划"，不写代码：把任务包第 3 节（范围）填完再动手

# 3. 实施后收尾
node .ai/bin/ai-arch.mjs index
node .ai/bin/ai-arch.mjs index --stale       # 通常 0–3 个文件
node .ai/bin/ai-arch.mjs review --drift
```

**判断标准**：任务包第 6 节（证据）里必须有真实命令输出，不接受"测试通过"四个字。

## 配方 3：改了数据库 schema

```bash
# 1. 先看影响面（哪个模块受影响、哪些测试要跑）
node .ai/bin/ai-arch.mjs review --impact src/db/schema.sql

# 2. 会看到影响矩阵要求：更新 .ai/registry.json + docs/architecture/data-model.md，且需要 ADR
cp .ai/templates/adr.md .ai/decisions/0008-add-user-timezone.md

# 3. 改完对账：注册表里的 invariants 必须与真实实现一致
node .ai/bin/ai-arch.mjs review --drift
```

**为什么要 ADR**：数据契约变更的代价最高、最难回退，而"当时为什么加这个字段"是半年后最值钱的信息。

## 配方 4：修一个偶发 bug

```bash
# 用报错里的函数名/字段名当关键词，命中率最高
node .ai/bin/ai-arch.mjs task "修复：切场景后 player 位置回到原点，偶发"
```

按 `skills/bugfix-triage/SKILL.md` 的七步走；**先复现再修**。修完必须：

- 加一条能失败的回归测试；
- 故意改坏实现确认测试会红；
- 把根因写进任务包第 5 节；
- 若根因是结构性的 → 写 ADR 或往影响矩阵加规则。

## 配方 5：AI 生成了过度设计的代码，要收敛

```bash
node .ai/bin/ai-arch.mjs patterns --level S      # 看当前规模的禁止清单
```

常见过度设计与其替代：

| 生成物 | 问题 | 替代 |
|---|---|---|
| `IUserRepository` + `UserRepositoryImpl`（只有一个实现） | 无第二个实现时接口无法验证 | 具体类 + 把 SQL 集中在一个文件 |
| `EventBus` + 3 个 handler（为解耦） | 调用链不可见 | 显式调用 + 一处 `onUserCreated()` 汇总函数 |
| `AbstractFactory` + `Strategy` 族（为一个分支） | 抽象成本高于收益 | 一个 `if` 或一个查表对象 |
| 每个实体一个 DTO/Mapper/VO 三层 | 纯粹样板 | 一个类型 + 一个转换函数 |

**动作**：跟 AI 明确"当前规模禁止清单"，并要求它给出"引入该抽象能解决的具体已发生问题"；给不出就删掉。

## 配方 6：接手一个陌生模块

```bash
node .ai/bin/ai-arch.mjs task "接手并说明 src/payments 的结构与风险" --area src/payments --budget 25000
node .ai/bin/ai-arch.mjs review --impact src/payments/index.ts
node .ai/bin/ai-arch.mjs review --decisions
```

读顺序：任务包的必读 → 模块内摘要 → 只有摘要不足时才读源码 → 相关 ADR → 运行手册。
**产出**：把这个模块的"非显然知识"补进摘要的 `invariants`，让下一个人不再重新摸索。

## 配方 7：游戏项目做资产索引（关键差异化）

场景/预制体/蓝图**不能整读**。做法：

```bash
node .ai/bin/ai-arch.mjs task "新增 Boss 战场景：需要哪些已有资产与系统" --area Assets/Scripts
```

然后按 `.ai/index/asset-index.md` 的规范登记资产：

| 字段 | 示例 |
|---|---|
| 路径 | `Assets/Scenes/BossArena.unity` |
| 用途 | Boss 战主场景，含摄像机轨道与两阶段刷怪点 |
| 依赖 | `Assets/Prefabs/Boss_*.prefab`、`Assets/Scripts/Combat/*` |
| 负责模块 | Combat |
| 变更风险 | 高（被 BuildSettings 与 3 个测试场景引用） |
| 关键字段（摘要） | 两阶段、玩家出生点 2 个、存档点 1 个 |

**判定方法**：文件 > 200KB 或扩展名在 `.unity/.prefab/.uasset/.umap/.tscn/.tres` 中 → 不整读，只读索引摘要。

## 配方 8：定期架构评审（1 小时）

```bash
node .ai/bin/ai-arch.mjs scale --gaps
node .ai/bin/ai-arch.mjs review --drift
node .ai/bin/ai-arch.mjs review --decisions
node .ai/bin/ai-arch.mjs task "架构评审：<范围>" --budget 20000
```

按 `skills/code-review/SKILL.md` 的"八问清单"逐条过。**只产出两类结论**：

1. 立即做（具体到文件 + 验收条件）；
2. 记录待定（写成 Proposed 状态的 ADR）。

"以后要注意"不算结论。评审结束必须有 ADR 或影响矩阵的改动，否则等于没做。

## 配方 9：框架升级

```bash
node .ai/bin/ai-arch.mjs upgrade            # dry-run，看会发生什么
node .ai/bin/ai-arch.mjs upgrade --apply
node .ai/bin/ai-arch.mjs review --drift     # 确认升级没引入漂移
```

若你改过框架文件，它们会出现在"需人工合并"里；逐个决定是接受框架版本还是保留你的改动。
**不要**直接 `--force`（会丢掉本地改动）。

## 配方 10：多项目/多仓库的统一

框架是复制式的，所以每个项目独立维护自己的 `.ai/`。跨项目统一的方式：

- 统一规范：都从**同一版本**的框架 `init`，`frameworkVersion` 记在 `.ai/framework.json` 里，可对比。
- 统一模板：把团队约定加进自己的 archetype 模板包（见 `templates/_schema/pack.schema.md` 的最小步骤）。
- 统一检查：CI 里都跑 `review --drift --strict` + `doctor`。
- **不要**试图用 submodule 挂载同一份 `.ai/`：项目会失去自治能力（理由见 `docs/04-design-notes.md` 第 6 节）。
