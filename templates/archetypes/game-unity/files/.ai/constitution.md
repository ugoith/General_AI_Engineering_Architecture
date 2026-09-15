# 项目宪法 — {{projectTitle}}

> L1 层：每会话必读，≤120 行。只写**本项目专属**的红线与可执行验证命令；通用规范来自框架（`packId: {{packId}}`，`frameworkVersion {{frameworkVersion}}`），不在此重复。
> 最后更新：{{date}}，负责人：{{owner}}。

## 1. 项目事实

| 项 | 值 |
|---|---|
| 引擎 / 版本 | Unity **{{unityVersion}}**（以 `ProjectSettings/ProjectVersion.txt` 为准；不一致时先修版本再干活） |
| 渲染管线 | **{{renderPipeline}}**（管线资产在 `Assets/Settings/`，待填文件名） |
| 源码根 | `{{srcDir}}` |
| 目标平台 / 帧率 | 待填写：`Windows / Android / iOS / WebGL`；目标 `60 FPS @ 1080p`（低于此值视为回归） |
| 规模等级 | {{scaleLevel}} / {{scaleName}} |

## 2. 红线（违反即拒绝合并）

1. **不手改 `.meta` 的 `guid`**；导入设置走 Inspector 或 `.meta` 的 `importer` 段 + ADR。
2. **不整读资产**（`.unity`/`.prefab`/`.asset`/`.anim`）：只经 `{{aiDir}}/index/asset-index.md` 摘要访问，确需细节按行窗口读。
3. **`{{srcDir}}` 中禁止 `using UnityEditor;`**；编辑器代码放 `Assets/Editor/` 或用 `#if UNITY_EDITOR`。
4. **`Update`/`FixedUpdate`/`LateUpdate` 中禁止每帧托管分配**：无 `new`、无字符串拼接、无 LINQ、无 `GetComponent`、无 `Find*`、无 `Resources.Load`。
5. **禁止伪造验证结果**：没跑过的测试不许写成通过；不能验证的写明"未验证 + 原因 + 建议的人工步骤"。
6. **禁止越规模引入架构**：DI 容器、第三方事件总线、ECS/DOTS 化、CQRS 分层在 {{scaleLevel}} 级一律不做；要做得先升级规模等级并写 ADR。
7. **资产改动必须同步索引条目**，否则视为未完成（资产不更新索引 = 下次任务必然读到过期上下文）。

## 3. 已批准依赖

| 依赖 | 版本 | 用途 | 批准方式 |
|---|---|---|---|
| 待填写 | | | ADR-000 或"Unity 内置" |

除本表外，新增任何 Package（`Packages/manifest.json` 变更）必须**先写 ADR**。

## 4. 验证命令（DoD 的唯一依据）

按成本从低到高执行，**低成本的先跑**：

```bash
# 1) 编译与域重载（编辑器内打开一次，Console 无 error）；或命令行：
Unity -batchmode -nographics -projectPath . -quit -logFile Logs/compile.log
# 2) 单元测试（EditMode，秒级）
Unity -batchmode -nographics -projectPath . -runTests -testPlatform EditMode -testResults Logs/editmode.xml -logFile Logs/editmode.log -quit
# 3) 场景/集成测试（PlayMode，分钟级）
Unity -batchmode -nographics -projectPath . -runTests -testPlatform PlayMode -testResults Logs/playmode.xml -logFile Logs/playmode.log -quit
# 4) 出包冒烟（里程碑，或改动涉及资产/导入设置）
Unity -batchmode -nographics -projectPath . -executeMethod BuildScript.BuildWindows -logFile Logs/build.log -quit
# 5) 索引漂移检查（每次提交前）
node .ai/bin/ai-arch.mjs review --drift
```

- Unity 可执行文件路径：待填写（Windows 形如 `"C:\Program Files\Unity\Hub\Editor\<版本>\Editor\Unity.exe"`）。
- 判定：测试 0 failed；`Logs/build.log` 无 `error CS`；产物存在于 `Build/`。
- **`Build/`、`Logs/`、`Library/` 不入库**，只把结果摘要写进任务包。
- 仅在编辑器内手工验过的改动，任务包必须写"仅编辑器内验证 + 未跑的命令 + 风险"。

## 5. 性能与成本预算

| 指标 | 预算 | 超标处理 |
|---|---|---|
| 目标帧时间 | 待填写：例如 `≤16.6 ms`（60 FPS） | Profiler 截帧定位；禁止"降画质了事"，需记录前后数据 |
| GC Alloc / 帧（稳态） | `0 B`（`Update` 路径） | 定位分配源，改缓存或 `NonAlloc` API |
| 场景加载时间 | 待填写 | 超预算则评估 Addressables 拆分，需 ADR |
| 首包体积 | 待填写 | 先查导入设置与图集，再查冗余资源引用 |

## 6. 规模门槛

{{> SHARED:scale-gate}}

## 7. 决策记录

- 目录：`{{aiDir}}/decisions/`，模板：`{{aiDir}}/templates/adr.md`，命名：`ADR-0001-<kebab-title>.md`。
- 何时必须写：

{{> SHARED:decision-trigger}}

## 8. 变更影响（改 A 必须同步 B）

| 改了 | 必须同步 |
|---|---|
| `{{srcDir}}` 下任何 `.cs` | `{{aiDir}}/index/files.json` 的 `hash` 与 `digest` |
| 任何场景/预制体/材质/图集 | `{{aiDir}}/index/asset-index.md` 对应条目（摘要、`deps`、风险） |
| 导入设置、图集、Addressables 组 | `{{docsDir}}/architecture/asset-pipeline.md` + ADR |
| 场景组成 | `{{docsDir}}/architecture/scene-composition.md` |
| Unity 版本 / 渲染管线 / 新增 Package | 本文件第 1、3 节 + ADR |
| 构建脚本或构建命令 | `{{docsDir}}/runbooks/build-and-verify.md` + 本文件第 4 节 |
