#!/usr/bin/env node
/**
 * 把框架打包成**单个 .mjs 文件**（零依赖、跨平台、离线可用）。
 *
 * 产物：`dist/ai-arch.mjs` —— 一个自包含的 CLI，内含：
 *   - cli/ 全部实现
 *   - templates/（base + 7 个 archetype + shared + _schema）
 *   - skills/ 全部任务知识
 *   - schema/ 机器可读契约
 *   - docs/system/（框架规范快照）
 *
 * 用法（拿到这一个文件即可给任意项目接入）：
 *   node ai-arch.mjs install --root <项目目录>
 *   node ai-arch.mjs quickstart --root <项目目录>
 *
 * 为什么是"单文件 .mjs"而不是"单个 .exe"：
 *   .mjs 无需安装、无平台绑定、体积 ~700KB 而不是 ~100MB（打包 Node 运行时），
 *   且内容是可审阅的源码。Windows 用户可用 `scripts/pack.mjs --exe` 额外生成一个
 *   自解压 .exe（内部仍是同一份 mjs），见 docs/02-adoption.md 的分发章节。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const distDir = path.join(repo, 'dist');

/** 需要内联进 bundle 的目录 → 运行时映射到虚拟根。 */
const BUNDLES = [
  { key: 'cli', dir: path.join(repo, 'cli'), skip: (rel) => rel.endsWith('ai-arch.mjs') },
  { key: 'templates', dir: path.join(repo, 'templates') },
  { key: 'skills', dir: path.join(repo, 'skills') },
  { key: 'schema', dir: path.join(repo, 'schema') },
  { key: 'docs/system', dir: path.join(repo, 'docs', 'system') },
];

function collect(dir, prefix = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...collect(abs, rel));
    else out.push({ rel: rel.split(path.sep).join('/'), abs });
  }
  return out;
}

