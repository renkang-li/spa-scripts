#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function collectJavaScriptFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        return;
      }
      files.push(...collectJavaScriptFiles(fullPath));
      return;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  });

  return files;
}

const files = collectJavaScriptFiles(ROOT);
let hasError = false;

files.forEach((filePath) => {
  const relativePath = path.relative(ROOT, filePath);
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    hasError = true;
    process.stderr.write(`\n[check] ${relativePath}\n`);
    process.stderr.write(result.stderr || result.stdout || 'syntax check failed\n');
  } else {
    process.stdout.write(`[check] ${relativePath}\n`);
  }
});

process.exit(hasError ? 1 : 0);
