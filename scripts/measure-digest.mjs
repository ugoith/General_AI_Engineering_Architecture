// 量化验证：摘要机制到底省多少 token（用于 README 的可验证数字）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const lib = path.resolve('cli', 'lib');
const { main } = await import(pathToFileURL(path.join(lib, 'cli.mjs')).href);
const { loadIndex } = await import(pathToFileURL(path.join(lib, 'indexer.mjs')).href);
const { estimateTokens } = await import(pathToFileURL(path.join(lib, 'report.mjs')).href);
const { estimateSourceCost } = await import(pathToFileURL(path.join(lib, 'taskpack.mjs')).href);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-'));
const capture = async (args) => {
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { out.push(String(c)); return true; };
  try { await main(args); } finally { process.stdout.write = orig; }
  return out.join('');
};

await capture(['init', root, '--pack', 'software-app-medium']);
await capture(['index', '--root', root]);

// 造一个"真实感"的源码文件：约 320 行 TypeScript
const srcDir = path.join(root, 'src', 'modules');
fs.mkdirSync(srcDir, { recursive: true });
const lines = [];
for (let i = 1; i <= 80; i += 1) {
  lines.push(`export function handler${i}(input: Request${i}): Response${i} {`);
  lines.push(`  const normalized = normalize${i}(input.payload ?? {});`);
  lines.push(`  return build${i}(normalized, { retries: 2, timeoutMs: 1500 });`);
  lines.push('}');
}
const bigFile = path.join(srcDir, 'orders.ts');
fs.writeFileSync(bigFile, lines.join('\n'), 'utf8');
await capture(['index', '--root', root]);

const idx = loadIndex(root);
const entry = idx.files.find((f) => f.path === 'src/modules/orders.ts');
const sourceCost = estimateSourceCost(entry);
const digestText = JSON.stringify({
  purpose: '订单模块的 HTTP 入口与归一化逻辑；被 api 层与事件消费者共同依赖。',
  exports: ['handler1', 'handler2'],
  invariants: ['payload 为 null 时必须走默认值分支', '不得在此层做持久化'],
});
const digestCost = estimateTokens(digestText);

console.log('文件：src/modules/orders.ts');
console.log('  行数            :', entry.loc);
console.log('  读整个源码 ≈    :', sourceCost, 'token');
console.log('  只读摘要 ≈      :', digestCost, 'token');
console.log('  倍率            :', (sourceCost / digestCost).toFixed(1) + 'x');

// 写入摘要后再看任务包估算
fs.writeFileSync(path.join(root, 'd.json'), JSON.stringify([{
  path: 'src/modules/orders.ts', reviewedHash: entry.hash,
  purpose: '订单模块的 HTTP 入口与归一化逻辑；被 api 层与事件消费者共同依赖。',
  exports: ['handler1', 'handler2'],
  invariants: ['payload 为 null 时必须走默认值分支', '不得在此层做持久化'],
  risk: 'medium', tags: ['orders'],
}]), 'utf8');
await capture(['index', '--root', root, '--apply', path.join(root, 'd.json')]);

const before = JSON.parse(await capture(['task', '--root', root, 'orders handler normalize', '--json', '--budget', '200000']));
console.log('\n任务包估算（含该文件）:', before.estimate.total, 'token');
console.log('该文件决策:', before.readList.filter((s) => s.path === 'src/modules/orders.ts').map((s) => `${s.decision} ≈${s.tokens}`).join(', '));

fs.rmSync(root, { recursive: true, force: true });
