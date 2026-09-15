# 模板包规格（pack.json）

> 本文件是 archetype 模板包的**机器契约**。`cli/` 按此读取并渲染；`scripts/validate.mjs` 按此校验。
> 契约变更必须同时更新 `schema/pack.schema.json` 与 `docs/system/07-cli.md`。

## 目录布局

```
templates/
  base/                          # 所有项目都注入的通用文件（用 {{...}} 变量，不得引用专项变量）
    AGENTS.md
    .ai/constitution.md
    .ai/registry.json
    .ai/tasks/TEMPLATE.md
    .ai/templates/adr.md
    .ai/rules/verification.md ...
  archetypes/
    <pack-id>/
      pack.json                  # 本文件描述的清单
      files/                     # 渲染进项目根的文件树，路径同样参与变量与条件渲染
      docs/                      # 渲染进项目 docs/ 的文件树（可选）
  shared/                        # 只读片段，供 {{> SHARED:name}} 引用
```

`base/` 与 `archetypes/<id>/` 的文件树会被**依次叠加**渲染：同名文件时 archetype 覆盖 base。
`files/` 渲染到项目根，`docs/` 渲染到项目 `docs/`（`{{docsDir}}` 的默认值）。

## pack.json 字段

```jsonc
{
  "id": "software-app-medium",          // 必填，kebab-case，与目录名一致
  "title": "中型应用（多模块）",           // 必填
  "description": "一句话说明适用场景",     // 必填
  "category": "software",               // 必填：software | game | data | embedded | automation
  "scaleLevel": "M",                    // 必填：S | M | L | XL，取值依据 docs/system/02-scales.md
  "scaleHint": {                        // 可选：帮助用户判断是否选它
    "loc": "2k – 30k",
    "modules": "3 – 15",
    "team": "2 – 8 人",
    "lifespan": "1 – 3 年"
  },
  "language": ["typescript"],           // 可选，仅用于展示
  "runtime": "node>=20 | dotnet | unity | unreal | godot",  // 可选
  "variables": [                        // 必填数组；渲染时与 common 变量合并，键冲突时本处优先
    {
      "key": "packageManager",          // 必填，camelCase
      "prompt": "包管理器",              // 必填
      "default": "npm",                 // 必填（可为空字符串或 null）
      "choices": ["npm", "pnpm", "yarn"], // 可选；有则 CLI 展示可选值
      "required": false                 // 可选，默认 false
    }
  ],
  "dirs": ["src", "tests", "docs/architecture"],  // 必填；空目录也创建（放 .gitkeep）
  "compile": [                          // 可选：渲染后要做的动作，CLI 只记录，不执行
    { "file": ".ai/constitution.md", "action": "fill", "hint": "填写项目专属的红线与验证命令" }
  ],
  "protectedPatterns": ["docs/architecture/**"], // 可选：upgrade 时不覆盖（默认追加本数组，见文档）
  "skills": ["code-review", "adr-writing"]       // 必填数组；引用本仓库 skills/<id>/
}
```

## `skills` 字段语义

- 只能引用本仓库 `skills/` 下真实存在的 skill id（`scripts/validate.mjs` 会校验）。
- `init` 把这些 skill 复制进项目的 `.ai/skills/`，同时在 `AGENTS.md` 的 skills 表里列出。
- 用户项目可以自由增删 `.ai/skills/`——它是项目资产，不是框架资产；`upgrade` 只覆盖未被改动的框架文件。

## 渲染语法（由 `cli/lib/render.mjs` 实现）

| 语法 | 语义 |
|---|---|
| `{{var}}` | 变量替换。未声明变量 → 渲染报错并列出行号 |
| `{{#IF var}} ... {{/IF}}` | `var` 非空、非 `"false"`、非 `"0"` 时保留；支持嵌套 |
| `{{#UNLESS var}} ... {{/UNLESS}}` | 与 IF 相反 |
| `{{> SHARED:name}}` | 内联插入 `templates/shared/` 下同名 `.md` 片段，**不做变量替换**（片段必须自洽） |
| `{{!-- ... --}}` | 注释，渲染时删除 |

路径渲染规则：

- 文件/目录名同样参与 `{{var}}` 替换与 `{{#IF}}` 条件（条件为假则整条路径跳过）。
- 路径变量渲染后为空 → 该路径被跳过（用于 `{{#IF hasTests}}tests{{/IF}}` 这类可选目录）。
- 渲染后连续 `/` 会被合并为单个 `/`。
- 空目录会写入 `.gitkeep`，保证 git 能提交。

## 层次叠加与覆盖语义（必读）

渲染时先铺 `base/`，再铺 `archetypes/<id>/`，**同一路径以 archetype 为准**。

**覆盖 = 整份替换，不做拼接、不做段落合并。** 这条规则是有意为之：

- 拼接语义会让"某个标题被删掉"变成静默漂移，且行数/预算无法判定；
- 完整文件让 diff 与长度预算都可检查。

**因此**：如果 archetype 要提供 `AGENTS.md`、`.gitignore` 这类 base 已有的文件，它必须写出**完整可用**的内容
（含自己需要的 `{{> SHARED:...}}` 引用），只写"增量/覆盖层"会导致 base 那部分内容**静默消失**。

`scripts/validate.mjs` 会强制检查：archetype 覆盖 base 的同名文件时，**必须包含 base 版本的全部 Markdown 标题**；
缺失即校验失败。判断该不该覆盖的方法：

| 情况 | 做法 |
|---|---|
| 只需要补充本项目类型的信息 | **不要**提供同名文件；把内容写进 archetype 自己的新文件，并在其中被引用 |
| 必须定制（如 `AGENTS.md` 要加引擎专项硬约束） | 写完整文件 + 保留 base 的全部标题 + 行数控制在预算内 |
| base 的内容完全不适用该类型 | 写完整文件，但要在 `pack.json` 的 `compile` 里注明"为何移除 base 的某某节" |

## 渲染变量的两个作用域

| 作用域 | 来源 | 可用位置 |
|---|---|---|
| common | CLI 内置（`projectName`、`srcDir`、`docsDir`、`aiDir`、`date`、`frameworkVersion` …） | `base/` 与所有 archetype |
| pack-local | 该 pack 的 `variables` | 仅该 archetype（可覆盖同名 common 键） |

**硬规则**：`templates/base/` 里的文件只能使用 common 变量；使用 pack-local 变量会导致其他 archetype 渲染失败，`validate.mjs` 会直接报错。

**变量优先级**（`resolveVariables()`）：命令行 `--<key>` > pack 声明的 `default`（即使与 common 同名，也以 pack 的 default 为准，例如 `game-unity` 把 `srcDir` 默认设为 `Assets/Scripts`）> common 初值。

**传参写法**：pack-local 变量用 camelCase（`--packageManager pnpm`）；CLI 会把 `--package-manager` 归一化为 `packageManager`，两种写法都可用。

## 新增一套 archetype 的最小步骤

1. `docs/system/02-scales.md` 确认规模等级与阈值出处（新增阈值必须同时改文档）。
2. 建 `templates/archetypes/<id>/pack.json`，`skills` 引用已有 skill。
3. 写 `files/`（项目骨架 + `.ai/` 层文件）与 `docs/`（该类型必写文档）。
4. `node scripts/validate.mjs` 通过（变量、skill 引用、shared 片段、token 预算）。
5. 在 `scripts/selftest.mjs` 的 `PACKS` 列表里加入新 pack id，跑 `node scripts/selftest.mjs`。
