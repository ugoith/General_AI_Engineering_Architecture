# schema：机器可读契约

本目录存放**格式契约**。任何被 CLI 读写、被 AI 解析的文件，其结构都必须在 schema 里有定义。

| 文件 | 约束对象 | 维护者 |
|---|---|---|
| `pack.schema.json` | `templates/archetypes/*/pack.json`（模板包清单） | 框架维护者 |
| `index.schema.json` | 项目内 `.ai/index/files.json`（文件索引） | 框架维护者 |

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
