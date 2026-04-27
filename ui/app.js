const state = {
  projects: [],
  filter: '',
  selected: new Set(),
  activeTab: 'branch',
};

const elements = {};

document.addEventListener('DOMContentLoaded', async () => {
  bindElements();
  bindEvents();
  await Promise.all([loadEnvironment(), refreshProjects()]);
});

function bindElements() {
  elements.workspaceRoot = document.getElementById('workspace-root');
  elements.glabStatus = document.getElementById('glab-status');
  elements.projectSearch = document.getElementById('project-search');
  elements.projectSummary = document.getElementById('project-summary');
  elements.projectList = document.getElementById('project-list');
  elements.output = document.getElementById('output');
  elements.tabButtons = [...document.querySelectorAll('.tab-button')];
  elements.tabPanels = [...document.querySelectorAll('.tab-panel')];

  elements.branchName = document.getElementById('branch-name');
  elements.branchBase = document.getElementById('branch-base');
  elements.branchFetch = document.getElementById('branch-fetch');

  elements.mergeSource = document.getElementById('merge-source');
  elements.mergeTarget = document.getElementById('merge-target');
  elements.mergeTitle = document.getElementById('merge-title');
  elements.mergeDesc = document.getElementById('merge-desc');
  elements.mergeDraft = document.getElementById('merge-draft');
  elements.mergePush = document.getElementById('merge-push');
  elements.mergeCommit = document.getElementById('merge-commit');
  elements.mergeCommitMsg = document.getElementById('merge-commit-msg');

  elements.versionMessage = document.getElementById('version-message');
  elements.versionPush = document.getElementById('version-push');
  elements.versionDryRun = document.getElementById('version-dry-run');
}

function bindEvents() {
  document.getElementById('refresh-projects').addEventListener('click', refreshProjects);
  document.getElementById('select-visible').addEventListener('click', selectVisibleProjects);
  document.getElementById('clear-selection').addEventListener('click', clearSelection);
  document.getElementById('clear-output').addEventListener('click', clearOutput);
  document.getElementById('plan-action').addEventListener('click', () => runAction('plan'));
  document.getElementById('run-action').addEventListener('click', () => runAction('run'));

  elements.projectSearch.addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    renderProjects();
  });

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

async function loadEnvironment() {
  const environment = await api('/api/environment');
  elements.workspaceRoot.textContent = environment.workspaceRoot || '未配置';
  elements.glabStatus.textContent = environment.glabAvailable ? 'Ready' : 'Missing';
}

async function refreshProjects() {
  const payload = await api('/api/projects');
  const previousSelection = new Set(state.selected);
  state.projects = payload.projects;
  state.selected = new Set(
    payload.projects.map((project) => project.name).filter((name) => previousSelection.has(name))
  );
  renderProjects();
}

