# Config/ — 项目配置说明

`Config/` 是**进版本库的引擎与项目配置**。它决定了游戏怎么启动、加载哪些资产、输入怎么映射，
因此这里的每一处改动都比普通代码改动影响面大：改错会导致"能编译但运行行为完全不同"。

## 1. 文件职责

| 文件 | 管什么 | 典型条目 |
|---|---|---|
| `DefaultEngine.ini` | 渲染、物理、碰撞通道、地图与 GameMode 默认值、`[/Script/EngineSettings.GameMapsSettings]` | `GameDefaultMap`、`GlobalDefaultGameMode`、碰撞 Profile |
| `DefaultGame.ini` | 打包规则、`AssetManager` 的 PrimaryAsset 类型与扫描路径、版本号 | `[/Script/Engine.AssetManagerSettings]`、`ProjectVersion` |
| `DefaultInput.ini` | 增强输入（Enhanced Input）的默认类、旧输入兼容开关 | `DefaultPlayerInputClass`、`DefaultInputComponentClass` |
| `DefaultEditor.ini` | 编辑器偏好（团队共享的那部分） | 关卡模板、蓝图编译提示 |
| `<Platform>/<Platform>Engine.ini` | 平台覆盖（画质档、分辨率、内存预算） | `[/Script/Engine.RendererSettings]` |

`Saved/Config/` 下的同名文件是**本机运行时覆盖，不入库**（见根目录 `.gitignore`）。
排查"我改了配置但没生效"时，先确认改的是 `Config/` 还是被 `Saved/Config/` 覆盖了。

## 2. 必须走 ADR 的配置改动

| 改动 | 为什么 |
|---|---|
| `GlobalDefaultGameMode` / `GameDefaultMap` | 改变游戏启动路径，影响所有测试与出包 |
| `AssetManager` 的 PrimaryAsset 类型或扫描目录 | 改变打包内容与按需加载行为，直接影响包体与加载失败 |
| 碰撞通道 / 碰撞 Profile 的新增或改名 | 会静默改变所有既有 Actor 的碰撞行为，是最隐蔽的回归源 |
| 渲染设置（默认 RHI、阴影、Lumen/Nanite 开关） | 影响全项目画质与性能预算 |
| 平台画质档（`DeviceProfiles`） | 影响目标机型能否达标 |
| 网络/复制相关默认值（`NetDriver`、tick 频率） | 改变同步语义 |
| 打包包含/排除规则 | 可能把资源打进去或漏掉 |

## 3. 提交与评审规则

- **只提交 `Config/` 下的文件**；`Saved/`、`Intermediate/` 一律不入库（`.gitignore` 已覆盖）。
- 改 `Config/` 的提交信息必须写**动机 + 影响面 + 验证方式**（跑了哪个层级的验证、结果如何）。
- `Config/` 的改动**不能与玩法代码改动混在同一个提交里**（出问题时无法二分定位）。
- 团队共享的编辑器偏好才放 `DefaultEditor.ini`；个人偏好留在本机。

## 4. 常见问题分诊

| 现象 | 先查 |
|---|---|
| 启动后进的是空关卡 / 编辑器默认场景 | `DefaultEngine.ini` 的 `GameDefaultMap` 与 `EditorStartupMap` |
| GameMode 的改动在 PIE 里生效、出包后不生效 | 是否只改了编辑器偏好？检查 `GlobalDefaultGameMode` 与关卡 Override |
| 某类资产生成时没被打进包 | `DefaultGame.ini` 的 `AssetManager` 扫描路径与 `DirectoriesToAlwaysCook` |
| 输入在打包版本里失灵 | `DefaultInput.ini` 的输入类 + 输入映射资产（`IMC_*`/`IA_*`）是否被 cook |
| 改了 ini 但行为没变 | 是否有 `Saved/Config/<Platform>/` 覆盖；是否该平台有独立 ini |
| 碰撞行为莫名变化 | 碰撞通道/Profile 是否被改名；`.uasset` 里保存的 Profile 名是否还存在 |

## 5. 与其他文档的关系

- 模块与依赖：`{{docsDir}}/architecture/module-layout.md`
- 资产索引（`AssetManager` 相关的资产必须登记 `primaryAsset`）：`{{aiDir}}/index/asset-index.md`
- 构建与打包验证：`{{docsDir}}/runbooks/build-and-verify.md`
