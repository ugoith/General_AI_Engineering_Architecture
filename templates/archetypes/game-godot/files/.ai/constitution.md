# 项目宪法 — {{projectTitle}}

> L1 层：每会话必读，必须 ≤120 行。只写**本项目专属**的红线与可执行验证命令；
> 通用规范来自框架（`packId: {{packId}}`，`frameworkVersion {{frameworkVersion}}`），不在本文件重复。
> 最后更新：{{date}}，负责人：{{owner}}。

## 1. 项目事实

| 项 | 值 |
|---|---|
| 引擎 / 版本 | Godot **{{godotVersion}}**（以 `project.godot` 的 `config/features` 为准） |
| 脚本语言 | {{#IF gdscript}}**GDScript**（不要引入 C# 脚本；如需切换语言先写 ADR）{{/IF}}{{#UNLESS gdscript}}**C#**（需 .NET 版 Godot；GDScript 仅允许用于编辑器工具）{{/UNLESS}} |
| 脚本根目录 | `{{srcDir}}` |
| 渲染后端 | 待填写：`Forward+ / Mobile / Compatibility` |
| 主场景 | `res://scenes/Main.tscn`（以 `project.godot` 的 `run/main_scene` 为准） |
| 目标平台 | 待填写：`Windows / Linux / macOS / Android / iOS / Web`（列出必测平台） |
| 目标帧率 | 待填写：例如 `60 FPS @ 1080p`（低端机允许降到 30） |
| 规模等级 | {{scaleLevel}} / {{scaleName}} |

## 2. 红线（违反即拒绝合并）

1. **不整读大场景**：`.tscn`/`.tres` 超过约 200 行时按行窗口读（先搜节点名与 `ExtResource`）。
2. **改 `project.godot` 的核心项必须先写 ADR**：autoload、主场景、渲染后端、输入映射、物理层名、`config_version`。
3. **禁止向 `res://` 写入运行时数据**（导出后为只读）：存档、日志、缓存一律写 `user://`。
4. **autoload 只做全局服务，不做业务逻辑容器**；新增/删除 autoload 必须写 ADR 并更新 `autoload-and-signals.md` 清单。
5. **`_process`/`_physics_process` 中禁止**：`get_node`、字符串拼接、临时 `Array`/`Dictionary`、`find_children`、
   `load()`/`preload` 动态路径。引用在 `_ready` 缓存。
6. **禁止提交 `.godot/`**（导入与着色器缓存）。导出产物目录（`Build/`）同样不入库。
7. **禁止伪造验证结果**：没跑过的导入校验/测试不许写成通过；不能验证的写明"未验证 + 原因 + 人工步骤"。
8. **禁止越规模引入架构**：DI 框架、第三方事件总线、ECS 重架构、CQRS 分层在 {{scaleLevel}} 级一律不做；要做得先升级规模等级并写 ADR。
9. **节点名与场景路径是公开契约**：改了入口节点名或场景路径必须同步索引与所有引用方（含 autoload 里的硬编码路径）。

## 3. 已批准依赖

| 依赖 / 插件 | 版本 | 用途 | 批准方式 |
|---|---|---|---|
| 待填写 | | | ADR-000 或"随引擎内置" |

`addons/` 下新增任何插件都必须先写 ADR（含测试框架的选型）。

## 4. 验证命令（DoD 的唯一依据）

```bash
# L0 无头导入校验：能抓出脚本解析错误、缺失资源、导入失败
godot --headless --path . --quit

# L0b 冒烟检查：关键场景与 autoload 是否存活（失败退出码非 0）
godot --headless --path . -s scripts/dev/smoke_check.gd

# L1 单元/集成测试（入口以 ADR 选定的框架为准）
godot --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit

# L2 导出冒烟（改场景/资源/导出预设/autoload 时必跑）
godot --headless --path . --export-release "Windows Desktop" Build/windows/{{projectName}}.exe

# L3 索引漂移检查（每次提交前）
node .ai/bin/ai-arch.mjs review --drift
```

- `godot` 的真实可执行文件路径：待填写（Windows 形如 `C:\Tools\Godot\Godot_v{{godotVersion}}-stable_win64.exe`）。
- 判定标准：L0 退出码 0 且无 `ERROR:`/`SCRIPT ERROR:`；L1 无 `failed`；L2 退出码 0 且产物存在。
- `Build/`、`.godot/` 是生成物，不入库，只把结果摘要写进任务包。
- **导出版与编辑器版行为不一致是高发问题**：导出后在真机上至少走一次主流程（见 runbook 第 4 节）。

## 5. 性能与成本预算

| 指标 | 预算 | 超标处理 |
|---|---|---|
| 帧时间（游戏逻辑 + 渲染） | 待填写：例如 `≤16.6 ms` | 编辑器 Profiler 抓帧，前后数据写进任务包 |
| `_process` 中分配 | `0`（稳态） | 缓存引用、复用容器、避免字符串生成 |
| 每帧 `get_node`/`find_children` 调用 | `0` | 改 `@onready`/`_ready` 缓存 |
| 场景首次加载时间 | 待填写 | 用 `ResourceLoader.load_threaded_request` 异步加载 + 加载画面 |
| 导出包体 | 待填写 | 检查导入设置（纹理压缩、音频格式）与未使用资源 |

## 6. 规模门槛

{{> SHARED:scale-gate}}

## 7. 决策记录

- 目录：`{{aiDir}}/decisions/`，模板：`{{aiDir}}/templates/adr.md`，命名：`ADR-0001-<kebab-title>.md`。
- 何时必须写：

{{> SHARED:decision-trigger}}

## 8. 变更影响（改 A 必须同步 B）

| 改了 | 必须同步 |
|---|---|
| `{{srcDir}}/**` 任何脚本 | `{{aiDir}}/index/files.json` 的 `hash` 与 `digest` |
| 任何 `.tscn`/`.tres` | `{{aiDir}}/index/asset-index.md` 对应条目（入口节点、`deps`、风险） |
| `project.godot` 核心项 | ADR + `{{docsDir}}/architecture/autoload-and-signals.md`（若涉及 autoload） |
| 场景组成或切换方式 | `{{docsDir}}/architecture/scene-composition.md` + ADR |
| 导出预设（`export_presets.cfg`） | `{{docsDir}}/runbooks/build-and-verify.md` + 导出冒烟 |
| 新增 `addons/` 插件或切换脚本语言 | 本文件第 1、3 节 + ADR |
