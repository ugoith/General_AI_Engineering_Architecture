# scripts/ — 脚本目录与代码约定

本文件说明"代码放哪里、依赖朝哪边、写代码时的硬规则"。**引擎 API 用法不在这里**，
见 `{{aiDir}}/skills/` 中的 `game-engine-conventions`。

## 1. 目录结构（依赖单向）

```
scripts/
  core/          基础设施：事件/信号契约、工具、存档接口、时间源、对象池
  systems/       与具体玩法无关的系统：音频、输入路由、场景切换、设置
  actors/        角色与物的行为脚本（与 scenes/actors/ 对应）
  ui/            UI 脚本（与 scenes/ui/ 对应）
  level/         关卡流程脚本（与 scenes/level/ 对应）
  autoload/      autoload 单例脚本（清单见 {{docsDir}}/architecture/autoload-and-signals.md）
{{#IF gdscript}}                本项目用 GDScript：保留 autoload/game.gd，删除 autoload/Game.cs（同一单例只能有一个实现）
{{/IF}}{{#UNLESS gdscript}}                本项目用 C#：保留 autoload/Game.cs，删除 autoload/game.gd，并把 project.godot 的 [autoload] 指向 .cs
{{/UNLESS}}
  editor/        仅编辑器使用的脚本（EditorScript / 工具，注意导出时排除）
  dev/           开发调试脚本（发布前确认未被引用）
```

依赖方向：`ui → actors/level → systems → core`。**反向依赖（core 引用 ui）一律拒绝**；
需要双向通信时把信号契约下沉到 `core/`，并写 ADR 记录契约字段。

## 2. 命名与文件约定

| 类型 | 约定 | 例子 |
|---|---|---|
| 文件 | snake_case | `player_controller.gd`、`hud.gd` |
| 类（`class_name`） | PascalCase | `class_name PlayerController` |
| 私有成员/方法 | 前缀 `_` | `_move_speed`、`_apply_damage()` |
| 信号 | 过去式或名词短语 | `health_changed`、`level_completed` |
| 常量 | `UPPER_SNAKE_CASE` | `MAX_HEALTH` |
| 枚举 | PascalCase 类型名 + 成员 | `enum State { IDLE, RUN }` |

- **一个文件一个 `class_name`**；文件与类不同名时，索引摘要里必须写清对应关系。
- 导出的可调参数用 `@export` 并在注释里写单位与取值范围。

## 3. 生命周期纪律

| 回调 | 只做这些 |
|---|---|
| `_init()` | 纯数据初始化（此时**不能**访问节点树） |
| `_enter_tree()` | 需要尽早注册时使用 |
| `_ready()` | 缓存节点引用（`@onready`）、连接信号、初始化状态 |
| `_process(delta)` | 表现相关、需要每帧更新的逻辑；**禁止分配与查找** |
| `_physics_process(delta)` | 物理与移动；用固定步长，不要和 `_process` 混用同一套积分 |
| `_exit_tree()` | 断开外部连接、注销自己 |

规则：

1. 子节点在 `_ready` 中**已完成**自身 `_ready`，因此父节点 `_ready` 里可以安全取子节点状态；
   反之（子节点取父节点状态）必须用信号等待。
2. `queue_free()` 后不要继续引用该对象；需要延迟处理时用 `is_instance_valid()` 判断。
3. 信号连接一律显式记录在索引摘要或代码顶部注释里；用 `CONNECT_ONE_SHOT` 时要写明理由。

## 4. 性能纪律（每帧路径）

- 引用缓存：`@onready var _sprite: Sprite2D = $Sprite`，**不要在 `_process` 里 `get_node`**。
- 容器复用：不在每帧创建 `Array`/`Dictionary`/`String`；需要时用成员变量复用。
- 字符串：不在每帧拼接（`str()`、`"..." % x`），需要文本时按需刷新（例如值变化时才更新 Label）。
- 节点数量：`find_children`、`get_tree().get_nodes_in_group()` 只在初始化时调用。
- 物理：合理设置物理层与掩码，避免"全层碰撞"；不需要的刚体设为 `freeze` 或移除。
- 若某系统每帧处理成百上千对象，先证明它是瓶颈（Profiler），再讨论优化方案；**优化前必须取基准数据**。

## 5. 反模式清单

| 反模式 | 后果 | 改成 |
|---|---|---|
| `_process` 里 `get_node("../../Player")` | 每帧开销 + 改名即断 | `@export` 注入或信号 |
| 用 autoload 当全局变量仓库 | 隐式依赖、无法单测、初始化顺序问题 | autoload 只放服务；数据走资源或显式传参 |
| 到处 `load("res://...")` 动态路径 | 导出后路径/资源可能缺失，且无法静态检查 | `preload` 常量 或 `@export` 资源引用 |
| 用 `await get_tree().create_timer(x).timeout` 做玩法时序 | 受暂停/倍速影响，难以测试 | 显式状态机 + `_process(delta)` 计时或可注入时间源 |
| 在脚本里硬编码数值 | 无法调参、无索引可查 | `@export` 或 `.tres` 资源配置 |
| 一个脚本 800 行承担 5 个职责 | 无法复用与测试 | 拆成 core + 系统 + 表现三层 |

## 6. 与索引的关系

- 新增/删除脚本，或改了脚本的公开职责 → 更新 `{{aiDir}}/index/files.json` 的 `path`/`digest`/`imports`/`module`。
- 摘要写法：**1–3 句，写"它负责什么 + 谁调用它"**。
  好例子：`"玩家移动与跳跃：读取 InputRouter 的输入，驱动 CharacterBody2D；对外发 jumped/landed 信号。"`
  坏例子：`"玩家脚本。"`（无信息量）
