# 模块划分与依赖方向

> 本文回答：有哪些模块、各自的职责边界、谁能依赖谁、加模块要走什么流程。
> 代码目录细节见 `Source/{{projectTitle}}/README.md`，构建与打包见 `{{docsDir}}/runbooks/build-and-verify.md`。

## 1. 模块清单（必须与 `Source/*.Build.cs` 一致）

| 模块 | 职责（一句话） | 依赖 | 被谁依赖 | 风险 |
|---|---|---|---|---|
| `{{projectTitle}}` | 游戏装配层：GameMode/PlayerController/关卡流程 | `Core`, `Combat`, `Inventory`, `UI` | 无（顶层） | high |
| `Core` | 共享契约：接口、枚举、通用数据结构、子系统基类 | 仅引擎模块 | 全部 | high |
| `Combat` | 战斗规则：伤害计算、连招、冷却 | `Core` | 装配层 | med |
| `Inventory` | 物品、装备、背包规则 | `Core` | 装配层 | med |
| `UI` | UMG 视图与 HUD 绑定 | `Core`, 各模块的 `Public` 接口 | 装配层 | med |

规则：**依赖单向无环**（`装配层 → 玩法模块 → Core`）。新增模块必须补本表并写 ADR。

## 2. 判定"该不该新建模块"

四个条件**全部满足**才建新模块，否则放进现有模块：

1. 有独立的领域概念（不是"技术层"，如"工具类"不算）；
2. 能被至少 2 个上层模块独立使用，或有清晰的生命周期边界；
3. 依赖方向能保持单向（不会需要反向依赖）；
4. 规模上值得：预计 >1500 行或 >10 个类。

只满足 1、2 但不满足 3、4 → 先在现有模块里放子目录，等证据充分再拆（拆分要写 ADR）。

## 3. 跨模块通信规则

| 方式 | 何时用 | 明确不用 |
|---|---|---|
| 直接调用 `Public/` 接口 | 同步、有明确返回值、调用方需要立即结果 | 玩法模块之间互相直调（易成环） |
| **C++ 委托 / 多播委托** | 一对多通知（如"血量变化"）、模块不想知道订阅者 | 用它传大量数据（应传句柄或 ID） |
| **GameplayTags + 事件** | 需要数据驱动、策划可配的触发 | 把它当通用消息总线用 |
| **Subsystem（`UWorldSubsystem` / `UGameInstanceSubsystem`）** | 需要一个有明确生命周期的共享服务 | 把它当全局变量的垃圾桶 |
| 蓝图事件分发器 | **仅**在装配层向 UI 转发表现层事件 | 玩法规则用蓝图分发器串联 |

约定：

- 事件/委托的**载荷（payload）是契约**：改字段必须写 ADR 并同步所有订阅者摘要（`files.json` 的 `imports`）。
- 广播方不关心订阅者是否存活：接收方自己保证在 `EndPlay` 解绑。
- **禁止**用 `GetWorld()->GetAuthGameMode()`/`GetGameInstance()` 到处强转取服务；服务通过 Subsystem 或初始化注入获得。

## 4. `Public/` 与 `Private/` 的边界

- 只有确实需要在模块外使用的类型才放 `Public/`。
- 只在本模块使用的助手类放 `Private/`；被外部 include 视为边界破坏，评审退回。
- 需要跨模块"看到行为"但不想暴露实现 → 用 `UINTERFACE`。
- 头文件里优先前置声明，减少 `#include` 传染（直接影响全项目编译时间）。

## 5. 加模块 / 改依赖的流程

1. 写 ADR：为什么新模块、职责边界、依赖与被依赖、迁移计划（现有代码怎么搬）。
2. 建 `Source/<Module>/<Module>.Build.cs`，明确 `PublicDependencyModuleNames` 与 `PrivateDependencyModuleNames`。
3. 改 `.uproject` 的 `Modules` 列表 → **重新生成项目文件**（见 runbook 第 0 节）→ 重编译。
4. 更新本文件第 1 节表格 + `{{aiDir}}/index/files.json` 的 `module` 字段。
5. 跑 L0 编译 + L1 测试；涉及装配层的改动跑 L2 打包冒烟。

## 6. 反模式

| 反模式 | 症状 | 改成 |
|---|---|---|
| 巨型 `Game` 模块（什么都往里塞） | 改一行触发全量重编译；职责说不清 | 按领域拆模块（见第 2 节判定） |
| 循环依赖后用"前置声明 + 延迟加载"绕过 | 链接期或运行期才炸 | 把契约下沉到低层模块 |
| `Core` 依赖具体玩法模块 | 依赖方向反转，Core 无法复用 | Core 只放契约，不含规则 |
| 每个功能建一个模块 | 模块爆炸、构建变慢、边界噪音 | 先目录后模块（第 2 节） |
| 用 Subsystem 当全局变量容器 | 隐式依赖、测试困难 | 明确接口 + 初始化注入 |
| 蓝图分发器串联玩法规则 | 规则藏在资产里，不可 review | 规则进 C++，蓝图只做表现 |

## 7. 与其他文档的关系

- 蓝图 vs C++ 边界：`{{docsDir}}/architecture/bp-vs-cpp.md`
- 代码目录与反射规则：`Source/{{projectTitle}}/README.md`
- 配置项与打包规则：`Config/README.md`
- 资产索引：`{{aiDir}}/index/asset-index.md`
