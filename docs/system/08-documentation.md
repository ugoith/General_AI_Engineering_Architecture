# 面向 AI 的文档化：让文档能被检索、被使用

> 前提：**文档的价值 = 被读取的概率 × 读取时的信息密度**。一份没人读的完整文档价值为零。
> 本文定义"写什么、放哪、写多长、怎么保证不过期"。

## 一、五类文档与它们的读者

| 类型 | 读者 | 位置 | 长度上限 | 更新触发 |
|---|---|---|---|---|
| 路由（指针） | AI，每会话 | `AGENTS.md` | 120 行 | 目录结构变化 |
| 约束（红线） | AI + 人 | `.ai/constitution.md` | 120 行 | 技术栈/验证命令/边界变化 |
| 索引（机器可读） | AI，程序化查询 | `.ai/index/*.json`、`.ai/registry.json` | 无（结构化） | 文件内容变化 |
| 决策 | 人 + AI | `.ai/decisions/NNNN-*.md` | 30–80 行 | 做出选择时 |
| 结构/手册 | 人 | `docs/architecture/*`、`docs/runbooks/*` | 60–200 行 | 结构变化时 |

## 二、写给 AI 的文档规则

1. **先给结论，再给理由。** 开头 3 行内回答"这是什么、什么时候用"。
2. **给判断条件，不要给形容词。** ❌"保持代码整洁" → ✅"单个函数超过 50 行必须拆分或注明理由"。
3. **给命令与路径原文。** AI 需要能直接执行或跳转的字符串，如 `node .ai/bin/ai-arch.mjs task "..."`。
4. **给反例。** "不要这样做：…（因为…）"比正面描述更能约束生成行为。
5. **表格优于散文。** 判定条件、字段含义、阈值一律用表格。
6. **不复制。** 同一知识只写一处；其他地方用链接或 `{{> SHARED:...}}`（仅框架模板层）。
7. **明确权威来源。** 若同一信息有两处（如注册表与架构文档），必须写清哪一份是权威。
8. **可被 diff。** 不要写"最近""目前"这类模糊时间；用日期或版本号。
9. **占位必须带格式。** 不允许 `TODO`；占位要给出填写的格式与示例。
10. **长度可验证。** 每个文档在开头注明它的长度预算（如"本文件 ≤ 120 行"），并用 `ai-arch doctor` 检查。

## 三、命名与结构约定

**中文标题 + 英文标识符**：文件名、目录、JSON 字段、CLI 参数、代码标识符一律英文 kebab-case / camelCase；文档正文用中文。

| 位置 | 命名 | 示例 |
|---|---|---|
| 项目文档 | `docs/<类别>/<主题>.md` | `docs/architecture/data-model.md` |
| ADR | `NNNN-kebab-title.md` | `0007-switch-to-postgres.md` |
| 任务包 | `YYYY-MM-DD-<slug>.md` | `2026-03-04-token-refresh.md` |
| skill | `skills/<id>/SKILL.md` | `skills/code-review/SKILL.md` |
| 模板包 | `templates/archetypes/<pack-id>/` | `templates/archetypes/game-unity/` |

## 四、三种机器可读文件的分工

| 文件 | 回答的问题 | 谁写 | 校验方式 |
|---|---|---|---|
| `.ai/index/files.json` | 每个文件是什么、改过没有、谁依赖它 | CLI（hash/依赖）+ AI（摘要） | `index --apply` 的 hash 校验 + `review --drift` |
| `.ai/registry.json` | 关键实体（数据模型/接口/模块/契约）的签名与不变量 | 人 + AI | `registry audit` + `review --drift` 的 hash 对账（`entity-hash-stale`） |
| `.ai/index/impact-map.json` | 改了 X 必须同步改什么 | 人 | `review --impact` 输出中使用；新增规则由评审驱动 |

`registry.json` 的实体格式：

```json
{
  "kind": "data-model | api | module | class | config | contract | asset",
  "name": "UserSession",
  "file": "src/auth/session.ts",
  "signature": "interface UserSession { userId: string; expiresAt: number }",
  "invariants": ["expiresAt 必须为 UTC 毫秒时间戳", "userId 不得为空"],
  "owner": "@team-auth",
  "hash": "<所在文件的内容 hash 前 10 位>"
}
```

**为什么需要它**：AI 在改动接口前需要知道"这个实体的不变量是什么"。若只靠读源码，它必须读完整文件；有了注册表，它读 5 行就够了。

## 五、文档腐烂的四个信号

| 信号 | 检测方式 | 处理 |
|---|---|---|
| 文档引用的路径不存在 | `review --drift` 的 `doc-link-missing` | 修文档或补文件 |
| 摘要与代码不符 | `review --drift` 的 `digest-stale` | 重写摘要 |
| 文档超过长度预算 | `ai-arch doctor` 的 `context-too-long` | 拆分为按需文档 |
| 同一知识两处不一致 | 人工评审（无法自动判定） | 指定权威来源，另一处改为链接 |

## 六、ADK：ADR 写法

见 `.ai/skills/adr-writing/SKILL.md`。核心要求：**一条 ADR 只记一个决策**，包含：

1. 状态（Proposed / Accepted / Superseded by NNNN）
2. 背景与约束（为什么必须现在决定）
3. 决策（一句话，用主动语态）
4. 后果（好的、坏的、必须接受的）
5. 备选方案与被放弃的原因
6. **回退条件**（什么情况下应该推翻这个决策）——最容易被漏掉但最有价值的一条

## 七、给 AI 生成文档的约束

AI 生成文档时最常见的两类失败：**膨胀**（写很多不解决具体问题的章节）和**空壳**（"TODO：补充详细说明"）。因此：

- 生成前先问："这份文档的读者在什么场景下会打开它？"若回答不出，就不要生成。
- 每节必须包含可执行内容（命令、判断条件、示例、反例）之一；没有就不写这一节。
- 长度超出预算时，**砍内容而不是加目录**。
- 写完自检：读者能否仅凭这份文档完成一次具体操作？不能就重写。
