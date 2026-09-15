# {{aiEntry}} — {{projectTitle}} 的 AI 入口

> 本文件是**指针，不是百科**（≤130 行）：只放硬约束、路由表、提交前检查；本 archetype 版本是完整文件（渲染器按路径整份覆盖 base），含通用部分 + Godot 专项。
**这是什么项目**：{{description}}
**项目名**：`{{projectName}}` ｜ **负责人**：{{owner}} ｜ **规模**：{{scaleLevel}} / {{scaleName}} ｜ **框架版本**：{{frameworkVersion}}

开工前必读（两份，不要跳过）：

1. `{{aiDir}}/constitution.md` —— 定位、技术栈、**验证命令**、红线、规模门槛、例外记录（L1，≤130 行）。
2. `{{aiDir}}/index/README.md` —— 索引体系说明书：`files.json` 的摘要字段、`impact-map.json`、任务包怎么用。

## 硬约束（不可协商）

- **语言**：面向人的文档用中文；代码标识符、JSON 字段、CLI 参数、文件名一律英文。
- **依赖**：新增运行时依赖前先写 ADR（`{{aiDir}}/decisions/`）；能用标准库解决就不要引入依赖。
- **单一事实来源**：每条规则只写一处；文件摘要只写在 `{{aiDir}}/index/files.json`，其它地方只引用不复制。
- **不猜**：外部字段名、错误码、超时语义必须查文档或问人；不得已的猜测标 `ASSUMPTION:` 并写进任务包。
- **可追溯**：任何改动都要能回答"改了哪些文件、依据哪条规则、用什么命令验证"；答不上来就是没做完。
- **引擎与资源**：引擎/工具链版本升级必须先写 ADR；资源命名与导入规范以本 archetype 的文档为准。

## Godot 专项硬约束（违反即返工）

1. **不整读大场景**：`.tscn` / `.tres` 超过约 200 行时按锚点定位读（先搜节点名或 `ExtResource`，再读前后约 40 行）；资产入口是 `{{aiDir}}/index/asset-index.md`。
2. **改 `project.godot` 核心项先写 ADR**：autoload、主场景、渲染后端、输入映射、物理层名、`config_version`。
3. **`res://` 只读、`user://` 可写**：禁止用 `res://` 存运行时数据（导出后为只读，本地能跑、导出后崩）。
4. **autoload 是全局状态**：新增/删除必须写 ADR 并更新 `{{docsDir}}/architecture/autoload-and-signals.md`；一个 autoload 一个职责。
5. **不提交 `.godot/`**（导入与着色器缓存）；`assets/**` 的 `.import` 要入库。
6. **`_process` / `_physics_process` 内禁止**：`get_node`、字符串拼接、临时 `Array`/`Dictionary`、`find_children`；引用在 `_ready` 缓存。
7. **信号用于解耦而非万物**：全局信号总线仅限 `autoload-and-signals.md` 允许的场景；跨系统契约变更先写 ADR。
8. **新增插件 / 资产包（`addons/`）必须先写 ADR**，除非宪法"已批准依赖"一节已列明。

{{> SHARED:context-discipline}}

## 工作路由表（先查表，再动手）

| 你的任务 | 先读 | 命令 / 然后 |
|---|---|---|
| 接新任务 | `{{aiDir}}/index/README.md`、`{{aiDir}}/tasks/TEMPLATE.md` | `node {{aiDir}}/bin/ai-arch.mjs task "<任务描述>"` |
| 加新玩法系统 | `scripts/README.md` + `{{aiDir}}/index/files.json` 摘要 | 定系统边界 → 挂接点写进 asset-index → 跨系统信号契约先写 ADR |
| 改场景结构 | `{{docsDir}}/architecture/scene-composition.md` + asset-index 条目 | 只改必要节点；改入口节点名要同步索引与引用方 |
| 新增 / 修改 autoload | `{{docsDir}}/architecture/autoload-and-signals.md` | **写 ADR** → 改 `project.godot` → 更新清单与 asset-index |
| 加 UI / 菜单 | `scenes/README.md` + `autoload-and-signals.md` | UI 只向上报事件，不反向操控玩法逻辑 |
| 调性能（掉帧、卡顿） | 宪法"性能预算"一节 | Profiler 取数 → 修改 → 前后对比写进任务包证据 |
| 导出失败 / 导出版行为不一致 | `{{docsDir}}/runbooks/build-and-verify.md` | 按分诊表排查（多为 `res://` 写入或资源未包含） |
| 改模块边界 / 数据契约 | `{{aiDir}}/index/impact-map.json` | 先写 ADR，再按 `mustUpdate` 逐条同步 |

## Godot 索引与摘要纪律

- `files.json` 记录**脚本与配置**（`{{srcDir}}/**`、`project.godot`、`export_presets.cfg`、`tests/**`）：`path`、`hash`、`digest`、`imports`。
- `asset-index.md` 记录**场景与资源**（`scenes/**`、`assets/**`）：路径、类型、用途、模块、依赖、入口节点、风险。
- 场景的正确读法：先读索引的 `entrypoints` / `deps` → 需要细节时搜 `[node name="X"`、`script = ExtResource(`、`[autoload]` → 只读锚点前后约 40 行（一次只回答一个问题）→ 结论回写索引并更新 `hash`。
- 改完脚本或场景后同步 `hash` 与摘要；否则下一次任务会拿到过期上下文。

## 可用 skill（按需加载，不要全量读）

| skill | 何时加载 |
|---|---|
| `context-indexing` | 新建/更新索引条目、摘要过期需重写时 |
| `adr-writing` | 触发 ADR（改 autoload、改 `project.godot` 核心项、换渲染后端、引入插件）时 |
| `game-engine-conventions` | 涉及节点生命周期、信号、资源加载、导出行为差异时 |
| `code-review` | 提交前自审、评审他人改动时 |

{{> SHARED:scope-guard}}

## 提交前必须做

```bash
# 1) 无头导入校验（首次或大改资产后必跑；抓脚本解析错误与缺失资源）
godot --headless --path . --quit
# 2) 冒烟检查（关键路径与 autoload 是否存活；失败退出码非 0）
godot --headless --path . -s scripts/dev/smoke_check.gd
# 3) 测试（测试框架先用 ADR 选定；下面以 GUT 为例，按实际框架调整）
godot --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit
# 4) 导出冒烟（预设名以 export_presets.cfg 为准）
godot --headless --path . --export-release "Windows Desktop" Build/windows/{{projectName}}.exe
# 5) 索引与漂移
node {{aiDir}}/bin/ai-arch.mjs index --stale
node {{aiDir}}/bin/ai-arch.mjs review --drift
```

- 导入是否成功、测试通过/失败数、导出产物路径与大小必须写进任务包"证据"一节。**没有证据的"应该没问题"不算通过**；未跑的层级写"未验证 + 原因 + 风险"。

{{> SHARED:verification-loop}}
