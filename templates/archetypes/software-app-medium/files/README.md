# {{projectTitle}}

{{description}}

- 项目名：`{{projectName}}` ｜ 负责人：{{owner}} ｜ 规模：{{scaleLevel}} / {{scaleName}} ｜ 运行时：`{{runtime}}` ｜ 包管理：{{packageManager}}
- AI 入口：`AGENTS.md` ｜ 项目宪法：`{{aiDir}}/constitution.md` ｜ 索引说明：`{{aiDir}}/index/README.md`

## 快速开始

```bash
# 1. 准备环境（详细步骤、环境变量与排障见 docs/runbooks/local-dev.md）
<安装依赖：按 runtime 填写，例如 npm install / uv sync / dotnet restore>

# 2. 起本地服务
<启动命令>

# 3. 验证（必须与 .ai/constitution.md 的“验证命令”一节一致）
<测试命令>
```

## 目录结构

```text
{{srcDir}}/
  modules/          # 业务模块；边界规则见 src/modules/README.md
{{testsDir}}/       # 测试；按模块分目录
{{docsDir}}/        # 人类文档：架构、数据模型、接口、运维手册
{{aiDir}}/          # AI 上下文：索引、任务包、决策记录、skills
```

## 模块概览

| 模块 | 职责（一句话） | 公开出口 | owner |
|---|---|---|---|
| `<module-a>` | <它负责什么，不负责什么> | `{{srcDir}}/modules/<module-a>/public` | {{owner}} |

> 这张表的权威版本是 `{{docsDir}}/architecture/overview.md`；这里只保留索引级的概览。新增模块前先读 `{{srcDir}}/modules/README.md`，并按 `AGENTS.md` 的规则写 ADR。

## 文档地图

| 你想知道 | 读这个 |
|---|---|
| 系统由哪些模块组成、数据怎么流 | `{{docsDir}}/architecture/overview.md` |
| 数据模型、字段与不变量 | `{{docsDir}}/architecture/data-model.md` |
| 对外与跨模块的接口契约 | `{{docsDir}}/architecture/interfaces.md` |
| 本地怎么跑起来、怎么排障 | `{{docsDir}}/runbooks/local-dev.md` |
| 为什么当初这么选 | `{{aiDir}}/decisions/` |
| 某个文件干什么（不读源码） | `{{aiDir}}/index/files.json` |

## 约定

- 提交前跑 `node {{aiDir}}/bin/ai-arch.mjs review --drift`，不允许新增 error/warn。
- 跨模块调用只走公开出口；模块内部文件不对外暴露（见 `{{srcDir}}/modules/README.md`）。
- 改契约、改模块边界、加依赖 → 先写 ADR（`{{aiDir}}/decisions/`），再动代码。
