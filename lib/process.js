const { spawnSync } = require('child_process');

function normalizeOutput(text) {
  return typeof text === 'string' ? text.replace(/\s+$/, '') : '';
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf-8',
    input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdout = normalizeOutput(result.stdout);
  const stderr = normalizeOutput(result.stderr);
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();

  return {
    success: !result.error && result.status === 0,
    status: result.status,
    stdout,
    stderr,
    combined,
    error: result.error ? result.error.message : null,
  };
}

function commandExists(command, cwd) {
  return runProcess(command, ['--version'], { cwd }).success;
}

module.exports = {
  commandExists,
  runProcess,
};
