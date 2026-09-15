# {{projectTitle}}

{{description}}

- 项目名：`{{projectName}}` ｜ 负责人：{{owner}} ｜ 规模：{{scaleLevel}} / {{scaleName}} ｜ 主语言：{{language}} ｜ 包管理：{{packageManager}}
- AI 入口：`AGENTS.md` ｜ 项目宪法：`{{aiDir}}/constitution.md` ｜ 变更记录：`CHANGELOG.md`

> S 级刻意保持轻流程：一个入口文件 + 一份 README + 一份宪法。架构文档在升到 M 级时才需要，见 `{{docsDir}}/README.md`。

## 快速开始

入口骨架固定为 `{{srcDir}}/main.mjs`（Node.js，零依赖）。若主语言选的是 python，请把入口换成 src/main.py（注意：CLI 命令名与退出码保持一致），并相应更新下面的命令。

```bash
# Node.js（默认）
node {{srcDir}}/main.mjs --help
node {{srcDir}}/main.mjs hello world

# 安装成全局命令（可选）
npm link                      # Node 项目；python 项目改用 pipx install . 或 uv tool install .
```

需要第三方依赖时：用 `{{packageManager}}` 安装、提交锁文件，并先在 `{{aiDir}}/decisions/` 写一条 ADR 说明为什么非加不可（S 级能不加就不加）。

## 用法

```text
{{projectName}} <command> [options]

命令：
  hello <name>      示例子命令，实现真实业务后替换
  --help, -h        显示帮助
  --version, -v     显示版本
```

示例：

```bash
$ {{projectName}} hello world
hello, world
```

## 退出码约定

| 退出码 | 含义 | 使用场景 |
|---|---|---|
| 0 | 成功 | 命令按预期完成，结果写到 stdout |
| 1 | 运行时失败 | 可预期的业务错误（文件不存在、校验不通过）；stderr 必须有一行可读原因 |
| 2 | 用法错误 | 参数缺失或非法；必须同时打印用法 |

脚本化调用方依赖这张表。改动它属于**公开行为变更**：先写 ADR，再更新本表与 `CHANGELOG.md`。

## 开发与验证

```bash
node --test {{testsDir}}/                          # 零依赖测试（Node 内置 test runner）
node {{aiDir}}/bin/ai-arch.mjs index               # 更新文件索引
node {{aiDir}}/bin/ai-arch.mjs review --drift      # 漂移检测
```

命令清单以 `{{aiDir}}/constitution.md` 的“验证命令”一节为准；本文件只做人类可读的概览。

## 变更记录

按 Keep a Changelog 的格式维护 `CHANGELOG.md`：用户可感知的变更（命令、参数、输出格式、退出码、依赖要求）必须记一条。

## AI 协作怎么省上下文

1. 开工先要任务包：`node {{aiDir}}/bin/ai-arch.mjs task "<任务描述>"`，按里面的读取清单读文件，不要满仓库搜索。
2. 索引在 `{{aiDir}}/index/files.json`；标注 `read-digest` 的文件说明 hash 未变，读摘要即可。
3. 决策写在 `{{aiDir}}/decisions/`，触发条件见 `AGENTS.md`。
