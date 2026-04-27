const {
  createAnnotatedTag,
  fetchTags,
  getAllTags,
  getMaxReleaseVersion,
  getNextRcVersion,
  pushTag,
} = require('../git');

function normalizeOptions(rawOptions = {}) {
  return {
    message: rawOptions.message || '',
    push: rawOptions.push === true,
    dryRun: rawOptions.dryRun === true,
  };
}

function buildVersionPreview(project) {
  const fetchResult = fetchTags(project.path);
  const tags = getAllTags(project.path);
  const nextVersion = getNextRcVersion(tags);

  return {
    project,
    fetchError: fetchResult.success ? null : (fetchResult.combined || fetchResult.error),
    ...nextVersion,
  };
}

function createVersionBatchPlan(projects, rawOptions = {}) {
  return {
    options: normalizeOptions(rawOptions),
    previews: projects.map((project) => buildVersionPreview(project)),
  };
}

function executeVersionPreview(preview, options) {
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
  const createResult = createAnnotatedTag(preview.project.path, preview.version, message);
  if (!createResult.success) {
    result.detail = createResult.combined || createResult.error || '创建 tag 失败';
    return result;
  }

  result.success = true;
  result.detail = '已创建';

  if (options.push) {
    const pushResult = pushTag(preview.project.path, preview.version);
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

function executeVersionBatch(batchPlan, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);

  return {
    ...batchPlan,
    executed: true,
    results: batchPlan.previews.map((preview) => executeVersionPreview(preview, options)),
  };
}

function buildVersionProjectRows(projects) {
  return projects.map((project) => {
    const localTags = getAllTags(project.path);
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
