const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { fork, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DEV_WORKSPACE_ROOT = path.resolve(SCRIPT_ROOT, '..');
const CURRENT_REPO_NAME = path.basename(SCRIPT_ROOT);

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const content = fs.readFileSync(getSettingsPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

function getWorkspaceRoot() {
  const settings = loadSettings();

  if (settings.workspaceRoot && fs.existsSync(settings.workspaceRoot)) {
    return settings.workspaceRoot;
  }

  if (process.env.SPA_ROOT_DIR && fs.existsSync(process.env.SPA_ROOT_DIR)) {
    return path.resolve(process.env.SPA_ROOT_DIR);
  }

  if (!app.isPackaged && fs.existsSync(DEFAULT_DEV_WORKSPACE_ROOT)) {
    return DEFAULT_DEV_WORKSPACE_ROOT;
  }

  return null;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 780,
    show: false,
    backgroundColor: '#f2ede4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.loadFile(path.join(__dirname, 'index.html'));
}

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*m/g, '');
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr || '').trim();
}

function findGlabPath() {
  const fromPath = runCommand('glab', ['--version'], SCRIPT_ROOT);
  if (fromPath) {
    return 'glab';
  }

  const possiblePaths = [
    path.join(process.env.LOCALAPPDATA || '', 'glab-1.22.0', 'bin', 'glab.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'glab', 'glab.exe'),
    'C:\\Program Files\\glab\\glab.exe',
  ];

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getProjectBranch(projectPath) {
  return runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], projectPath) || 'unknown';
}

function listProjects() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    return [];
  }

  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== CURRENT_REPO_NAME)
    .filter((name) => fs.existsSync(path.join(workspaceRoot, name, '.git')))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const projectPath = path.join(workspaceRoot, name);
      return {
        name,
        branch: getProjectBranch(projectPath),
      };
    });
}

function getEnvironmentSummary() {
  return {
    scriptRoot: SCRIPT_ROOT,
    workspaceRoot: getWorkspaceRoot(),
    tools: {
      git: runCommand('git', ['--version'], SCRIPT_ROOT),
      node: process.version,
      glab: findGlabPath(),
    },
    packaged: app.isPackaged,
  };
}

function getScriptCommand(payload) {
  const projectsArg = payload.projects.join(',');

  if (payload.type === 'branch') {
    const args = ['-p', projectsArg, '-y'];

    if (payload.stash) {
      args.push('--stash');
    }

    if (payload.force) {
      args.push('--force');
    }

    args.push(payload.branchName);
    return { script: 'create-branch.js', args };
  }

  if (payload.type === 'merge') {
    const args = [
      '-p',
      projectsArg,
      '-y',
      '--source',
      payload.sourceBranch,
      '--target',
      payload.targetBranch,
      '--title',
      payload.title,
      '--desc',
      payload.description ?? '',
    ];

    args.push(payload.draft ? '--draft' : '--no-draft');

    if (payload.commit) {
      args.push('--commit', '--commit-msg', payload.commitMessage || payload.title);
    }

    if (payload.push) {
      args.push('--push');
    }

    return { script: 'create-merge.js', args };
  }

  if (payload.type === 'version') {
    const args = ['-p', projectsArg, '-y'];

    if (payload.message) {
      args.push('--message', payload.message);
    }

    if (payload.push) {
      args.push('--push');
    }

    if (payload.dryRun) {
      args.push('--dry-run');
    }

    return { script: 'create-version.js', args };
  }

  throw new Error(`Unsupported action type: ${payload.type}`);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid request payload.');
  }

  if (!getWorkspaceRoot()) {
    throw new Error('Select a workspace folder first.');
  }

  if (!Array.isArray(payload.projects) || payload.projects.length === 0) {
    throw new Error('Select at least one project.');
  }

  if (payload.type === 'branch' && !String(payload.branchName || '').trim()) {
    throw new Error('Branch name is required.');
  }

  if (payload.type === 'merge') {
    if (!String(payload.sourceBranch || '').trim()) {
      throw new Error('Source branch is required.');
    }

    if (!String(payload.targetBranch || '').trim()) {
      throw new Error('Target branch is required.');
    }

    if (!String(payload.title || '').trim()) {
      throw new Error('MR title is required.');
    }
  }
}

function runScript(window, payload) {
  validatePayload(payload);

  const runId = `${payload.type}-${Date.now()}`;
  const command = getScriptCommand(payload);
  const scriptPath = path.join(SCRIPT_ROOT, command.script);
  const workspaceRoot = getWorkspaceRoot();
  const child = fork(scriptPath, command.args, {
    cwd: SCRIPT_ROOT,
    env: {
      ...process.env,
      SPA_ROOT_DIR: workspaceRoot,
    },
    silent: true,
    windowsHide: true,
  });

  return new Promise((resolve) => {
    let output = '';

    const sendLog = (stream, chunk) => {
      const text = stripAnsi(chunk.toString());
      output += text;
      window.webContents.send('script:log', { runId, stream, text });
    };

    window.webContents.send('script:log', {
      runId,
      stream: 'meta',
      text: `> ${command.script} ${command.args.join(' ')}\n`,
    });

    child.stdout.on('data', (chunk) => sendLog('stdout', chunk));
    child.stderr.on('data', (chunk) => sendLog('stderr', chunk));

    child.on('error', (error) => {
      const text = `${error.message}\n`;
      output += text;
      window.webContents.send('script:log', { runId, stream: 'stderr', text });
      resolve({
        runId,
        success: false,
        exitCode: null,
        output,
        error: error.message,
      });
    });

    child.on('close', (code) => {
      resolve({
        runId,
        success: code === 0,
        exitCode: code,
        output,
      });
    });
  });
}

async function chooseWorkspace(senderWindow) {
  const current = getWorkspaceRoot() || app.getPath('documents');
  const result = await dialog.showOpenDialog(senderWindow, {
    title: '选择工作区目录',
    defaultPath: current,
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return getEnvironmentSummary();
  }

  const settings = loadSettings();
  settings.workspaceRoot = result.filePaths[0];
  saveSettings(settings);
  return getEnvironmentSummary();
}

ipcMain.handle('environment:get', () => getEnvironmentSummary());
ipcMain.handle('workspace:choose', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return chooseWorkspace(window);
});
ipcMain.handle('projects:list', () => listProjects());
ipcMain.handle('scripts:run', (event, payload) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return runScript(window, payload);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
