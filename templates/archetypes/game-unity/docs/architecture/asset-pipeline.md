# 资产管线（导入设置、图集、加载策略）

> 本文决定"资产怎么进项目、怎么被打包、运行时怎么被加载"。它直接决定包体、加载时间与内存占用，
> 因此**任何一节规则的改动都要写 ADR**。判定用的资产清单见 `{{aiDir}}/index/asset-index.md`。

## 1. 导入设置基线（新建资产按此设，评审按此查）

| 资产 | 设置项 | 基线值 | 理由 |
|---|---|---|---|
| 贴图（UI） | Texture Type / Sprite Mode | `Sprite (2D and UI)` / `Single` | 避免运行时切图集失败 |
| 贴图（UI） | Max Size | `2048`（大图先拆） | 移动端显存敏感 |
| 贴图（UI） | Compression | `ASTC 6x6`（桌面 `DXT5`） | 跨平台一致性与画质折中 |
| 贴图（UI） | Generate Mip Maps | `off` | UI 不需要 mip，浪费 33% 显存 |
| 贴图（3D） | Read/Write Enabled | `off` | 开启会双份内存 |
| 贴图（3D） | sRGB / Normal Map | 法线图必须勾 `Normal map` 类型 | 否则光照错误且难查 |
| 模型 | Mesh Compression | `off`（或 `Low`） | 高压缩会引入顶点误差 |
| 模型 | Import Materials | `off`，材质手工管理 | 避免自动生成一堆 `Material` 资产 |
| 模型 | Optimize Game Objects | 需要骨骼访问时 `off`，否则 `on` | 影响 `Transform` 查找 |
| 音频（长） | Load Type | `Streaming`（音乐）/ `Compressed In Memory`（音效） | 长音频解压进内存会爆 |
| 音频（短） | Load Type / Compression | `Decompress On Load` / `Vorbis` | 低延迟播放 |
| 图集 | Sprite Atlas 分组 | 按场景/模块分组，单组 ≤2048² | 一组过大时切换 UI 会整组加载 |

规则：**改导入设置必须改 `.meta` 的 `importer` 段或在 Inspector 内改并提交 `.meta`**，
但**永远不要改 `guid`**（见 `AGENTS.md` 硬约束）。

## 2. 图集（Sprite Atlas）取舍

用图集当且仅当满足：同一屏内会同时出现、总尺寸可控、切换频率高。

| 做法 | 何时用 | 代价 |
|---|---|---|
| 打进图集（Sprite Atlas，`Include in Build`） | 主 UI、HUD 常驻图标 | 整组随场景进入内存 |
| 图集 + `Late Binding`（Addressables） | 大型图鉴、按页签浏览的图标 | 需要对 Addressables 组做加载/卸载管理 |
| 不打包（独立 Sprite） | 启动图、单次出现的大图 | 每个 Sprite 一次 DrawCall 与一次加载 |

反模式：把所有贴图塞进一个"大图集"。结果是一个界面只用一个图标也要加载全部；
判定信号是"某个图集 >4096² 或 >30 MB"，出现就必须拆组。

## 3. 加载方式取舍：直接引用 / Resources / Addressables

| 方式 | 适用 | 明确禁止的用法 |
|---|---|---|
| **Inspector 直接引用**（首选） | 场景内固定出现、生命周期与场景一致的对象 | 为了"方便"跨场景引用 |
| **`Resources/`** | 仅限启动期就需要、且体积极小的资产（如启动 Logo） | 业务资产、可下载内容、需要热更的内容；`Resources` 里的东西**全部**进包且无法按需卸载 |
| **Addressables** | 关卡内容、可下载皮肤、按需加载的大型资源 | 用它加载"其实一直都要用"的小资源（徒增异步复杂度） |

判定顺序：**先问"是否随场景同生共死"** → 是则直接引用；否 → 问"是否必须在首包" → 是则 `Resources`（并接受全量进包）；否则 Addressables。

Addressables 使用规则：

- 组按"卸载边界"划分，不按文件类型划分。一个组的语义应是"这组资源一起加载、一起释放"。
- 每个异步加载句柄都必须有对应的释放路径：`AsyncOperationHandle.Release()`。
  泄漏判定：连续进出同一场景 5 次，内存不回落即为泄漏。
- 引用计数由加载方持有；**禁止**把句柄存在全局单例里长期不释放。
- 组结构变更（新增组、移动资产所属组）→ 写 ADR + 更新 asset-index。

## 4. 提交前资产检查清单

- [ ] 新增资产的导入设置符合第 1 节基线（重点：贴图类型、Max Size、Read/Write、Mip）。
- [ ] 图集分组符合第 2 节（无 >4096² 或 >30 MB 的组）。
- [ ] 加载方式符合第 3 节判定顺序，没有"因为方便"塞进 `Resources/` 的业务资产。
- [ ] 每个 Addressables 句柄都有释放点。
- [ ] asset-index 条目已更新（`kind`/`purpose`/`deps`/`risk`/`hash`）。
- [ ] 涉及规则变更的已写 ADR。
- [ ] 出包一次并记录包体大小变化（Δ > 5% 必须在任务包里解释）。

## 5. 常见问题分诊

| 现象 | 常见根因 | 先查 |
|---|---|---|
| 模型进游戏后是粉色/紫红 | 材质引用的 shader 不在当前管线（{{renderPipeline}}）里 | 管线资产与材质 shader；HDRP/URP 材质不互通 |
| 包体突然变大几十 MB | 误把源文件（PSD/FBX 源）或音频未压缩导入 | 导入设置、`Resources/` 内容、Addressables 组 |
| 首次进关卡卡顿 | 首次同步加载 + shader 变体编译 | 预热（ShaderVariantCollection）、把加载挪到遮罩期间 |
| 切换界面内存持续上涨 | Addressables 句柄未释放 / 图集未卸载 | 第 3 节的泄漏判定流程 |
| 移动端纹理糊 | Max Size 被全局默认值截断 | 贴图导入设置与平台覆盖（Override for Android/iOS） |

平台覆盖设置**优先于**默认设置，排查时先看"平台页签是否覆盖了默认值"。

## 6. 与其他文档的关系

- 场景与常驻对象：`{{docsDir}}/architecture/scene-composition.md`
- 资产索引格式：`{{aiDir}}/index/asset-index.md`
- 构建与出包验证：`{{docsDir}}/runbooks/build-and-verify.md`
