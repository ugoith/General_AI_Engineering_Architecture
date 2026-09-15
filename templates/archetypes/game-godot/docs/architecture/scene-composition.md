# 场景组成（Godot）

> 本文回答：有哪些场景、谁是主场景、怎么切换、切换期间谁负责什么、改动前要确认什么。
> **不要用整读 `.tscn` 来回答这些问题**——答案在这里和 `{{aiDir}}/index/asset-index.md`。

## 1. 场景清单（必须与 asset-index 同步）

| 场景 | 角色 | 装载方式 | 入口节点 | 风险 |
|---|---|---|---|---|
| `res://scenes/Main.tscn` | 主场景（`project.godot` 的 `run/main_scene`）：启动与流程编排 | 启动即加载 | `Systems/GameRoot` | high |
| `res://scenes/ui/MainMenu.tscn` | 主菜单、设置、继续游戏 | `Game.change_scene()` | `UI/Root` | high |
| `res://scenes/level/Level01.tscn` | 关卡玩法 | `Game.change_scene()` | `Systems/LevelRoot` | high |
| `res://scenes/ui/HUD.tscn` | 常驻 HUD，由关卡实例化 | 被实例化（非切换） | `UI/HUD` | med |
| `res://scenes/dev/Dev_*.tscn` | 单功能最小复现 | 编辑器 F6 直接运行 | 自由 | low |

新增场景必须：登记本表 + 登记 asset-index + 说明"谁加载它、它加载谁"。

## 2. 组成原则

1. **一个场景 = 一个可独立进入的状态**。不要把整个游戏塞进 `Main.tscn`：改一处要重载全部，协作冲突大。
2. **场景里只放"节点与引用"**：层级、`@export` 引用、初始摆放。**逻辑在脚本、数值在 `.tres` 资源**。
3. **常驻服务是 autoload，不是场景节点**（清单见 `autoload-and-signals.md`）。场景里不要再造一份音频/存档管理器。
4. **UI 与关卡解耦**：`HUD.tscn` 只通过 `@export` 拿数据、通过信号上报操作，不 `get_node("../../Player")`。
5. **每个场景都能单独跑**：UI 场景 F6 可开；关卡场景不依赖"先跑主菜单"才能工作（缺数据时用默认值兜底）。

## 3. 切换流程（硬约定）

```
请求方（UI / 关卡逻辑）
  → Game.change_scene("res://scenes/level/Level01.tscn")   # 只登记意图
  → Game 在下一帧执行 change_scene_to_file()                # 避免在信号回调中重入
  → 发出 scene_changed 信号
  → 新场景 _ready 完成初始化后自行恢复输入 / 隐藏遮罩
```

硬约定：

- **不要在信号回调或 `_process` 中直接 `change_scene_to_file()`**：场景树正在遍历时切换会导致不可预期行为。统一走 `Game.change_scene()`。
- **切换期间锁输入**：由负责遮罩的 UI 或 `Game` 统一控制（例如 `get_tree().paused` 或输入路由开关），避免点击穿透到新场景。
- **大型关卡用异步加载**：`ResourceLoader.load_threaded_request()` + 加载画面，进度用 `load_threaded_get_status()` 汇报；
  在 100% 之后再切场景，否则会卡一帧明显的长任务。
- **加载失败必须有兜底**：`ResourceLoader.exists()` 预检 + 失败回主菜单并给出错误提示，**不允许静默停在空场景**。
- 场景切换的过渡动画属于 UI 层，不要写进 `Game` 服务。

## 4. 数据在场景间怎么传

| 方式 | 何时用 | 明确不用 |
|---|---|---|
| autoload 服务里的显式状态（如"当前关卡 ID"） | 跨场景的少量流程状态 | 把整个游戏对象塞进 autoload |
| `.tres` 配置文件 / 关卡参数资源 | 关卡配置、难度参数 | 运行时可变数据（应写 `user://`） |
| `Game` 的显式参数方法 | 切换时带参数（`start_level(id)`） | 用全局变量隐式传参 |
| 存档文件（`user://`） | 需要跨启动保留的数据 | 用它传一次性的运行期数据 |

规则：**场景之间的接口要显式**。任何"新场景自己去某个全局对象里捞数据"的写法都要在评审时说明为什么不能显式传参。

## 5. 改动决策清单（改场景组成前逐条过）

1. 这次改动是"摆放/引用"还是"流程/结构"？流程改动 → 先写 ADR。
2. 目标场景在 asset-index 的 `risk` 是什么？`high` → 必须写清 `entrypoints` 与 `deps`。
3. 是否影响 autoload 或被 autoload `preload` 的场景？影响 → 同步 `autoload-and-signals.md`。
4. 是否有其它场景实例化它？有 → 检查 `@export` 参数的默认值是否仍成立。
5. 跑过 L0 无头导入校验了吗？导出过吗（改流程必跑导出冒烟）？
6. 无法自动验证的部分，任务包里写出手动验证步骤与结果。

## 6. 反模式

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| `Main.tscn` 里堆所有玩法 | 改一处重载全部 | 拆 `level/` + `actors/` + `ui/` |
| 场景间用节点路径字符串互相查找 | 改名静默失效 | `Game.change_scene()` + 显式参数 / 信号 |
| 直接 `change_scene_to_file()` 到处调用 | 无遮罩、无锁输入、重入问题 | 统一走 `Game.change_scene()` |
| UI 直接读写玩法节点 | UI 无法单独运行与测试 | `@export` 注入 + 信号上报 |
| 切换时同步加载大关卡 | 明显卡顿 | 线程加载 + 加载画面 |
| 用 autoload 做"全局事件总线"串联一切 | 隐式依赖、难追踪 | 见 `autoload-and-signals.md` 第 4 节 |

## 7. 与其他文档的关系

- autoload 与信号规则：`{{docsDir}}/architecture/autoload-and-signals.md`
- 场景索引格式：`{{aiDir}}/index/asset-index.md`
- 目录约定：`scenes/README.md`、`scripts/README.md`
- 导出与验证：`{{docsDir}}/runbooks/build-and-verify.md`
