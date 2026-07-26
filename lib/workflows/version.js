const {
  createAnnotatedTag,
  createAnnotatedTagAt,
  fetchOrigin,
  fetchTags,
  getAllTags,
  getMaxReleaseVersion,
  getNextRcVersion,
  pushTag,
  remoteBranchExists,
} = require('../git');
const { DEFAULT_CONCURRENCY, mapConcurrent } = require('../async');

function normalizeOptions(rawOptions = {}) {
  return {
    message: rawOptions.message || '',
    push: rawOptions.push === true,
    dryRun: rawOptions.dryRun === true,
    sourceMode: rawOptions.sourceMode || 'head',
    remoteBranch: rawOptions.remoteBranch || '',
  };
}

async function buildVersionPreview(project, options) {
  const isRemote = options.sourceMode === 'remote-branch' && options.remoteBranch;
  const [originFetchResult, fetchResult] = await Promise.all([
    isRemote ? fetchOrigin(project.path) : { success: true },
    fetchTags(project.path),
  ]);

  const tags = await getAllTags(project.path);
  const nextVersion = getNextRcVersion(tags);

  const sourceRef = isRemote ? `origin/${options.remoteBranch}` : 'HEAD';

  if (isRemote && !originFetchResult.success) {
    return {
      project,
      fetchError: fetchResult.success ? null : (fetchResult.combined || fetchResult.error),
      sourceRef,
      success: false,
      error: `同步 origin 失败: ${originFetchResult.combined || originFetchResult.error || 'git fetch origin --prune 失败'}`,
      baseVersion: nextVersion.baseVersion || null,
      version: null,
    };
  }

  if (isRemote && !(await remoteBranchExists(project.path, options.remoteBranch))) {
    return {
      project,
      fetchError: fetchResult.success ? null : (fetchResult.combined || fetchResult.error),
      sourceRef,
      success: false,
      error: `远端不存在分支 ${sourceRef}`,
      baseVersion: nextVersion.baseVersion || null,
      version: null,
    };
  }

  return {
    project,
    fetchError: fetchResult.success ? null : (fetchResult.combined || fetchResult.error),
    sourceRef,
    ...nextVersion,
  };
}

async function createVersionBatchPlan(projects, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  return {
    options,
    previews: await mapConcurrent(projects, DEFAULT_CONCURRENCY,
      (project) => buildVersionPreview(project, options)),
  };
}

async function executeVersionPreview(preview, options) {
  const result = {
    project: preview.project.name,
    success: false,
    tag: preview.version || null,
    pushed: false,
    detail: '',
  };

  if (!preview.success) {
    result.detail = preview.error;
    return result;
  }

  if (options.dryRun) {
    result.success = true;
    result.detail = 'dry-run';
    return result;
  }

  const message = options.message || preview.version;
  const isRemote = options.sourceMode === 'remote-branch' && options.remoteBranch;
  const createResult = isRemote
    ? await createAnnotatedTagAt(preview.project.path, preview.version, message, preview.sourceRef)
    : await createAnnotatedTag(preview.project.path, preview.version, message);

  if (!createResult.success) {
    result.detail = createResult.combined || createResult.error || '创建 tag 失败';
    return result;
  }

  result.success = true;
  result.detail = '已创建';

  if (options.push) {
    const pushResult = await pushTag(preview.project.path, preview.version);
    if (!pushResult.success) {
      result.success = false;
      result.detail = pushResult.combined || pushResult.error || '推送 tag 失败';
      return result;
    }
    result.pushed = true;
    result.detail = '已创建并推送';
  }

  return result;
}

async function executeVersionBatch(batchPlan, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);

  return {
    ...batchPlan,
    executed: true,
    results: await mapConcurrent(batchPlan.previews, DEFAULT_CONCURRENCY,
      (preview) => executeVersionPreview(preview, options)),
  };
}

function buildVersionProjectRows(projects) {
  return mapConcurrent(projects, DEFAULT_CONCURRENCY, async (project) => {
    const localTags = await getAllTags(project.path);
    const latest = getMaxReleaseVersion(localTags);

    return {
      name: project.name,
      latestRelease: latest
        ? `v${latest.major}.${latest.minor}.${latest.patch}`
        : '无正式版本',
    };
  });
}

module.exports = {
  buildVersionProjectRows,
  createVersionBatchPlan,
  executeVersionBatch,
  normalizeOptions,
};