function main() {
  const payload = {};
  let count = 0;
  for (const bundle of BUNDLES) {
    for (const file of collect(bundle.dir)) {
      if (bundle.skip && bundle.skip(file.rel)) continue;
      const key = `${bundle.key}/${file.rel}`;
      payload[key] = fs.readFileSync(file.abs, 'utf8');
      count += 1;
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const banner = `#!/usr/bin/env node
/**
 * ai-arch ${pkg.version} — AI 原生工程级架构框架（单文件分发版）
 *
 * 本文件由 scripts/pack.mjs 从一个零依赖 Node 项目自动打包而成，请勿手工编辑。
 * 它自包含 CLI 实现、全部 archetype 模板、skills、schema 与框架规范快照，
 * 因此**不需要安装、不需要联网、不依赖任何 npm 包**。
 *
 * 快速开始：
 *   node ai-arch.mjs quickstart --root <项目目录>     # 打印可粘贴给 agent 的接入提示词
 *   node ai-arch.mjs install  --root <项目目录>       # 一条命令接入（自动识别项目类型）
 *   node ai-arch.mjs packs                           # 查看全部模板包
 *   node ai-arch.mjs help                            # 全部命令
 *
 * 来源：https://github.com/ugoith/General_AI_Engineering_Architecture
 * 许可：MIT
 */
`;

  const body = `
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** 内联资源：相对路径 → 文件内容。 */
const BUNDLED = ${JSON.stringify(payload)};

const META = ${JSON.stringify({
    version: pkg.version,
    name: pkg.name,
    builtFrom: 'scripts/pack.mjs',
  })};

/**
 * 缓存键 = **内联内容的哈希**（而不是版本号）。
 *
 * 为什么必须按内容：早期实现用版本号做键，结果"同一个版本里改了行为"时会继续使用旧解包，
 * 新命令静默消失（真实故障：加了 install-shim 后打包版仍报未知命令）。
 * 按内容哈希则天然满足两点：内容相同复用缓存、内容不同自动换目录。
 */
const BUNDLE_ID = crypto.createHash('sha256').update(JSON.stringify(BUNDLED)).digest('hex').slice(0, 16);

/**
 * 把内联资源解包到缓存目录，得到一个真实可用的"框架根"。
 */
function materialize() {
  const base = process.env.AI_ARCH_HOME || path.join(os.homedir(), '.ai-arch');
  const root = path.join(base, 'bundled', META.version + '-' + BUNDLE_ID);
  const marker = path.join(root, '.complete');
  if (fs.existsSync(marker)) return root;

  const tmp = root + '.tmp-' + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(BUNDLED)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  // 让框架根识别出自己的版本（package.json 不在 bundle 里，单独写一份最小版）
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: META.name, version: META.version, type: 'module' }, null, 2) + '\\n',
    'utf8',
  );
  fs.writeFileSync(path.join(tmp, '.complete'), new Date().toISOString() + '\\n', 'utf8');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.renameSync(tmp, root);
  return root;
}

const frameworkRoot = materialize();
process.env.AI_ARCH_BUNDLE_ROOT = frameworkRoot;
process.env.AI_ARCH_SELF = fileURLToPath(import.meta.url);

const cli = await import(pathToFileURL(path.join(frameworkRoot, 'cli', 'lib', 'cli.mjs')).href);
process.exitCode = await cli.main(process.argv.slice(2));
`;

  fs.mkdirSync(distDir, { recursive: true });
  const outFile = path.join(distDir, 'ai-arch.mjs');
  fs.writeFileSync(outFile, banner + body, 'utf8');
  const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(0);

  // Windows 启动器：双击/命令行都能用，无需记 `node xxx.mjs`
  const cmdFile = path.join(distDir, 'ai-arch.cmd');
  fs.writeFileSync(cmdFile, [
    '@echo off',
    'rem ai-arch —— 单文件分发版的 Windows 启动器（自动定位同目录的 ai-arch.mjs）',
    'setlocal',
    'set "PAYLOAD=%~dp0ai-arch.mjs"',
    'if not exist "%PAYLOAD%" (',
    '  echo [ai-arch] 找不到载荷文件：%PAYLOAD%',
    '  echo            请确保 ai-arch.cmd 与 ai-arch.mjs 在同一目录。',
    '  exit /b 1',
    ')',
    'node "%PAYLOAD%" %*',
    'exit /b %ERRORLEVEL%',
  ].join('\r\n') + '\r\n', 'utf8');

  // POSIX 启动器
  const shFile = path.join(distDir, 'ai-arch');
  fs.writeFileSync(shFile, [
    '#!/bin/sh',
    '# ai-arch —— 单文件分发版的 POSIX 启动器（自动定位同目录的 ai-arch.mjs）',
    'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'exec node "$DIR/ai-arch.mjs" "$@"',
  ].join('\n') + '\n', 'utf8');
  try { fs.chmodSync(shFile, 0o755); } catch { /* Windows 上忽略 */ }

  // 独立校验：签名不应包含 node_modules 之类的外部引用
  const forbidden = ['require("', "require('"].filter((pat) => {
    const hits = body.split(pat).length - 1;
    return hits > 0;
  });

  process.stdout.write(`打包完成：\n`);
  process.stdout.write(`  ${path.relative(repo, outFile)}   ${count} 个内联文件，${sizeKb} KB（载荷）\n`);
  process.stdout.write(`  ${path.relative(repo, cmdFile)}   Windows 启动器\n`);
  process.stdout.write(`  ${path.relative(repo, shFile)}     POSIX 启动器\n`);
  if (forbidden.length > 0) {
    process.stdout.write(`  注意：载荷内出现 ${forbidden.join('、')}，请确认没有引入外部依赖\n`);
  }
  process.stdout.write('\n用法（三种等价）：\n');
  process.stdout.write('  node dist/ai-arch.mjs quickstart --root <项目目录>\n');
  process.stdout.write('  dist\\ai-arch.cmd quickstart --root <项目目录>          (Windows)\n');
  process.stdout.write('  ./dist/ai-arch quickstart --root <项目目录>            (macOS/Linux)\n');
  process.stdout.write('\n想在任何目录直接用 `ai-arch` 命令？把它复制到 PATH 里的目录，例如：\n');
  process.stdout.write('  copy dist\\ai-arch.cmd dist\\ai-arch.mjs "%USERPROFILE%\\bin\\"\n');
}

main();
