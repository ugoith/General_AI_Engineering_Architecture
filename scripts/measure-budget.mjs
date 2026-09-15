// 度量：生成项目的 L0+L1 固定成本与 AGENTS.md 行数（用于校准文档中的预算声明）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const lib = path.resolve('cli', 'lib');
const { main } = await import(pathToFileURL(path.join(lib, 'cli.mjs')).href);
const { loadIndex } = await import(pathToFileURL(path.join(lib, 'indexer.mjs')).href);
const { estimateTokens } = await import(pathToFileURL(path.join(lib, 'report.mjs')).href);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-'));
const capture = async (args) => {
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { out.push(String(c)); return true; };
  try { await main(args); } finally { process.stdout.write = orig; }
  return out.join('');
};

const packs = JSON.parse(await capture(['packs', '--json'])).map((p) => p.id);
console.log('pack'.padEnd(24), 'AGENTS行', 'AGENTS token', 'constitution行', 'constitution token');
for (const pack of packs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `b-${pack}-`));
  await capture(['init', dir, '--pack', pack]);
  const a = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const c = fs.readFileSync(path.join(dir, '.ai', 'constitution.md'), 'utf8');
  const lines = (t) => t.replace(/\r\n/g, '\n').split('\n').length;
  console.log(
    pack.padEnd(24),
    String(lines(a)).padStart(6),
    String(estimateTokens(a)).padStart(11),
    String(lines(c)).padStart(13),
    String(estimateTokens(c)).padStart(18),
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
fs.rmSync(root, { recursive: true, force: true });

// 索引侧规模（用于 docs 的说明）
const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'budget2-'));
await capture(['init', r2, '--pack', 'software-app-medium']);
await capture(['index', '--root', r2]);
const idx = loadIndex(r2);
const srcFiles = idx.files.filter((f) => !f.path.startsWith('.ai/'));
console.log('\n典型 M 级空项目索引：', idx.fileCount, '个文件；其中项目文件', srcFiles.length, '个；框架快照', idx.fileCount - srcFiles.length, '个');
fs.rmSync(r2, { recursive: true, force: true });
