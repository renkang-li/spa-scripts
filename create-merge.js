#!/usr/bin/env node

const { run } = require('./lib/commands/merge');

run(process.argv.slice(2)).catch((caughtError) => {
  console.error(caughtError.message);
  process.exit(1);
});
