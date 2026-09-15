# 项目宪法 — {{projectTitle}}

> L1 层：每会话必读，≤120 行。只写**本项目专属**的红线与可执行验证命令；通用规范来自框架（`packId: {{packId}}`，`frameworkVersion {{frameworkVersion}}`）。
> 最后更新：{{date}}，负责人：{{owner}}。

## 1. 项目事实

| 项 | 值 |
|---|---|
| 引擎 / 版本 | Unreal Engine **{{ueVersion}}**（以 `{{projectTitle}}.uproject` 的 `EngineAssociation` 为准） |
| 项目形态 | {{#IF usesBlueprint}}C++ 与 Blueprint 混合（边界见 `{{docsDir}}/architecture/bp-vs-cpp.md`）{{/IF}}{{#UNLESS usesBlueprint}}纯 C++（引入蓝图资产需先写 ADR）{{/UNLESS}} |
| C++ 源码根 | `{{srcDir}}` |
| 平台 / 帧率 | 待填写：`Win64 / Linux / Android / iOS / PS5 / XSX`；目标 `60 FPS @ 1080p`（游戏线程与渲染线程分开记） |
| 规模等级 | {{scaleLevel}} / {{scaleName}} |

## 2. 红线（违反即拒绝合并）

1. **不整读 `.uasset`/`.umap`**（二进制）；资产理解走 `{{aiDir}}/index/asset-index.md` + `Content/README.md` 命名约定。
2. **持有 `UObject` 的成员必须有 `UPROPERTY()`**，否则 GC 回收后成野指针（最难查的崩溃）。
3. **UObject 禁止裸 `new`/`delete`**：用 `NewObject`/`CreateDefaultSubobject`/`SpawnActor`。
4. **`Binaries/`、`Intermediate/`、`Saved/`、`DerivedDataCache/`、`.vs/` 不得入库**。
5. **禁止伪造验证结果**：没编译过、没跑过的测试不许写"通过"；不能验证的必须写"未验证 + 原因 + 人工步骤"。
6. **禁止越规模引入架构**：DI 框架、自研事件总线、ECS 重架构、CQRS 分层在 {{scaleLevel}} 级不做；要做得先升级规模等级并写 ADR。
7. **跨模块只 include `Public/` 下的头文件**；`Private/` 被外部引用视为边界破坏。
8. **数值不写死在 C++**：可调数值放 DataAsset/DataTable，否则每次调参都要重编译。

## 3. 已批准依赖

| 依赖 / 插件 | 版本 | 用途 | 批准方式 |
|---|---|---|---|
| 待填写 | | | ADR-000 或"引擎内置" |

新增任何 Plugin、第三方库或 `.Build.cs` 模块依赖，**必须先写 ADR**。

## 4. 验证命令（DoD 的唯一依据）

按成本从低到高，**能停在低层就不要往上跑**：

```bash
# L0 编译（增量；改头文件/模块/Build.cs 前先重新生成项目文件）
Build.bat {{projectTitle}}Editor Win64 Development -Project="%CD%\{{projectTitle}}.uproject" -WaitMutex
# L1 自动化测试（无头，前缀 Project.）
UnrealEditor-Cmd.exe "%CD%\{{projectTitle}}.uproject" -ExecCmds="Automation RunTests Project;Quit" -unattended -nopause -nullrhi -log
# L2 打包冒烟（改资产/配置/模块，或里程碑时）
RunUAT.bat BuildCookRun -project="%CD%\{{projectTitle}}.uproject" -noP4 -platform=Win64 -clientconfig=Development -cook -build -stage -pak -archive -archivedirectory=Build
# L3 索引漂移检查（每次提交前）
node .ai/bin/ai-arch.mjs review --drift
```

- 引擎路径：待填写（如 `C:\Program Files\Epic Games\UE_{{ueVersion}}\Engine\Build\BatchFiles\Build.bat`）。
- 判定：编译退出码 0 且日志无 `error C`；测试 0 failed；打包退出码 0 且 `Build/` 下存在可执行文件。
- 生成物（`Binaries/`、`Intermediate/`、`Saved/`、`Build/`）不入库，只把结果摘要写进任务包。
- 只在编辑器 Play 过一次的改动，任务包必须写"仅 PIE 验证 + 未跑的命令 + 风险"。

## 5. 性能与成本预算

| 指标 | 预算 | 超标处理 |
|---|---|---|
| 游戏线程帧时间 | 待填写：例如 `≤10 ms`（60 FPS 下留渲染余量） | Unreal Insights 抓帧定位，前后数据写进任务包 |
| 渲染线程帧时间 | 待填写：例如 `≤12 ms` | `stat unit` / `ProfileGPU`；禁止用"降画质"草率收尾 |
| `Tick` 中堆分配 | `0`（稳态） | 定位分配源（`FString` 拼接、`TArray` 增长、动态材质）并改缓存 |
| 关卡加载时间 / 包体 | 待填写 | 加载用 `AssetManager` 按需加载或关卡流送（ADR）；包体先查扫描路径与 `DirectoriesToAlwaysCook` |
| 蓝图 `EventGraph` Tick 节点 | 待填写上限 | 迁移到 C++（见 `bp-vs-cpp.md`） |

## 6. 规模门槛

{{> SHARED:scale-gate}}

## 7. 决策记录

- 目录：`{{aiDir}}/decisions/`，模板：`{{aiDir}}/templates/adr.md`，命名：`ADR-0001-<kebab-title>.md`。
- 何时必须写：

{{> SHARED:decision-trigger}}

## 8. 变更影响（改 A 必须同步 B）

| 改了 | 必须同步 |
|---|---|
| `Source/**` 下任何 `.h`/`.cpp` | `{{aiDir}}/index/files.json` 的 `hash` 与 `digest` |
| `Public/` 下头文件的签名 | 全项目重编译 + 更新所有调用方摘要 + 跨模块契约写 ADR |
| `.Build.cs` / 模块列表 / `.uproject` | 重新生成项目文件 + `{{docsDir}}/architecture/module-layout.md` + ADR |
| `Config/*.ini` 的核心项（GlobalDefaultGameMode、AssetManager、碰撞、渲染） | ADR + `Config/README.md` + 打包冒烟 |
| 任何 `Content/**` 资产 | `{{aiDir}}/index/asset-index.md` 对应条目 |
| 蓝图与 C++ 的职责边界 | `{{docsDir}}/architecture/bp-vs-cpp.md` + ADR |
| 引擎版本 / 新增 Plugin | 本文件第 1、3 节 + ADR + 全量重编译与回归 |
