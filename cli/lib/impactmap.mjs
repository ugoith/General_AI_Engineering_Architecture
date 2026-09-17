/**
 * 影响矩阵的**可判定化**。
 *
 * 问题（属于"运行链路的第 4 步"）：
 *   `.ai/index/impact-map.json` 此前只是一张**人读的表**。`review --impact <文件>` 会把矩阵里**全部**规则
 *   都打印出来，于是"这次改动命中了哪几条"完全靠人判断——判断不了的条目等于没有条目（本框架的一贯取舍）。
 *
 * 做法：让每条规则声明自己的**触发判据**（`when`），由 CLI 机械求值：
 *   - `when.entityKinds[]`：注册表里该 kind 的实体文件出现在本次改动里
 *   - `when.paths[]`      ：改动路径匹配 glob
 *   - `when.manifest`     ：改动的是依赖清单（package.json / *.csproj / pyproject.toml …）
 *   - `when.build`        ：改动的是构建与工具链配置（tsconfig / Makefile / CI / *.Build.cs …）
 *
 * **没有 `when` 的规则不猜**：判为 `unknown`，并明确报告"未声明判据 → 本次无法判断是否适用"，
 * 而不是把所有规则一股脑列出来让人自己挑（那正是要消灭的行为）。
 *
 * `mustUpdate` 的核对交给 taskclose.mjs：它需要任务包记录的创建时间作为基线。
 */

import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, matchesAny, normalizeRel } from './fsx.mjs';

/** 依赖清单：改了它们意味着依赖变化。 */
export const MANIFEST_PATTERNS = [
  '**/package.json', '**/pnpm-lock.yaml', '**/package-lock.json', '**/yarn.lock',
  '**/requirements*.txt', '**/pyproject.toml', '**/Pipfile', '**/poetry.lock',
  '**/go.mod', '**/go.sum', '**/Cargo.toml', '**/Cargo.lock',
  '**/*.csproj', '**/*.uproject', '**/*.uplugin', '**/Packages/manifest.json',
  '**/pom.xml', '**/build.gradle', '**/build.gradle.kts', '**/vcpkg.json',
  '**/conanfile.txt', '**/conanfile.py', '**/Gemfile', '**/composer.json',
];

/** 构建与工具链配置：改了它们意味着构建方式变化。 */
export const BUILD_PATTERNS = [
  '**/Makefile', '**/CMakeLists.txt', '**/Dockerfile', '**/docker-compose*.yml', '**/docker-compose*.yaml',
  '**/tsconfig*.json', '**/vite.config.*', '**/webpack.config.*', '**/rollup.config.*', '**/esbuild*.mjs',
  '**/*.Build.cs', '**/*.Target.cs', '**/ProjectVersion.txt', '**/export_presets.cfg',
  '**/.github/workflows/*.yml', '**/.github/workflows/*.yaml', '**/.gitlab-ci.yml', '**/Jenkinsfile',
  '**/*.sln', '**/build.sh', '**/build.ps1',
];

/** 支持的判据键。写错键名不会被静默忽略——会在 `unknown` 里报出来。 */
export const WHEN_KEYS = ['entityKinds', 'paths', 'manifest', 'build'];

/**
 * 由 CLI 自己在收尾流程中刷新的文件：不参与"本次任务有没有同步它"的判定。
 * 理由：收尾顺序是 `review --task` → `index --stale`，`files.json` 由第 2 步刷新，
 * 在这里判定它必然误报；它的新鲜度由 `task-index-stale` 负责。
 */
export const FRAMEWORK_MAINTAINED = new Set(['.ai/index/files.json']);

