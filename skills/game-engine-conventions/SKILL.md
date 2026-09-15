---
name: game-engine-conventions
description: Unity / Unreal / Godot / Web 游戏项目的引擎特有约定，重点是"资产不可整读"
when: 在任何游戏引擎项目中工作（场景、预制体、蓝图、资产相关任务时尤其重要）
---

# 引擎特有约定

## 一、最重要的规则：资产文件不要整读

场景、预制体、蓝图、材质、动画文件的体积可能是源码的几十倍，而**其中 95% 是编辑器生成的序列化噪音**。整读它们会瞬间耗尽上下文，而且几乎得不到有用信息。

| 引擎 | 资产格式 | 为什么不能整读 | 正确做法 |
|---|---|---|---|
| Unity | `.unity`（场景）、`.prefab`、`.asset`、`.mat` | 巨型 YAML，含 GUID、fileID、序列化组件逐字段展开 | 读 `.ai/index/asset-index.md` 里的摘要；需要细节时只读相关片段（按 `GameObject`/组件名定位） |
| Unreal | `.uasset`、`.umap` | **二进制**，无法读 | 只能靠命名约定、`.ai/index/asset-index.md`、以及 C++ 侧引用（`TSoftObjectPtr` 路径）理解 |
| Godot | `.tscn`、`.tres` | 文本但节点树 + 资源引用冗长 | 按需只读被改动的节点段；先读 `asset-index.md` 定位行号区间 |
| Web | 图集/JSON 关卡数据 | 大数据文件 | 读 schema 与摘要，不读实例数据 |

**判定方法**：文件 > 200KB，或扩展名在 `.unity/.prefab/.uasset/.umap/.tscn/.tres/.asset` 中 → **不整读**。

## 二、编辑器与运行时的边界

| 引擎 | 编辑器专有代码位置 | 规则 |
|---|---|---|
| Unity | `Assets/Editor/`、`Assets/**/Editor/` | 运行时脚本不得引用 `UnityEditor` 命名空间；用 `#if UNITY_EDITOR` 包裹 |
| Unreal | `WITH_EDITOR` / `WITH_EDITORONLY_DATA` | 编辑器专用逻辑必须条件编译；`UEditorSubsystem` 与 `UGameInstanceSubsystem` 分清 |
| Godot | `@tool` 脚本 | `@tool` 会同时在编辑器运行——其中的副作用代码必须显式判断 `Engine.is_editor_hint()` |
| Web | 构建脚本 vs 运行时代码 | 构建期依赖不得进入运行时包（检查 bundle 体积） |

## 三、引擎项目不可入库的目录

| 引擎 | 忽略 | 说明 |
|---|---|---|
| Unity | `Library/`、`Temp/`、`Obj/`、`Logs/`、`*.csproj`、`*.sln`、`UserSettings/` | 全部是生成物 |
| Unreal | `Binaries/`、`Intermediate/`、`Saved/`、`DerivedDataCache/`、`.vs/` | 生成物；`.uproject` 与 `Config/` 要入库 |
| Godot | `.godot/`、导出产物 | 导入缓存 |
| Web | `dist/`、`node_modules/` | 构建产物 |

**`.meta` 文件（Unity）必须入库**，但**不要手改**：GUID 变了会导致所有引用断裂。新增资产让编辑器生成。

## 四、引擎特有反模式

### Unity
- ❌ 在 `Update()` 里 `FindObjectOfType` / `GetComponent` / `Camera.main` —— 缓存到字段。
- ❌ 用字符串 `SendMessage` / `Invoke` —— 无法静态检查，重命名就断。
- ❌ 每帧 `new` 对象或拼接字符串（GC 抖动）—— 用对象池/StringBuilder。
- ❌ 把逻辑写在 `MonoBehaviour` 里并直接互相引用 —— 用事件或显式注入。
- ❌ 用 `Resources/` 装大量资产（会全部打进包）—— 用 Addressables。

### Unreal
- ❌ 在 Tick 里做重活或频繁 `SpawnActor`；用计时器/事件驱动。
- ❌ 蓝图与 C++ 职责不清：**判断标准**——需要高频执行、被多处复用、需要测试 → C++；一次性关卡逻辑、美术调参 → 蓝图。混用规则必须写进 `docs/architecture/bp-vs-cpp.md`。
- ❌ 忘记 `UPROPERTY()` 导致对象被 GC 回收（悬垂指针）。
- ❌ 硬编码资产路径字符串 —— 用 `TSoftObjectPtr` 或在配置里集中管理。

### Godot
- ❌ 滥用 autoload 单例（全局状态难测）—— 清单与使用规则写进 `docs/architecture/autoload-and-signals.md`。
- ❌ 用全局信号总线做所有通信 —— 调用链不可见；仅用于跨场景的少数事件。
- ❌ 在 `_process` 里做重活；用 `_physics_process` 处理物理，注意固定步长假设。

### Web
- ❌ 帧循环内分配对象/闭包/字符串。
- ❌ 资源加载无失败回退（网络会失败）。
- ❌ 只支持键鼠或只支持触摸。
- ❌ 首屏体积失控（把整个引擎与所有关卡打进一个 bundle）。

## 五、验证命令（写进项目宪法）

| 引擎 | 快速验证 | 完整验证 |
|---|---|---|
| Unity | 编辑器内运行 PlayMode 测试 | `Unity -batchmode -runTests -testPlatform PlayMode -projectPath .`；构建 `-executeMethod` |
| Unreal | 编辑器内 PIE + 自动化测试 | `RunUAT BuildCookRun`；`-ExecCmds="Automation RunTests ..."` |
| Godot | `godot --headless --quit` 检查脚本错误 | `godot --headless -s tests/run_tests.gd`；导出 `--export-release` |
| Web | `npm run typecheck && npm test` | 生产构建 + 帧率/体积基准 |

**注意**：引擎的完整验证通常很慢（分钟级）。把"快速验证"与"提交前完整验证"分开写进宪法，避免因为慢而跳过全部验证。

## 六、游戏项目的规模判定补充

游戏项目的"模块数"按**系统**计（输入/渲染/UI/音频/存档/关卡/战斗/网络），而不是按脚本文件数。一个 20 万行的游戏可能只有 12 个系统，但系统间的耦合程度决定架构复杂度。
判定时额外看两项：**实体/对象规模的量级**（决定是否需要 ECS/对象池）与**帧预算**（决定是否能承受抽象层开销）。
