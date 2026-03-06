const state = {
  projects: [],
  filter: '',
  activeTab: 'branch',
  running: false,
  currentRunId: null,
  selected: new Set(),
};

const elements = {};

document.addEventListener('DOMContentLoaded', async () => {
  bindElements();
  bindEvents();
  bindLogStream();
  await loadEnvironment();
  await refreshProjects();
  syncControls();
});

function bindElements() {
  elements.projectList = document.getElementById('project-list');
  elements.projectSearch = document.getElementById('project-search');
  elements.projectSummary = document.getElementById('project-summary');
  elements.runStatus = document.getElementById('run-status');
  elements.workspacePath = document.getElementById('workspace-path');
  elements.dependencyStatus = document.getElementById('dependency-status');
  elements.logOutput = document.getElementById('log-output');
  elements.tabButtons = [...document.querySelectorAll('.tab-button')];
  elements.tabPanels = [...document.querySelectorAll('.tab-panel')];

  elements.branchName = document.getElementById('branch-name');
  elements.branchStash = document.getElementById('branch-stash');
  elements.branchForce = document.getElementById('branch-force');

  elements.mergeSource = document.getElementById('merge-source');
  elements.mergeTarget = document.getElementById('merge-target');
  elements.mergeTitle = document.getElementById('merge-title');
  elements.mergeDescription = document.getElementById('merge-description');
  elements.mergeCommit = document.getElementById('merge-commit');
  elements.mergePush = document.getElementById('merge-push');
  elements.mergeDraft = document.getElementById('merge-draft');
  elements.mergeCommitMessage = document.getElementById('merge-commit-message');

  elements.versionMessage = document.getElementById('version-message');
  elements.versionPush = document.getElementById('version-push');
  elements.versionDryRun = document.getElementById('version-dry-run');
}

function bindEvents() {
  document.getElementById('refresh-projects').addEventListener('click', refreshProjects);
  document.getElementById('choose-workspace').addEventListener('click', chooseWorkspace);
  document.getElementById('select-all-projects').addEventListener('click', selectVisibleProjects);
  document.getElementById('clear-projects').addEventListener('click', clearSelection);
  document.getElementById('clear-log').addEventListener('click', clearLog);

  elements.projectSearch.addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    renderProjects();
  });

  elements.mergeCommit.addEventListener('change', syncControls);
  elements.versionDryRun.addEventListener('change', syncControls);

  document.getElementById('run-branch').addEventListener('click', () => runAction('branch'));
  document.getElementById('run-merge').addEventListener('click', () => runAction('merge'));
  document.getElementById('run-version').addEventListener('click', () => runAction('version'));

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });
}

function bindLogStream() {
  window.desktopApi.onScriptLog((entry) => {
    if (state.currentRunId && entry.runId !== state.currentRunId) {
      return;
    }

    appendLog(entry.text, entry.stream);
  });
}

async function loadEnvironment() {
  const environment = await window.desktopApi.getEnvironment();
  elements.workspacePath.textContent = environment.workspaceRoot || '未配置，请先选择包含 Git 仓库的目录。';
  renderDependencies(environment.tools);
}

function renderDependencies(tools) {
  const items = [
    { label: 'Node', value: tools.node || 'Unavailable', ok: Boolean(tools.node) },
    { label: 'Git', value: tools.git || 'Unavailable', ok: Boolean(tools.git) },
    { label: 'glab', value: tools.glab || 'Unavailable', ok: Boolean(tools.glab) },
  ];

  elements.dependencyStatus.innerHTML = items.map((item) => (
    `<div class="dependency-item ${item.ok ? 'ok' : 'warn'}">
      <span>${item.label}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>`
  )).join('');
}

async function refreshProjects() {
  setStatus('Running refresh...');
  const previousSelection = new Set(state.selected);
  const projects = await window.desktopApi.listProjects();

  state.projects = projects;
  state.selected = new Set(
    projects
      .map((project) => project.name)
      .filter((name) => previousSelection.has(name))
  );

  renderProjects();
  setStatus('Idle');
}

async function chooseWorkspace() {
  setStatus('Selecting workspace...');
  await window.desktopApi.chooseWorkspace();
  await loadEnvironment();
  await refreshProjects();
}

