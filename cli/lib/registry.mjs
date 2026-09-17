/**
 * 实体注册表（`.ai/registry.json`）的校验与漂移检测。
 *
 * 这一层补的是"**验证**"维度的缺口：索引只能回答"文件在不在、内容变没变"，
 * 回答不了"这个契约的**语义**是什么、谁拥有它、什么必须恒成立"。
 * 注册表存的就是后者（invariants / signature / owner）。
 *
 * 两者结合才能检出**契约静默漂移**：
 *   注册表说实体 X 在文件 F、其 hash 为 H；而索引里 F 的 hash 已变成 H'。
 *   这说明有人改了契约却没更新注册表——后果是后续 AI 会拿旧的不变量做判断。
 *   没有 hash 字段时无法检出这类漂移，这也是为什么注册表条目必须记 hash。
 *
 * 同一思路的另一半是 `tests`：不变量是"必须恒成立"的断言，
 * 而**没人能发现它被破坏**的断言等于文档里的一句话。因此有 invariants 却没有
 * tests 的实体会被指出（与"判定不了的规则等于没有规则"同一标准），
 * 契约漂移时也会直接列出该重跑哪些测试。
 */

import path from 'node:path';
import {
  isFile, readJsonSafe, normalizeRel, shortHash, walk, matchesAny,
} from './fsx.mjs';
import { loadIndex } from './indexer.mjs';

export const ENTITY_KINDS = [
  'data-model', 'api', 'module', 'class', 'config', 'contract', 'asset',
];

/** 读取注册表（不存在或非法时返回 null，由调用方决定如何报告）。 */
export function loadRegistry(root) {
  return readJsonSafe(path.join(root, '.ai', 'registry.json'), null);
}

/**
 * 校验注册表自身的结构。
 * 与"规则集校验"同一思路：**判定不了的条目等于没有条目**，
 * 因此缺少 file / invariants 的实体会被明确指出，而不是静默放过。
 */
export function auditRegistry(root) {
  const reg = loadRegistry(root);
  const issues = [];
  if (!reg) {
    return { present: false, issues, summary: { total: 0, kinds: {}, withoutInvariants: 0, withoutHash: 0, withoutTests: 0 } };
  }
  const index = loadIndex(root);
  const indexed = new Set((index?.files ?? []).map((f) => f.path));
  const entities = Array.isArray(reg.entities) ? reg.entities : [];
  const names = new Set();
  const kinds = {};
  let withoutInvariants = 0;
  let withoutHash = 0;
  let withoutTests = 0;

  for (const [i, e] of entities.entries()) {
    const label = e?.name ?? `#${i}`;
    if (!e || typeof e !== 'object') {
      issues.push({ level: 'error', entity: label, message: '实体不是对象' });
      continue;
    }
    if (!e.name) issues.push({ level: 'error', entity: label, message: '缺少 name' });
    else if (names.has(e.name)) issues.push({ level: 'error', entity: label, message: '实体名重复' });
    else names.add(e.name);

    if (!ENTITY_KINDS.includes(e.kind)) {
      issues.push({ level: 'error', entity: label, message: `kind 非法：${e.kind ?? '（缺失）'}，可选 ${ENTITY_KINDS.join('/')}` });
    } else {
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    }
    if (!e.file) {
      issues.push({ level: 'error', entity: label, message: '缺少 file：没有 file 就无法与索引对账，也无法检出漂移' });
    }
    if (!Array.isArray(e.invariants) || e.invariants.length === 0) {
      withoutInvariants += 1;
      issues.push({
        level: 'warn', entity: label,
        message: '没有 invariants：这条登记只剩"名字"，无法回答"改它时必须保持什么"（注册表的核心价值就是这一项）',
      });
    } else {
      for (const inv of e.invariants) {
        if (typeof inv !== 'string' || inv.trim().length < 4) {
          issues.push({ level: 'warn', entity: label, message: `不变量过短，可能不可判定：${JSON.stringify(inv)}` });
        } else if (/尽量|合理|注意|优雅/.test(inv) && !/[0-9≤≥<>=]|禁止|必须|不得/.test(inv)) {
          issues.push({ level: 'warn', entity: label, message: `不变量可能不可判定："${inv}"` });
        }
      }
      // 不变量是"必须恒成立"的断言，因此它天然可被判定的前提是**有人能发现它被破坏**。
      // 没有测试引用的不变量只能靠人记得——与"判定不了的规则等于没有规则"同一标准。
      const tests = Array.isArray(e.tests) ? e.tests.filter((t) => typeof t === 'string' && t.trim()) : [];
      if (tests.length === 0) {
        withoutTests += 1;
        issues.push({
          level: 'warn', entity: label,
          message: '不变量没有任何测试引用（tests 为空）：被破坏时没有机制能自动发现，只能靠人记得',
        });
      } else {
        for (const t of tests) {
          if (!indexed.has(normalizeRel(t))) {
            issues.push({
              level: 'warn', entity: label,
              message: `tests 指向的文件不在索引中：${normalizeRel(t)}（路径写错，或该测试还没纳入索引）`,
            });
          }
        }
      }
    }
    if (!e.hash) {
      withoutHash += 1;
      issues.push({
        level: 'warn', entity: label,
        message: '没有 hash：无法检出"契约被改但注册表未更新"的漂移（建议填 .ai/index/files.json 里该文件的 hash 前 10 位）',
      });
    }
  }

  return {
    present: true,
    issues,
    summary: {
      total: entities.length,
      kinds,
      withoutInvariants,
      withoutHash,
      withoutTests,
      errors: issues.filter((x) => x.level === 'error').length,
      warnings: issues.filter((x) => x.level === 'warn').length,
    },
  };
}

