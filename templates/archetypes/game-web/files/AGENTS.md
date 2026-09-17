# {{aiEntry}} — {{projectTitle}} 的 AI 入口

> 本文件是**指针，不是百科**（≤150 行）：只放硬约束、路由表、提交前检查。知识在 `{{aiDir}}/`、`{{docsDir}}/` 与源码里，按需读取。
> 注意：本 archetype 的 `AGENTS.md` 会**整份替换**基础层同名文件（渲染器按路径覆盖，不做拼接），因此这里保留了基础层的通用部分，并追加 Web 游戏专项。

**这是什么项目**：{{description}}
**项目名**：`{{projectName}}` ｜ **负责人**：{{owner}} ｜ **规模**：{{scaleLevel}} / {{scaleName}} ｜ **框架版本**：{{frameworkVersion}}

开工前必读（两份，不要跳过）：

1. `{{aiDir}}/constitution.md` —— 定位、技术栈、**验证命令**、红线、规模门槛、例外记录（L1，≤150 行）。
2. `{{aiDir}}/index/README.md` —— 索引体系说明书：`files.json` 的摘要字段、`impact-map.json`、任务包怎么用。

## 硬约束（不可协商）

- **语言**：面向人的文档用中文；代码标识符、JSON 字段、CLI 参数、文件名一律英文。
- **依赖**：新增运行时依赖前先写 ADR（`{{aiDir}}/decisions/`）；能用标准库解决就不要引入依赖。
- **单一事实来源**：每条规则只写一处；文件摘要只写在 `{{aiDir}}/index/files.json`，其它地方只引用不复制。
- **不猜**：外部字段名、错误码、超时语义必须查文档或问人；不得已的猜测标 `ASSUMPTION:` 并写进任务包。
- **可追溯**：任何改动都要能回答"改了哪些文件、依据哪条规则、用什么命令验证"；答不上来就是没做完。
- **引擎与资源**：引擎/工具链版本升级必须先写 ADR；资源命名与导入规范以本 archetype 的文档为准。

## Web 游戏专项硬约束（违反即返工）

1. **帧循环内零分配**：不 `new` 对象/数组/闭包、不字符串拼接、不 `JSON.stringify`、不 `map`/`filter`、不 `console.log` 拼串；临时值用预分配的对象池。
2. **资源必须走加载器且有失败回退**：禁止在渲染/逻辑代码里 `new Image()`、`fetch`、`import './a.png'`；清单集中在 `{{srcDir}}/assets/`，失败走占位图/静音，**不允许整局卡死**。
3. **键鼠与触摸双输入**：任一缺失视为未完成；移动端必须真机或模拟器验过触摸。
4. **首屏体积是硬预算**：运行时依赖必须已在宪法"已批准依赖"表中，否则先写 ADR（含体积影响）；**构建输出体积是唯一证据**。
5. **帧内不读写布局**：不读 `offsetWidth` / `getBoundingClientRect`、不写触发重排的样式；UI 用画布内绘制，或初始化时测量并缓存。
6. **不阻塞主线程**：超过约 16 ms 的同步工作（解析大数据、生成地形、图像处理）必须分帧或放进 Worker。
7. **`render` 阶段只读**：渲染不得修改玩法状态（否则画面与逻辑不同步，极难复现）。
8. **不读构建产物**：`dist/`、`node_modules/`、`*.min.js`、sourcemap 一律不索引、不入库、不分析。

{{> SHARED:context-discipline}}

## 工作路由表（先查表，再动手）

| 你的任务 | 先读 | 命令 / 然后 |
|---|---|---|
| 接新任务 | `{{aiDir}}/index/README.md`、`{{aiDir}}/tasks/TEMPLATE.md` | `node {{aiDir}}/bin/ai-arch.mjs task "<任务描述>"` |
| 加新玩法系统 | `{{srcDir}}/systems/README.md` + `files.json` 摘要 | 定系统边界与调度位次 → 更新 `runtime-loop.md` 的调度表 |
| 改帧循环 / 调度顺序 | `{{docsDir}}/architecture/runtime-loop.md` | 属结构变更 → **先写 ADR**；改后必须重测帧时间 |
| 加资源（图 / 音 / 数据） | `{{docsDir}}/architecture/asset-loading.md` | 进清单 + 定回退策略 + 记录体积增量 |
| 掉帧 / 卡顿 | `{{docsDir}}/architecture/performance-budget.md` | Performance 面板取数 → 定位 → 改 → 前后数据写进任务包证据 |
| 加输入动作 | `{{srcDir}}/systems/README.md`（input 一节） | 同时接键鼠与触摸；补测试或写明手动验证步骤 |
| 构建 / 发布问题 | `{{docsDir}}/runbooks/build-and-verify.md` | 按分诊表排查 |
| 改模块边界 / 存档契约 | `{{aiDir}}/index/impact-map.json` | 先写 ADR，再按 `mustUpdate` 逐条同步 |
| 更新文档 / 索引 | `{{aiDir}}/index/README.md` | `node {{aiDir}}/bin/ai-arch.mjs index --stale` |

## Web 游戏索引与摘要纪律

- `files.json`：`{{srcDir}}/**`、`{{testsDir}}/**` 与构建配置（`path`、`hash`、`digest`、`imports`）。
- 资源清单条目：路径、类型、体积、用途、是否预加载、回退策略——**新增资源必须登记，否则不算完成**。
- 改完代码后同步 `hash` 与摘要；否则下一次任务会拿到过期上下文。

## 可用 skill（按需加载，不要全量读）

| skill | 何时加载 |
|---|---|
| `context-indexing` | 新建/更新索引条目、摘要过期需重写时 |
| `adr-writing` | 触发 ADR（加运行时依赖、改调度结构、改存档或网络契约、换引擎）时 |
| `game-engine-conventions` | 涉及帧循环、渲染批次、资源加载、输入与音频约定时 |
| `test-strategy` | 设计测试层次、写时间与随机性可控的测试时 |
| `code-review` | 提交前自审、评审他人改动时 |

{{> SHARED:scope-guard}}

## 任务收尾必须做（顺序不能颠倒）

```bash
{{packageManager}} run typecheck   # 必须零错误；不要用 any 绕过
{{packageManager}} run test        # 时间与随机源必须可注入（否则测试不可复现）
{{packageManager}} run build       # 核对首屏 JS 体积是否在预算内
{{packageManager}} run preview     # 手动主流程：首屏 → 开始 → 玩 30 秒 → 结束
node {{aiDir}}/bin/ai-arch.mjs review --task    # 闭环对账 → 再补摘要 → 最后终检
node {{aiDir}}/bin/ai-arch.mjs index --stale
node {{aiDir}}/bin/ai-arch.mjs review --drift
```

- 类型错误数、测试通过/失败数、首屏 JS 体积必须写进任务包"证据"一节。**没有证据的"应该没问题"不算通过**；未跑的层级写明"未验证 + 原因 + 风险"（例如"未测 Safari / iOS"）。
- 三条收尾命令都不允许出现**新增**未处理项；`review --task` 报 `task-premise-stale` 时必须**重读那个文件**。

{{> SHARED:verification-loop}}
