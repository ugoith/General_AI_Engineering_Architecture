/**
 * 模板包（archetype pack）加载与渲染树组装。
 *
 * 目录契约见 templates/_schema/pack.schema.md。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  exists, isDir, isFile, readJson, walk, toPosix, normalizeRel, matchesAny,
} from './fsx.mjs';
import {
  RenderError, inlineShared, renderText, renderPath, collectVariables, collectSharedRefs,
} from './render.mjs';
import { templatesDir, skillsDir, listFilesRecursive } from './framework.mjs';

export const PACK_CATEGORIES = ['software', 'game', 'data', 'embedded', 'automation'];
export const SCALE_LEVELS = ['S', 'M', 'L', 'XL'];

export function loadPackById(packId, root = templatesDir()) {
  const dir = path.join(root, 'archetypes', packId);
  if (!isFile(path.join(dir, 'pack.json'))) return null;
  const pack = readJson(path.join(dir, 'pack.json'));
  return { ...pack, dir };
}

export function listPacks(root = templatesDir()) {
  const archDir = path.join(root, 'archetypes');
  if (!isDir(archDir)) return [];
  const packs = [];
  for (const entry of fs.readdirSync(archDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(archDir, entry.name, 'pack.json');
    if (!isFile(file)) continue;
    try {
      packs.push({ ...readJson(file), dir: path.join(archDir, entry.name) });
    } catch (error) {
      packs.push({ id: entry.name, dir: path.join(archDir, entry.name), __error: error.message });
    }
  }
  packs.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return packs;
}

export function loadShared(root = templatesDir()) {
  const dir = path.join(root, 'shared');
  const shared = {};
  for (const file of listFilesRecursive(dir, (f) => f.endsWith('.md'))) {
    const name = path.basename(file, '.md');
    shared[name] = fs.readFileSync(file, 'utf8');
  }
  return shared;
}

/** 项目侧 skills 复制：把框架 skills/<id>/ 复制进 <project>/.ai/skills/<id>/。 */
export function skillSourceDir(id, root = skillsDir()) {
  return path.join(root, id);
}

