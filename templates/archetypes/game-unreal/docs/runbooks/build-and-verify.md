# Runbook：构建与验证（Unreal Engine）

> 用途：把"怎么编译、怎么打包、怎么跑自动化测试、失败了怎么查"写成可照着执行的步骤。
> 每条命令都带判定标准——**没有判定标准的命令等于没跑**。本机与 CI 必须跑同一组命令。

## 0. 前置（只做一次）

1. 安装与宪法一致的引擎版本 **{{ueVersion}}**（Epic Games Launcher 或源码编译）。
2. 记录三个可执行文件路径，填入 `.ai/constitution.md` 第 4 节：
   - `Engine\Build\BatchFiles\Build.bat`（UBT 编译）
   - `Engine\Binaries\Win64\UnrealEditor-Cmd.exe`（无头运行，跑自动化测试）
   - `Engine\Build\BatchFiles\RunUAT.bat`（打包/cook）
3. 工程文件（`.sln`）**不入库**，首次克隆后必须右键 `.uproject` → `Generate Visual Studio project files`（或调用 `UnrealVersionSelector`）。

## 1. 何时必须重新生成项目文件

| 改动 | 需要重新生成 | 原因 |
|---|---|---|
| 新增/删除 `.h`/`.cpp` | 否（增量编译即可） | 文件加入编译由 UBT 扫描 |
| 新增/改 `UCLASS`/`UPROPERTY`/`UFUNCTION`、改继承关系 | **是**，然后全量重编译该模块 | 反射代码（`.generated.h`）需重新生成 |
| 改 `.Build.cs`、新增模块、改 `.uproject` 的 `Modules` | **是** | 模块依赖图变化 |
| 只改 `.cpp` 函数体且签名未变 | 否 | 纯实现变更 |
| 升级引擎版本 | **是** + 重新编译全部 | API 与序列化可能变化 |

**不重新生成的典型症状**：链接错误 `unresolved external symbol`、编辑器里看不到新加的属性、
`generated.h` 缺失报错。遇到这些先按本表处理，不要靠删 `Intermediate/` 试错（那是最后手段）。

## 2. 验证阶梯

| 层 | 命令 | 判定 | 耗时量级 |
|---|---|---|---|
| L0 编译 | `Build.bat {{projectTitle}}Editor Win64 Development -Project="%CD%\{{projectTitle}}.uproject" -WaitMutex` | 退出码 0，日志无 `error C` | 1–10 min（增量） |
| L1 自动化测试 | `UnrealEditor-Cmd.exe "%CD%\{{projectTitle}}.uproject" -ExecCmds="Automation RunTests <前缀>;Quit" -unattended -nopause -nullrhi -log` | 日志出现 `Automation Test Succeeded` 且无 `Failed` | 1–10 min |
| L2 打包冒烟 | `RunUAT.bat BuildCookRun -project="%CD%\{{projectTitle}}.uproject" -noP4 -platform=Win64 -clientconfig=Development -cook -build -stage -pak -archive -archivedirectory=Build` | 退出码 0 且 `Build/Windows/` 下存在可执行文件 | 15–60 min |
| L3 真机/目标平台 | 同 L2，改 `-platform=<目标>` | 目标机上冷启动进可玩界面 | 视平台 |

选择规则：

- 只改 `.cpp` 实现（签名未变）→ 至少 L0。
- 改了头文件、模块、`.Build.cs`、反射宏 → L0 + L1。
- 改了 `Content/**` 资产、`Config/*.ini`、模块划分 → 至少 L2。
- 里程碑 / 发布前 → L2（+ 目标平台 L3）。

## 3. 测试前缀约定

自动化测试的名字必须是 `Project.<模块>.<行为>`，例如 `Project.Combat.DamageOverflow`。

- 前缀 `Project.` 让命令可以只跑本项目测试，不跑引擎自带测试。
- 单模块验证用 `-ExecCmds="Automation RunTests Project.Combat;Quit"`。
- 新增模块时必须建立对应的测试前缀，否则该模块"Cannot be verified"（等于没有 DoD）。

## 4. 失败分诊表

| 现象 | 先看 | 常见根因 | 处理 |
|---|---|---|---|
| `unresolved external symbol` | 编译日志的符号名 | 头文件改了没重新生成项目文件 / `.Build.cs` 少依赖 | 按第 1 节重新生成并重编译 |
| `Cannot open include file: 'X.generated.h'` | 该头文件是否在 `Public/` 且类名与文件名一致 | 反射头命名不符 | 头文件名必须与 `UCLASS` 类型名一致（去掉前缀） |
| 编辑器里看不到新属性 | 是否加了 `UPROPERTY`、是否重编译 | 忘记重编译或宏缺失 | 补宏 + 重编译 |
| 运行期随机崩溃（间隔数分钟） | 崩溃调用栈中的 `UObject*` | 裸指针持有 UObject 无 `UPROPERTY` → GC 回收 | 改 `TObjectPtr<>` + `UPROPERTY()` |
| 打包成功但启动黑屏/缺关卡 | `DefaultEngine.ini` 的 `GameDefaultMap` 与 cook 日志 | 关卡没被 cook（未在 `DirectoriesToAlwaysCook`/AssetManager 扫描路径） | 按 `Config/README.md` 第 4 节分诊 |
| 打包报 "Missing ... asset" | cook 日志搜 `Warning/Error` | 资产引用被移动/删除，或只存在于 `Developers/` | 用 asset-index 反查依赖；不要手改资产引用 |
| 打包超时或内存爆 | cook 日志平台段 | 未使用 `-noxgeshadow` 等裁剪、材质变体爆炸 | 收敛材质参数组合；按需拆关卡 |
| 改了 ini 不生效 | 是否存在 `Saved/Config/<Platform>/*.ini` | 本机覆盖优先 | 删本机覆盖或改平台 ini |
| 自动化测试在无头模式挂起 | 日志最后一行 | 测试等待真实帧/窗口，或弹窗阻塞 | 测试不用真实时间与 UI 交互；加 `-nullrhi` |

## 5. 记录要求（任务包必须包含）

```markdown
### 结果
- 改动：<一句话>
- 验证层级：L0 / L1 / L2 / L3（列出实际跑的命令）
- 证据：<编译结果、测试通过/失败数、产物路径与大小、包体 Δ>
- 未验证项与原因：<例如"主机平台未测：无开发机配额">
- 遗留风险：<例如"改了碰撞通道，仅验证了主流程">
```

**只跑 L0 却声称"已验证完成"属于伪造验证**，评审直接退回。

## 6. 索引与漂移

```bash
node .ai/bin/ai-arch.mjs review --drift
```

- hash 漂移 → 更新 `{{aiDir}}/index/files.json` 或 `{{aiDir}}/index/asset-index.md`。
- 报"决策缺失"（改了模块/边界/配置但无 ADR）→ 补 ADR。
- 漂移未清零不算完成（DoD 第 5 条）。