function renderProjects() {
  const visibleProjects = getVisibleProjects();
  elements.projectSummary.textContent = `已选 ${state.selected.size} / ${state.projects.length} 个项目，可见 ${visibleProjects.length} 个。`;

  if (visibleProjects.length === 0) {
    elements.projectList.innerHTML = '<p class="empty-state">没有匹配的项目。</p>';
    return;
  }

  elements.projectList.innerHTML = visibleProjects.map((project) => `
    <label class="project-item">
      <div class="project-head">
        <div class="project-title-row">
          <input type="checkbox" data-project="${escapeHtml(project.name)}" ${state.selected.has(project.name) ? 'checked' : ''}>
          <span class="project-name">${escapeHtml(project.name)}</span>
        </div>
        <span class="chip ${project.dirty ? 'dirty' : 'clean'}">${project.dirty ? 'dirty' : 'clean'}</span>
      </div>
      <div class="project-branch">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"></path>
        </svg>
        <span class="mono">${escapeHtml(project.currentBranch)}</span>
      </div>
      ${project.dirtyEntries.length ? `<div class="project-dirty-files mono">${escapeHtml(project.dirtyEntries.join(' · '))}</div>` : ''}
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
      elements.projectSummary.textContent = `已选 ${state.selected.size} / ${state.projects.length} 个项目，可见 ${visibleProjects.length} 个。`;
    });
  });
}

function getVisibleProjects() {
  if (!state.filter) {
    return state.projects;
  }

  return state.projects.filter((project) => (
    project.name.toLowerCase().includes(state.filter)
    || project.repoPath.toLowerCase().includes(state.filter)
  ));
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

function buildPayload() {
  const projects = [...state.selected];

  if (state.activeTab === 'branch') {
    return {
      projects,
      branchName: elements.branchName.value.trim(),
      base: elements.branchBase.value.trim() || 'origin/master',
      fetch: elements.branchFetch.checked,
    };
  }

  if (state.activeTab === 'merge') {
    return {
      projects,
      source: elements.mergeSource.value.trim() || '@current',
      target: elements.mergeTarget.value.trim() || 'master',
      title: elements.mergeTitle.value.trim(),
      desc: elements.mergeDesc.value,
      draft: elements.mergeDraft.checked,
      push: elements.mergePush.checked,
      commit: elements.mergeCommit.checked,
      commitMsg: elements.mergeCommitMsg.value.trim(),
    };
  }

  return {
    projects,
    message: elements.versionMessage.value.trim(),
    push: elements.versionPush.checked,
    dryRun: elements.versionDryRun.checked,
  };
}

async function runAction(mode) {
  clearOutput();

  if (state.selected.size === 0) {
    renderMessage('error', '请先选择至少一个项目。');
    return;
  }

  const payload = buildPayload();
  const endpoint = `/api/${state.activeTab}/${mode}`;

  try {
    const response = await api(endpoint, {
      method: 'POST',
      body: payload,
    });
    renderBatch(state.activeTab, mode, response.batch);
    await refreshProjects();
  } catch (error) {
    renderMessage('error', error.message);
  }
}

function renderBatch(tab, mode, batch) {
  if (tab === 'branch') {
    renderBranchBatch(mode, batch);
    return;
  }

  if (tab === 'merge') {
    renderMergeBatch(mode, batch);
    return;
  }

  renderVersionBatch(mode, batch);
}

function renderBranchBatch(mode, batch) {
  if (batch.blocked) {
    renderMessage('warn', '检测到未提交更改，本次批量建分支会整批停止。');
  } else {
    renderMessage('success', mode === 'plan' ? '分支计划已生成。' : '分支操作已执行。');
  }

  appendCard('批量建分支', `
    ${batch.dirtyProjects.length ? `
      <div class="status-banner warn">
        <strong>阻塞项目：</strong>
        <div class="mono">${escapeHtml(batch.dirtyProjects.map((item) => `${item.project} [${item.currentBranch}]`).join(' · '))}</div>
      </div>
    ` : ''}
    ${renderTable([
      '项目', '当前分支', '基线', '动作', '详情'
    ], batch.plans.map((plan) => [
      escapeHtml(plan.project),
      `<span class="mono">${escapeHtml(plan.currentBranch)}</span>`,
      `<span class="mono">${escapeHtml(plan.baseRef || '(无需新建)')}</span>`,
      renderStatus(plan.error ? 'error' : (plan.dirty ? 'warn' : 'info'), escapeHtml(plan.description)),
      escapeHtml(plan.error || plan.fetchError || (plan.dirtyEntries || []).join(' · ') || '')
    ]))}
    ${batch.results && batch.results.length ? `
      <div class="output-card">
        <strong>执行汇总</strong>
        <div class="mono">成功 ${batch.summary.successCount} · 实际切换/创建 ${batch.summary.changedCount} · 失败 ${batch.summary.failCount}</div>
      </div>
      ${renderTable([
        '项目', '结果', '详情'
      ], batch.results.map((result) => [
        escapeHtml(result.project),
        renderStatus(result.success ? 'info' : 'error', result.success ? (result.simulated ? '预览' : (result.changed ? '成功' : '无需变更')) : '失败'),
        escapeHtml(result.detail)
      ]))}
    ` : ''}
  `);
}

function renderMergeBatch(mode, batch) {
  renderMessage(batch.glabAvailable ? 'success' : 'error', batch.glabAvailable
    ? (mode === 'plan' ? 'MR 计划已生成。' : 'MR 操作已执行。')
    : '当前环境没有可用的 glab。');

  appendCard('批量创建 MR', `
    ${renderTable([
      '项目', '仓库', '源分支', '工作区', '状态'
    ], batch.plans.map((plan) => [
      escapeHtml(plan.project),
      `<span class="mono">${escapeHtml(plan.repoPath)}</span>`,
      `<span class="mono">${escapeHtml(plan.sourceBranch || '(无法解析)')}</span>`,
      renderStatus(plan.dirty ? 'warn' : 'info', plan.dirty ? 'dirty' : 'clean'),
      renderStatus(plan.error ? 'error' : 'info', escapeHtml(plan.error || '可执行'))
    ]))}
    ${batch.results && batch.results.length ? `
      <div class="output-card">
        <strong>执行汇总</strong>
        <div class="mono">成功 ${batch.summary.successCount} · 跳过 ${batch.summary.skippedCount} · 失败 ${batch.summary.failCount}</div>
      </div>
      ${renderTable([
        '项目', '结果', '详情'
      ], batch.results.map((result) => [
        escapeHtml(result.project),
        renderStatus(result.success ? 'info' : 'error', result.success ? (result.skipped ? '已跳过' : '成功') : '失败'),
        result.url ? `<a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">${escapeHtml(result.url)}</a>` : escapeHtml(result.detail)
      ]))}
    ` : ''}
  `);
}

