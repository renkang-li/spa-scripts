#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const { resolveWorkspaceRoot } = require('../lib/config');
const { listWorkspaceProjects, resolveSelectedProjects } = require('../lib/projects');
const { buildProjectCatalog } = require('../lib/workflows/catalog');
const {
  createBranchBatchPlan,
  describeAction,
  executeBranchBatch,
  summarizeBranchResults,
  validateBranchName,
} = require('../lib/workflows/branch');
const { createMergeBatchPlan, executeMergeBatch, findGlabPath } = require('../lib/workflows/merge');
const { createVersionBatchPlan, executeVersionBatch } = require('../lib/workflows/version');

const UI_ROOT = __dirname;
const DEFAULT_PORT = Number(process.env.PORT || 4310);
const HOST = '127.0.0.1';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/html; charset=utf-8';
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function respondFile(response, filePath) {
  try {
    const content = fs.readFileSync(filePath);
    response.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    request.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function getSelectedProjects(projectNames) {
  const allProjects = listWorkspaceProjects();
  const { selected, invalid } = resolveSelectedProjects(allProjects, projectNames || []);

  if (invalid.length > 0) {
    const error = new Error(`以下项目不存在: ${invalid.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  if (selected.length === 0) {
    const error = new Error('请至少选择一个项目');
    error.statusCode = 400;
    throw error;
  }

  return selected;
}

function summarizeMergeResults(results) {
  return {
    successCount: results.filter((item) => item.success && !item.skipped).length,
    skippedCount: results.filter((item) => item.skipped).length,
    failCount: results.filter((item) => !item.success).length,
  };
}

function summarizeVersionResults(results) {
  return {
    successCount: results.filter((item) => item.success).length,
    pushedCount: results.filter((item) => item.pushed).length,
    failCount: results.filter((item) => !item.success).length,
  };
}

function serializeBranchBatch(batch) {
  return {
    branchName: batch.branchName,
    options: batch.options,
    blocked: batch.blocked,
    blockedReason: batch.blockedReason,
    dirtyProjects: batch.dirtyProjects,
    plans: batch.plans.map((plan) => ({
      project: plan.project.name,
      currentBranch: plan.currentBranch,
      localExists: plan.localExists,
      remoteExists: plan.remoteExists,
      baseRef: plan.baseRef,
      dirty: plan.dirty,
      dirtyEntries: plan.dirtyEntries,
      fetchError: plan.fetchError,
      action: plan.action,
      description: describeAction(plan),
      error: plan.error,
    })),
    results: batch.results || [],
    summary: batch.results ? summarizeBranchResults(batch.results) : null,
  };
}

function serializeMergeBatch(batch) {
  return {
    options: batch.options,
    glabAvailable: batch.glabAvailable,
    plans: batch.plans.map((plan) => ({
      project: plan.project.name,
      repoPath: plan.repoPath,
      remoteUrl: plan.remoteUrl,
      sourceBranch: plan.sourceBranch,
      branchExists: plan.branchExists,
      dirty: plan.dirty,
      error: plan.error,
    })),
    results: batch.results || [],
    summary: batch.results ? summarizeMergeResults(batch.results) : null,
  };
}

function serializeVersionBatch(batch) {
  return {
    options: batch.options,
    previews: batch.previews.map((preview) => ({
      project: preview.project.name,
      baseVersion: preview.baseVersion || null,
      version: preview.version || null,
      sourceRef: preview.sourceRef || 'HEAD',
      fetchError: preview.fetchError,
      success: preview.success === true,
      error: preview.error || null,
    })),
    results: batch.results || [],
    summary: batch.results ? summarizeVersionResults(batch.results) : null,
  };
}

async function handleApi(request, response, parsedUrl) {
  if (request.method === 'GET' && parsedUrl.pathname === '/api/environment') {
    respondJson(response, 200, {
      workspaceRoot: resolveWorkspaceRoot(),
      glabAvailable: Boolean(findGlabPath()),
      defaultBranchBase: 'origin/master',
    });
    return;
  }

  if (request.method === 'GET' && parsedUrl.pathname === '/api/projects') {
    respondJson(response, 200, {
      projects: buildProjectCatalog().map((project) => ({
        name: project.name,
        currentBranch: project.currentBranch,
        repoPath: project.repoPath,
        remoteUrl: project.remoteUrl,
        dirty: project.dirty,
        dirtyEntries: project.dirtyEntries,
      })),
    });
    return;
  }

  if (request.method !== 'POST') {
    respondJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const body = await readJsonBody(request);
  const selectedProjects = getSelectedProjects(body.projects);

  if (parsedUrl.pathname === '/api/branch/plan' || parsedUrl.pathname === '/api/branch/run') {
    const validation = validateBranchName(body.branchName || '');
    if (!validation.valid) {
      respondJson(response, 400, { error: validation.message });
      return;
    }

    const batchPlan = createBranchBatchPlan(selectedProjects, validation.branchName, {
      base: body.base,
      fetch: body.fetch !== false,
      dryRun: parsedUrl.pathname.endsWith('/plan') ? true : body.dryRun === true,
    });

    if (parsedUrl.pathname.endsWith('/run')) {
      const execution = executeBranchBatch(batchPlan, {
        base: body.base,
        fetch: body.fetch !== false,
        dryRun: body.dryRun === true,
      });
      respondJson(response, 200, { batch: serializeBranchBatch(execution) });
      return;
    }

    respondJson(response, 200, { batch: serializeBranchBatch(batchPlan) });
    return;
  }

  if (parsedUrl.pathname === '/api/merge/plan' || parsedUrl.pathname === '/api/merge/run') {
    if (!String(body.title || '').trim()) {
      respondJson(response, 400, { error: 'MR 标题不能为空' });
      return;
    }

    const batchPlan = createMergeBatchPlan(selectedProjects, {
      source: body.source,
      target: body.target,
      title: body.title,
      desc: body.desc,
      draft: body.draft !== false,
      commit: body.commit === true,
      commitMsg: body.commitMsg,
      push: body.push === true,
    });

    if (parsedUrl.pathname.endsWith('/run')) {
      const execution = executeMergeBatch(batchPlan, {
        source: body.source,
        target: body.target,
        title: body.title,
        desc: body.desc,
        draft: body.draft !== false,
        commit: body.commit === true,
        commitMsg: body.commitMsg,
        push: body.push === true,
      });
      respondJson(response, 200, { batch: serializeMergeBatch(execution) });
      return;
    }

    respondJson(response, 200, { batch: serializeMergeBatch(batchPlan) });
    return;
  }

  if (parsedUrl.pathname === '/api/version/plan' || parsedUrl.pathname === '/api/version/run') {
    if (body.sourceMode === 'remote-branch' && !String(body.remoteBranch || '').trim()) {
      respondJson(response, 400, { error: '远端分支模式下分支名不能为空' });
      return;
    }

    const versionOpts = {
      message: body.message,
      push: body.push === true,
      dryRun: parsedUrl.pathname.endsWith('/plan') ? true : body.dryRun === true,
      sourceMode: body.sourceMode || 'head',
      remoteBranch: (body.remoteBranch || '').trim(),
    };

    const batchPlan = createVersionBatchPlan(selectedProjects, versionOpts);

    if (parsedUrl.pathname.endsWith('/run')) {
      const execution = executeVersionBatch(batchPlan, versionOpts);
      respondJson(response, 200, { batch: serializeVersionBatch(execution) });
      return;
    }

    respondJson(response, 200, { batch: serializeVersionBatch(batchPlan) });
    return;
  }

  respondJson(response, 404, { error: 'Not found' });
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const parsedUrl = new URL(request.url, `http://${request.headers.host || HOST}`);

      if (parsedUrl.pathname.startsWith('/api/')) {
        await handleApi(request, response, parsedUrl);
        return;
      }

      if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
        respondFile(response, path.join(UI_ROOT, 'index.html'));
        return;
      }

      if (parsedUrl.pathname === '/styles.css' || parsedUrl.pathname === '/app.js') {
        respondFile(response, path.join(UI_ROOT, parsedUrl.pathname.slice(1)));
        return;
      }

      if (parsedUrl.pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }

      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } catch (caughtError) {
      const statusCode = caughtError.statusCode || 500;
      respondJson(response, statusCode, { error: caughtError.message || 'Unexpected error' });
    }
  });
}

function listenOnAvailablePort(server, port, attemptsLeft = 10) {
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
        listenOnAvailablePort(server, port + 1, attemptsLeft - 1).then(resolve, reject);
        return;
      }
      reject(error);
    });

    server.once('listening', () => resolve(port));
    server.listen(port, HOST);
  });
}

async function main() {
  const server = createServer();
  const port = await listenOnAvailablePort(server, DEFAULT_PORT);
  console.log(`SPA Scripts UI running at http://${HOST}:${port}`);
  console.log(`Workspace: ${resolveWorkspaceRoot() || '(not configured)'}`);
  console.log('Press Ctrl+C to stop.');
}

main().catch((caughtError) => {
  console.error(caughtError.message);
  process.exit(1);
});
