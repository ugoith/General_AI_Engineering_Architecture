# 资产索引（scene / prefab / material / config）

> L2 层。**这是理解本项目资产的唯一入口。** 任何任务在碰资产之前先读本文件对应条目；
> 只有在摘要不足以决策时，才允许按"按行定位读"的方式打开资产原文（见第 4 节）。
> 维护者：改动资产的人（不是"以后有人"）。条目与资产必须同一次提交更新。

## 1. 为什么不能整读资产

| 资产类型 | 实际形态 | 整读的代价 |
|---|---|---|
| `.unity` 场景 | 文本 YAML，但由 `GameObject`/`Transform`/`MonoBehaviour` 块线性展开，含大量 `fileID`/`guid` 引用 | 中型场景 1–5 万行；读一次即耗尽上下文，且 95% 是样板字段 |
| `.prefab` | 同上，嵌套预制体还会有 `PrefabInstance` 覆盖块 | 同上；修改点往往只在一个覆盖块里 |
| `.asset` / `.mat` / `.controller` | 文本 YAML，多为序列化字段与引用 | 大量无关的默认值字段 |
| `.fbx` / `.png` / `.wav` / `.unitypackage` | **二进制** | 无法读；只能读导入设置（`.meta`）与用途 |

结论：**资产靠索引与命名约定理解，不靠阅读。** 索引写得好，一个场景的摘要 5–10 行就能替代 3 万行 YAML。

## 2. 条目格式（`asset-index.md` 主体，按模块分组）

每个条目的字段与**填写要求**：

| 字段 | 含义 | 填写要求 |
|---|---|---|
| `path` | 资产路径（相对仓库根） | 必须与磁盘一致，大小写敏感 |
| `kind` | `scene` / `prefab` / `material` / `so`(ScriptableObject) / `atlas` / `addressable-group` | 用固定枚举，不要自创 |
| `purpose` | 这个资产在游戏里干什么 | 一句话，动词开头，例如"承载主菜单 UI 的三个面板与入口按钮" |
| `module` | 所属模块（与 `files.json` 的 `module` 同名） | 一个资产只属于一个模块；跨模块共享的资产放 `Core` 并注明 |
| `deps` | 依赖的脚本/预制体/材质/图集 | 只列**跨模块**与高风险依赖，脚本写类名不写 GUID |
| `entrypoints` | 场景中的入口节点（如 `Systems/GameBootstrap`） | 场景必填；这是"不用整读就能知道从哪开始"的关键 |
| `risk` | `low` / `med` / `high` | 判定见第 3 节 |
| `hash` | 文件内容指纹（前 8 位足够） | 变更时更新；用来判定"摘要是否过期" |
| `changed` | 最近一次实质变更日期 + 一句话 | 例：`2026-03-02 拆出 HUD 预制体` |

条目骨架（复制这段填）：

```markdown
### <模块名>

- `path`: `Assets/Scenes/Main.unity`
  - `kind`: scene
  - `purpose`: 待填写：一句话说明这个场景承载什么流程
  - `entrypoints`: `Systems/GameBootstrap`、`UI/RootCanvas`
  - `deps`: `PlayerController`、`Assets/Prefabs/UI/Hud.prefab`、`Assets/Settings/URP-Asset.asset`
  - `risk`: high
  - `hash`: `00000000`
  - `changed`: {{date}} 新建索引条目
  - `notes`: 待填写：已知坑（例如"切换时不要销毁 EventSystem，否则输入失效"）
```

## 3. 风险等级判定（决定改动前要读多少）

- `high`：启动场景、常驻管理器、存档/设置相关、被 5 个以上资产引用的预制体、图集与渲染管线资产。
  改动前**必须**读原文相关窗口 + 跑 PlayMode 测试 + 手动过一次相关流程。
- `med`：单个玩法模块的主预制体、模块内共享材质、Addressables 组。
  改动后**必须**跑 PlayMode 测试。
- `low`：一次性装饰物、只被一个场景引用的独立预制体。
  改完做编辑器内目视检查即可。

新增资产时默认按 `med` 登记，**降级需要写明理由**。

## 4. 按行定位读（摘要不足时的唯一合法姿势）

1. **先定位行号**：搜索稳定锚点而不是猜行数。
   - 节点名：`m_Name: Player`
   - 脚本挂载：搜该脚本的 GUID（在脚本的 `.meta` 里取）
   - 预制体实例覆盖：`PrefabInstance:`
2. **只读窗口**：读锚点前后约 40 行（Harness 的 `read` 支持 `offset`/`limit`）。
3. **一次只回答一个问题**：不要"顺便看看整个场景"。
4. **读完必须回写**：把结论写进本索引的 `purpose` / `deps` / `notes`，并把 `hash` 更新为当前值。
5. 如果一次任务需要打开 3 个以上 high 风险资产，**先停下来**：把任务拆小，或在任务包里写明"需要人工确认场景结构"。

## 5. 命名约定（让索引可以"猜"）

- 场景：`Assets/Scenes/<Flow>.unity`（如 `Boot`、`MainMenu`、`Level01`、`Sandbox_<功能>` 用于开发验证）。
- 预制体：`Assets/Prefabs/<模块>/<用途>.prefab`（`Hud`、`Enemy_Goblin`、`Pickup_Coin`）。
- 材质：`Assets/Art/Materials/<模块>/M_<用途>.mat`；贴图：`T_<用途>_<通道>.png`。
- ScriptableObject 配置：`Assets/Config/<模块>/<用途>.asset`。
- **命名即索引**：路径说不清用途说明命名错了，先改命名再登记。

## 6. 维护触发条件（什么时候必须更新本文件）

- 新增/删除/移动任何场景、预制体、材质、配置资产。
- 改了资产的对外结构（新增公开字段、换根节点、改依赖）。
- 改了导入设置、图集分组、Addressables 组。
- `review --drift` 报出资产 hash 漂移。

未更新索引的资产改动**视为任务未完成**，评审时直接退回。
