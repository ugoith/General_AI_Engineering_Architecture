/**
 * 设计模式选择矩阵（机器可读版本）。
 *
 * 本文件是 `docs/system/03-pattern-selection.md` 的数据化形式；两者必须一致。
 * `scripts/validate.mjs` 会检查两边的模式名集合是否对齐。
 */

/** 规模判定规则：四项取最高档。与 docs/system/02-scales.md 一致。 */
export const MATRIX_RULES = [
  {
    level: 'S',
    name: '轻量',
    loc: '< 2k',
    modules: '1',
    team: '1 人',
    lifespan: '< 3 月',
    must: ['README', 'AGENTS.md', '验证命令', '变更记录'],
    banned: ['DI 容器', '事件总线', '仓储层/分层架构', 'CQRS', '微服务', '自研框架或 RPC', '多级缓存', '插件系统', '抽象工厂 + 策略族的组合'],
  },
  {
    level: 'M',
    name: '标准',
    loc: '2k – 30k',
    modules: '3 – 15',
    team: '2 – 8 人',
    lifespan: '0.5 – 3 年',
    must: ['上述全部', '项目宪法', '实体注册表', 'ADR', '模块边界文档', 'CI 校验'],
    banned: ['CQRS', '微服务', '多级缓存', '自研序列化', '无 ADR 的跨模块重构'],
  },
  {
    level: 'L',
    name: '系统',
    loc: '30k – 200k',
    modules: '15 – 60',
    team: '8 – 30 人',
    lifespan: '2 – 5 年',
    must: ['上述全部', '契约测试', '依赖方向自动检查', '性能预算', '固定评审节奏', '版本化接口'],
    banned: ['无 ADR 的跨模块重构', '隐式全局状态', '绕过契约层的跨模块直连'],
  },
  {
    level: 'XL',
    name: '平台',
    loc: '> 200k',
    modules: '> 60',
    team: '> 30 人',
    lifespan: '> 5 年',
    must: ['上述全部', '领域边界与所有权', '版本化契约与兼容策略', '迁移与弃用流程', '架构评审委员会（可由 1 人兼任）'],
    banned: ['单体式共享库', '无版本的契约变更', '跨领域的直接数据库访问'],
  },
];

/**
 * 模式条目。
 *  minLevel：允许引入的最低规模（低于该级别引入 = 过度设计）
 *  problem ：它解决的具体问题（没有这个问题就不该引入）
 *  cost    ：引入后的持续代价
 *  adrRequired：是否必须先写 ADR
 */
