# {{aiEntry}} — {{projectTitle}} 的 AI 入口

> 本文件是**指针，不是百科**（≤150 行）：只放硬约束、路由表、提交前检查。知识在 `{{aiDir}}/`、`{{docsDir}}/` 与源码里，按需读取。

**这是什么项目**：{{description}}
**项目名**：`{{projectName}}` ｜ **负责人**：{{owner}} ｜ **规模**：{{scaleLevel}} / {{scaleName}} ｜ **框架版本**：{{frameworkVersion}}
{{#IF usesBlueprint}}**项目形态**：C++ 与 Blueprint 混合 —— 职责边界判定见 `{{docsDir}}/architecture/bp-vs-cpp.md`，动手前先按该文档判定归属。
{{/IF}}{{#UNLESS usesBlueprint}}**项目形态**：纯 C++ —— 引入任何蓝图资产都必须先写 ADR（判定依据见 `{{docsDir}}/architecture/bp-vs-cpp.md`）。
{{/UNLESS}}
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

## UE 专项硬约束（违反即返工）

1. **绝不整读 `.uasset` / `.umap`**（二进制）：理解资产只能靠 `{{aiDir}}/index/asset-index.md` 摘要 + `Content/README.md` 命名约定 + 在编辑器里实际打开确认。
   **例外通道**（是否存在、能做什么、**不能**做什么，由 `.ai/project-facts.json` 决定——版本相关的事实不写死在本文件里，否则引擎升级后它就变成错误指导）：
   `node {{aiDir}}/bin/ai-arch.mjs facts` 会按本项目引擎版本与已启用插件给出结论与边界；任务包也会自动带上。
   **但无论有没有这条通道，资产的可共享知识都必须写进 `asset-index.md`**（它离线可读、可入库、可跨会话）。
2. **改头文件 / 模块 / `.Build.cs` 后必须重新生成项目文件再重编译**；只改 `.cpp` 实现且签名未变时可增量编译（命令见 `{{docsDir}}/runbooks/build-and-verify.md` 第 1 节）。
3. **`Binaries/`、`Intermediate/`、`Saved/`、`DerivedDataCache/`、`.vs/` 不入库**；它们出现在变更列表里说明 `.gitignore` 被破坏。
4. **GC 规则**：持有 `UObject` 的成员必须有 `UPROPERTY()`，否则会被 GC 回收成野指针（最难查的一类崩溃）；非拥有引用用 `TWeakObjectPtr<>`。
5. **UObject 禁止裸 `new` / `delete`**：用 `NewObject` / `CreateDefaultSubobject` / `SpawnActor`；释放交给 GC 或 `MarkAsGarbage()`。
6. **跨模块只 include `Public/` 下的头文件**；外部引用 `Private/` 视为模块边界破坏，必须先写 ADR。
7. **数值不写死在 C++**：可调数值放 DataAsset / DataTable，否则每次调参都要重编译。
8. **新增 Plugin / 第三方库 / 模块依赖必须先写 ADR**，除非宪法"已批准依赖"一节已列明。
9. **C++ / 蓝图 / 资产的归属必须先对齐再动手**：新内容属于哪一侧按 `{{docsDir}}/architecture/bp-vs-cpp.md` 判定；命中该文档"必须停下来问"的触发条件时**先问用户**，并把结论同时记进 `.ai/rules.json` 与 ADR——只口头对齐等于没对齐。
10. **新的长期约束必须先入库再写代码**：`node {{aiDir}}/bin/ai-arch.mjs rules add "<可判定的规则>" --category <类别> --enforcement <tool|review|manual> --check "<怎么判定>"`。判定不了的规则等于没有规则。

{{> SHARED:context-discipline}}

## 工作路由表（先查表，再动手）

| 你的任务 | 先读 | 命令 / 然后 |
|---|---|---|
| 接新任务 | `{{aiDir}}/index/README.md`、`{{aiDir}}/tasks/TEMPLATE.md` | `node {{aiDir}}/bin/ai-arch.mjs task "<任务描述>"` |
| 加新玩法系统 | `{{docsDir}}/architecture/module-layout.md` + `files.json` 摘要 | 先定模块归属与 C++/BP 边界；跨模块通信先写 ADR |
| 改 Map 或关卡流程 | `module-layout.md` + asset-index 的 Map 条目 | 只改必要 Actor；改完同步索引与 `Content/README.md` |
| 改蓝图逻辑 | `{{docsDir}}/architecture/bp-vs-cpp.md` | 若判定应属 C++，先迁移再改，不在蓝图里叠加 |
| 改头文件 / 模块 / `.Build.cs` | 模块依赖表 + `files.json` 摘要 | 重新生成项目文件 → 重编译 → 更新索引 |
| 改配置（`Config/*.ini` 核心项） | `Config/README.md` 第 2 节 | 属契约变更 → 先写 ADR，再跑打包冒烟 |
| 打包 / Cook 失败 | `{{docsDir}}/runbooks/build-and-verify.md` | 按分诊表排查，不要靠猜 |
| 改模块边界 / 数据契约 | `{{aiDir}}/index/impact-map.json` | 先写 ADR，再按 `mustUpdate` 逐条同步 |
| 判断这段逻辑写 C++ 还是蓝图 | `{{docsDir}}/architecture/bp-vs-cpp.md` 第 2 节判定顺序 | 命中第 4 节触发条件 → **先问用户**，结论记进 rules.json + ADR |
| 用户提出新的代码风格/工程约束 | `{{aiDir}}/rules.json` | `node {{aiDir}}/bin/ai-arch.mjs rules add "..." --category style --enforcement <tool\|review> --check "<怎么判定>"`，再按输出的传播清单逐条落实 |
| 想知道这个引擎版本能用哪些 AI 能力 | `{{aiDir}}/project-facts.json` | `node {{aiDir}}/bin/ai-arch.mjs facts`（按版本与插件判定，含边界说明） |

## UE 索引与摘要纪律

- `files.json`：C++ 与构建文件（`{{srcDir}}/**`、`Config/**`、`*.uproject`、`*.Build.cs`）；`asset-index.md`：`Content/**` 资产。
- 二进制资产**没有"按行读"这条退路**。摘要不足时的顺序：先读它对应的 C++ 头文件（`class` 字段与默认值）→ 查 `deps` 与 DataAsset 默认值 → 请人在编辑器里目视确认（Reference Viewer）→ **不要用文本工具硬试**。
{{#IF usesBlueprint}}- 蓝图索引到**图名级别**（`BP_X / EventGraph / 负责什么`），多数任务因此不必打开蓝图。
{{/IF}}- 改完代码或资产后同步 `hash` 与摘要；否则下一次任务会拿到过期上下文。

## 可用 skill（按需加载，不要全量读）

| skill | 何时加载 |
|---|---|
| `context-indexing` | 新建/更新索引条目、摘要过期需重写时 |
| `adr-writing` | 触发 ADR（换引擎版本、加模块/插件、改网络或存档契约、引入依赖）时 |
| `game-engine-conventions` | 涉及 UObject 生命周期、反射宏、GC、资产引用、模块构建时 |
| `code-review` | 提交前自审、评审他人改动时 |

{{> SHARED:scope-guard}}

## 任务收尾必须做（顺序不能颠倒）

```bash
# 1) 编译（头文件/模块变更前先重新生成项目文件）
Build.bat {{projectTitle}}Editor Win64 Development -Project="%CD%\{{projectTitle}}.uproject" -WaitMutex
# 2) 自动化测试（无头；测试前缀 Project.）
UnrealEditor-Cmd.exe "%CD%\{{projectTitle}}.uproject" -ExecCmds="Automation RunTests Project;Quit" -unattended -nopause -nullrhi -log
# 3) 打包冒烟（里程碑，或改资产/配置/模块后必须做）
RunUAT.bat BuildCookRun -project="%CD%\{{projectTitle}}.uproject" -noP4 -platform=Win64 -clientconfig=Development -cook -build -stage -pak -archive -archivedirectory=Build
# 4) 收尾：闭环对账 → 补摘要 → 终检
node {{aiDir}}/bin/ai-arch.mjs review --task
node {{aiDir}}/bin/ai-arch.mjs index --stale
node {{aiDir}}/bin/ai-arch.mjs review --drift
```

- 编译结果、测试通过/失败数、产物路径与大小必须写进任务包"证据"一节。**没有证据的"应该没问题"不算通过**；未跑的层级写明"未验证 + 原因 + 手动步骤"。
- 三条收尾命令都不允许出现**新增**未处理项；`review --task` 报 `task-premise-stale` 时必须**重读那个文件**。

{{> SHARED:verification-loop}}
