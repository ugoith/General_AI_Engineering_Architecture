#!/usr/bin/env node
// {{projectName}} —— CLI 入口骨架（S 级：单文件、零运行时依赖）。
//
// 主语言选了 python 时：删除本文件，改为 src/main.py，保持同样的子命令与退出码约定，
// 并同步更新 README.md 与 .ai/constitution.md 的验证命令。
//
// 约定（必须与 README.md 的“退出码”一节一致，改动属于公开行为变更）：
//   0 = 成功 ｜ 1 = 运行时失败（可预期的业务错误）｜ 2 = 用法错误（参数缺失或非法）
import { argv, exit, stderr, stdout } from 'node:process';

const NAME = '{{projectName}}';
const VERSION = '0.0.1'; // 与 CHANGELOG.md 的最新版本保持一致

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const USAGE = `用法：${NAME} <command> [options]

命令：
  hello <name>      示例子命令：输出问候（实现真实业务时替换）
  --help, -h        显示本帮助
  --version, -v     显示版本

退出码：
  0  成功
  1  运行时失败（原因写到 stderr）
  2  用法错误
`;

/** 最简参数解析：够用即可，不要为此引入依赖。 */
function parse(args) {
  const flags = new Set();
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('-')) flags.add(arg);
    else positional.push(arg);
  }
  return { flags, positional };
}

/** 业务入口：把这里换成真实逻辑。返回进程退出码。 */
function run(command, positional) {
  switch (command) {
    case 'hello': {
      const name = positional[1];
      if (!name) {
        stderr.write(`缺少参数：name\n\n${USAGE}`);
        return EXIT_USAGE;
      }
      stdout.write(`hello, ${name}\n`);
      return EXIT_OK;
    }
    default:
      stderr.write(`未知命令：${command}\n\n${USAGE}`);
      return EXIT_USAGE;
  }
}

function main(args) {
  const { flags, positional } = parse(args);
  if (flags.has('--help') || flags.has('-h')) {
    stdout.write(USAGE);
    return EXIT_OK;
  }
  if (flags.has('--version') || flags.has('-v')) {
    stdout.write(`${NAME} ${VERSION}\n`);
    return EXIT_OK;
  }
  if (positional.length === 0) {
    stderr.write(USAGE);
    return EXIT_USAGE;
  }
  try {
    return run(positional[0], positional);
  } catch (error) {
    // 运行时失败必须给出一行可读原因，退出码固定为 1
    stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAIL;
  }
}

exit(main(argv.slice(2)));