export function listAvailableSkills(root = skillsDir()) {
  if (!isDir(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isFile(path.join(root, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}

/**
 * 组装基础渲染节点：把某目录下所有文件读成 { relPath: { text } }。
 * 路径参与渲染，因此此处先记录原始相对路径。
 */
function readTree(dir, { skip = [] } = {}) {
  const nodes = {};
  if (!isDir(dir)) return nodes;
  const { files } = walk(dir, { ignore: skip });
  for (const rel of files) {
    const abs = path.join(dir, rel);
    nodes[rel] = { sourcePath: abs };
  }
  return nodes;
}

/**
 * 构建完整的渲染映射。
 *
 * @param {object} pack 已加载的 pack（含 dir）
 * @param {Record<string, unknown>} vars 渲染变量（common + pack-local）
 * @param {{templates?: string, extraSkip?: string[], strict?: boolean, log?: Function}} [opts]
 * @returns {{ files: Record<string, {text: string, origin: string}> }}
 */
export function buildRenderMap(pack, vars, opts = {}) {
  const root = opts.templates ?? templatesDir();
  const strict = opts.strict !== false;
  const shared = loadShared(root);
  const sharedDeclared = new Set(pack.shared ?? []);

  const layers = [];
  const baseDir = path.join(root, 'base');
  // base 与 archetype 的目录契约一致：<layer>/files/ → 项目根，<layer>/docs/ → 项目 docsDir
  if (isDir(path.join(baseDir, 'files'))) {
    layers.push({ name: 'base', dir: path.join(baseDir, 'files'), packLocalAllowed: false });
  }
  const baseDocsDir = path.join(baseDir, 'docs');
  const projectDocsDir = String(vars.docsDir ?? 'docs');
  if (isDir(baseDocsDir)) {
    layers.push({ name: 'base/docs', dir: baseDocsDir, packLocalAllowed: false, docsPrefix: projectDocsDir });
  }
  layers.push({ name: pack.id, dir: path.join(pack.dir, 'files'), packLocalAllowed: true, separate: true });

  const raw = {};
  for (const layer of layers) {
    if (layer.separate) continue;
    for (const [rel, node] of Object.entries(readTree(layer.dir, { skip: opts.extraSkip }))) {
      const key = layer.docsPrefix ? toPosix(path.join(layer.docsPrefix, rel)) : rel;
      raw[key] = { ...node, origin: layer.name, packLocalAllowed: layer.packLocalAllowed };
    }
  }

  // archetype: files/ → 项目根；docs/ → 项目 docsDir
  const filesDir = path.join(pack.dir, 'files');
  for (const [rel, node] of Object.entries(readTree(filesDir, { skip: opts.extraSkip }))) {
    raw[rel] = { ...node, origin: pack.id, packLocalAllowed: true };
  }
  const docsDir = path.join(pack.dir, 'docs');
  for (const [rel, node] of Object.entries(readTree(docsDir, { skip: opts.extraSkip }))) {
    raw[toPosix(path.join(projectDocsDir, rel))] = {
      ...node, origin: `${pack.id}/docs`, packLocalAllowed: true,
    };
  }

  const files = {};
  for (const [rel, node] of Object.entries(raw)) {
    let text = fs.readFileSync(node.sourcePath, 'utf8');
    let renderedPath;
    try {
      renderedPath = renderPath(rel, vars, { strict, file: rel });
    } catch (error) {
      throw new RenderError(`[${pack.id}] 路径渲染失败：${rel}\n  ${error.message}`);
    }
    if (!renderedPath) continue;
    if (sharedDeclared.size > 0) {
      for (const name of sharedDeclared) {
        text = text.replace(new RegExp(`\\{\\{>\\s*SHARED:${name}\\s*\\}\\}`, 'g'), `{{> SHARED:${name}}}`);
      }
    }
    try {
      text = inlineShared(text, shared, `${pack.id}:${rel}`);
      text = renderText(text, vars, { strict, file: `${pack.id}:${rel}` });
    } catch (error) {
      throw new RenderError(`[${pack.id}] 文件渲染失败：${rel}\n  ${error.message}`);
    }
    files[renderedPath] = { text, origin: node.origin, sourcePath: node.sourcePath };
  }

  return { files, shared };
}

/** 校验渲染结果中的变量使用情况（供 validate.mjs 做全量审计）。 */
export function auditPackVariables(pack, root = templatesDir(), extra = {}) {
  const declared = new Set((pack.variables ?? []).map((v) => v.key));
  const shared = loadShared(root);
  const issues = [];
  const details = [];

  const scan = (dir, label, { allowPackLocal }) => {
    for (const file of listFilesRecursive(dir)) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = normalizeRel(path.relative(root, file));
      for (const name of collectSharedRefs(text)) {
        if (!Object.prototype.hasOwnProperty.call(shared, name)) {
          issues.push(`${label}/${rel} 引用了不存在的共享片段 ${name}`);
        }
      }
      for (const name of collectVariables(text)) {
        details.push({ rel: `${label}/${rel}`, name, allowPackLocal });
        if (COMMON_VARIABLE_NAMES.has(name)) continue;
        if (allowPackLocal && declared.has(name)) continue;
        if (!allowPackLocal && declared.has(name)) {
          issues.push(`${label}/${rel} 使用了 pack-local 变量 ${name}；该层也只能使用 common 变量`);
          continue;
        }
        issues.push(`${label}/${rel} 使用了未声明的变量 ${name}`);
      }
    }
  };

  const baseDir = path.join(root, 'base');
  if (!extra.skipBase && isDir(baseDir)) {
    scan(baseDir, 'base', { allowPackLocal: false });
  }
  scan(path.join(pack.dir, 'files'), `${pack.id}/files`, { allowPackLocal: true });
  scan(path.join(pack.dir, 'docs'), `${pack.id}/docs`, { allowPackLocal: true });
  return { issues, details, declared: [...declared] };
}

/** common 变量名白名单（必须与 templates/_schema/variables.md 一致）。 */
export const COMMON_VARIABLE_NAMES = new Set([
  'projectName', 'projectTitle', 'description', 'owner', 'srcDir', 'testsDir',
  'docsDir', 'aiDir', 'date', 'frameworkVersion', 'packId', 'scaleLevel',
  'scaleName', 'isGame', 'aiEntry',
]);

export function skillExists(id) {
  return isFile(path.join(skillsDir(), id, 'SKILL.md'));
}

export function isProtected(relPath, patterns = []) {
  return matchesAny(relPath, patterns);
}

export { exists, isDir, isFile };
