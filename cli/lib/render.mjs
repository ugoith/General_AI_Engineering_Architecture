/**
 * 模板渲染引擎（零依赖）。
 *
 * 语法见 templates/_schema/pack.schema.md：
 *   {{var}}  {{#IF var}}...{{/IF}}  {{#UNLESS var}}...{{/UNLESS}}
 *   {{> SHARED:name}}  {{!-- 注释 --}}
 *
 * 硬规则：
 *  - 未声明的变量 → 抛错（并给出行号），绝不静默替换成空字符串。
 *  - 不支持表达式 / 比较 / 函数调用。
 *  - 路径同样参与渲染；条件为假的路径整条跳过；空路径段被丢弃。
 */

const TOKEN_RE = /\{\{(.*?)\}\}/gs;

export class RenderError extends Error {}

/** 取变量的"真值"语义：空串、false、0、null、undefined 均为假。 */
export function isTruthy(value) {
  if (value === undefined || value === null) return false;
  const s = String(value).trim();
  if (s === '') return false;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  return true;
}

function getVar(vars, name) {
  if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
  return undefined;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * 渲染一段文本。
 * @param {string} text
 * @param {Record<string, unknown>} vars
 * @param {{file?: string, strict?: boolean}} [opts] strict=false 时未知变量渲染为空（仅用于诊断）
 */
export function renderText(text, vars, opts = {}) {
  const { file = '<inline>', strict = true } = opts;
  const out = renderBlocks(text, vars, file, strict, 0);
  return substitute(out, vars, file, strict);
}

function renderBlocks(text, vars, file, strict, depth) {
  if (depth > 32) throw new RenderError(`${file}: 条件嵌套超过 32 层，疑似未闭合`);

  let out = '';
  let i = 0;
  let guard = 0;

  while (i < text.length) {
    guard += 1;
    if (guard > 200000) throw new RenderError(`${file}: 渲染循环超限，请检查模板`);

    const open = text.indexOf('{{', i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);

    const close = text.indexOf('}}', open);
    if (close === -1) throw new RenderError(`${file}:${lineOf(text, open)} 存在未闭合的 {{`);

    const token = text.slice(open + 2, close).trim();
    const afterOpen = close + 2;

    if (token.startsWith('!--')) {
      const end = text.indexOf('--}}', open);
      if (end === -1) throw new RenderError(`${file}:${lineOf(text, open)} 注释未闭合`);
      i = end + 4;
      continue;
    }

    if (token.startsWith('>')) {
      // 共享片段由调用方预先内联（renderTree 会处理），此处保留原样交给上层
      out += text.slice(open, afterOpen);
      i = afterOpen;
      continue;
    }

    if (token.startsWith('#IF ') || token.startsWith('#UNLESS ')) {
      const negated = token.startsWith('#UNLESS ');
      const name = token.slice(negated ? 8 : 4).trim();
      const endTag = negated ? '{{/UNLESS}}' : '{{/IF}}';
      const endIdx = findBlockEnd(text, afterOpen, negated ? 'UNLESS' : 'IF', file);
      const inner = text.slice(afterOpen, endIdx);
      const value = getVar(vars, name);
      if (strict && value === undefined) {
        throw new RenderError(
          `${file}:${lineOf(text, open)} 条件引用了未声明的变量 "${name}"`,
        );
      }
      const truthy = isTruthy(value);
      const keep = negated ? !truthy : truthy;
      if (keep) out += renderBlocks(inner, vars, file, strict, depth + 1);
      i = endIdx + endTag.length;
      continue;
    }

    if (token.startsWith('/IF') || token.startsWith('/UNLESS')) {
      throw new RenderError(
        `${file}:${lineOf(text, open)} 出现多余的 {{${token}}}（缺少对应的开始标签）`,
      );
    }

    // 普通变量，保留到 substitute 阶段统一处理
    out += text.slice(open, afterOpen);
    i = afterOpen;
  }

  return out;
}

function findBlockEnd(text, from, kind, file) {
  const openTag = kind === 'IF' ? '#IF ' : '#UNLESS ';
  const endTag = kind === 'IF' ? '{{/IF}}' : '{{/UNLESS}}';
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const next = text.indexOf('{{', i);
    if (next === -1) break;
    const close = text.indexOf('}}', next);
    if (close === -1) break;
    const token = text.slice(next + 2, close).trim();
    if (token.startsWith(openTag)) depth += 1;
    else if (token === endTag.slice(2, -2)) {
      if (depth === 0) return next;
      depth -= 1;
    }
    i = close + 2;
  }
  throw new RenderError(`${file}:${lineOf(text, from)} 条件块未闭合，缺少 ${endTag}`);
}