export const PATTERNS = [
  {
    name: '显式函数分层（handler → service → repo）',
    problem: '同一条业务规则被多个入口重复实现，改一处漏一处',
    minLevel: 'M',
    cost: '每层一次跳转成本；层职责划分不清时会退化',
    adrRequired: false,
    why: '先把调用方向固定下来，比引入框架更便宜',
  },
  {
    name: '依赖注入（手工传参优先）',
    problem: '同一对象在多个地方被 new 出来，测试无法替换',
    minLevel: 'M',
    cost: '构造函数变长；容器化后启动顺序难追踪',
    adrRequired: false,
    why: 'S 级项目直接 import 即可，测试用真实对象更省事；容器（DI 框架）只在 L 级以上且确有跨模块装配需求时考虑，且需 ADR',
  },
  {
    name: '仓储接口（Repository）',
    problem: '业务逻辑里散落 SQL/网络调用，换存储要改遍全局',
    minLevel: 'M',
    cost: '一层间接；过度泛化会得到"什么都能存"的接口',
    adrRequired: false,
    why: '接口只暴露业务真的用到的操作，不要做通用 CRUD 基类',
  },
  {
    name: '事件/消息解耦（进程内）',
    problem: '一个动作要触发多个互不相关的副作用，直接调用导致循环依赖',
    minLevel: 'L',
    cost: '调用链不可见、调试困难、顺序不确定；必须配日志与追踪',
    adrRequired: true,
    why: 'M 级以内通常用显式调用 + 一处汇总函数就够了',
  },
  {
    name: 'CQRS / 读写分离',
    problem: '读写负载特征差异极大，且写模型的约束拖慢读路径',
    minLevel: 'L',
    cost: '最终一致性、重复代码、同步管道；团队必须理解一致性语义',
    adrRequired: true,
    why: '只有出现可测量的读放大或写瓶颈时才引入；S/M 级引入属于缺陷',
  },
  {
    name: '插件/扩展点（SPI）',
    problem: '同一套核心要支持多种外部实现，且实现方与核心分开发布',
    minLevel: 'L',
    cost: '版本兼容矩阵、加载失败处理、安全边界',
    adrRequired: true,
    why: '如果扩展方就是你自己的团队，改用直接调用 + 配置开关',
  },
  {
    name: '状态机（显式状态与转移表）',
    problem: '布尔标志位组合爆炸，非法状态无法排除',
    minLevel: 'M',
    cost: '需要维护转移表；状态划分不当会反复重写',
    adrRequired: false,
    why: '生命周期复杂（订单/任务/连接/游戏流程）时收益极高',
  },
  {
    name: 'ECS（实体-组件-系统）',
    problem: '大量同构对象按帧更新，OOP 继承与虚调用成为瓶颈',
    minLevel: 'M',
    cost: '思维模型断层、调试困难、与引擎编辑器集成复杂',
    adrRequired: true,
    why: '游戏项目只有实体规模数千以上、且性能实测受限时才值得；小项目用普通对象 + 简单列表更快',
  },
  {
    name: '对象池',
    problem: '高频创建销毁导致 GC 抖动或分配热点',
    minLevel: 'M',
    cost: '生命周期管理与"归还时清理"容易出错',
    adrRequired: false,
    why: '必须先用 profiler 证明分配是瓶颈，再引入',
  },
  {
    name: '数据驱动配置（表/JSON 驱动内容）',
    problem: '数值与内容调整需要改代码重新构建',
    minLevel: 'M',
    cost: '需要 schema 校验与版本迁移；配置错误要能早发现',
    adrRequired: false,
    why: '游戏与业务规则频繁调整时收益最大；配置必须有校验，否则等于把错误推迟到运行时',
  },
  {
    name: '契约优先（先定接口/数据结构再实现）',
    problem: '多方并行开发时接口反复变更，返工成本高',
    minLevel: 'L',
    cost: '前期投入；契约变更需要流程',
    adrRequired: true,
    why: '涉及外部系统或多团队时必须；单团队可退化为"先写接口文件"',
  },
  {
    name: '适配器/防腐层（Anti-Corruption Layer）',
    problem: '外部系统的数据模型与术语渗入核心领域',
    minLevel: 'M',
    cost: '一层转换代码',
    adrRequired: false,
    why: '任何第三方 SDK/引擎 API 直接进入领域逻辑时都应加',
  },
  {
    name: '特性开关（Feature Flag）',
    problem: '未完成功能需要合并但不可见，或需要灰度',
    minLevel: 'M',
    cost: '开关会累积成债务，必须有清理时限',
    adrRequired: false,
    why: '每个开关都要写"何时删除"，否则半年后没人敢关',
  },
  {
    name: '分层缓存',
    problem: '重复计算或远程调用成本高，且延迟不可接受',
    minLevel: 'L',
    cost: '失效策略是 bug 的主要来源；需要可观测性',
    adrRequired: true,
    why: 'S/M 级先用一次本地缓存或直接优化查询',
  },
  {
    name: 'DDD 战术模式（聚合/值对象/领域事件）',
    problem: '业务规则复杂且频繁变化，需要显式表达不变式',
    minLevel: 'L',
    cost: '建模成本高；用错地方会得到大量无行为的贫血包装',
    adrRequired: true,
    why: '只有业务规则本身是复杂度来源时才值得；技术复杂度用分层与契约解决',
  },
];

/** 规模对应的禁止清单（来源于 MATRIX_RULES）。 */
export function antiPatterns(level = null) {
  if (!level) {
    return MATRIX_RULES.find((r) => r.level === 'S').banned;
  }
  const rule = MATRIX_RULES.find((r) => r.level === level);
  return rule ? rule.banned : [];
}

export function scaleRule(level) {
  return MATRIX_RULES.find((r) => r.level === level) ?? null;
}
