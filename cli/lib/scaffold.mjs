/**
 * 项目脚手架：`init`（生成）与 `upgrade`（同步框架）的实现。
 *
 * 契约见 docs/system/07-cli.md。核心不变量：
 *  - 已存在的文件默认**不覆盖**（除非 --force 或该文件被标记为框架托管且未被本地改动）。
 *  - 所有生成的框架文件都记入 `.ai/framework.json:managed`，upgrade 依此三态处理。
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildRenderMap, listPacks, loadPackById, skillExists } from './pack.mjs';
import {
  exists, isDir, isFile, readJsonSafe, writeJson, sha256, ensureDir, walk,
  normalizeRel, matchesAny, toPosix,
} from './fsx.mjs';
import { frameworkRoot, frameworkVersion, templatesDir, cliRoot, skillsDir } from './framework.mjs';
import { RenderError } from './render.mjs';

export const SCALE_NAME = { S: '轻量', M: '标准', L: '系统', XL: '平台' };

export const PACK_FRAMEWORK_META = '.ai/framework.json';

export function deriveProjectName(dir) {
  const base = path.basename(path.resolve(dir));
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'project';
}

export function titleCase(name) {
  return name.split(/[-_]/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

export function resolveVariables(pack, { dir, flags = {}, now = new Date() }) {
  const projectName = String(flags.name ?? deriveProjectName(dir));
  const vars = {
    projectName,
    projectTitle: titleCase(projectName),
    description: String(flags.description ?? '待填写：一句话说明项目做什么、给谁用'),
    owner: String(flags.owner ?? '@unknown'),
    srcDir: 'src',
    testsDir: 'tests',
    docsDir: 'docs',
    aiDir: '.ai',
    date: formatDate(now),
    frameworkVersion: frameworkVersion(),
    packId: pack.id,
    scaleLevel: pack.scaleLevel,
    scaleName: SCALE_NAME[pack.scaleLevel] ?? pack.scaleLevel,
    isGame: pack.category === 'game' ? 'true' : 'false',
    aiEntry: 'AGENTS.md',
  };

  const missing = [];
  const hasCommon = (key) => Object.prototype.hasOwnProperty.call(vars, key);
  for (const decl of pack.variables ?? []) {
    const fromFlag = flags[decl.key];
    let value;
    if (fromFlag !== undefined && fromFlag !== true) {
      value = String(fromFlag);
      if (decl.choices && !decl.choices.includes(value)) {
        missing.push(`--${decl.key} 的取值 "${value}" 不在允许范围：${decl.choices.join(', ')}`);
      }
    } else if (fromFlag === true) {
      value = 'true';
    } else if (decl.default !== undefined && decl.default !== null && decl.default !== '') {
      // pack 显式声明的默认值优先于 common 初值（例如 game-unity 把 srcDir 默认覆盖为 Assets/Scripts）
      value = decl.default;
    } else if (hasCommon(decl.key)) {
      value = vars[decl.key];
    } else {
      value = decl.default;
    }
    if (decl.required && (value === undefined || value === null || value === '')) {
      missing.push(`缺少必填变量 --${decl.key}（${decl.prompt}）`);
    }
    vars[decl.key] = value === undefined ? '' : value;
  }

  // 派生：若 pack 未声明 srcDir，允许 --src-dir 覆盖
  if (flags['src-dir']) vars.srcDir = String(flags['src-dir']);
  if (flags['tests-dir']) vars.testsDir = String(flags['tests-dir']);

  return { vars, errors: missing };
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function planScaffold(pack, opts = {}) {
  const { dir, flags = {}, now = new Date(), templates = templatesDir() } = opts;
  const { vars, errors } = resolveVariables(pack, { dir, flags, now });
  if (errors.length > 0) return { errors, vars, files: {}, dirs: [] };

  const { files } = buildRenderMap(pack, vars, { templates, strict: true });

  // pack.json 的 dirs 也要渲染
  const dirs = [];
  for (const raw of pack.dirs ?? []) {
    const rendered = raw
      .replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name) => String(vars[name] ?? ''))
      .split('/').filter(Boolean).join('/');
    if (rendered) dirs.push(rendered);
  }

  return { vars, files, dirs, errors: [] };
}

/**
 * 框架托管记录。
 *
 * 结构：`managed[relPath] = { hash, origin }`
 *  - `hash`   ：上次由框架写入的内容哈希（用于判断"框架文件是否被本地改过"）
 *  - `origin` ：`'framework'` 表示**这个文件是框架创建的**，可以重置/更新；
 *               `'legacy-adopted'` 表示历史上"内容恰好一致而被登记"，**框架不认领它**。
 *
 * 为什么要区分：真实事故里 `.gitignore` 因一次错误的 force 覆盖被写进 managed，
 * 之后 `init --force` 就认为"这是框架文件"，把那个错误状态一路还原下去，用户的文件再也回不来。
 * **只有"框架创建的文件"才允许被重置**，这是不可绕过的安全底线。
 */
