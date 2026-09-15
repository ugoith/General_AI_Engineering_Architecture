# 接口与契约（L 级）

> 用途：登记所有对外与跨子系统的承诺，并给出**版本与兼容矩阵**。规则细节见 `{{docsDir}}/architecture/contracts/README.md`。
> 原则：契约先于实现（先定字段与错误码，再写代码），且每个契约都有 owner 与契约测试。

## 1. 契约清单

| 类型 | 契约 | owner | 消费方 | 版本 | 契约测试 |
|---|---|---|---|---|---|
| HTTP API | (示例) POST /orders | <module-a> / <@team> | 前端、第三方 | v1 | `{{testsDir}}/contract/orders/` |
| 事件 | (示例) OrderCreated | <module-a> / <@team> | <module-b>、数据平台 | v1 | `{{testsDir}}/contract/events/` |
| 内部模块接口 | (示例) PricingApi | <pricing> / <@team> | <module-a> | v1 | `{{testsDir}}/contract/pricing/` |
| CLI / 脚本 | (示例) --output json | <cli> / <@team> | 运维脚本 | v1 | `{{testsDir}}/contract/cli/` |
| 文件格式 | (示例) orders.parquet | <module-c> / <@team> | 数据团队 | v2 | `{{testsDir}}/contract/files/` |

## 2. 单个契约怎么写

```text
契约名 / 版本 / owner / 消费方：
请求：字段 | 类型 | 必填 | 约束 | 示例
响应：字段 | 类型 | 必填 | 约束 | 示例
错误码：错误码 | 含义 | 触发条件 | 调用方应做什么
幂等：幂等键是什么；重试是否安全
超时与重试：调用方超时；允许的重试次数（跨模块禁止层层重试）
兼容：本版本的兼容承诺；下一版本何时开始
```

六项缺一不可。缺项按 `ASSUMPTION:` 标注，并在下一次评审前确认。

## 3. 错误码约定

| 类别 | 错误码示例 | 调用方应做什么 |
|---|---|---|
| 输入问题 | INVALID_INPUT | 修正参数后重试；不要原样重试 |
| 状态冲突 | CONFLICT | 重新读取最新状态后再决定 |
| 目标缺失 | NOT_FOUND | 提示用户；不要自动重试 |
| 依赖不可用 | DEPENDENCY_UNAVAILABLE | 按约定退避重试；超过次数上报而不是无限重试 |
| 内部错误 | INTERNAL | 上报并附带追踪 id；不要暴露内部细节给外部消费方 |

错误码属于契约：新增可以，改语义必须走不兼容流程。

## 4. 版本兼容矩阵

| 契约 | v1 | v2 | 并存期 | 下线条件 |
|---|---|---|---|---|
| (示例) POST /orders | 维护中，仅修缺陷 | 主用 | <起止日期> | 消费方全部迁移 + 弃用期结束 |
| (示例) orders.parquet | 只读兼容 | 主用 | <起止日期> | 读取方全部升级 |

并存期必须有明确日期；只写"尽快迁移"等于没有弃用流程。

## 5. 契约测试矩阵

| 契约 | 测试位置 | 覆盖内容 | 是否阻断 CI |
|---|---|---|---|
| POST /orders | `{{testsDir}}/contract/orders/` | 字段类型、错误码、幂等、超时路径 | 是 |
| OrderCreated | `{{testsDir}}/contract/events/` | 载荷字段、未知字段容忍、重复投递幂等 | 是 |

契约测试站在**消费方视角**断言；实现重构不应导致契约测试失败，否则说明测试写到了内部细节上。

## 6. 变更与弃用

1. 判定兼容性（见 `{{docsDir}}/architecture/contracts/README.md` 第 3 节）。
2. 不兼容 → 写 ADR，开新版本，确定弃用期与通知名单。
3. 改实现 + 契约测试 + 本文件的字段表与矩阵。
4. 更新 `{{aiDir}}/registry.json` 与索引。
5. 弃用期结束、消费方确认迁移完成后，删除旧版本并更新本文件（不允许"留着但没人知道还能不能用"）。
