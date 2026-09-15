# 通用变量与共享片段（common scope）

> `templates/base/` 与所有 archetype 都可能用到这里的变量。**pack-local 变量不得出现在 `templates/base/` 中。**
> 新增 common 变量必须同时更新本文件与 `cli/lib/scaffold.mjs` 的 `resolveVariables()`。

## common 变量表

| 变量 | 默认值 | 说明 |
|---|---|---|
| `projectName` | 目录名（kebab-case） | 项目名，与仓库名一致 |
| `projectTitle` | 由 `projectName` 转 Title Case | 展示用标题 |
| `description` | `待填写：一句话说明项目做什么、给谁用` | 项目定位 |
| `owner` | `@unknown` | 负责人或团队 |
| `srcDir` | `src` | 源码根目录（游戏类可为 `Assets/Scripts` 等） |
| `testsDir` | `tests` | 测试根目录（可为空 → 相关路径被跳过） |
| `docsDir` | `docs` | 人类文档根目录 |
| `aiDir` | `.ai` | AI 上下文根目录（索引、任务包、skill 都在这里） |
| `date` | 生成当日 `YYYY-MM-DD` | |
| `frameworkVersion` | 框架 `package.json` 的 version | 生成的框架版本，`upgrade` 依赖它 |
| `packId` | 所选 archetype id | |
| `scaleLevel` | 所选 pack 的 scaleLevel | `S`/`M`/`L`/`XL` |
| `scaleName` | 由 scaleLevel 映射 | `轻量`/`标准`/`系统`/`平台` |
| `isGame` | `true`/`false` | 是否游戏类 archetype |
| `aiEntry` | `AGENTS.md` | AI 入口文件名 |

## 使用规则

- 布尔型 common 变量（`isGame`）用法固定为 `{{#IF isGame}}...{{/IF}}`，不要直接输出。
- 需要"可选目录"时，把目录名写成变量并在 `pack.json` 里给空字符串默认值，例如 `testsDir: ""`；渲染器会跳过空路径段。
- 不要在模板里写死日期、版本、作者——一律用变量，保证可重复渲染与可 diff。

## 共享片段（`templates/shared/`）

片段**不做变量替换**，因此必须自洽、不含 `{{ }}`。用 `{{> SHARED:name}}` 引用，`name` 即文件名去掉 `.md`。

| 片段 | 内容 | 谁在用 |
|---|---|---|
| `context-discipline` | 分层上下文与预算的浓缩版（L0/L1/L2/L3 + 增量读取规则） | 所有项目 `AGENTS.md` |
| `verification-loop` | 完成定义（DoD）：跑什么、什么算通过、失败怎么记 | 所有项目 `AGENTS.md` |
| `decision-trigger` | 何时必须写 ADR 的判定清单 | 所有项目 `AGENTS.md` |
| `scope-guard` | 防越界：不顺手重构、不扩需求、不猜接口 | 所有项目 `AGENTS.md` |
| `scale-gate` | 规模分级表与"当前规模禁止什么" | 项目宪法、评审 skill |

## 命名与语言

- 文件名一律 kebab-case 英文；文档标题可用中文。
- JSON 字段一律英文 camelCase（与 `schema/*.schema.json` 一致）。
