# schema：机器可读契约

本目录存放**格式契约**。契约分两类，**每一类都必须有一处权威定义**，不允许"代码里知道、文档里查不到"：

| 文件 | 约束对象 | 权威定义位置 | 维护者 |
|---|---|---|---|
| `pack.schema.json` | `templates/archetypes/*/pack.json`（模板包清单） | 本目录（JSON Schema） | 框架维护者 |
| `index.schema.json` | 项目内 `.ai/index/files.json`（文件索引） | 本目录（JSON Schema） | 框架维护者 |

另有三个**项目侧数据文件**，结构简单且随框架演进而增字段，因此不用 JSON Schema 固化（固化会让每次加字段都变成破坏性变更），改由规范正文定义：

| 文件 | 结构定义在 |
|---|---|
| `.ai/rules.json` | `docs/system/07-cli.md`（rules 一节）+ `cli/lib/rules.mjs` |
| `.ai/project-facts.json` | `docs/system/07-cli.md`（facts 一节）+ `cli/lib/facts.mjs` |
| `.ai/registry.json` | `docs/system/08-documentation.md`（实体格式）+ `cli/lib/registry.mjs` |

**判断标准**：会被其它工具按固定格式解析、且格式变更需要迁移已生成项目的 → 写 JSON Schema；只被本项目 CLI 读写、新增字段向后兼容的 → 规范正文 + 代码共同定义，并在变更时更新本节表格。

## 使用方式

- **校验**：`node scripts/validate.mjs` 会对仓库内所有 `pack.json` 套用 `pack.schema.json` 的字段要求（零依赖实现，不引入 ajv）。
- **给 AI 读**：AI 在修改索引格式或新增模板包前，应先读对应 schema，再改代码。
- **给外部工具读**：schema 是标准 JSON Schema（draft 2020-12），可用任何校验器处理。

## 变更规则

改 schema 属于**破坏性变更**（影响已生成的项目），因此：

1. 必须升对应的 `schemaVersion` 字段（`index.schema.json` 的 `schemaVersion` 在生成的文件里）。
2. 必须同步更新 `docs/system/07-cli.md` 与 `docs/system/04-context-discipline.md`。
3. 必须同步更新 `templates/_schema/pack.schema.md`（若是 pack 格式）。
4. 必须在 `docs/05-changelog-of-rules.md` 记录。
5. `node scripts/selftest.mjs` 必须验证新旧格式的往返（索引读→写→再读）。

完整影响矩阵见 `docs/system/09-change-protocol.md`。
