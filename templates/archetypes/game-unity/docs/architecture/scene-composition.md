# 场景组成（Scene Composition）

> 本文回答：有哪些场景、各自装什么、怎么切换、谁是常驻的、改动前要确认什么。
> **不要用阅读 `.unity` 文件来回答这些问题**——答案在这里和 `{{aiDir}}/index/asset-index.md`。

## 1. 场景清单（必须与 asset-index 同步）

| 场景 | 角色 | 装载方式 | 关键入口节点 | 风险 |
|---|---|---|---|---|
| `Assets/Scenes/Boot.unity` | 启动：初始化常驻服务、读存档、决定进哪个流程 | 首场景，构建时 index 0 | `Systems/GameBootstrap` | high |
| `Assets/Scenes/MainMenu.unity` | 主菜单、设置、继续游戏 | 单场景加载（卸载 Boot 的内容，保留常驻） | `UI/RootCanvas` | high |
| `Assets/Scenes/Level01.unity` | 关卡玩法 | 单场景加载 | `Systems/LevelRoot` | high |
| `Assets/Scenes/Sandbox_<功能>.unity` | 开发验证用：单功能最小复现 | 编辑器内任意加载 | 自由 | low |

新增场景必须：登记本表 + 登记 asset-index + 明确"谁加载它、它加载谁"，否则视为未完成。

## 2. 组成原则

1. **一个场景 = 一个可独立进入的流程状态**，不要做"把整个游戏塞进一个场景"的巨型场景（改一处要重载全部，测试与协作成本爆炸）。
2. **场景里只放"位置与引用"**：节点层级、组件引用、初始摆放。**逻辑与数值放代码与 ScriptableObject**，否则改动无法 code review。
3. **常驻对象放 Boot**：`GameBootstrap`、`AudioService`、`SaveService`、`InputRouter` 等在 Boot 中 `DontDestroyOnLoad`，
   其它场景**禁止**重复创建同类对象。清单维护在本文件第 3 节。
4. **跨场景引用用配置而非 `DontDestroyOnLoad` 传参**：Boot 把服务注册到 `Core` 的服务表，场景对象在 `Start` 里取。
5. **每个场景必须能在编辑器里单独 Play 通过**（依赖常驻服务时要有 `#if UNITY_EDITOR` 的兜底初始化）。
   做不到说明场景耦合过重，需要拆。

## 3. 常驻对象清单（Boot 场景）

| 对象 | 职责 | 生命周期 | 备注 |
|---|---|---|---|
| `Systems/GameBootstrap` | 启动编排：读档 → 初始化服务 → 切首个流程场景 | 全程 | 唯一允许持有全局服务表的对象 |
| `Systems/AudioService` | 音频通道、音量设置 | 全程 | 音乐切换要淡入淡出，禁止硬切 |
| `Systems/SaveService` | 存档读写（格式见 ADR） | 全程 | 存档结构变更**必须** ADR |
| `UI/RootCanvas` | 全局 UI 层（加载遮罩、提示） | 全程 | 场景内 UI 挂到它下面，不要各造 Canvas |

清单变更（新增/删除常驻对象）→ 更新本表 + 写 ADR（属于模块边界变更）。

## 4. 切换流程（加载顺序是硬约定）

```
当前场景 → RootCanvas 显示遮罩 → 卸载当前场景（异步，帧内逐步销毁）
        → 加载目标场景（异步） → 目标场景 Start 完成初始化
        → 隐藏遮罩 → 恢复输入
```

硬约定：

- **切换期间必须锁输入**（`InputRouter.Lock()` / `Unlock()`），否则会出现"点击穿透到下一个场景"。
- **卸载与加载之间不要留空帧**：空帧会被玩家看到闪烁；用 `allowSceneActivation` 控制激活时机。
- **异步加载必须报告进度**，并在 90% 处等待"准备好再激活"（否则进度条会卡住不动）。
- 加载失败的兜底：回滚到上一个可用场景 + 明确错误提示，**不允许静默停在一个空场景**。
- 加场景过渡动画时，动画归 `UI` 层，不要写进 `Systems`。

## 5. 改动决策清单（改场景前逐条过）

1. 这次改动是"摆放/引用"还是"结构/流程"？结构改动 → 先写 ADR。
2. 目标场景在 asset-index 里的 `risk` 是什么？`high` → 必须写清 `deps` 并做好回归。
3. 会不会影响常驻对象？会影响 → 同步第 3 节表格。
4. 有没有别的场景加载它？有 → 检查加载参数默认值是否仍成立。
5. 是否需要新的 `entrypoints`？需要 → 更新 asset-index 条目。
6. PlayMode 测试能不能覆盖这次改动？不能 → 在任务包写出手动验证步骤。

## 6. 反模式（见到就改）

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 场景里挂大量逻辑 MonoBehaviour，逻辑只存在于编辑器里 | 无法 review、无法测试、merge 冲突巨大 | 逻辑入 `{{srcDir}}/Modules`，场景只留引用 |
| 用 `DontDestroyOnLoad` 在多个场景里各建一个"管理器" | 重复实例、状态错乱 | 统一由 Boot 创建并注册 |
| 场景间用 `static` 变量传数据 | 编辑器热重载后状态残留、无法复现 bug | 走 `Core` 的服务表或显式参数 |
| 直接 `SceneManager.LoadScene("Level01")` 散落在各处 | 无法统一加遮罩/锁输入 | 统一走 `SceneFlow.Load<场景>()` |
| 提交时场景文件带着开发用的临时对象 | 污染他人工作区 | 删掉 `Sandbox_*` 之外的临时对象；开发验证放 `Sandbox_*` |

## 7. 与其他文档的关系

- 资产层面的依赖与风险：`{{aiDir}}/index/asset-index.md`
- 导入设置与图集：`{{docsDir}}/architecture/asset-pipeline.md`
- 构建与出包：`{{docsDir}}/runbooks/build-and-verify.md`
- 代码目录约定：`{{srcDir}}/README.md`
