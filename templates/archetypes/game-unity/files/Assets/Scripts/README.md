# {{srcDir}} — C# 源码目录约定

本文件说明"代码放哪里、依赖朝哪边"。**它不解释引擎用法**，引擎约定见 `{{aiDir}}/skills/` 中的 `game-engine-conventions`。

## 1. 目录职责（单向依赖，禁止回指）

```
{{srcDir}}/
  Core/        基础设施：事件定义、时间源、存档接口、对象池、通用扩展
  Modules/     玩法模块，每个子目录一个自洽功能，目录名 = 模块名 = files.json 的 module
  UI/          视图层：面板、绑定、输入提示。依赖 Core 与 Modules 的公开接口，不被 Modules 依赖
  Editor/      （见 Assets/Editor/README.md，编辑器代码不放这里）
```

依赖方向固定为：`UI → Modules → Core`。**反向依赖（Core 引用 Modules）一律拒绝**；
两个模块需要互相通信时，把消息类型下沉到 `Core`，或用 `Core` 里的信号/事件定义，并写 ADR 记录契约。

## 2. 单个模块的内部结构

```
Modules/Combat/
  CombatModule.cs        组装入口：MonoBehaviour，持有子系统引用，暴露公开 API
  CombatSystem.cs        逻辑：不继承 MonoBehaviour 的纯 C# 优先
  CombatConfig.cs        ScriptableObject 配置（放 Assets/Config/Combat/）
  CombatEvents.cs        本模块对外的信号定义
  Runtime/               只在本模块内使用的实现细节
```

规则：

- **对外只暴露 `XxxModule` 的公开方法**，其它类默认 `internal`，避免别的模块直接 `GetComponent` 内部类。
- **纯逻辑优先写成不继承 `MonoBehaviour` 的类**：可测试、不依赖场景、不参与序列化。
- **配置走 ScriptableObject**，不要散落在场景里的常量字段上；配置资产的索引条目见 `{{aiDir}}/index/asset-index.md`。

## 3. 生命周期与每帧成本

- `Awake`：只做字段与引用缓存（`GetComponent` 集中在这里）。
- `OnEnable`/`OnDisable`：注册与注销事件，必须成对。
- `Start`：需要其它对象已初始化的接线。
- `Update`/`FixedUpdate`/`LateUpdate`：**禁止分配**（无 `new`、无字符串拼接、无 LINQ、无 `GetComponent`、无 `Find*`）。
  多对象每帧查询用批量 API（`Physics.RaycastNonAlloc`、`Physics.OverlapSphereNonAlloc`、`Renderer.GetPropertyBlock` 等）。
- 逻辑帧率与渲染解耦的模块（AI、寻路）用固定步长驱动，不要绑在 `Update` 的 delta 上做积分。

## 4. 协程、异步与取消

- 短生命周期的延时用协程；跨场景/跨加载的流程用 `Awaitable`/`UniTask`（**引入后者需 ADR**）。
- 任何异步流程必须在对象销毁时停止：`OnDestroy` 里 `StopAllCoroutines` 或取消 token，避免回调打到已销毁对象。
- 不用 `Invoke`/`InvokeRepeating` 做游戏逻辑（字符串名字反射、无法静态检查），改用显式计时字段或协程。

## 5. 不要做的事

| 反模式 | 为什么 | 改成 |
|---|---|---|
| `Update` 里 `FindObjectOfType<T>()` | 全场景遍历，O(n) 每帧 | `Awake` 缓存字段，或用模块入口注入 |
| `Resources.Load`（尤其在循环里） | 资源常驻内存、无法被 Addressables 分析 | 预加载引用 / Addressables |
| 单例 `static Instance`（到处用） | 隐式全局状态，测试与场景切换困难 | 模块入口暴露引用，或经 `Core` 的显式服务接口 |
| `SendMessage` | 反射字符串，改名字静默失效 | 显式方法调用或类型化信号 |
| 在 `Assets/Scripts/` 里写 `[MenuItem]`、`AssetDatabase` | 打包时编译失败 | 移到 `Assets/Editor/` |
| 每帧 `new WaitForSeconds` | 每帧分配（GC 尖峰） | 缓存 `WaitForSeconds` 实例或用计时字段 |

## 6. 与索引的关系

- 新增/删除 `.cs` 文件，或改了类的公开职责 → 更新 `{{aiDir}}/index/files.json` 的 `path`/`digest`/`imports`/`module`。
- 摘要写法：**1–3 句，写"它负责什么 + 谁调用它"**，不写实现细节。
  好例子：`"战斗回合推进：接收 CombatEvents.TurnAdvance，维护行动队列，对外暴露 EndTurn()。"`
  坏例子：`"战斗相关的类。"`（无信息量，等于没写）
