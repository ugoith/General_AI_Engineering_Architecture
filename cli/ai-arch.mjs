#!/usr/bin/env node
/**
 * ai-arch CLI 入口。
 *
 * 两种运行位置：
 *  1. 框架仓库内：node cli/ai-arch.mjs <命令>
 *  2. 项目内（推荐）：node .ai/bin/ai-arch.mjs <命令>
 *
 * 在项目内运行时，lib/ 位于 <项目根>/.ai/lib/，与框架仓库中 cli/lib 的位置对称。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const here = path.dirname(self);

// 框架仓库模式：<repo>/cli/ai-arch.mjs → lib 在 <repo>/cli/lib
// 项目模式    ：<root>/.ai/bin/ai-arch.mjs → lib 在 <root>/.ai/lib
const candidateLibDirs = [
  path.join(here, 'lib'),
  path.join(here, '..', 'lib'),
];
const libDir = candidateLibDirs.find((d) => {
  try {
    return fs.statSync(path.join(d, 'cli.mjs')).isFile();
  } catch {
    return false;
  }
});

if (!libDir) {
  process.stderr.write(
    '[ai-arch] 找不到内部模块目录。若你在项目里运行，请确认 .ai/lib/cli.mjs 存在；\n'
    + '          可用框架仓库的命令重新生成：node cli/ai-arch.mjs init --refresh\n',
  );
  process.exit(2);
}

const cli = await import(pathToFileURL(path.join(libDir, 'cli.mjs')).href);
process.exitCode = await cli.main(process.argv.slice(2));
