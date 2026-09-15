# 变更记录

记录**用户可感知**的变更：新增/修改/删除的命令、参数、输出格式、退出码、依赖要求。内部重构、注释、测试补充不必记录。

格式参考 Keep a Changelog；版本号遵循语义化版本——`MAJOR`（不兼容变更）`.`MINOR`（向后兼容的新功能）`.`PATCH`（向后兼容的修复）。

## [Unreleased]

### Added

- 初始骨架：`{{srcDir}}/main.mjs` 提供 `hello` 子命令与 `--help` / `--version`，退出码约定见 `README.md`。

### Changed

- （示例）`hello` 的默认输出语言由英文改为中文。破坏性变更请在此注明 BREAKING 并写 ADR。

### Fixed

- 无。

### Removed

- 无。

## 发布时怎么做

1. 把 `[Unreleased]` 改成一个新版本号小节并补日期，例如：`## [0.1.0] - {{date}}`。
2. 在 `{{srcDir}}/main.mjs` 里同步 `VERSION` 常量（或改为从包元数据读取）。
3. 已发布的小节不要再改：发现写错就更正到下一个版本里。
