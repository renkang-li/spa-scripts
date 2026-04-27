#!/usr/bin/env node

const branch = require('./lib/commands/branch');
const merge = require('./lib/commands/merge');
const version = require('./lib/commands/version');

const commands = {
  branch,
  merge,
  version,
};

function printHelp() {
  console.log(`
SPA Scripts CLI

用法:
  node cli.js <command> [options]

命令:
  branch    批量创建分支
  merge     批量创建 Merge Request
  version   批量创建 RC Tag

示例:
  node cli.js branch -a -b origin/master feature/checkout-funnel
  node cli.js merge -a --title "feat: checkout funnel"
  node cli.js version -p "spa-shop,spa-store" --dry-run
`);
}

async function main(argv = process.argv.slice(2)) {
  const [commandName, ...rest] = argv;

  if (!commandName || commandName === '-h' || commandName === '--help') {
    printHelp();
    return;
  }

  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  await command.run(rest);
}

main().catch((caughtError) => {
  console.error(caughtError.message);
  process.exitCode = 1;
});
