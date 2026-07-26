const {
  BRANCH_PREFIX_PATTERNS,
  DEFAULT_BRANCH_BASE,
} = require('../config');
const {
  checkoutLocalBranch,
  checkoutRemoteBranch,
  createBranch,
  fetchOrigin,
  getCurrentBranch,
  getWorkingTreeStatus,
  localBranchExists,
  remoteBranchExists,
  resolveBaseRef,
} = require('../git');
const { DEFAULT_CONCURRENCY, mapConcurrent } = require('../async');

function validateBranchName(branchName) {
  if (!branchName || !branchName.trim()) {
    return { valid: false, message: '分支名不能为空' };
  }

  const normalized = branchName.trim();
  if (!BRANCH_PREFIX_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      valid: false,
      message: '分支名格式必须是 feature/xxx、fix/xxx、hotfix/xxx 或 release/xxx',
    };
  }

  if (/[\s~^:?*\[\]\\]/.test(normalized)) {
    return {
      valid: false,
      message: '分支名包含非法字符（空格、~、^、:、?、*、[、]、\\）',
    };
  }

  return { valid: true, branchName: normalized };
}

function normalizeOptions(rawOptions = {}) {
  return {
    base: rawOptions.base || DEFAULT_BRANCH_BASE,
    fetch: rawOptions.fetch !== false,
    dryRun: rawOptions.dryRun === true,
  };
}

function describeAction(plan) {
  switch (plan.action) {
    case 'blocked-dirty':
      return '存在未提交更改';
    case 'already-current':
      return '已在目标分支';
    case 'checkout-local':
      return '切换到本地分支';
    case 'checkout-remote':
      return '切换到远程分支';
    case 'create-from-base':
      return `从 ${plan.baseRef} 创建`;
    default:
      return '无法执行';
  }
}

async function buildBranchPlan(project, branchName, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  // fetch 会更新 origin/* 引用，必须先于后面的 ref 检查完成。
  const fetchResult = options.fetch ? await fetchOrigin(project.path) : { success: true };
  const [worktree, currentBranch, localExists, remoteExists] = await Promise.all([
    getWorkingTreeStatus(project.path),
    getCurrentBranch(project.path),
    localBranchExists(project.path, branchName),
    remoteBranchExists(project.path, branchName),
  ]);
  const baseResult = (!localExists && !remoteExists)
    ? await resolveBaseRef(project.path, options.base)
    : { success: true, ref: null };

  let action = 'create-from-base';
  let error = null;

  if (worktree.entries.length > 0) {
    action = 'blocked-dirty';
  } else if ((currentBranch || 'unknown') === branchName) {
    action = 'already-current';
  } else if (localExists) {
    action = 'checkout-local';
  } else if (remoteExists) {
    action = 'checkout-remote';
  } else if (!baseResult.success) {
    action = 'error';
    error = baseResult.error;
  }

  return {
    project,
    branchName,
    currentBranch: currentBranch || 'unknown',
    localExists,
    remoteExists,
    baseRef: baseResult.ref,
    dirty: worktree.entries.length > 0,
    dirtyEntries: worktree.entries,
    fetchError: fetchResult.success ? null : (fetchResult.combined || fetchResult.error),
    action,
    error,
  };
}

async function createBranchBatchPlan(projects, branchName, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const plans = await mapConcurrent(projects, DEFAULT_CONCURRENCY,
    (project) => buildBranchPlan(project, branchName, options));
  const dirtyProjects = plans.filter((plan) => plan.dirty);
  const blocked = dirtyProjects.length > 0;

  return {
    branchName,
    options,
    blocked,
    blockedReason: blocked ? 'dirty-worktrees' : null,
    dirtyProjects: dirtyProjects.map((plan) => ({
      project: plan.project.name,
      currentBranch: plan.currentBranch,
      dirtyEntries: plan.dirtyEntries,
    })),
    plans,
  };
}

async function executeSinglePlan(plan, options) {
  const result = {
    project: plan.project.name,
    branchName: plan.branchName,
    success: false,
    changed: false,
    simulated: false,
    detail: '',
  };

  if (plan.action === 'error') {
    result.detail = plan.error || '无法执行';
    return result;
  }

  if (plan.action === 'blocked-dirty') {
    result.detail = `存在未提交更改: ${plan.dirtyEntries.join(', ')}`;
    return result;
  }

  if (options.dryRun) {
    result.success = true;
    result.simulated = true;
    result.detail = `dry-run: ${describeAction(plan)}`;
    return result;
  }

  if (plan.action === 'already-current') {
    result.success = true;
    result.detail = '已在目标分支';
    return result;
  }

  if (plan.action === 'checkout-local') {
    const checkoutResult = await checkoutLocalBranch(plan.project.path, plan.branchName);
    if (!checkoutResult.success) {
      result.detail = checkoutResult.combined || checkoutResult.error || '切换本地分支失败';
      return result;
    }
    result.success = true;
    result.changed = true;
    result.detail = '已切换到本地分支';
    return result;
  }

  if (plan.action === 'checkout-remote') {
    const checkoutResult = await checkoutRemoteBranch(plan.project.path, plan.branchName);
    if (!checkoutResult.success) {
      result.detail = checkoutResult.combined || checkoutResult.error || '切换远程分支失败';
      return result;
    }
    result.success = true;
    result.changed = true;
    result.detail = '已切换到远程分支';
    return result;
  }

  const createResult = await createBranch(plan.project.path, plan.branchName, plan.baseRef);
  if (!createResult.success) {
    result.detail = createResult.combined || createResult.error || '创建分支失败';
    return result;
  }

  result.success = true;
  result.changed = true;
  result.detail = `已从 ${plan.baseRef} 创建`;
  return result;
}

async function executeBranchBatch(batchPlan, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);

  if (batchPlan.blocked) {
    return {
      ...batchPlan,
      executed: false,
      results: batchPlan.plans.map((plan) => ({
        project: plan.project.name,
        branchName: plan.branchName,
        success: false,
        changed: false,
        detail: plan.dirty
          ? `存在未提交更改: ${plan.dirtyEntries.join(', ')}`
          : '整批停止：有项目存在未提交更改',
      })),
    };
  }

  return {
    ...batchPlan,
    executed: true,
    results: await mapConcurrent(batchPlan.plans, DEFAULT_CONCURRENCY,
      (plan) => executeSinglePlan(plan, options)),
  };
}

function summarizeBranchResults(results) {
  return {
    successCount: results.filter((item) => item.success).length,
    changedCount: results.filter((item) => item.changed).length,
    failCount: results.filter((item) => !item.success).length,
  };
}

module.exports = {
  createBranchBatchPlan,
  describeAction,
  executeBranchBatch,
  normalizeOptions,
  summarizeBranchResults,
  validateBranchName,
};
