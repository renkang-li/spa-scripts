const { SCRIPT_ROOT } = require('../config');
const {
  commitAll,
  getCurrentBranch,
  getRemoteRepoPath,
  hasUncommittedChanges,
  localBranchExists,
  pushBranch,
} = require('../git');
const { commandExists, runProcess } = require('../process');
const { DEFAULT_CONCURRENCY, mapConcurrent } = require('../async');

let cachedGlabPath;

async function findGlabPath() {
  if (cachedGlabPath === undefined) {
    cachedGlabPath = (await commandExists('glab', SCRIPT_ROOT)) ? 'glab' : null;
  }
  return cachedGlabPath;
}

function normalizeOptions(rawOptions = {}) {
  return {
    source: rawOptions.source || '@current',
    target: rawOptions.target || 'master',
    title: rawOptions.title || '',
    desc: rawOptions.desc || '',
    draft: rawOptions.draft === true,
    commit: rawOptions.commit === true,
    commitMsg: rawOptions.commitMsg || '',
    push: rawOptions.push === true,
  };
}

async function resolveSourceBranch(project, sourceOption) {
  if (sourceOption !== '@current') {
    return sourceOption;
  }
  return (await getCurrentBranch(project.path)) || null;
}

async function createMergeRequest(projectPath, glabPath, options) {
  const args = [
    'mr', 'create',
    '--source-branch', options.sourceBranch,
    '--target-branch', options.targetBranch,
    '--title', options.title,
    '--description', options.description || '',
    '--yes',
  ];

  if (options.draft) {
    args.push('--draft');
  }

  const result = await runProcess(glabPath, args, { cwd: projectPath });
  if (!result.success) {
    return {
      success: false,
      error: result.combined || result.error || 'glab mr create 失败',
    };
  }

  const urlMatch = result.combined.match(/https?:\/\/[^\s]+\/merge_requests\/\d+/);
  return {
    success: true,
    url: urlMatch ? urlMatch[0] : null,
  };
}

async function findExistingMergeRequest(projectPath, glabPath, options) {
  const args = [
    'mr', 'list',
    '--source-branch', options.sourceBranch,
    '--target-branch', options.targetBranch,
    '-F', 'json',
    '-P', '20',
  ];

  if (options.draft === true) {
    args.push('--draft');
  }

  const result = await runProcess(glabPath, args, { cwd: projectPath });
  if (!result.success) {
    return {
      success: false,
      error: result.combined || result.error || 'glab mr list 失败',
      url: null,
    };
  }

  try {
    const items = JSON.parse(result.stdout || '[]');
    const matched = items.find((item) => item.web_url);
    return {
      success: true,
      url: matched ? matched.web_url : null,
      iid: matched ? matched.iid : null,
    };
  } catch {
    return {
      success: false,
      error: '无法解析 glab mr list 返回结果',
      url: null,
    };
  }
}

async function buildMergePlan(project, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const sourceBranch = await resolveSourceBranch(project, options.source);
  const [branchExists, remoteInfo, dirty] = await Promise.all([
    sourceBranch ? localBranchExists(project.path, sourceBranch) : false,
    getRemoteRepoPath(project.path),
    hasUncommittedChanges(project.path),
  ]);

  return {
    project,
    repoPath: remoteInfo.repoPath || '(未配置 origin)',
    remoteUrl: remoteInfo.remoteUrl,
    sourceBranch,
    branchExists,
    dirty,
    error: sourceBranch ? null : '无法解析当前分支',
  };
}

async function createMergeBatchPlan(projects, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const [glabPath, plans] = await Promise.all([
    findGlabPath(),
    mapConcurrent(projects, DEFAULT_CONCURRENCY, (project) => buildMergePlan(project, options)),
  ]);

  return {
    options,
    glabPath,
    glabAvailable: Boolean(glabPath),
    plans,
  };
}

async function executeMergePlan(plan, options, glabPath) {
  const result = {
    project: plan.project.name,
    success: false,
    skipped: false,
    url: null,
    detail: '',
  };

  if (plan.error) {
    result.detail = plan.error;
    return result;
  }

  if (!plan.branchExists) {
    result.detail = `源分支不存在: ${plan.sourceBranch}`;
    return result;
  }

  if (options.commit && plan.dirty) {
    const message = options.commitMsg || options.title;
    const commitResult = await commitAll(plan.project.path, message);
    if (!commitResult.success) {
      const output = commitResult.combined || commitResult.error || '提交失败';
      if (!output.includes('nothing to commit') && !output.includes('no changes added')) {
        result.detail = output;
        return result;
      }
    }
  }

  if (options.push) {
    const pushResult = await pushBranch(plan.project.path, plan.sourceBranch);
    if (!pushResult.success) {
      const output = pushResult.combined || pushResult.error || '';
      if (!output.includes('Everything up-to-date')) {
        result.detail = `推送失败: ${output}`;
        return result;
      }
    }
  }

  // 直接尝试创建，已存在时再回查一次链接，正常路径只有一次 glab 调用。
  const mrResult = await createMergeRequest(plan.project.path, glabPath, {
    sourceBranch: plan.sourceBranch,
    targetBranch: options.target,
    title: options.title,
    description: options.desc,
    draft: options.draft,
  });

  if (!mrResult.success) {
    if (mrResult.error.includes('already exists') || mrResult.error.includes('already open')) {
      const existingMr = await findExistingMergeRequest(plan.project.path, glabPath, {
        sourceBranch: plan.sourceBranch,
        targetBranch: options.target,
        draft: options.draft,
      });
      result.success = true;
      result.skipped = true;
      result.url = existingMr.url || null;
      result.detail = 'MR 已存在';
      return result;
    }
    result.detail = mrResult.error;
    return result;
  }

  result.success = true;
  result.url = mrResult.url;
  result.detail = mrResult.url || '已创建';
  return result;
}

async function executeMergeBatch(batchPlan, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);

  if (!batchPlan.glabAvailable) {
    return {
      ...batchPlan,
      executed: false,
      results: batchPlan.plans.map((plan) => ({
        project: plan.project.name,
        success: false,
        skipped: false,
        url: null,
        detail: '未找到 glab，请先安装 GitLab CLI',
      })),
    };
  }

  return {
    ...batchPlan,
    executed: true,
    results: await mapConcurrent(batchPlan.plans, DEFAULT_CONCURRENCY,
      (plan) => executeMergePlan(plan, options, batchPlan.glabPath)),
  };
}

module.exports = {
  createMergeBatchPlan,
  executeMergeBatch,
  findGlabPath,
  normalizeOptions,
};
