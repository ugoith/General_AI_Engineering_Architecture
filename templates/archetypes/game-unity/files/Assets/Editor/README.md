# Assets/Editor — 编辑器扩展目录

放在这里的代码**只在编辑器里编译**，不进入播放器构建。这是"编辑器/运行时边界"的物理实现。

## 1. 放什么

| 可以放 | 典型用途 |
|---|---|
| 自定义 Inspector / PropertyDrawer | 让策划少填错（范围校验、下拉、预览） |
| 菜单工具 `[MenuItem]` | 批量校验、批量改导入设置、生成配置资产 |
| 构建脚本 | `BuildScript.BuildWindows` 等 CLI 可调用的静态入口 |
| 资产后处理器 `OnPostprocessAllAssets` | 强制命名/导入规则 |
| 场景与资产的自动检查 | 提交前跑"场景引用是否缺失"这类校验 |
| 编辑器窗口 `EditorWindow` | 关卡编辑器、数据表编辑 |

## 2. 不放什么

- **不放运行时逻辑**（任何会在打包后需要执行的东西）。判断方法：这段代码会在 `Play` 的玩家构建里被调用吗？会 → 放 `{{srcDir}}`。
- **不放游戏数据**。数据走 ScriptableObject / JSON，编辑器代码只负责读写它们。
- **不放第三方 SDK 的编辑器包**（走 Package Manager 或 `Assets/Plugins/`）。

## 3. 边界规则（写新文件前先读）

1. 本目录**可以** `using UnityEditor;`、访问 `AssetDatabase`、`EditorGUILayout`、`Selection`。
2. `{{srcDir}}` 与其它运行时目录**禁止** `using UnityEditor;`。需要"仅编辑器下多做一些事"时，用条件编译：

```csharp
// 运行时文件夹里唯一允许的形式：默认分支不引用任何编辑器 API
#if UNITY_EDITOR
    UnityEditor.EditorUtility.SetDirty(this);
#endif
```

3. 编辑器代码可以依赖运行时程序集，**运行时不得依赖编辑器程序集**。为此需要用 asmdef 隔离（见下）。
4. 编辑器代码**不要修改 `.meta` 的 `guid`**；改导入设置用 `AssetImporter.GetAtPath(...)` + `SaveAndReimport()`。

## 4. asmdef 隔离（避免"打包才发现编译不过"）

```
Assets/Editor/Game.Editor.asmdef        // 编辑器程序集
{
  "name": "Game.Editor",
  "references": ["Game.Runtime"],       // 单向：编辑器 → 运行时
  "includePlatforms": ["Editor"]        // 关键：只在编辑器编译
}

{{srcDir}}/Game.Runtime.asmdef          // 运行时程序集
{
  "name": "Game.Runtime",
  "references": []                      // 绝不能出现 Game.Editor
}
```

规则：`Game.Editor` 可以引用 `Game.Runtime`，反之**必然导致构建失败或被静默剥离**。
新增 asmdef 属于模块边界变更 → **写 ADR**。

## 5. 常用工具应该做成什么样

- **批量操作要先干跑**：先打印"将影响 N 个资产"，再让用户确认（`EditorUtility.DisplayDialog`）；CI 场景下用 `-executeMethod` + 显式参数跳过确认。
- **构建脚本的入口签名固定**：`public static void BuildWindows()`，无参数、无返回值、失败时 `EditorApplication.Exit(1)`，这样 CLI 里 `-executeMethod BuildScript.BuildWindows` 才能判定成败。
- **工具要幂等**：跑两遍结果一致；不幂等的工具必须写明前置条件。
- **不许在编辑器工具里静默改用户资产**：改动前干跑 + 输出清单，改动后写日志。

## 6. 验证

- 编辑器代码的验证方式：在编辑器里执行一次工具 + 目视结果，并在任务包里记录"输入 → 预期 → 实际"。
- 能在 EditMode 测试里断言的逻辑（阈值计算、命名校验、数据校验）**必须有测试**，放在 `Assets/Tests/EditMode/`。
- 构建脚本的验证只能靠真实出包：见 `{{docsDir}}/runbooks/build-and-verify.md`。