export function readManaged(meta) {
  const raw = meta?.managed ?? {};
  const out = {};
  for (const [rel, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[rel] = { hash: value, origin: 'legacy-adopted' };
    else if (value && typeof value === 'object') {
      out[rel] = { hash: value.hash, origin: value.origin ?? 'legacy-adopted' };
    }
  }
  return out;
}

/** 该路径是否是"框架创建的文件"（允许被框架重置）。 */
export function isFrameworkOwned(entry) {
  return entry?.origin === 'framework';
}

/**
 * 生成项目文件。
 *
 * 写入前的安全判定（**关键**）：只有"框架创建的文件"才允许被覆盖或重置。
 *
 *  | 情况 | 行为 |
 *  |---|---|
 *  | 文件不存在 | 创建，登记 `origin: 'framework'` |
 *  | 存在且内容与本 pack 渲染结果一致，且**框架创建** | 登记为 framework（幂等） |
 *  | 存在且内容一致，但不是框架创建 | 只报告，不认领（`origin` 保持） |
 *  | 框架创建 + 本地未改动 | `--force` 时重置，否则跳过 |
 *  | 框架创建 + 本地已改动 | `--force` 时才重置 |
 *  | 从未由框架创建 | **一律不写，报告为 refused；`--force` 也不写** |
 *
 * 最后一条是安全底线。早期实现让 `init --force` 覆盖任何现存文件，三次误伤真实项目的
 * `.gitignore`（项目自有的 UE 忽略规则被模板版顶掉）。
 */
export function initProject(dir, opts = {}) {
  const {
    packId, flags = {}, force = false, dryRun = false, now = new Date(), quiet = false,
  } = opts;

  const pack = loadPackById(packId);
  if (!pack) {
    const packs = listPacks();
    const error = new RenderError(
      `未知模板包 "${packId}"。可用：${packs.map((p) => p.id).join(', ')}`,
    );
    return { ok: false, error: error.message, packs };
  }

  const plan = planScaffold(pack, { dir, flags, now });
  if (plan.errors.length > 0) return { ok: false, error: plan.errors.join('\n') };

  const target = path.resolve(dir);
  const metaPath = path.join(target, PACK_FRAMEWORK_META);
  const prevMeta = readJsonSafe(metaPath, null);
  const prevManaged = readManaged(prevMeta);

  const written = [];
  const skipped = [];
  const refused = [];   // 项目原有文件：框架拒绝触碰
  const created = [];   // 本次由框架新建的文件
  const managed = { ...prevManaged };

  for (const [rel, node] of Object.entries(plan.files)) {
    const abs = path.join(target, rel);
    const relPosix = normalizeRel(rel);
    const newHash = sha256(node.text);
    const prev = prevManaged[relPosix];
    const owned = isFrameworkOwned(prev);

    if (!isFile(abs)) {
      if (!dryRun) {
        ensureDir(path.dirname(abs));
        fs.writeFileSync(abs, node.text, 'utf8');
      }
      written.push(relPosix);
      created.push(relPosix);
      managed[relPosix] = { hash: newHash, origin: 'framework' };
      continue;
    }

    const currentHash = sha256(fs.readFileSync(abs, 'utf8'));
    if (currentHash === newHash) {
      written.push(relPosix);
      if (!prev) {
        // 内容恰好与框架版本一致，但框架从未创建它 → 报告但不认领
        refused.push(relPosix);
      }
      // 保持既有 origin 不变（owned 的仍是 framework，legacy 的仍不认领）
      continue;
    }
    if (owned) {
      if (force || currentHash === prev.hash) {
        // 框架文件：未改动则正常更新；已改动则仅 --force 重置
        if (!dryRun) fs.writeFileSync(abs, node.text, 'utf8');
        written.push(relPosix);
        managed[relPosix] = { hash: newHash, origin: 'framework' };
      } else {
        skipped.push(relPosix);
      }
      continue;
    }
    // 不是框架创建的文件 → 绝不写入
    refused.push(relPosix);
  }

  for (const rel of plan.dirs) {
    const abs = path.join(target, rel);
    if (isDir(abs)) continue;
    if (!dryRun) {
      ensureDir(abs);
      const keep = path.join(abs, '.gitkeep');
      if (!exists(keep) && fs.readdirSync(abs).length === 0) fs.writeFileSync(keep, '', 'utf8');
    }
    written.push(rel + '/');
  }

  // 框架工具链快照：让项目离线可用（.ai/bin/.ai/lib/.ai/ai-arch.mjs）
  const toolCopies = copyToolchain(target, { dryRun });
  written.push(...toolCopies.written);
  skipped.push(...toolCopies.skipped);

  // skills 复制（同样只碰框架自己的文件：已存在且内容不同的 skill 文件不覆盖）
  const skillCopies = copySkills(target, pack.skills ?? [], { dryRun, force: false });
  written.push(...skillCopies.written);
  skipped.push(...skillCopies.skipped);
  const missingSkills = (pack.skills ?? []).filter((id) => !skillExists(id));

  // 框架规范快照（离线可读）
  const docCopies = copySystemDocs(target, { dryRun });
  written.push(...docCopies.written);

  // 模板快照：让项目内也能运行 init/upgrade（它们需要 templates/）
  const templateCopies = copyTemplateSnapshot(target, { dryRun });
  written.push(...templateCopies.written);

  const meta = {
    schemaVersion: 1,
    frameworkVersion: frameworkVersion(),
    packId: pack.id,
    scaleLevel: pack.scaleLevel,
    variables: plan.vars,
    generatedAt: prevMeta?.generatedAt ?? now.toISOString(),
    managed,
    skills: pack.skills ?? [],
    protectedPatterns: pack.protectedPatterns ?? [],
    refusedNotManaged: refused.sort(),
  };
  if (!dryRun) writeJson(metaPath, meta);

  return {
    ok: true,
    pack,
    vars: plan.vars,
    dir: target,
    written: written.sort(),
    skipped: skipped.sort(),
    created: created.sort(),
    refused: refused.sort(),
    managedCount: Object.keys(managed).length,
    missingSkills,
    dryRun,
    pack_hint: {
      skills: pack.skills ?? [],
      compile: pack.compile ?? [],
    },
  };
}

export function copyToolchain(target, { dryRun = false } = {}) {
  const written = [];
  const skipped = [];
  const src = cliRoot();
  const base = path.join(target, '.ai');
  const mapping = [
    { from: path.join(src, 'ai-arch.mjs'), to: path.join(base, 'bin', 'ai-arch.mjs') },
    { from: path.join(src, 'lib'), to: path.join(base, 'lib') },
  ];
  for (const item of mapping) {
    if (!exists(item.from)) continue;
    for (const file of listFiles(item.from)) {
      const rel = normalizeRel(path.relative(item.from, file));
      const dest = isFile(item.from) ? item.to : path.join(item.to, rel);
      if (isFile(dest)) {
        if (fs.readFileSync(dest, 'utf8') === fs.readFileSync(file, 'utf8')) {
          skipped.push(normalizeRel(path.relative(target, dest)));
          continue;
        }
      }
      if (!dryRun) {
        ensureDir(path.dirname(dest));
        fs.writeFileSync(dest, fs.readFileSync(file));
      }
      written.push(normalizeRel(path.relative(target, dest)));
    }
  }
  return { written, skipped };
}

function listFiles(dirOrFile) {
  if (isFile(dirOrFile)) return [dirOrFile];
  const { files } = walk(dirOrFile, { ignore: ['node_modules/'] });
  return files.map((rel) => path.join(dirOrFile, rel));
}

export function copySkills(target, skillIds, { dryRun = false, force = false } = {}) {
  const written = [];
  const skipped = [];
  for (const id of skillIds) {
    const from = path.join(skillsDir(), id);
    if (!isDir(from)) continue;
    for (const file of listFiles(from)) {
      const rel = normalizeRel(path.relative(from, file));
      const dest = path.join(target, '.ai', 'skills', id, rel);
      if (isFile(dest) && !force) {
        skipped.push(normalizeRel(path.relative(target, dest)));
        continue;
      }
      if (!dryRun) {
        ensureDir(path.dirname(dest));
        fs.writeFileSync(dest, fs.readFileSync(file));
      }
      written.push(normalizeRel(path.relative(target, dest)));
    }
  }
  return { written, skipped };
}

export function copySystemDocs(target, { dryRun = false } = {}) {
  const written = [];
  const from = path.join(frameworkRoot(), 'docs', 'system');
  if (!isDir(from)) return { written };
  for (const file of listFiles(from)) {
    const rel = normalizeRel(path.relative(from, file));
    const dest = path.join(target, '.ai', 'framework', 'docs', rel);
    if (isFile(dest) && fs.readFileSync(dest, 'utf8') === fs.readFileSync(file, 'utf8')) continue;
    if (!dryRun) {
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, fs.readFileSync(file));
    }
    written.push(normalizeRel(path.relative(target, dest)));
  }
  return { written };
}

