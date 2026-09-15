# {{srcDir}}/systems — 系统划分与边界

本文件定义"一个系统是什么、边界在哪、谁来调度"。**引擎 API 用法不在这里**，
见 `{{aiDir}}/skills/` 中的 `game-engine-conventions`；调度顺序见 `{{docsDir}}/architecture/runtime-loop.md`。

## 1. 什么是"系统"

一个系统 = **一个有明确职责、有明确数据所有权、可独立测试的模块**。判定标准：

- 能用一句话说清"它负责什么"，且不出现"以及"；
- 它**拥有**自己的状态（别的系统只能通过它的公开方法读写）；
- 它的核心逻辑可以在没有渲染的世界里跑（纯逻辑部分不依赖 canvas/引擎对象）。

不满足"能一句话说清"的，说明该拆；不拥有状态的（例如一堆纯函数），做成 `utils` 而不是系统。

## 2. 系统清单（新增系统必须补这张表）

| 系统 | 职责（一句话） | 拥有的状态 | 依赖 | 调度位次 |
|---|---|---|---|---|
| `input` | 把键鼠与触摸事件转成统一的动作状态 | 按键/指针状态、动作映射 | 无 | 1（最先，其他系统读它） |
| `level` | 加载/卸载关卡内容，管理实体生成与回收 | 当前关卡 ID、实体表 | `assets`、`save` | 2 |
| `audio` | 播放/停止音效与音乐，管理音量与通道 | 音量设置、播放中句柄 | `assets` | 3 |
| `save` | 读写存档与设置（localStorage/IndexedDB） | 存档数据、版本号 | 无 | 4（按需调用，不每帧） |
| `render` | 把当前世界状态画出来；不做玩法决策 | 绘制列表、相机 | 只读其它系统 | 最后 |

调度位次只是默认值；**改位次要在 `runtime-loop.md` 里同步**，因为它会影响一帧内的数据可见性。

## 3. 依赖规则

- 依赖是**单向**的：`level → assets/save`，`render → 只读其他系统的状态`。
  **禁止 render 修改玩法状态**（改了会导致"画面与逻辑不同步"这类极难查的 bug）。
- 系统之间通过**构造函数注入**拿到对方（显式依赖），不要用模块级单例互相 import（隐式依赖，无法测试）。
- 事件通知用**显式回调列表**（`onXxx(listener)` 返回取消函数），不要引入全局事件总线框架（规模门槛禁止）。
- 需要一个"共享的世界状态"时，明确它的所有者：存在 `level` 系统里，其他系统通过 getter 读，不要各存一份副本。

## 4. 每个系统的内部结构

```
{{srcDir}}/systems/input/
  index.ts        对外出口：只导出 createInputSystem() 与类型
  state.ts        状态定义与纯函数（可单测：不需要 DOM）
  keyboard.ts     键鼠事件绑定（浏览器 API 集中在这里）
  touch.ts        触摸事件绑定（与键鼠产出同一种动作状态）
```

规则：

- **index.ts 是唯一对外出口**；其它系统只 import 它，不深入内部文件。
- **浏览器 API 只在边界文件里出现**（`keyboard.ts`/`touch.ts`），纯逻辑文件不碰 `window`/`document`，
  这样纯逻辑可以直接在 Node 里跑测试。
- 时间来源（`performance.now()`）与随机数（`Math.random()`）通过参数或注入的 provider 获得，
  使测试可以控制时间与随机性。
- 每个系统实现 `GameSystem` 接口（见 `{{srcDir}}/main.ts`），`init/update/render/dispose` 按需实现。

## 5. 数据与资源

- 资源（图、音、JSON）**不直接 import**，通过 `assets` 加载器按 key 获取，key 与清单一一对应（见 `{{docsDir}}/architecture/asset-loading.md`）。
- 可变数据（存档、设置）写 `localStorage`/`IndexedDB`，必须带**版本号**并在读取时做迁移或重置；
  存档格式变更 = 数据契约变更 → 写 ADR。
- 数值与关卡配置放在数据文件（JSON/TS 常量模块）里，不要散落在系统代码中间。

## 6. 反模式

| 反模式 | 后果 | 改成 |
|---|---|---|
| 系统里直接 `new Image()` / `fetch()` | 无统一失败处理、无体积核算 | 走 `assets` 加载器 |
| 系统之间互相 import 单例 | 隐式依赖、测试要 mock 一整个世界 | 构造函数注入 |
| 在 `render` 里改玩法状态 | 画面与逻辑不同步、难以复现 | 状态只在 `fixedUpdate`/`update` 改 |
| 每帧创建数组/对象传参 | GC 抖动 → 掉帧 | 复用上下文对象（见 `main.ts` 的 `FrameContext`） |
| 一个系统 800 行做 5 件事 | 无法独立测试与替换 | 按第 1 节判定拆分 |
| 引入事件总线"图省事" | 调用关系不可追踪 | 显式回调用集合 + ADR（若确需全局） |

## 7. 与其他文档的关系

- 调度顺序与帧结构：`{{docsDir}}/architecture/runtime-loop.md`
- 资源加载与回退：`{{docsDir}}/architecture/asset-loading.md`
- 性能预算：`{{docsDir}}/architecture/performance-budget.md`
- 测试策略：`{{testsDir}}/README.md`
