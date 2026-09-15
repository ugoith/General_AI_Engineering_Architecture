/**
 * 极简命令（零依赖）。
 *
 * @param {string} title 标题
 * @param {string[][]} rows 每行是若干列
 * @param {{align?: ('left'|'right')[]}} [opts]
 * @returns {string}
 */
export function table(title, rows, opts = {}) {
  const align = opts.align ?? [];
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = displayWidth(String(cell));
      widths[i] = Math.max(widths[i] ?? 0, len);
    });
  }
  const pad = (cell, i) => {
    const s = String(cell);
    const gap = (widths[i] ?? 0) - displayWidth(s);
    if (gap <= 0) return s;
    return align[i] === 'right' ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
  };
  const lines = [];
  if (title) lines.push(title);
  for (const row of rows) {
    lines.push('  ' + row.map(pad).join('  ').replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

/** CJK 字符按 2 列宽计算，保证终端对齐。 */
export function displayWidth(s) {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** 估算 token：ASCII 约 4 字符/token，CJK 约 0.6 token/字符。 */
export function estimateTokens(text) {
  let ascii = 0;
  let wide = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 128) ascii += 1;
    else if (isWide(cp)) wide += 1;
    else wide += 0.5;
  }
  return Math.ceil(ascii / 4 + wide * 0.6);
}

export function kb(bytes) {
  return (bytes / 1024).toFixed(1) + 'K';
}