function substitute(text, vars, file, strict) {
  return text.replace(TOKEN_RE, (match, body) => {
    const token = body.trim();
    if (token.startsWith('>') || token.startsWith('#') || token.startsWith('/') || token.startsWith('!--')) {
      return match;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
      throw new RenderError(
        `${file}:${lineOf(text, text.indexOf(match))} 不支持的模板表达式 "${token}"（本引擎只支持简单变量）`,
      );
    }
    const value = getVar(vars, token);
    if (value === undefined) {
      if (strict) throw new RenderError(`${file}:${lineOf(text, text.indexOf(match))} 使用了未声明的变量 "${token}"`);
      return '';
    }
    return value === null ? '' : String(value);
  });
}

/** 收集文本中引用的所有变量名（用于校验与 pack 变量审计）。 */
export function collectVariables(text) {
  const found = new Set();
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[1].trim();
    if (token.startsWith('#IF ')) found.add(token.slice(4).trim());
    else if (token.startsWith('#UNLESS ')) found.add(token.slice(8).trim());
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) found.add(token);
  }
  return found;
}

/** 收集 {{> SHARED:name}} 引用。 */
export function collectSharedRefs(text) {
  const found = new Set();
  for (const match of text.matchAll(/\{\{>\s*SHARED:([A-Za-z0-9_-]+)\s*\}\}/g)) found.add(match[1]);
  return found;
}

/**
 * 组装文件内容：base 默认内容 + archetype 覆盖内容。
 *
 * **覆盖语义（重要）**：archetype 提供同名文件时**整份替换** base 的对应文件，不做任何拼接或合并。
 * 因此若某个 archetype 需要自定义 `AGENTS.md` 等由 base 提供的文件，它必须写出**完整可用**的内容
 * （包含自己需要的共享片段引用）；只写"增量/覆盖层"会导致 base 那部分内容静默消失。
 * 见 templates/_schema/pack.schema.md 的「层次叠加与覆盖语义」。
 */
export function composeFile(baseText, overrideText) {
  if (overrideText === undefined || overrideText === null) return baseText ?? '';
  return overrideText;
}

/** 段落级差异（仅用于 --diff 诊断，不参与渲染）。 */
export function diffSections(baseText, overrideText) {
  const headings = (t) => [...String(t ?? '').matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
  const base = new Set(headings(baseText));
  const over = new Set(headings(overrideText));
  return {
    lostFromBase: [...base].filter((h) => !over.has(h)),
    addedInOverride: [...over].filter((h) => !base.has(h)),
  };
}

/** 渲染路径：条件为假的段整段丢弃，空段丢弃，多余斜杠合并。 */
export function renderPath(relPath, vars, opts = {}) {
  const rendered = renderText(relPath, vars, { ...opts, file: opts.file ?? relPath });
  const collapsed = rendered
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '')
    .join('/');
  return collapsed;
}

/** 内联 {{> SHARED:x}}：片段不做变量替换（片段必须自洽）。 */
export function inlineShared(text, shared, file = '<inline>') {
  return text.replace(/\{\{>\s*SHARED:([A-Za-z0-9_-]+)\s*\}\}/g, (_m, name) => {
    if (!Object.prototype.hasOwnProperty.call(shared, name)) {
      throw new RenderError(`${file} 引用了不存在的共享片段 "${name}"`);
    }
    return shared[name];
  });
}
