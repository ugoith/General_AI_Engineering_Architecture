# 场景与资源索引（Godot：.tscn / .tres / .import）

> L2 层。**这是理解本项目场景与资源的唯一入口。** 任何任务在碰场景之前先读本文件对应条目。
> `.tscn` 是文本，**但可读不等于应该整读**——本文第 1 节解释原因，第 4 节给出唯一合法的细读方式。

## 1. 为什么大场景不能整读

`.tscn` / `.tres` 的文本结构是：

```
[gd_scene load_steps=N format=3 uid="uid://..."]
[ext_resource type="Script" path="res://scripts/player.gd" id="1_abc"]
[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]
[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_abc")
[node name="Sprite" type="Sprite2D" parent="."]
texture = ExtResource("2_def")
```

问题在于：

- **节点块线性展开**：一个 300 节点的场景 = 300+ 个 `[node ...]` 块，多数属性是编辑器写入的默认值。
- **引用是间接的**：`ExtResource("1_abc")` 要回到文件头部才能知道指向哪个脚本/资源，跨行对应关系靠 id。
- **`load_steps`、`uid`、属性顺序**会因编辑器版本与操作顺序变化，产生大量无意义 diff。
- 一个中等 2D 关卡场景 2000–8000 行；整读一次就吃掉大部分上下文，而真正相关的往往只有 1–2 个节点块。

结论：**摘要 + 入口节点 + 命名约定**足以支撑绝大多数任务；确需细节时按第 4 节做窗口读。

## 2. 条目格式

| 字段 | 含义 | 填写要求 |
|---|---|---|
| `path` | `res://` 路径 | 与磁盘一致 |
| `kind` | `scene` / `resource` / `material` / `shader` / `texture` / `audio` / `font` / `tileset` | 固定枚举 |
| `purpose` | 这个场景/资源干什么 | 一句话，动词开头 |
| `module` | 所属模块（与 `files.json` 的 `module` 同名） | 一个资产一个模块 |
| `entrypoints` | 场景中的入口节点路径（相对根） | 场景必填，如 `Systems/GameRoot`、`UI/HUD`；这是"从哪开始看"的答案 |
| `attachedScripts` | 挂在关键节点上的脚本（`res://scripts/...`） | 只列入口节点与关键系统节点上的脚本 |
| `deps` | 依赖的其它场景/资源（跨模块的必列） | 例：`res://scenes/ui/HUD.tscn`、`res://assets/tilesets/dungeon.tres` |
| `risk` | `low` / `med` / `high` | 判定见第 3 节 |
| `hash` | 文件指纹前 8 位 | 变更时更新，用于判定摘要是否过期 |
| `changed` | 最近实质变更：日期 + 一句话 | 例：`2026-03-02 拆出 HUD 场景` |

条目骨架（复制填写）：

```markdown
### <模块名>

- `path`: `res://scenes/level/Level01.tscn`
  - `kind`: scene
  - `purpose`: 待填写：一个可通关的关卡，含地形、敌人、出口触发器
  - `entrypoints`: `Systems/LevelRoot`、`Player`、`UI/HUD`
  - `attachedScripts`: `LevelRoot` → `res://scripts/level/level_root.gd`
  - `deps`: `res://scenes/ui/HUD.tscn`、`res://scenes/actors/Player.tscn`、`res://assets/tilesets/dungeon.tres`
  - `risk`: high
  - `hash`: `00000000`
  - `changed`: {{date}} 新建索引条目
  - `notes`: 待填写：已知坑（例如"出口触发器依赖 LevelRoot 的信号，改名会静默失效"）
```

## 3. 风险等级判定

- `high`：主场景、关卡场景、玩家/敌人等核心 Actor 场景、被 5 个以上场景引用的公共场景、
  autoload 直接 `preload` 的场景、输入映射与物理层相关配置资源。
  改动前必须读条目 + 相关脚本；改后必须跑 L0 导入校验 + L2 导出冒烟（或至少人工走一次流程）。
- `med`：模块内 UI 场景、模块共享资源、TileSet、材质。
  改后跑 L1 测试或 Play 一次相关流程。
- `low`：一次性装饰、只被一个场景引用的独立资源。
  编辑器内目视检查即可。

新增资产默认按 `med` 登记；降级需写明理由。

## 4. 场景的正确读法（摘要不足时）

1. **先定位节点**：搜索 `[node name="X"`（含 `parent="..."` 可确认层级）。
2. **解析引用**：需要知道某 `ExtResource("id")` 指向什么时，回到文件头读对应的 `[ext_resource ...]` 那一行。
3. **只读窗口**：锚点前后约 40 行（`read` 的 `offset`/`limit`）。
4. **一次只回答一个问题**，不要"顺便看看整个场景"。
5. **读完回写**：把结论写进 `entrypoints`/`deps`/`notes`，并更新 `hash`。
6. 需要"整体结构"时，优先让人类在编辑器里打开 **Scene 面板**并口述/截图层级树——这比读文本便宜得多。
7. 若一次任务要打开 3 个以上 high 风险场景，先停下来拆任务。

## 5. 命名与目录约定（让索引可以"猜"）

| 类型 | 约定 | 例子 |
|---|---|---|
| 场景 | `scenes/<域>/<用途>.tscn`，PascalCase 文件名 | `scenes/ui/HUD.tscn`、`scenes/level/Level01.tscn` |
| 可复用 Actor | `scenes/actors/<类型>.tscn` | `scenes/actors/Player.tscn`、`scenes/actors/Enemy_Goblin.tscn` |
| 资源 | `assets/<类型>/<用途>.<ext>` | `assets/tilesets/dungeon.tres`、`assets/audio/sfx_jump.ogg` |
| 脚本 | `scripts/<域>/<用途>_<角色>.gd`，snake_case 文件名 | `scripts/level/level_root.gd` |
| 着色器 | `assets/shaders/<用途>.gdshader` | `assets/shaders/water.gdshader` |

- **节点名即契约**：入口节点名（如 `Systems/GameRoot`）会被脚本与索引引用，改名必须同步更新。
- 场景文件名 PascalCase（跟类名风格一致），脚本文件名 snake_case（跟 GDScript 官方风格一致）。

## 6. 维护触发条件

- 新增/删除/移动任何 `scenes/**`、`assets/**` 文件。
- 改了场景的入口节点或关键节点名、`autoload` 引用、信号连接关系。
- 改了导入设置（纹理压缩、音频循环、TileSet 参数）。
- `review --drift` 报出资产 hash 漂移。

未更新索引的场景改动**视为任务未完成**，评审直接退回。
