# Content/ — 资产目录约定

`Content/` 里全是**二进制资产**（`.uasset` / `.umap`）。本文件定义它们的组织方式，
目的是让"路径 + 前缀 + 索引条目"三者足以让人和 AI 理解一个资产，**而不需要打开它**。

## 1. 目录结构

```
Content/
  <模块名>/            与 files.json 的 module 同名，例如 Combat/、Inventory/、UI/
    Blueprints/        BP_、ABP_、WBP_
    Data/              DA_（DataAsset）、DT_（DataTable）、曲线
    Art/               SM_、SK_、M_、MI_、T_
    FX/                NS_（Niagara）、特效材质
    Audio/             SFX_、MUS_
  Maps/                Map_ 或关卡流程命名：L_Boot、L_MainMenu、L_Level01
  Core/                跨模块共享的最小集合（输入 IMC_/IA_、通用数据资产）
  Developers/          个人开发目录（可选，通常不入库，见第 4 节）
```

规则：

- **一个资产只属于一个模块目录**。跨模块共享的放 `Core/` 并在索引里注明"被谁用"。
- 子目录按**类型**分（Blueprints/Data/Art/FX/Audio），不要按"谁在用"分。
- 模块目录名变更 = 大量引用路径变更 → 写 ADR 并在编辑器里用"移动资产"（保持引用）完成。

## 2. 命名前缀（强制）

| 前缀 | 类型 | 前缀 | 类型 |
|---|---|---|---|
| `BP_` | 蓝图类 | `SM_` / `SK_` | 静态网格 / 骨骼网格 |
| `WBP_` | UMG 控件蓝图 | `M_` / `MI_` | 材质 / 材质实例 |
| `ABP_` | 动画蓝图 | `T_` | 贴图 |
| `DA_` / `DT_` | DataAsset / DataTable | `NS_` | Niagara 系统 |
| `IMC_` / `IA_` | 增强输入映射上下文 / 输入动作 | `SFX_` / `MUS_` | 音效 / 音乐 |
| `L_` | 关卡（Map） | `E_` | 枚举资产（如需要） |

命名骨架：`<前缀><用途>_<变体>`，例如 `BP_Enemy_Goblin`、`DA_Weapon_Sword`、`MI_Rock_Wet`。
**不要**用中文、空格、连续下划线或纯数字结尾（`BP_Enemy2` → `BP_Enemy_Elite`）。

## 3. 蓝图与 C++ 的边界

蓝图资产的职责边界见 `{{docsDir}}/architecture/bp-vs-cpp.md`。本文件只强调与目录相关的两条：

- 蓝图**可以**在 `EventGraph` 里做装配、连线、表现；**不要**把规则逻辑堆在蓝图里。
- 蓝图若包含本应由 C++ 承担的规则逻辑，评审直接退回（判定清单见上述文档）。

## 4. Developers/ 与临时资产

- 个人实验资产放 `Content/Developers/<你的名字>/`，并且**默认不入库**。
- 需要提交的开发验证关卡命名 `L_Sandbox_<功能>`，放 `Maps/` 下，并在索引里标 `risk: low`。
- 提交前清理：临时蓝图、复制粘贴的 `_Copy`、未引用的测试资产。

## 5. 资产改动检查清单

- [ ] 路径符合第 1 节，前缀符合第 2 节。
- [ ] `.ai/index/asset-index.md` 条目已更新（`kind`/`class`/`purpose`/`deps`/`primaryAsset`/`risk`/`hash`）。
- [ ] 若参与打包（`AssetManager` 扫描或 `DirectoriesToAlwaysCook`），已在索引里标 `primaryAsset`。
- [ ] 若新增输入映射，已登记 `IMC_`/`IA_` 并在 `Config/README.md` 第 4 节相关项下核对。
- [ ] 未提交 `Developers/` 下的个人资产与 `_Copy` 类冗余资产。
- [ ] 涉及结构/边界变更的已写 ADR。

## 6. 与其他文档的关系

- 资产索引格式与风险判定：`{{aiDir}}/index/asset-index.md`
- 模块与依赖方向：`{{docsDir}}/architecture/module-layout.md`
- 蓝图 vs C++ 判定：`{{docsDir}}/architecture/bp-vs-cpp.md`
- 打包与验证：`{{docsDir}}/runbooks/build-and-verify.md`