function declaredKeys(when) {
  if (!when || typeof when !== 'object') return [];
  return WHEN_KEYS.filter((k) => {
    const v = when[k];
    if (v === undefined || v === null || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}

/**
 * 把矩阵规则按"本次改动是否命中"分类。
 *
 * @param {{changed?: string[], impactMap?: object|null, index?: object|null, registry?: object|null}} input
 * @returns {{applicable: object[], unknown: object[], skipped: object[], summary: object}}
 */
export function classifyImpactRules(input = {}) {
  const { changed = [], impactMap = null, index = null, registry = null } = input;
  const rel = [...new Set(changed.map((c) => normalizeRel(String(c))))];
  const rules = Array.isArray(impactMap?.rules) ? impactMap.rules : [];
  const entities = Array.isArray(registry?.entities) ? registry.entities : [];
  const unknownKeys = new Set();

  const applicable = [];
  const unknown = [];
  const skipped = [];

  for (const rule of rules) {
    const when = rule?.when ?? null;
    const base = {
      trigger: rule?.trigger ?? '(未命名)',
      mustUpdate: Array.isArray(rule?.mustUpdate) ? rule.mustUpdate : [],
      adrRequired: Boolean(rule?.adrRequired),
      note: rule?.note ?? null,
    };
    const keys = declaredKeys(when);
    if (keys.length === 0) {
      const stray = when && typeof when === 'object'
        ? Object.keys(when).filter((k) => !WHEN_KEYS.includes(k))
        : [];
      for (const k of stray) unknownKeys.add(k);
      unknown.push({
        ...base,
        matched: [],
        evidence: [stray.length > 0
          ? `when 里的键 ${stray.join('、')} 不是受支持的判据（支持：${WHEN_KEYS.join('、')}）`
          : '未声明触发判据（when）：本次无法判断该规则是否适用'],
      });
      continue;
    }

    const matched = new Set();
    const evidence = [];
    for (const key of keys) {
      if (key === 'entityKinds') {
        const kinds = new Set((when.entityKinds ?? []).map(String));
        for (const e of entities) {
          const file = normalizeRel(String(e?.file ?? ''));
          if (!file || !kinds.has(String(e?.kind ?? ''))) continue;
          if (!rel.includes(file)) continue;
          matched.add(file);
          evidence.push(`注册表实体 ${e.name}（${e.kind}）落在改动里：${file}`);
        }
      } else if (key === 'paths') {
        const patterns = (when.paths ?? []).map(String);
        for (const p of rel) {
          if (!matchesAny(p, patterns)) continue;
          matched.add(p);
          evidence.push(`路径命中 when.paths：${p}`);
        }
      } else if (key === 'manifest') {
        for (const p of rel) {
          if (!matchesAny(p, MANIFEST_PATTERNS)) continue;
          matched.add(p);
          evidence.push(`依赖清单被改动：${p}`);
        }
      } else if (key === 'build') {
        for (const p of rel) {
          if (!matchesAny(p, BUILD_PATTERNS)) continue;
          matched.add(p);
          evidence.push(`构建/工具链配置被改动：${p}`);
        }
      }
    }

    const entry = { ...base, matched: [...matched], evidence: [...new Set(evidence)] };
    if (matched.size > 0) applicable.push(entry);
    else skipped.push({ ...entry, evidence: ['声明的判据都不匹配本次改动'] });
  }

  return {
    applicable,
    unknown,
    skipped,
    summary: {
      total: rules.length,
      applicable: applicable.length,
      unknown: unknown.length,
      skipped: skipped.length,
      unknownKeys: [...unknownKeys],
    },
  };
}

/**
 * 核对一条规则的 `mustUpdate` 是否真的同步了。
 *
 * 基线用**任务包的创建时间**：`mtime > createdAt` 即"本次任务碰过它"。
 * 为什么不用 hash：`mustUpdate` 里的文件通常不在任务包读取清单里（没人给过它 hash），
 * 而没有基线的 hash 比对是无意义的。mtime 只能回答"有没有动过"，回答不了"改得对不对"——
 * 所以报告里的措辞必须停在"没有改动过"，不能升级成"没有正确更新"。
 */
export function impactTargetsState(root, rule, { sinceMs = null } = {}) {
  const out = { updated: [], notUpdated: [], missing: [], skipped: [] };
  for (const raw of rule?.mustUpdate ?? []) {
    const target = normalizeRel(String(raw));
    if (!target) continue;
    if (FRAMEWORK_MAINTAINED.has(target)) {
      out.skipped.push({ target, reason: '由收尾第 2 步的 index 刷新，此处的判定会误报；它的新鲜度由 task-index-stale 负责' });
      continue;
    }
    const abs = path.join(root, target);
    if (isDir(abs)) {
      out.skipped.push({ target, reason: '是目录：无法用单个 mtime 判定它是否被更新过' });
      continue;
    }
    if (!isFile(abs)) {
      out.missing.push({ target });
      continue;
    }
    if (sinceMs === null) {
      out.skipped.push({ target, reason: '任务包没有可用的创建时间，无法确定基线' });
      continue;
    }
    const mtimeMs = fs.statSync(abs).mtimeMs;
    if (mtimeMs > sinceMs) out.updated.push({ target });
    else out.notUpdated.push({ target });
  }
  return out;
}
