---
name: context-indexing
description: 维护 .ai/index/files.json 的语义摘要，让后续任务不必重读源码
when: 接手新任务前、大改动后、review --drift 报告 digest-stale 时
---

# 维护文件索引与摘要

## 何时用

- 新项目接入后第一次建立索引。
- 一次任务改动完成后（属于"完成定义"的一部分）。
- `ai-arch review --drift` 报了 `digest-stale` / `digest-missing`。
- 你发现任务包把很多文件标成 `read-source`（说明摘要缺失，成本高）。

## 何时不用

- 只是读代码、没有改动 —— 不需要更新索引（hash 没变）。
- 想让索引"顺便"帮你找代码 —— 那是任务包的职责（`ai-arch task`），不是摘要的职责。

## 标准流程

```bash
# 1. 更新机械部分：hash、行数、依赖关系
node .ai/bin/ai-arch.mjs index

# 2. 拿到待写摘要清单（含每个文件的 hash 与旧摘要）
node .ai/bin/ai-arch.mjs index --stale --json > .ai/cache/digest-request.json

# 3. 阅读清单中列出的源码，产出 JSON 数组（格式见下）

# 4. 回填（会校验 hash，不匹配的条目会被拒绝）
node .ai/bin/ai-arch.mjs index --apply .ai/cache/digests.json
```

产出格式（**只输出 JSON，不要解释**）：

```json
[
  {
    "path": "src/auth/session.ts",
    "reviewedHash": "原样回填清单里的 hash",
    "purpose": "会话令牌的签发与校验；被 http 层与 ws 层共同依赖。",
    "exports": ["createSession", "verifySession", "UserSession"],
    "invariants": ["expiresAt 必须是 UTC 毫秒时间戳", "校验失败不得抛出异常，返回 null"],
    "risk": "high",
    "tags": ["auth", "contract"]
  }
]
```

## 写作要求

| 字段 | 要求 | 反例 |
|---|---|---|
| `purpose` | ≤ 200 字，说明**为何存在、谁依赖它** | ❌"这个文件包含 createSession 函数，它创建会话"（复述代码） |
| `exports` | 只写对外真正可见的符号 | ❌把内部辅助函数也列上 |
| `invariants` | 写"改这里时必须保持什么" | ❌"代码要写得好"（不可判定） |
| `risk` | 被多方依赖、涉及数据/契约/安全 → high | ❌所有文件都写 high |

## 反例（常见错误）

- ❌ **凭印象写摘要**：文件读了一半就写。`--apply` 的 hash 校验只能防"文件变了"，防不了"你没读全"。
- ❌ **摘要写得像注释**：摘要的价值在于让后续 AI **不必读源码**；如果读完摘要还需要打开源码，摘要就没起作用。
- ❌ **忘记写 invariants**：这是最容易被漏掉、但对后续 AI 最有价值的一项——它承载了"不能踩的坑"。
- ❌ **一次给几百个文件写摘要**：先只处理 `risk: high` 与被频繁读取的文件（通常 10 个以内），收益最高、成本最低。

## 预算意识

写完摘要后自查：任务包给出的估算是否明显下降？

```bash
node .ai/bin/ai-arch.mjs task "和上次类似的任务" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log('估算 token:',p.estimate.total)})"
```

若 `read-source` 数量仍然很多，说明还有高风险文件缺摘要。
