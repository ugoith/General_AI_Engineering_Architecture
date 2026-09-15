/**
 * 框架内置阈值。**每个数字都必须能在 docs/system/ 找到出处**（见 AGENTS.md 硬约束）。
 *
 * 出处：
 *  - 行数上限：docs/system/04-context-discipline.md 的预算表
 *  - token 上限：同上（字符启发式估算，误差 ±20%）
 *  - taskBudget：docs/system/04-context-discipline.md「任务包默认预算」
 */

/** 静态上下文文件的行数与 token 上限（key 为项目内相对路径）。 */
export const PACK_LIMITS = {
  'AGENTS.md': 140,
  '.ai/constitution.md': 140,
  '.ai/index/README.md': 200,
};

/**
 * 各上下文文件的 token 上限。实测值见 scripts/measure-budget.mjs。
 *
 * - `AGENTS.md`：游戏类 archetype 实测 ~1900–2050（内联共享片段 + 引擎专项硬约束 +
 *   引擎必读项与验证命令），通用软件类 ~1600。上限 2100 留出项目自加规则的余量
 *   （例如把项目已有的规范体系接进来）。行数上限 140 与之匹配。
 * - `.ai/constitution.md`：游戏类实测 ~1600（含 decision-trigger / scale-gate 片段），上限 1800。
 *
 * 出处：docs/system/04-context-discipline.md 的预算表。
 */
export const AGENTS_TOKEN_BUDGET = 2100;
export const CONTEXT_TOKEN_BUDGETS = {
  'AGENTS.md': AGENTS_TOKEN_BUDGET,
  '.ai/constitution.md': 1800,
  '.ai/index/README.md': 1700,
};

/** 任务包默认 token 预算。 */
export const DEFAULT_TASK_BUDGET = 40000;

/** 索引规模超过该值时，`task` 命令会提示需要 --area 限定范围。 */
export const LARGE_INDEX_HINT = 400;

/** 单个源码文件的 token 估算系数（token/行）。 */
export const TOKENS_PER_LOC = 9;

/**
 * 索引入口的大小上限：超过该值的文件不进入 `.ai/index/files.json`。
 *
 * 依据（实测）：某 UE 项目 6682 个可遍历文件中 90.3% 是二进制，其中多个 `.pdb` 超过 60MB；
 * 把它们计入索引会让 files.json 涨到 4.2MB，且每个条目都只会被判为 `read-source`，
 * 直接摧毁任务包的上下文预算。256KB 足以覆盖正常源码与文本配置。
 */
export const DEFAULT_INDEX_MAX_BYTES = 256 * 1024;
