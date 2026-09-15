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

export function shortHash(hash, len = 10) {
  return String(hash ?? '').slice(0, len);
}

export function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
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
  return patterns.some((pattern) => {
    if (pattern.endsWith('/')) return p === pattern.slice(0, -1) || p.startsWith(pattern);
    if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3);
      return p === base || p.startsWith(base + '/');
    }
    if (!pattern.includes('*') && !pattern.includes('{')) {
      return p === normalizeRel(pattern);
    }
    return globToRegExp(pattern).test(p);
  });
}

/** 读取 .gitignore，转成与 matchesAny 兼容的模式列表。 */
export function readGitignore(root) {
  const file = path.join(root, '.gitignore');
  if (!isFile(file)) return [];
  const patterns = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('!')) continue;
    let p = normalizeRel(trimmed.replace(/^\//, ''));
    if (!p.includes('/') && !p.includes('*')) {
      patterns.push(p, '**/' + p, p + '/');
      continue;
    }
    if (p.startsWith('**/')) {
      patterns.push(p.slice(3), p);
      continue;
    }
    patterns.push(p, '**/' + p);
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
