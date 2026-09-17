# {{aiEntry}} — {{projectTitle}} 的 AI 入口

> 本文件是**指针，不是百科**（≤150 行）：只放硬约束、路由表、提交前检查。知识在 `{{aiDir}}/`、`{{docsDir}}/` 与源码里，按需读取。
> 注意：本 archetype 的 `AGENTS.md` 会**整份替换**基础层同名文件（渲染器按路径覆盖，不做拼接），因此这里保留了基础层的通用部分，并追加 Unity 专项。

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
- **引擎与资源**：引擎/管线版本升级必须先写 ADR；资源命名与导入规范以本 archetype 的文档为准。

## Unity 专项硬约束（违反即返工）

1. **不手改 `.meta`**：`guid` 是资产引用的唯一凭据，手改会静默切断引用（Missing Script/Reference）；导入设置走 Inspector，或改 `.meta` 的 `importer` 段并写 ADR。
2. **不整读资产**：`.unity` / `.prefab` / `.asset` / `.anim` 只经 `{{aiDir}}/index/asset-index.md` 的摘要与关键字段（根节点、依赖、模块、风险）访问；确需细节时按锚点定位行窗口读取。
3. **运行时查找反模式**：`FindObjectOfType` / `GameObject.Find` / `FindGameObjectsWithTag` / `Resources.Load` 出现在 `Update` / `FixedUpdate` 一律视为缺陷；初始化期的一次性查找在 `Awake` 缓存成字段。
4. **编辑器代码只放 `Assets/Editor/`**（或 `#if UNITY_EDITOR`）；`{{srcDir}}` 下出现 `using UnityEditor;` 会导致打包失败。
5. **`.csproj` / `.sln` 是生成物**，不入库；手工改动会被 Unity 覆盖。
6. **`Update` 内零分配**：不 `new` 托管对象、不字符串拼接、不 LINQ、不每帧 `GetComponent`、不装箱（含 `foreach` 遍历字典产生的枚举器）。
7. **新增 Package / 第三方依赖必须先写 ADR**（改 `Packages/manifest.json` 同样算），除非宪法"已批准依赖"一节已列明。

{{> SHARED:context-discipline}}

## 工作路由表（先查表，再动手）

| 你的任务 | 先读 | 命令 / 然后 |
|---|---|---|
| 接新任务 | `{{aiDir}}/index/README.md`、`{{aiDir}}/tasks/TEMPLATE.md` | `node {{aiDir}}/bin/ai-arch.mjs task "<任务描述>"` |
| 加新玩法系统 | `{{srcDir}}/README.md` + `{{aiDir}}/index/files.json` 相关摘要 | 先定模块目录与边界；跨模块通信先写 ADR |
| 改场景组成 / 切场景 | `{{docsDir}}/architecture/scene-composition.md` + asset-index 该条目 | 只改必要节点；改完更新该条目摘要与 `deps` |
| 改预制体结构 | asset-index 该预制体条目 | 结构大改需 ADR，并同步场景组成文档 |
| 调性能（掉帧、GC） | 宪法"性能预算"一节 | Profiler 截帧定位；前后数据写进任务包证据 |
| 改导入设置 / 图集 / Addressables | `{{docsDir}}/architecture/asset-pipeline.md` | 影响包体与加载时间，**必须写 ADR** |
| 改模块边界 / 数据契约 | `{{aiDir}}/index/impact-map.json` 的 `module-boundary-change` / `data-model-change` | 先写 ADR，再按 `mustUpdate` 逐条同步 |
| 修 bug / 重构 | 任务包"读取清单"里的目标文件与 `digest` | `node {{aiDir}}/bin/ai-arch.mjs task "fix: <现象>"` |
| 更新文档 / 索引 | `{{aiDir}}/index/README.md` | `node {{aiDir}}/bin/ai-arch.mjs index --stale` |

## Unity 索引与摘要纪律

- 代码进 `files.json`（`path` / `hash` / `digest` / `imports`）；资产进 `asset-index.md`（路径、用途、模块、依赖、风险、入口节点）。
- 读大 YAML 的正确姿势：先搜锚点（`m_Name:`、`MonoBehaviour:`、脚本 GUID）定位行号 → 只读前后约 40 行 → 把结论回写摘要，**不要把原文粘进任务包**。
- 改完代码或资产后必须同步 `hash` 与摘要；否则下一次任务会拿到过期上下文并据此做出错误判断。

## 可用 skill（按需加载，不要全量读）

| skill | 何时加载 |
|---|---|
| `context-indexing` | 新建/更新索引条目、摘要过期需重写时 |
| `adr-writing` | 触发 ADR（换引擎/管线、改模块边界、改存档或事件契约、加依赖）时 |
| `game-engine-conventions` | 涉及 Unity 生命周期、序列化、资产引用、导入流程时 |
| `code-review` | 提交前自审、评审他人改动时 |

{{> SHARED:scope-guard}}

## 任务收尾必须做（顺序不能颠倒）

```bash
# 1) EditMode 测试（Unity 可执行文件路径见宪法"验证命令"一节）
Unity -batchmode -nographics -projectPath . -runTests -testPlatform EditMode -testResults Logs/editmode.xml -logFile Logs/editmode.log -quit
# 2) 出包冒烟（里程碑，或改动资产/导入设置后必须做）
Unity -batchmode -nographics -projectPath . -executeMethod BuildScript.BuildWindows -logFile Logs/build.log -quit
# 3) 收尾：闭环对账 → 补摘要 → 终检
node {{aiDir}}/bin/ai-arch.mjs review --task
node {{aiDir}}/bin/ai-arch.mjs index --stale
node {{aiDir}}/bin/ai-arch.mjs review --drift
```

- 测试通过/失败数与产物路径必须写进任务包"证据"一节。**没有证据的"应该没问题"不算通过**；未跑的层级写明"未验证 + 原因 + 手动步骤"。
- 三条收尾命令都不允许出现**新增**未处理项；`review --task` 报 `task-premise-stale` 时必须**重读那个文件**。

{{> SHARED:verification-loop}}
