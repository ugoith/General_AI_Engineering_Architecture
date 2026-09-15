# 资产索引（Map / Blueprint / DataAsset / 静态资源）

> L2 层。**这是理解本项目资产的唯一入口**——因为 `.uasset` / `.umap` 是二进制，读不了。
> 任何任务在碰资产之前先读本文件对应条目。条目与资产必须同一次提交更新。

## 1. 为什么二进制资产只能靠索引

`.uasset` / `.umap` 是 UE 的序列化二进制格式（含名称表、导入/导出表、缩略图、平台字节序标记）。
用文本工具读取只会得到乱码：既无法得到结构，也白白消耗上下文。
即使是文本导出的 `T3D`/复制粘贴形式，也只用于"单节点级别的搬运"，不适合理解整体。

替代方案有三条，**必须组合使用**：

| 手段 | 提供什么 | 局限 |
|---|---|---|
| 本索引的摘要 | 用途、依赖、所属模块、关键属性、风险 | 需要人/AI 主动维护 |
| `Content/` 命名约定（见 `Content/README.md`） | 从路径推断类型与归属 | 只覆盖命名规范的部分 |
| C++ 侧的类型定义与 DataAsset 默认值 | 该资产**能**有多少字段、默认值是什么 | 不知道实例上被改成了什么 |

需要知道"这个蓝图实例上某个属性被改成什么"时，**唯一可靠方式是在编辑器里打开看**。
不要试图用文本读取解决这个问题——那是注定失败的路径。

## 2. 条目格式

| 字段 | 含义 | 填写要求 |
|---|---|---|
| `path` | 资产路径（`/Game/...` 或 `Content/...`） | 与内容浏览器一致 |
| `kind` | `map` / `bp` / `data`(DataAsset/DataTable) / `mesh` / `mat` / `anim` / `fx` / `ui`(UMG) | 用固定枚举 |
| `class` | 对应的 C++ 基类（如 `ACombatCharacter`、`UWeaponData`） | 没有 C++ 基类的纯蓝图写 `BlueprintOnly` 并说明原因 |
| `purpose` | 干什么用 | 一句话，动词开头 |
| `module` | 所属模块（与 `files.json` 的 `module` 同名） | 一个资产一个模块 |
| `deps` | 依赖的其它资产/类 | 只列跨模块与高风险依赖 |
| `primaryAsset` | PrimaryAssetType / 是否可被 `AssetManager` 按需加载 | 参与打包与按需加载的必须填 |
| `risk` | `low` / `med` / `high` | 判定见第 3 节 |
| `hash` | 文件指纹前 8 位 | 变更时更新，用于判定摘要是否过期 |
| `changed` | 最近实质变更：日期 + 一句话 | 例：`2026-03-02 加入蓄力攻击分支` |

条目骨架（复制填写）：

```markdown
### <模块名>

- `path`: `/Game/Blueprints/Combat/BP_PlayerCharacter`
  - `kind`: bp
  - `class`: `ACombatCharacter`
  - `purpose`: 待填写：玩家角色装配与输入转发，不含数值规则
  - `deps`: `UCombatComponent`、`/Game/Data/Combat/DA_WeaponSword`、`/Game/UI/WBP_Hud`
  - `primaryAsset`: `Character` / 是
  - `risk`: high
  - `hash`: `00000000`
  - `changed`: {{date}} 新建索引条目
  - `notes`: 待填写：已知坑（例如"EventGraph 里不要放 Tick 逻辑，性能由 C++ 的 Tick 控制"）
```

## 3. 风险等级判定

- `high`：默认 GameMode/PlayerController/Character、被 5 个以上资产引用、参与存档或网络复制、
  `PrimaryAsset` 根节点、UMG 根控件、输入映射（`IMC_*`/`IA_*`）。
  改动前必须读索引条目 + 相关 C++ 头文件，改后必须跑打包冒烟与手动流程。
- `med`：单个玩法模块的主要蓝图、DataAsset 配置、模块内共享材质/动画蓝图。
  改后必须跑自动化测试或至少 Play-In-Editor 全流程。
- `low`：装饰性静态网格、一次性特效、开发用测试关卡。
  编辑器内目视检查即可。

新增资产默认按 `med` 登记；降级需写明理由。

## 4. 摘要不足时怎么办（决策顺序）

1. **先问它是什么类**：查 `class` → 读该 C++ 头文件（这是可读的，且信息密度最高）。
2. **再问它引用了谁**：查 `deps` 与 DataAsset 的默认值；必要时在编辑器里用 Reference Viewer 反查。
3. **再问它现在被改成了什么**：由人类在编辑器里打开资产并回答/截图；**这一步不要用文本工具尝试**。
4. **需要结构化改动**：让 C++ 或编辑器工具脚本完成（例如用 `UAssetManager`/编辑器工具批量改属性），
   而不是"手改资产文件"。
5. 若一次任务需要打开 3 个以上 high 风险资产，先停下来拆任务。

## 5. 命名与目录约定（与 `Content/README.md` 互为引用）

- 前缀：`BP_`（蓝图类）、`WBP_`（UMG 控件）、`ABP_`（动画蓝图）、`DA_`（DataAsset）、`DT_`（DataTable）、
  `M_`/`MI_`（材质/实例）、`SM_`（静态网格）、`SK_`（骨骼网格）、`T_`（贴图）、`NS_`（Niagara）、`IMC_`/`IA_`（增强输入）。
- 目录：`Content/<模块>/<类型子目录>/`，模块名与 `files.json` 的 `module` 一致。
- **命名即索引**：路径说不出用途说明命名错了，先改命名再登记。

## 6. 维护触发条件

- 新增/删除/移动任何 `Content/**` 资产。
- 改了资产的对外结构（新增公开属性、替换父类、改 `PrimaryAsset` 归属）。
- 改了默认 GameMode/输入映射/打包包含规则（`Config/DefaultGame.ini` 的 AssetManager 段）。
- `review --drift` 报出资产 hash 漂移。

未更新索引的资产改动**视为任务未完成**，评审直接退回。