/**
 * 模板快照 → `<project>/.ai/framework/templates/`。
 * 目的：让项目内也能运行 `init` / `upgrade`（两者需要 templates/），并保留 archetype 的
 * `protectedPatterns` 语义。快照为**只读框架资产**：由 `upgrade` 覆盖，不作为项目内容修改。
 *
 * 与框架规范快照统一收在 `.ai/framework/` 下，便于"跳过框架快照"的统一判断（索引、摘要、文档链接检查）。
 */
export function copyTemplateSnapshot(target, { dryRun = false } = {}) {
  const written = [];
  const from = templatesDir();
  if (!isDir(from)) return { written };
  for (const file of listFiles(from)) {
    const rel = normalizeRel(path.relative(from, file));
    const dest = path.join(target, '.ai', 'framework', 'templates', rel);
    if (isFile(dest) && fs.readFileSync(dest, 'utf8') === fs.readFileSync(file, 'utf8')) continue;
    if (!dryRun) {
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, fs.readFileSync(file));
    }
    written.push(normalizeRel(path.relative(target, dest)));
  }
  return { written };
}

/**
 * `upgrade`：把项目里的框架托管文件同步到当前框架版本。
 *
 * 四态处理：
 *  1. 框架托管 + 本地未改动      → 覆盖为框架最新版
 *  2. 框架托管 + 本地已改动      → 保留并报告（`--force` 可强制覆盖）
 *  3. 框架托管但文件已被删除     → 报告（不恢复：可能是用户有意删除）
 *  4. **从未托管过的现存文件**   → 一律跳过并报告，`--force` 也不覆盖
 *
 * 第 4 条是安全底线：项目原有文件（例如自己的 `.gitignore`）绝不能被框架覆盖，
 * 否则等于销毁用户内容。要接管这类文件必须由用户显式删除后重跑 `init`。
 */
