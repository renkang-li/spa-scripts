const { spawn } = require('child_process');

function normalizeOutput(text) {
  return typeof text === 'string' ? text.replace(/\s+$/, '') : '';
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (payload) => {
      if (!settled) {
        settled = true;
        resolve(payload);
      }
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (spawnError) {
      settle({
        success: false,
        status: null,
        stdout: '',
        stderr: '',
        combined: '',
        error: spawnError.message,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let spawnFailure = null;

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    // spawn 失败（如命令不存在）时不一定会触发 close，两个事件都要兜底。
    child.on('error', (error) => {
      spawnFailure = error;
      settle({
        success: false,
        status: null,
        stdout: normalizeOutput(stdout),
        stderr: normalizeOutput(stderr),
        combined: '',
        error: error.message,
      });
    });

    child.on('close', (status) => {
      const normalizedStdout = normalizeOutput(stdout);
      const normalizedStderr = normalizeOutput(stderr);
      const combined = [normalizedStdout, normalizedStderr].filter(Boolean).join('\n').trim();

      settle({
        success: !spawnFailure && status === 0,
        status,
        stdout: normalizedStdout,
        stderr: normalizedStderr,
        combined,
        error: spawnFailure ? spawnFailure.message : null,
      });
    });

    child.stdin.on('error', () => {});
    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

async function commandExists(command, cwd) {
  const result = await runProcess(command, ['--version'], { cwd });
  return result.success;
}

module.exports = {
  commandExists,
  runProcess,
};