function renderVersionBatch(mode, batch) {
  renderMessage('success', mode === 'plan' ? 'RC Tag 预览已生成。' : 'RC Tag 操作已执行。');

  appendCard('批量 RC Tag', `
    ${renderTable([
      '项目', '基础版本', '新 RC', '状态'
    ], batch.previews.map((preview) => [
      escapeHtml(preview.project),
      `<span class="mono">${escapeHtml(preview.baseVersion || '(无)')}</span>`,
      `<span class="mono">${escapeHtml(preview.version || '(无法生成)')}</span>`,
      renderStatus(preview.success ? 'info' : 'error', escapeHtml(preview.success ? '可创建' : preview.error))
    ]))}
    ${batch.results && batch.results.length ? `
      <div class="output-card">
        <strong>执行汇总</strong>
        <div class="mono">成功 ${batch.summary.successCount} · 已推送 ${batch.summary.pushedCount} · 失败 ${batch.summary.failCount}</div>
      </div>
      ${renderTable([
        '项目', '结果', 'Tag', '详情'
      ], batch.results.map((result) => [
        escapeHtml(result.project),
        renderStatus(result.success ? 'info' : 'error', result.success ? '成功' : '失败'),
        `<span class="mono">${escapeHtml(result.tag || '(无)')}</span>`,
        escapeHtml(result.detail)
      ]))}
    ` : ''}
  `);
}

function clearOutput() {
  elements.output.innerHTML = '';
}

function renderMessage(type, message) {
  elements.output.innerHTML += `
    <div class="status-banner ${type}">
      <strong>${type === 'error' ? '出错了' : type === 'warn' ? '需要注意' : '状态更新'}</strong>
      <div>${escapeHtml(message)}</div>
    </div>
  `;
}

function appendCard(title, content) {
  elements.output.innerHTML += `
    <section class="output-card">
      <h3>${escapeHtml(title)}</h3>
      ${content}
    </section>
  `;
}

function renderTable(headers, rows) {
  return `
    <div class="result-table">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStatus(type, label) {
  return `<span class="status-pill ${type}">${label}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