export function upgradeProject(projectRoot, opts = {}) {
  const { dryRun = true, force = false, now = new Date() } = opts;
  const metaPath = path.join(projectRoot, PACK_FRAMEWORK_META);
  if (!isFile(metaPath)) {
    return { ok: false, error: `未找到 ${PACK_FRAMEWORK_META}：该项目不是由本框架 init 生成的（或元数据被删除）。请先运行 init --refresh。` };
  }
  const meta = readJsonSafe(metaPath, {});
  const packId = meta.packId;
  const pack = loadPackById(packId);
  if (!pack) return { ok: false, error: `元数据里的模板包 "${packId}" 已不存在（框架可能已重命名）。` };

  const flags = {};
  for (const [k, v] of Object.entries(opts.flags ?? {})) flags[k] = v;
  const plan = planScaffold(pack, { dir: projectRoot, flags, now });
  if (plan.errors.length > 0) return { ok: false, error: plan.errors.join('\n') };

  const protectedPatterns = [...(meta.protectedPatterns ?? []), ...(pack.protectedPatterns ?? [])];
  const updated = [];
  const changedLocally = [];
  const created = [];
  const removed = [];
  const protectedFiles = [];
  const notManaged = [];

  const managed = readManaged(meta);
  const affected = new Set();

  for (const [rel, node] of Object.entries(plan.files)) {
    const abs = path.join(projectRoot, rel);
    const relPosix = normalizeRel(rel);
    const newHash = sha256(node.text);
    const entry = managed[relPosix];
    const oldHash = entry?.hash;
    const owned = isFrameworkOwned(entry);
    affected.add(relPosix);

    if (matchesAny(relPosix, protectedPatterns)) {
      protectedFiles.push(relPosix);
      continue;
    }
    if (!isFile(abs)) {
      // 文件已不在项目里：只有"框架创建过"的才可能是被用户删除，才报告 removed。
      // 从未托管的文件不存在 → 什么都没发生（绝不能据此创建！）
      if (owned) removed.push(relPosix);
      continue;
    }
    const currentHash = sha256(fs.readFileSync(abs, 'utf8'));
    if (currentHash === newHash) {
      // 内容已是框架版本：幂等。但**只有框架创建的文件**才更新托管记录：
      // 项目原有文件即使内容巧合一致，也不认领（否则下次就会把它当框架文件覆盖）。
      if (owned) managed[relPosix] = { hash: newHash, origin: 'framework' };
      continue;
    }
    // 非框架创建的文件：无论 --force 与否，upgrade 都不接管、不覆盖。
    // 覆盖它等于销毁用户内容（真实案例：UE 项目的 .gitignore 被模板版覆盖三次）。
    if (!owned) {
      notManaged.push(relPosix);
      continue;
    }
    if (currentHash !== oldHash) {
      // 框架创建但被本地改过：默认保留；--force 才覆盖（这是显式的破坏性要求）
      if (force) {
        if (!dryRun) fs.writeFileSync(abs, node.text, 'utf8');
        updated.push(relPosix);
        managed[relPosix] = { hash: newHash, origin: 'framework' };
      } else {
        changedLocally.push(relPosix);
      }
      continue;
    }
    if (!dryRun) fs.writeFileSync(abs, node.text, 'utf8');
    updated.push(relPosix);
    managed[relPosix] = { hash: newHash, origin: 'framework' };
  }

  for (const rel of Object.keys(managed)) {
    if (affected.has(rel)) continue;
    if (!isFile(path.join(projectRoot, rel))) removed.push(rel);
  }

  const toolCopies = copyToolchain(projectRoot, { dryRun });
  const skillCopies = copySkills(projectRoot, pack.skills ?? [], { dryRun, force: false });
  const docCopies = copySystemDocs(projectRoot, { dryRun });
  const templateCopies = copyTemplateSnapshot(projectRoot, { dryRun });

  if (!dryRun) {
    meta.frameworkVersion = frameworkVersion();
    meta.upgradedAt = now.toISOString();
    meta.managed = managed;
    writeJson(metaPath, meta);
  }

  return {
    ok: true,
    dryRun,
    fromVersion: meta.frameworkVersion,
    toVersion: frameworkVersion(),
    packId,
    updated: updated.sort(),
    created: created.sort(),
    changedLocally: changedLocally.sort(),
    notManaged: notManaged.sort(),
    removed: removed.sort(),
    protectedFiles: protectedFiles.sort(),
    toolchain: toolCopies.written.length,
    skills: skillCopies.written.length,
    frameworkDocs: docCopies.written.length,
    templateSnapshot: templateCopies.written.length,
  };
}

export function loadProjectMeta(projectRoot) {
  return readJsonSafe(path.join(projectRoot, PACK_FRAMEWORK_META), null);
}

export { exists, toPosix };