/**
 * 注册表 × 索引 的对账（漂移检测）。
 *
 * 检出四类问题：
 *  1. `entity-file-missing` —— 注册表指向的文件不存在（搬了/删了没更新注册表）
 *  2. `entity-hash-stale`   —— 文件 hash 与注册表记录不一致（契约被改，注册表未同步）
 *  3. `entity-unindexed`    —— 文件存在但不在索引里（被忽略规则排除，或超出索引体积上限）
 *  4. `high-risk-unregistered` —— 高风险 / 被多方依赖的文件尚未登记（以 info 报告，是工作队列而非错误）
 *
 * 第 4 类是刻意保留的"欠账可见化"：注册表为空时，校验无从下手（无实体可查），
 * 于是框架必须主动指出"哪些文件值得登记"，否则这一层永远不会被用起来。
 */
export function reconcileRegistry(root, opts = {}) {
  const {
    limit = 20,
    highRiskOnly = true,
    minDependents = 3,
  } = opts;

  const findings = [];
  const index = loadIndex(root);
  const reg = loadRegistry(root);

  if (!index) {
    return { findings, summary: { checked: 0, stale: 0, missing: 0, unregistered: 0 } };
  }
  const byPath = new Map((index.files ?? []).map((f) => [f.path, f]));

  const entities = Array.isArray(reg?.entities) ? reg.entities : [];
  let stale = 0;
  let missing = 0;
  let unindexed = 0;

  for (const e of entities) {
    if (!e?.file) continue;
    const rel = normalizeRel(String(e.file));
    const entry = byPath.get(rel);
    if (!entry) {
      // 文件可能被目录级登记（例：module 登记的是目录）——这里只对"看起来像文件"的路径报缺失
      if (/\.[A-Za-z0-9]+$/.test(rel)) {
        missing += 1;
        findings.push({
          severity: 'warn',
          code: 'entity-file-missing',
          target: `${e.name} → ${rel}`,
          message: '注册表指向的文件不存在：契约可能被搬运或删除，而注册表未同步',
          action: `修正 .ai/registry.json 中 ${e.name} 的 file，或删除该实体`,
        });
      } else {
        unindexed += 1;
        findings.push({
          severity: 'info',
          code: 'entity-unindexed',
          target: `${e.name} → ${rel}`,
          message: '登记的路径是目录或不在索引中：无法用 hash 对账（目录级登记属正常，文件级登记请改用具体文件）',
          action: '若这是目录级登记可忽略；否则改为具体文件路径',
        });
      }
      continue;
    }
    if (e.hash) {
      const current = shortHash(entry.hash, 10);
      if (current !== String(e.hash).slice(0, 10)) {
        stale += 1;
        const tests = Array.isArray(e.tests) ? e.tests.filter((t) => typeof t === 'string' && t.trim()) : [];
        findings.push({
          severity: 'warn',
          code: 'entity-hash-stale',
          target: `${e.name} → ${rel}`,
          message: `契约已变但注册表未同步（注册表 ${String(e.hash).slice(0, 10)} → 索引 ${current}）：`
            + '后续 AI 会据此使用旧的不变量做判断',
          action: `重新核对 ${e.name} 的 signature 与 invariants，然后更新 hash`
            + (tests.length > 0
              ? `；并重跑声明的测试：${tests.join('、')}`
              : '；该实体未声明 tests，不变量是否还成立只能靠人工确认'),
        });
      }
    }
  }

  // 高风险未登记：给出"值得登记"的工作队列
  const registered = new Set(entities.map((e) => normalizeRel(String(e?.file ?? ''))));
  const candidates = (index.files ?? [])
    .filter((f) => f.kind === 'text')
    .filter((f) => !f.path.startsWith('.ai/'))
    .filter((f) => !registered.has(f.path))
    .filter((f) => (highRiskOnly ? f.risk === 'high' : true))
    .filter((f) => (f.importedBy?.length ?? 0) >= minDependents || f.risk === 'high')
    .sort((a, b) => (b.importedBy?.length ?? 0) - (a.importedBy?.length ?? 0))
    .slice(0, limit);

  if (entities.length === 0 && candidates.length > 0) {
    findings.push({
      severity: 'info',
      code: 'registry-empty',
      target: '.ai/registry.json',
      message: `注册表尚无任何实体。它不是"文件清单"（那是索引的职责），而是**契约清单**：`
        + '记录"改它时必须保持什么"（不变量）、谁拥有它、签名是什么。'
        + `检测到 ${candidates.length} 个高风险/被多方依赖的文件值得优先登记`,
      action: '按下面的候选逐个补 invariants 与 hash；只登记会出事的，不必登记全部文件',
    });
  }
  for (const f of candidates) {
    findings.push({
      severity: 'info',
      code: 'high-risk-unregistered',
      target: f.path,
      message: `未登记：risk=${f.risk}，被 ${f.importedBy?.length ?? 0} 处依赖`
        + (f.digest?.purpose ? `；摘要：${String(f.digest.purpose).slice(0, 60)}` : ''),
      action: '在 .ai/registry.json 登记其 invariants / signature / owner / tests，hash 填该文件 hash 前 10 位',
    });
  }

  return {
    findings,
    summary: {
      checked: entities.length,
      stale,
      missing,
      unindexed,
      unregisteredCandidates: candidates.length,
    },
  };
}

export { isFile, matchesAny, walk };
