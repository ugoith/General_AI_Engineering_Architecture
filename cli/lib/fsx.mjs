/**
 * 文件系统 / 路径 / 文本工具（零依赖，跨平台）。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_IGNORES = [
  '.git/',
  'node_modules/',
  '.ai/cache/',
  'dist/',
  'build/',
  'out/',
  'target/',
  'bin/',
  'obj/',
  'Library/',
  'Temp/',
  'Logs/',
  'Binaries/',
  'Intermediate/',
  'Saved/',
  'DerivedDataCache/',
  '.godot/',
  '.vs/',
  '.idea/',
  '.vscode/',
  '__pycache__/',
  '.venv/',
  'venv/',
  '.next/',
  '.nuxt/',
  'coverage/',
];

export const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tga', '.psd',
  '.mp3', '.ogg', '.wav', '.flac', '.mp4', '.mov', '.webm',
  '.zip', '.gz', '.7z', '.rar', '.jar', '.apk', '.aab',
  '.exe', '.dll', '.so', '.dylib', '.pdb', '.bin', '.dat', '.pak', '.uasset',
  '.umap', '.fbx', '.obj', '.blend', '.ttf', '.otf', '.woff', '.woff2',
  '.pdf', '.xlsx', '.docx', '.pptx', '.sqlite', '.db', '.class', '.o', '.a',
  '.lib', '.wasm', '.unitypackage', '.assetbundle', '.pck', '.res', '.pyc',
]);

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function normalizeRel(p) {
  return toPosix(p).replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 去掉 UTF-8 BOM。
 * Windows 工具（记事本、部分脚手架、PowerShell 的 Set-Content）会写出带 BOM 的 JSON，
 * 直接 JSON.parse 会抛错——而这类错误一旦被 catch 吞掉，就会表现为"某个信号静默消失"。
 */
export function stripBom(text) {
  return String(text).replace(/^\uFEFF/, '');
}

export function shortHash(hash, len = 10) {
  return String(hash ?? '').slice(0, len);
}

export function readJson(file) {
  return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
}

