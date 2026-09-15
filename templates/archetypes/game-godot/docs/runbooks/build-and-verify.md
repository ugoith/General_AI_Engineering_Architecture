# Runbook：运行、测试与导出（Godot 4）

> 用途：把"怎么无头校验、怎么跑测试、怎么导出、失败了怎么查"写成可照着执行的步骤。
> 每条命令都带判定标准——**没有判定标准的命令等于没跑**。本机与 CI 必须跑同一组命令。

## 0. 前置（只做一次）

1. 安装与宪法一致的 Godot 版本 **{{godotVersion}}**（标准版；若项目用 C# 则安装 .NET 版）。
2. 记录可执行文件路径并写入 `.ai/constitution.md` 第 4 节：
   - Windows：`C:\Tools\Godot\Godot_v{{godotVersion}}-stable_win64.exe`
   - macOS：`/Applications/Godot.app/Contents/MacOS/Godot`
   - Linux：`./Godot_v{{godotVersion}}-stable_linux.x86_64`
3. 首次打开项目会生成 `.godot/` 导入缓存（**不入库**）；CI 上首次运行也必须先生成它，否则资源路径解析会失败。

## 1. 验证阶梯

| 层 | 命令 | 判定 | 耗时量级 |
|---|---|---|---|
| L0 导入校验 | `godot --headless --path . --quit` | 退出码 0，输出无 `ERROR:` / `SCRIPT ERROR:` | 10 s – 3 min |
| L0b 冒烟 | `godot --headless --path . -s scripts/dev/smoke_check.gd` | 输出 `smoke_check: OK`，退出码 0 | < 10 s |
| L1 测试 | `godot --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit` | 无 `failed`，退出码 0 | 10 s – 2 min |
| L2 导出冒烟 | `godot --headless --path . --export-release "Windows Desktop" Build/windows/{{projectName}}.exe` | 退出码 0，产物存在 | 1 – 5 min |
| L3 运行冒烟 | 双击导出产物（或 `--path Build/windows` 运行） | 主流程可玩：启动 → 进关卡 → 退出 | 5 min |

选择规则：

- 只改 `{{srcDir}}` 下脚本实现 → L0 + L0b + L1。
- 改了场景/资源/`project.godot`/导出预设 → 至少 L0 + L2。
- 涉及 autoload、流程切换、输入映射 → 必须 L2 + L3。
- 里程碑/发布前 → L2 + L3（每个目标平台各一次）。

## 2. 导出（命令行）

```bash
# 预设名必须与 export_presets.cfg 里的 name 完全一致（含空格与大小写）
godot --headless --path . --export-release "Windows Desktop" Build/windows/{{projectName}}.exe
godot --headless --path . --export-release "Linux/X11"     Build/linux/{{projectName}}.x86_64
godot --headless --path . --export-release "Web"           Build/web/index.html
```

- **必须先有导出预设**（编辑器 Project → Export 添加一次并提交 `export_presets.cfg`）；CI 上首次导出如果报"preset not found"，就是预设名写错或文件未提交。
- 导出模板（export templates）必须已安装且版本与引擎一致，否则报 `No export template found`。
- 产物目录 `Build/` 不入库；把大小与路径写进任务包。
- 包体变化 >5% 时必须在任务包里解释原因（新资源？纹理未压缩？误把开发资源打进去？）。

## 3. 失败分诊表

| 现象 | 先看 | 常见根因 | 处理 |
|---|---|---|---|
| `--headless --quit` 输出 `SCRIPT ERROR` | 报错文件与行号 | 脚本解析错误、类型不匹配、`preload` 路径不存在 | 按行修；`preload` 失败会连带报一堆错误，先修第一个 |
| 编辑器能跑、导出版崩溃 | 导出时终端输出 + 运行产物时的 `user://logs/` | 用了 `res://` 写数据、依赖编辑器专用 API、资源未被导出包含 | 数据改写 `user://`；把编辑器逻辑放到导出排除的脚本；检查资源筛选规则 |
| 导出报 `No export template found` | 模板版本 | 模板未装或版本不匹配 | 在编辑器里下载与引擎版本一致的模板 |
| 导出报 `preset not found` | `export_presets.cfg` | 预设名拼写不符/文件未提交 | 用文件里的 `name=` 值原样传参 |
| `--headless` 下 autoload 报 null | `project.godot` 的 `[autoload]` | 注册名与脚本不符、脚本有解析错误导致未加载 | 修解析错误；核对注册名与 `smoke_check.gd` 的 `REQUIRED_AUTOLOAD` |
| 测试全绿但游戏仍坏 | 测试覆盖范围 | 只测了纯逻辑，未测场景装配 | 补 L2 场景测试或写清"人工验证步骤 + 结果" |
| 场景切换后黑屏 | 场景输出的第一条错误 | 目标场景路径错、场景未保存、缺 autoload | 用 `ResourceLoader.exists()` 预检；核对索引条目 |
| 帧率骤降 | Profiler | 每帧 `get_node`/字符串拼接/大量节点 | 按 `scripts/README.md` 第 4 节排查，改前先取基准 |

## 4. 记录要求（任务包必须包含）

```markdown
### 结果
- 改动：<一句话>
- 验证层级：L0 / L0b / L1 / L2 / L3（列出实际跑的命令）
- 证据：<导入是否干净、测试通过/失败数、产物路径与大小、包体 Δ>
- 未验证项与原因：<例如"Android 未测：本机无导出模板">
- 遗留风险：<例如"改了 autoload，仅验证了 Windows 导出">
```

**只跑 L0 却声称"已验证完成"属于伪造验证**，评审直接退回。

## 5. 索引与漂移

```bash
node .ai/bin/ai-arch.mjs review --drift
```

- hash 漂移 → 更新 `{{aiDir}}/index/files.json` 或 `{{aiDir}}/index/asset-index.md`。
- 报"决策缺失"（改了 autoload/`project.godot` 核心项/导出预设但无 ADR）→ 补 ADR。
- 漂移未清零不算完成（DoD 第 5 条）。
