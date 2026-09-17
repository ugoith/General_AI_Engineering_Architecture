# 索引体系 — `.ai/index/` 与 `.ai/registry.json`

> 唯一目的：**hash 没变的文件不要重读源码**。索引是提交进 git 的共享资产，不是缓存。
> 本文件说明字段含义与更新时机；机械字段由 `node {{aiDir}}/bin/ai-arch.mjs index` 生成。

## 1. 组成部分

| 文件 | 回答什么问题 | 谁写 | 何时更新 |
|---|---|---|---|
| `{{aiDir}}/index/files.json` | 每个文件是干什么的？改它会影响谁？ | CLI 填机械字段，AI 填 `digest` | 文件增删改后 |
| `{{aiDir}}/index/impact-map.json` | 改了 A 必须同步哪些 B/C？要不要 ADR？ | 项目自己维护（种子已给） | 流程变化时 |
| `{{aiDir}}/tasks/` | 这次任务该读哪些文件、值多少 token？ | `task` 命令生成，AI 填充 | 每个任务 |
| `{{aiDir}}/registry.json` | 关键实体（数据模型/接口/契约/模块）的登记册 | 项目自己维护 | 实体增删改时 |

## 2. files.json

顶层：`schemaVersion`、`generated`、`root`、`fileCount`、`files[]`、`summary{byRisk, pendingDigest, staleDigest, totalLoc, contextLoc, contextFiles}`。

其中 `totalLoc` 是**源行数**（不含 `{{aiDir}}/`），`contextLoc` 是上下文文件行数——规模等级判定看前者，不要混用。

单条 `files[]`：

| 字段 | 含义 | 谁写 |
|---|---|---|
| `path` | 项目根相对路径（posix 分隔） | CLI |
| `kind` | `text` 或 `binary-or-large` | CLI |
| `lang` | 由扩展名推断的语言 | CLI |
| `loc` | 行数 | CLI |
| `bytes` | 字节数 | CLI |
| `hash` | 内容指纹（判断"要不要重读"的唯一依据） | CLI |
| `imports[]` | 本项目内的依赖（相对路径；外部依赖不记） | CLI |
| `importedBy[]` | 反向依赖：改这个文件会波及谁 | CLI |
| `risk` | `low` / `medium` / `high`（配置、契约、大类文件默认高） | CLI 初判，AI 可改 |
| `tags[]` | 检索标签 | CLI 初判，AI 可加 |
| `owner` | 负责人 / 团队 | 项目填 |
| `digest.status` | `pending` 无摘要 ｜ `digest` 有 ｜ `stale` 内容已变 | CLI |
| `digest.purpose` | 该文件为何存在、谁依赖它（≤200 字） | **AI** |
| `digest.exports[]` | 对外暴露的符号、命令或路由 | **AI** |
| `digest.invariants[]` | 必须恒成立的约束（如"金额恒 > 0"） | **AI** |
| `digest.risk` | 读完源码后重新判定的风险 | **AI** |
| `digest.tags[]` | 读完源码后补充的标签 | **AI** |
| `digest.reviewedHash` | 摘要对应的内容 hash（摘要的"保质期"） | CLI 回填 |
| `digest.reviewedAt` | 摘要最近一次确认时间（即 verifiedAt） | CLI 回填 |
| `digest.stale` | 摘要是否已过期 | CLI |

操作规则（这几条是省上下文的核心，别绕过）：

1. 任务包标注 `read-digest` 的文件：**只读摘要，不要打开源码**。
2. 标注 `read-source` 的文件（`pending`、`stale` 或 hash 已变）：读源码，然后按 `index --stale --json` 的载荷写摘要，用 `index --apply` 回写。
3. 不要手写 `hash`；不要留下"摘要与源码不一致"的条目（`review --drift` 会报 `digest-stale`）。
4. 索引文件必须提交；只有 `{{aiDir}}/cache/` 被忽略。

## 3. impact-map.json

每条规则四个字段：`trigger`（变更类型）、`when`（**触发判据**，机器求值）、`mustUpdate[]`（必须同步更新的文件）、`adrRequired`（是否必须先写 ADR）。

`when` 支持四种判据（任一匹配即算命中）：

| 判据 | 含义 |
|---|---|
| `entityKinds: [...]` | 注册表里这些 kind 的实体文件出现在本次改动里 |
| `paths: [...]` | 改动路径匹配这些 glob |
| `manifest: true` | 改的是依赖清单（`package.json` / `*.csproj` / `pyproject.toml` …） |
| `build: true` | 改的是构建与工具链配置（`tsconfig` / `Makefile` / CI / `*.Build.cs` …） |

用法：

```bash
node {{aiDir}}/bin/ai-arch.mjs review --impact src/models/user.ts
```

输出按**命中 / 未声明判据 / 不适用**三类分开——不再把整张表打印出来让人自己挑。
改动做完后用 `review --task` 核对：命中的规则，其 `mustUpdate` 文件是否真的被改动过（没改会报 `task-impact-not-updated`）。

- **没有 `when` 的规则不会被猜**：它会被报成"未声明判据 → 本次无法判断是否适用"。自己加的 trigger 请一并补 `when`。
- 项目规则（`rules add`）会自动写入一条 trigger，其 `when.paths` 取自规则的 `scope`——规则的作用范围就是它的触发判据。
- 若 `mustUpdate` 里的文件在本项目不存在：要么本规模不要求它（记进宪法"本项目的例外"），要么现在按骨架补上——不要忽略。

## 4. tasks/

`task "<描述>"` 生成 `{{aiDir}}/tasks/<日期>-<slug>.md`，含：必读清单（固定成本）、读取清单（`read-source` / `read-digest` / 因预算丢弃）、范围、验收标准、证据、遗留风险、预算决算。

- 生成后先补"范围 / 验收标准"再动手；收工前补"结果 / 证据 / 遗留风险与假设"。
- 任务包**不要删除**：它是"上次做了什么、依据什么"的记忆。结构说明见 `{{aiDir}}/tasks/TEMPLATE.md`。