export function readJsonSafe(file, fallback = null) {
  try {
    return readJson(file);
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 判断文件是否可当作文本读取：扩展名表 + 前 8KB 是否含 NUL 字节。 */
export function isProbablyText(file) {
  const ext = path.extname(file).toLowerCase();
  if (BINARY_EXT.has(ext)) return false;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (let i = 0; i < read; i += 1) if (buf[i] === 0) return false;
    return true;
  } catch {
    return false;
  }
}

/** glob → RegExp：支持 **、*、?、{a,b}。 */
export function globToRegExp(pattern) {
  const pat = normalizeRel(pattern);
  let out = '';
  for (let i = 0; i < pat.length; i += 1) {
    const ch = pat[i];
    if (ch === '*') {
      if (pat[i + 1] === '*') {
        const after = pat[i + 2];
        if (after === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    if (ch === '{') {
      const close = pat.indexOf('}', i);
      if (close !== -1) {
        const options = pat.slice(i + 1, close).split(',');
        out += '(?:' + options.map(escapeRegExp).join('|') + ')';
        i = close;
        continue;
      }
    }
    out += escapeRegExp(ch);
  }
  return new RegExp('^' + out + '$');
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesAny(relPath, patterns = []) {
  const p = normalizeRel(relPath);
  return patterns.some((pattern) => matchesOne(p, pattern));
}

function matchesOne(p, pattern) {
  // 目录模式（以 / 结尾）：匹配该目录本身及其下所有内容。
  // 支持带通配符的目录，例如 `Plugins/*/Intermediate/`（UE 项目的 .gitignore 常见写法）。
  if (pattern.endsWith('/')) {
    const base = pattern.slice(0, -1);
    if (p === base || p.startsWith(base + '/')) return true;
    if (base.includes('*') || base.includes('{')) {
      const re = globToRegExp(base);
      if (re.test(p)) return true;
      // 逐级前缀匹配：只要路径中有一段完整落在该目录内，就视为被忽略
      const segments = p.split('/');
      for (let i = 1; i < segments.length; i += 1) {
        if (re.test(segments.slice(0, i).join('/'))) return true;
      }
    }
    return false;
  }
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3);
    return p === base || p.startsWith(base + '/');
  }
  if (!pattern.includes('*') && !pattern.includes('{')) {
    return p === normalizeRel(pattern);
  }
  return globToRegExp(pattern).test(p);
}

/**
 * 读取 .gitignore，转成与 matchesAny 兼容的模式列表。
 *
 * 覆盖的语法：
 *  - `name`          → 匹配任意层级下的该名字，也匹配目录（等价 `**\/name`）
 *  - `/name` 或 `name/` → 锚定到仓库根
 *  - `dir/*`         → **等价于忽略整个 dir 目录**（git 语义：dir 内不允许重新包含）
 *                      这一条很关键：UE 的 `.gitignore` 写的是 `Binaries/*`、`Intermediate/*`，
 *                      若不按此处理，`Plugins/*​/Intermediate/...` 里的 UHT 生成代码会被误索引。
 *  - `a/**`、`*.ext`、`**\/name` 等交给 globToRegExp
 *  - 以 `!` 开头的否定规则：本实现不处理（保守做法，宁多索引不少索引）
 */
export function readGitignore(root) {
  const file = path.join(root, '.gitignore');
  if (!isFile(file)) return [];
  const patterns = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('!')) continue; // 否定规则不支持：保守处理

    const anchored = trimmed.startsWith('/');
    let p = normalizeRel(trimmed.replace(/^\//, ''));
    if (!p) continue;

    // `dir/*`、`a/*/b/*` → 整个末级目录（git 语义：目录内不允许重新包含）
    // 这一条覆盖 UE 的 `Binaries/*`、`Plugins/*/Intermediate/*` 等写法。
    if (p.endsWith('/*')) {
      const dir = p.slice(0, -2);
      const variants = [dir + '/'];
      if (!anchored) variants.push('**/' + dir + '/');
      patterns.push(...variants);
      continue;
    }
    // `dir/**` → 整个 dir 目录
    if (p.endsWith('/**')) {
      const dir = p.slice(0, -3);
      const variants = [dir + '/'];
      if (!anchored) variants.push('**/' + dir + '/');
      patterns.push(...variants);
      continue;
    }
    // 显式目录 `dir/`
    if (p.endsWith('/')) {
      patterns.push(p);
      if (!anchored) patterns.push('**/' + p);
      continue;
    }
    if (p.includes('*') || p.includes('{')) {
      patterns.push(p);
      if (!anchored) patterns.push('**/' + p);
      continue;
    }
    // 裸名字：任意层级、文件或目录
    patterns.push(p, '**/' + p, p + '/', '**/' + p + '/');
  }
  return patterns;
}

/**
 * 目录树遍历。返回相对 root 的 posix 路径。
 * @param {string} root
 * @param {{ignore?: string[], includeDotFiles?: boolean, maxFiles?: number}} [opts]
 */
export function walk(root, opts = {}) {
  const { ignore = [], includeDotFiles = true, maxFiles = 200000 } = opts;
  const all = [...DEFAULT_IGNORES, ...ignore];
  const files = [];
  const dirs = [];

  const visit = (dir) => {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const abs = path.join(dir, entry.name);
      const rel = normalizeRel(path.relative(root, abs));
      if (matchesAny(rel, all)) continue;
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        dirs.push(rel);
        visit(abs);
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      if (!includeDotFiles && entry.name.startsWith('.')) continue;
      files.push(rel);
    }
  };

  visit(root);
  return { files, dirs };
}

export function languageOf(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
    '.py': 'python', '.cs': 'csharp', '.cpp': 'cpp', '.cc': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
    '.c': 'c', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
    '.gd': 'gdscript', '.lua': 'lua', '.rb': 'ruby', '.php': 'php', '.sh': 'shell', '.ps1': 'powershell',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.md': 'markdown',
    '.html': 'html', '.css': 'css', '.scss': 'scss', '.sql': 'sql', '.shader': 'shader',
    '.hlsl': 'hlsl', '.glsl': 'glsl', '.uxml': 'xml', '.xml': 'xml', '.tscn': 'godot-scene',
    '.tres': 'godot-resource', '.unity': 'unity-scene', '.prefab': 'unity-prefab',
  };
  return map[ext] ?? (ext ? ext.slice(1) : 'unknown');
}

export function countLines(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

export function relFrom(root, p) {
  return normalizeRel(path.relative(root, p));
}
