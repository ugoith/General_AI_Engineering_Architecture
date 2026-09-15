/**
 * 框架根定位（零依赖）。
 *
 * CLI 有两种运行位置：
 *  1. 框架仓库内：node cli/ai-arch.mjs ...        → 框架根 = 仓库根
 *  2. 用户项目内：node .ai/bin/ai-arch.mjs ...     → .ai/bin/ 内带一份框架快照
 * 两种情况下模板/schema/skills 都相对自身定位，因此 <cliRoot>/../ 永远可用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readJsonSafe } from './fsx.mjs';

export function cliRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** 框架资源根：包含 templates/ 与 schema/ 的目录。 */
export function frameworkRoot() {
  return path.resolve(cliRoot(), '..');
}

export function frameworkVersion() {
  const pkg = readJsonSafe(path.join(frameworkRoot(), 'package.json'), null);
  if (pkg?.version) return pkg.version;
  const local = readJsonSafe(path.join(cliRoot(), 'version.json'), null);
  return local?.version ?? '0.0.0';
}

export function templatesDir() {
  return path.join(frameworkRoot(), 'templates');
}

export function skillsDir() {
  return path.join(frameworkRoot(), 'skills');
}

export function schemaDir() {
  return path.join(frameworkRoot(), 'schema');
}

export function systemDocsDir() {
  return path.join(frameworkRoot(), 'docs', 'system');
}

/**
 * 项目侧框架资源根：`<project>/.ai/framework/`
 * 下面有两类**只读框架快照**（由 init/upgrade 维护，不属于项目内容）：
 *  - `docs/`      → 框架规范快照（离线可读）
 *  - `templates/` → 模板快照（让项目内也能运行 init / upgrade）
 * 索引、任务包摘要、文档链接检查都应跳过该目录（见 indexer 的 AI_INTERNAL_PREFIXES）。
 */
export const PROJECT_FRAMEWORK_DIR = '.ai/framework';

/** 判断某个目录是否是本框架仓库根。 */
export function isFrameworkRepo(dir) {
  return exists(path.join(dir, 'templates', 'base')) && exists(path.join(dir, 'cli', 'ai-arch.mjs'));
}

/** 向上查找框架仓库根（用于在子目录里执行命令）。 */
export function findFrameworkRepo(start = process.cwd()) {
  let dir = path.resolve(start);
  for (let i = 0; i < 40; i += 1) {
    if (isFrameworkRepo(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 判断某个目录是否是"被本框架初始化过的项目"（存在 .ai/index 或 .ai/constitution.md）。 */
export function isScaffoldedProject(dir) {
  return exists(path.join(dir, '.ai')) &&
    (exists(path.join(dir, '.ai', 'framework.json')) || exists(path.join(dir, '.ai', 'constitution.md')));
}

/** 向上查找被初始化过的项目根。 */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (let i = 0; i < 40; i += 1) {
    if (isScaffoldedProject(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function readProjectMeta(projectRoot) {
  return readJsonSafe(path.join(projectRoot, '.ai', 'framework.json'), null);
}

export function listFilesRecursive(dir, filter = () => true) {
  const out = [];
  if (!exists(dir)) return out;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (filter(abs)) out.push(abs);
    }
  };
  visit(dir);
  return out;
}
