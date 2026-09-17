/**
 * 依赖邻域查询：由 index.files[].imports / importedBy 构建，用于"改变更影响面"。
 */

import { candidatePathsOf } from './pathc.mjs';

export function buildGraph(index) {
  const nodes = new Map((index?.files ?? []).map((f) => [f.path, f]));
  const edges = new Map();
  for (const file of nodes.values()) {
    edges.set(file.path, new Set(file.imports ?? []));
  }
  return { nodes, edges };
}

export function resolveTargets(graph, spec) {
  const out = new Set();
  if (graph.nodes.has(spec)) out.add(spec);
  for (const candidate of candidatePathsOf(spec)) if (graph.nodes.has(candidate)) out.add(candidate);
  return [...out];
}

/**
 * 计算影响面。
 * @param {object} index
 * @param {string[]} changed 变更的文件（相对路径）
 * @param {{depth?: number, limit?: number}} [opts]
 */
export function impactOf(index, changed, opts = {}) {
  const { depth = 2, limit = 60 } = opts;
  const graph = buildGraph(index);
  const changedSet = new Set();
  for (const spec of changed) for (const hit of resolveTargets(graph, spec)) changedSet.add(hit);
  // 返回形状必须与正常路径一致：早期这里只返回 changed/dependents/depth，
  // 于是 `review --impact <索引里没有的路径>`（新建文件、写错路径都很常见）会在读取 impact.tests 时抛 TypeError，
  // 而不是老老实实报"未匹配到"。
  if (changedSet.size === 0) {
    return {
      changed: [], dependents: [], depth, tests: [],
      summary: { changedCount: 0, dependentCount: 0, testCount: 0 },
    };
  }

  const levels = new Map();
  for (const c of changedSet) levels.set(c, 0);
  let frontier = [...changedSet];
  for (let d = 1; d <= depth; d += 1) {
    const next = [];
    for (const file of frontier) {
      const node = graph.nodes.get(file);
      const parents = node?.importedBy ?? [];
      for (const p of parents) {
        if (levels.has(p)) continue;
        levels.set(p, d);
        next.push(p);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const dependents = [...levels.entries()]
    .filter(([p, d]) => d > 0 && !changedSet.has(p))
    .sort((a, b) => a[1] - b[1] || graph.nodes.get(b[0]).importedBy.length - graph.nodes.get(a[0]).importedBy.length)
    .slice(0, limit)
    .map(([p, d]) => ({
      path: p,
      depth: d,
      risk: graph.nodes.get(p)?.risk ?? 'low',
      digest: graph.nodes.get(p)?.digest?.purpose ?? null,
    }));

  const tests = [...graph.nodes.keys()].filter(
    (p) => /(^|\/)(tests?|specs?|__tests__)\//i.test(p) || /\.(test|spec)\./i.test(p),
  ).filter((p) => {
    const node = graph.nodes.get(p);
    return (node?.imports ?? []).some((i) => changedSet.has(i) || dependents.some((d) => d.path === i));
  });

  return {
    changed: [...changedSet],
    dependents,
    depth,
    tests,
    summary: {
      changedCount: changedSet.size,
      dependentCount: dependents.length,
      testCount: tests.length,
    },
  };
}

export { candidatePathsOf } from './pathc.mjs';