function renderProjects() {
  const visibleProjects = getVisibleProjects();

  if (visibleProjects.length === 0) {
    elements.projectList.innerHTML = '<p class="empty-state">没有匹配的项目。</p>';
  } else {
    elements.projectList.innerHTML = visibleProjects.map((project) => `
      <label class="project-item">
        <input type="checkbox" data-project="${escapeHtml(project.name)}" ${state.selected.has(project.name) ? 'checked' : ''}>
        <span class="project-name">${escapeHtml(project.name)}</span>
        <span class="project-branch">${escapeHtml(project.branch)}</span>
      </label>
    `).join('');

    elements.projectList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const projectName = event.target.dataset.project;
        if (event.target.checked) {
          state.selected.add(projectName);
        } else {
          state.selected.delete(projectName);
        }
        updateProjectSummary();
      });
    });
  }

  updateProjectSummary();
}

function updateProjectSummary() {
  const total = state.projects.length;
  const visible = getVisibleProjects().length;
  const selected = state.selected.size;
  elements.projectSummary.textContent = `已选 ${selected} / ${total} 个项目，当前可见 ${visible} 个。`;
}

function getVisibleProjects() {
  if (!state.filter) {
    return state.projects;
  }

  return state.projects.filter((project) => project.name.toLowerCase().includes(state.filter));
}

function selectVisibleProjects() {
  getVisibleProjects().forEach((project) => state.selected.add(project.name));
  renderProjects();
}

function clearSelection() {
  state.selected.clear();
  renderProjects();
}

function switchTab(tabName) {
  state.activeTab = tabName;
  elements.tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
}

function syncControls() {
  elements.mergeCommitMessage.disabled = !elements.mergeCommit.checked;

  if (elements.versionDryRun.checked) {
    elements.versionPush.checked = false;
    elements.versionPush.disabled = true;
  } else {
    elements.versionPush.disabled = false;
  }
}

function buildPayload(type) {
  const projects = [...state.selected];

  if (type === 'branch') {
    return {
      type,
      projects,
      branchName: elements.branchName.value.trim(),
      stash: elements.branchStash.checked,
      force: elements.branchForce.checked,
    };
  }

  if (type === 'merge') {
    return {
      type,
      projects,
      sourceBranch: elements.mergeSource.value.trim(),
      targetBranch: elements.mergeTarget.value.trim(),
      title: elements.mergeTitle.value.trim(),
      description: elements.mergeDescription.value,
      draft: elements.mergeDraft.checked,
      commit: elements.mergeCommit.checked,
      commitMessage: elements.mergeCommitMessage.value.trim(),
      push: elements.mergePush.checked,
    };
  }

  return {
    type,
    projects,
    message: elements.versionMessage.value.trim(),
    push: elements.versionPush.checked,
    dryRun: elements.versionDryRun.checked,
  };
}

async function runAction(type) {
  if (state.running) {
    return;
  }

  const payload = buildPayload(type);

  if (payload.projects.length === 0) {
    setStatus('Select projects first', true);
    appendLog('Select at least one project before running.\n', 'stderr');
    return;
  }

  clearLog();
  state.running = true;
  setStatus(`Running ${type}...`);

  try {
    const result = await window.desktopApi.runScript(payload);
    state.currentRunId = result.runId;
    setStatus(result.success ? `Finished: ${result.exitCode}` : `Failed: ${result.exitCode ?? 'error'}`, !result.success);
    appendLog(`\nProcess finished with exit code ${result.exitCode ?? 'error'}.\n`, result.success ? 'meta' : 'stderr');
  } catch (error) {
    setStatus('Request failed', true);
    appendLog(`${error.message}\n`, 'stderr');
  } finally {
    state.running = false;
  }
}

function clearLog() {
  elements.logOutput.textContent = '';
  state.currentRunId = null;
}

function appendLog(text, stream) {
  if (!text) {
    return;
  }

  const prefixMap = {
    stderr: '[stderr] ',
    meta: '[cmd] ',
  };
  const prefix = prefixMap[stream] || '';
  elements.logOutput.textContent += prefix ? `${prefix}${text}` : text;
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

function setStatus(text, isError = false) {
  elements.runStatus.textContent = text;
  elements.runStatus.classList.toggle('error', isError);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
