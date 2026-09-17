/**
 * 框架内置阈值。**每个数字都必须能在 docs/system/ 找到出处**（见 AGENTS.md 硬约束）。
 *
 * 出处：
 *  - 行数上限：docs/system/04-context-discipline.md 的预算表
 *  - token 上限：同上（字符启发式估算，误差 ±20%）
 *  - taskBudget：docs/system/04-context-discipline.md「任务包默认预算」
 */

/**
 * 静态上下文文件的行数与 token 上限（key 为项目内相对路径）。
 *
 * 行数是**代理指标**，真约束是 token（见下方 `CONTEXT_TOKEN_BUDGETS`）。
 * 取 150 行的理由：游戏类 archetype 的 AGENTS.md 内联了共享片段 + 引擎专项硬约束 +
 * 引擎必读项与验证命令，实测 119–141 行；项目再接入自身既有的规范体系会加几行。
 * 140 曾让一个正常接入的项目立刻报"超限"——那属于阈值过紧而非内容膨胀。
 * 阈值应当约束**真问题**（每会话固定成本），而不是制造噪音；实测 token 仍在 2100 以内。
 */
export const PACK_LIMITS = {
  'AGENTS.md': 150,
  '.ai/constitution.md': 150,
  '.ai/index/README.md': 200,
};

/**
 * 各上下文文件的 token 上限。实测值见 scripts/measure-budget.mjs。
 *
 * - `AGENTS.md`：软件类 ~1670，游戏类 ~1940–2390。上限 2500 是因为 **game-unreal**
 *   实测 2392（内联共享片段 + 10 条 UE 专项硬约束 + 11 行路由表 + 索引纪律 + 编译/测试/打包命令）。
 *   这些内容按 `docs/04-design-notes.md` 的取舍**不该砍**（要压缩时应砍"项目定位/指针"类内容）。
 *   原上限 2100 是在游戏类实测 1900–2050 时定的，之后模板长到 2390 却没有同步上调——
 *   结果是**新 init 的 UE 项目一开局就报 context-budget**，阈值变成了噪音而不是约束。
 *   行数上限 150 与之匹配（150 行 × 约 16.7 token/行 ≈ 2500）。
 * - `.ai/constitution.md`：游戏类实测 ~1550–1650（含 decision-trigger / scale-gate 片段），上限 1800。
 * - `.ai/index/README.md`：~880，上限 1700（它只在首次任务与格式变更时进必读清单，见 taskpack.mjs）。
 *
 * 出处：docs/system/04-context-discipline.md 的预算表。
 */
export const AGENTS_TOKEN_BUDGET = 2500;
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
