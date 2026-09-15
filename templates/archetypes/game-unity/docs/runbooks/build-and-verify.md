# Runbook：构建与验证（Unity）

> 用途：把"怎么构建、怎么判定成功、失败了怎么查"写成可照着执行的步骤。
> 每条命令的判定标准都写在命令后面——**没有判定标准的命令等于没跑**。
> 工程师本机与 CI 必须跑同一组命令；差异只允许出现在 Unity 可执行文件路径上。

## 0. 前置（只做一次）

1. Unity Hub 安装与宪法一致的版本（`{{unityVersion}}`）。版本以 `ProjectSettings/ProjectVersion.txt` 为准。
2. 记录 Unity 可执行文件路径，填入 `.ai/constitution.md` 第 4 节：
   - Windows：`C:\Program Files\Unity\Hub\Editor\<版本>\Editor\Unity.exe`
   - macOS：`/Applications/Unity/Hub/Editor/<版本>/Unity.app/Contents/MacOS/Unity`
3. 首次打开项目会导入资源（10–60 分钟，取决于资产量）。**导入期间不要构建**。

## 1. 验证阶梯（按成本从低到高，能停在低层就不要往上跑）

| 层 | 命令 | 判定 | 耗时量级 |
|---|---|---|---|
| L0 编译 | `Unity -batchmode -nographics -projectPath . -quit -logFile Logs/compile.log` | `Logs/compile.log` 无 `error CS`；退出码 0 | 1–3 min |
| L1 单元测试（EditMode） | `Unity -batchmode -nographics -projectPath . -runTests -testPlatform EditMode -testResults Logs/editmode.xml -logFile Logs/editmode.log -quit` | XML 中 `failed="0"` | 1–2 min |
| L2 场景测试（PlayMode） | 同上，`-testPlatform PlayMode`，结果写 `Logs/playmode.xml` | `failed="0"` | 5–15 min |
| L3 出包冒烟 | `Unity -batchmode -nographics -projectPath . -executeMethod BuildScript.BuildWindows -logFile Logs/build.log -quit` | 退出码 0 且产物存在 | 10–40 min |

选择规则：

- 只改 C# 逻辑（不碰资产、不碰导入设置）→ 至少 L0 + L1。
- 改了场景/预制体/材质、或改了常驻对象 → 至少 L2。
- 里程碑、发布前、改了导入设置/图集/Addressables/管线 → 必须 L3。

## 2. 出包与产物

```bash
# Windows 出包（BuildScript 是 Assets/Editor 里的静态入口）
Unity -batchmode -nographics -projectPath . -executeMethod BuildScript.BuildWindows -logFile Logs/build.log -quit
# 产物预期：Build/Windows/<项目名>.exe + <项目名>_Data/
```

- 产物与日志目录（`Build/`、`Logs/`）**不入库**，只在任务包里记录大小与路径。
- 包体变化是重要信号：相对上一次出包变化 >5% 时，必须在任务包里说明原因（新资产？图集膨胀？误入 `Resources/`？）。
- 出包后至少做一次**冷启动冒烟**：从 `Boot` 走到可操作界面，再进一个关卡并退出。

## 3. 失败分诊表（先分类，再动手）

| 现象 | 先看 | 常见根因 | 处理 |
|---|---|---|---|
| `error CS####` 编译失败 | `Logs/compile.log` 第一条 error | 编辑器 API 混入运行时程序集（`using UnityEditor;` 放错目录）、asmdef 引用方向错 | 移到 `Assets/Editor/`，或用 `#if UNITY_EDITOR`；检查 asmdef 单向依赖 |
| 测试在本地过、CI 挂 | `Logs/*.log` 里的场景路径与平台 | 依赖编辑器状态、依赖本地路径、依赖帧率 | 测试必须自建场景与对象；不用 `AssetDatabase` 做运行时断言 |
| PlayMode 测试超时 | 测试日志最后输出 | 异步加载未完成就断言、等待真实时间 | 用可注入的时间源；等待条件而非固定时长 |
| 出包成功但运行黑屏 | 播放器日志（`%USERPROFILE%\AppData\LocalLow\<公司>\<项目>\Player.log`） | Boot 场景未在 `Scenes In Build` 首位、首场景依赖了未包含的资产 | 检查 Build Settings 场景列表与 asset-index 的入口节点 |
| 出包报"资源丢失/Missing" | `Logs/build.log` 搜 `Missing` | 资产被移动但引用未更新、`Resources`/Addressables 组漏包含 | 用 asset-index 反向查依赖；不要手改 `.meta` guid |
| 打包失败在 `Library/` 相关 | 日志开头 | 上一次非正常退出导致 Library 损坏 | 关闭 Unity → 删 `Library/` → 重新导入（这是最后手段，会耗时） |
| 产物巨大 | 出包日志的 `Build Report` | 源文件误入库、音频/贴图未压缩、`Resources/` 全量进包 | 按 `{{docsDir}}/architecture/asset-pipeline.md` 第 5 节分诊 |

## 4. 记录要求（任务包必须包含）

```markdown
### 结果
- 改动：<一句话>
- 验证层级：L0 / L1 / L2 / L3（列出实际跑的命令）
- 证据：<通过数/失败数、产物路径与大小、包体 Δ>
- 未验证项与原因：<例如"Android 未测：本机无设备">
- 遗留风险：<例如"该场景属 high 风险，未做 5 次进出泄漏测试">
```

**只跑 L0/L1 却在任务包里声称"已验证完成"属于伪造验证**，评审直接退回。

## 5. 索引与漂移

```bash
node .ai/bin/ai-arch.mjs review --drift
```

- 报出 hash 漂移 → 更新 `{{aiDir}}/index/files.json` 或 `{{aiDir}}/index/asset-index.md` 对应条目。
- 报出"决策缺失"（改了架构但无 ADR）→ 补 ADR，见 `{{aiDir}}/constitution.md` 第 7 节。
- 漂移未清零不算完成（DoD 第 5 条）。
