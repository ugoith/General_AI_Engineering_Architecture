# CLAUDE.md

本仓库的唯一 AI 入口是 [`AGENTS.md`](./AGENTS.md)。请先完整读取它，再按其"工作路由"表决定后续要读的文件。

补充说明（仅 Claude 系工具需要）：

- 本仓库不使用 `.claude/` 私有配置承载规范；一切规范在 `docs/system/`，任务知识在 `skills/`。
- 若你支持 Agent Skills，可直接按 `skills/*/SKILL.md` 的 frontmatter 加载；否则按 `skills/README.md` 的索引入口手动读取。
- 修改任何文件后，必须运行 `node scripts/validate.mjs` 与 `node scripts/selftest.mjs`，两者都通过才算完成。
