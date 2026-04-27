const {
  BRANCH_PREFIX_PATTERNS,
  DEFAULT_BRANCH_BASE,
  resolveWorkspaceRoot,
} = require('../config');
const { chooseProjects, listWorkspaceProjects } = require('../projects');
const { parseArgs } = require('../parser');
const { createPrompt } = require('../prompt');
const {
  checkoutRef,
  createBranch,
  deleteLocalBranch,
  fetchOrigin,
  getCurrentBranch,
  hasUncommittedChanges,
  refExists,
  resolveBaseRef,
  stashChanges,
} = require('../git');
const {
  dim,
  divider,
  error,
  info,
  printBanner,
  printKeyValues,
  printTable,
  statusCell,
  success,
  warn,
} = require('../terminal');

const schema = [
  { name: 'help', alias: 'h', type: 'boolean' },
  { name: 'projects', alias: 'p', type: 'list', default: [] },
  { name: 'all', alias: 'a', type: 'boolean' },
  { name: 'stash', alias: 's', type: 'boolean' },
  { name: 'force', alias: 'f', type: 'boolean' },
  { name: 'dryRun', type: 'boolean' },
  { name: 'yes', alias: 'y', type: 'boolean' },
  { name: 'base', alias: 'b', type: 'string', default: DEFAULT_BRANCH_BASE },
  { name: 'fetch', type: 'boolean', default: true },
];

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

  return { valid: true };
}

function printHelp() {
  console.log(`
批量创建分支

用法:
  node cli.js branch [选项] [分支名]
  node create-branch.js [选项] [分支名]

选项:
  -h, --help        显示帮助
  -p, --projects    指定项目列表（逗号分隔）
  -a, --all         选择所有项目
  -s, --stash       自动 stash 未提交更改
  -f, --force       如果分支已存在则删除后重建
      --dry-run     仅预览，不实际创建分支
  -y, --yes         跳过确认
  -b, --base        指定基线引用，默认 auto
      --no-fetch    不执行 git fetch origin --prune

说明:
  --base auto 会优先尝试 origin/master、origin/main、master、main。
  这让后续“从远程 master 创建分支”的批量动作可以直接复用同一套逻辑。

示例:
  node cli.js branch feature/checkout-funnel
  node cli.js branch -a -b origin/master feature/checkout-funnel
  node cli.js branch -p "spa-shop,spa-store" -s -f feature/reset-branch
`);
}

function buildProjectRows(projects) {
  return projects.map((project) => ({
    name: project.name,
    currentBranch: getCurrentBranch(project.path) || 'unknown',
  }));
}

function buildPlan(project, branchName, options) {
  const fetchResult = options.fetch ? fetchOrigin(project.path) : { success: true };
  const baseResult = resolveBaseRef(project.path, options.base);
  const currentBranch = getCurrentBranch(project.path) || 'unknown';
  const dirty = hasUncommittedChanges(project.path);
  const targetExists = refExists(project.path, branchName);

  return {
    project,
    branchName,
    currentBranch,
    dirty,
    targetExists,
    fetchError: fetchResult.success ? null : (fetchResult.combined || fetchResult.error),
    baseRef: baseResult.success ? baseResult.ref : null,
    error: baseResult.success ? null : baseResult.error,
  };
}

function executePlan(plan, options) {
  const result = {
    project: plan.project.name,
    success: false,
    skipped: false,
    branchName: plan.branchName,
    baseRef: plan.baseRef,
    detail: '',
  };

  if (plan.error) {
    result.detail = plan.error;
    return result;
  }

  if (plan.dirty && !options.stash) {
    result.detail = '存在未提交更改，使用 --stash 后可自动暂存';
    return result;
  }

  if (options.dryRun) {
    result.success = true;
    result.detail = plan.targetExists
      ? (options.force ? `dry-run: 将从 ${plan.baseRef} 重建` : 'dry-run: 分支已存在')
      : `dry-run: 将从 ${plan.baseRef} 创建`;
    result.skipped = plan.targetExists && !options.force;
    return result;
  }

  if (plan.dirty && options.stash) {
    const stashResult = stashChanges(plan.project.path);
    if (!stashResult.success) {
      result.detail = stashResult.combined || stashResult.error || 'stash 失败';
      return result;
    }
  }

  if (plan.targetExists) {
    if (!options.force) {
      result.success = true;
      result.skipped = true;
      result.detail = '分支已存在';
      return result;
    }

    const checkoutResult = checkoutRef(plan.project.path, plan.baseRef);
    if (!checkoutResult.success) {
      result.detail = checkoutResult.combined || checkoutResult.error || '切换基线失败';
      return result;
    }

    const deleteResult = deleteLocalBranch(plan.project.path, plan.branchName);
    if (!deleteResult.success) {
      result.detail = deleteResult.combined || deleteResult.error || '删除旧分支失败';
      return result;
    }
  }

  const createResult = createBranch(plan.project.path, plan.branchName, plan.baseRef);
  if (!createResult.success) {
    result.detail = createResult.combined || createResult.error || '创建分支失败';
    return result;
  }

  result.success = true;
  result.detail = `已从 ${plan.baseRef} 创建`;
  return result;
}

async function run(argv) {
  const { options, positionals } = parseArgs(argv, schema);
  if (options.help) {
    printHelp();
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot();
  printBanner('批量创建分支', workspaceRoot || '未配置工作区');

  if (!workspaceRoot) {
    error('未找到工作区目录，请检查 SPA_ROOT_DIR 或脚本所在位置');
    process.exitCode = 1;
    return;
  }

  const allProjects = listWorkspaceProjects();
  if (!allProjects.length) {
    error('未找到任何 Git 项目');
    process.exitCode = 1;
    return;
  }

  const prompt = createPrompt();

  try {
    const projectRows = buildProjectRows(allProjects);
    const selectedResult = await chooseProjects(allProjects, {
      ...options,
      prompt,
      projectRows: projectRows.map((row, index) => ({
        ...row,
        name: allProjects[index].name,
      })),
      columns: [
        { header: '#', key: 'index' },
        { header: '项目', key: 'name' },
        { header: '当前分支', key: 'currentBranch' },
      ],
    });

    if (selectedResult === null) {
      warn('已取消操作');
      return;
    }

    if (selectedResult.invalid.length > 0) {
      warn(`以下项目不存在: ${selectedResult.invalid.join(', ')}`);
    }

    if (!selectedResult.selected.length) {
      error('未选择任何有效项目');
      process.exitCode = 1;
      return;
    }

    let branchName = positionals[0];
    if (!branchName) {
      branchName = (await prompt.ask('\n请输入要创建的分支名: ')).trim();
    }

    const validation = validateBranchName(branchName);
    if (!validation.valid) {
      error(validation.message);
      process.exitCode = 1;
      return;
    }

    if (!positionals[0] && options.base === DEFAULT_BRANCH_BASE) {
      const baseInput = (await prompt.ask(`请输入基线引用 [${DEFAULT_BRANCH_BASE}]: `)).trim();
      if (baseInput) {
        options.base = baseInput;
      }
    }

    info(`已选择 ${selectedResult.selected.length} 个项目，开始生成执行计划...`);
    const plans = selectedResult.selected.map((project) => buildPlan(project, branchName, options));

    console.log('\n执行计划:');
    console.log(divider());
    printTable([
      { header: '项目', key: 'projectName', render: (row) => row.project.name },
      { header: '当前分支', key: 'currentBranch' },
      { header: '基线', key: 'baseRef', render: (row) => row.baseRef || '(未解析)' },
      { header: '工作区', key: 'dirtyState', render: (row) => row.dirty ? 'dirty' : 'clean' },
      { header: '状态', key: 'planStatus', render: (row) => {
        if (row.error) return statusCell('error', '无法执行');
        if (row.targetExists && options.force) return statusCell('warn', '将重建');
        if (row.targetExists) return statusCell('skip', '将跳过');
        return statusCell('info', '可创建');
      } },
    ], plans);
    console.log(divider());

    plans.filter((plan) => plan.fetchError).forEach((plan) => {
      warn(`${plan.project.name} fetch 警告: ${plan.fetchError}`);
    });

    printKeyValues([
      { key: '分支名', value: branchName },
      { key: '基线', value: options.base },
      { key: 'stash', value: options.stash ? '是' : '否' },
      { key: 'force', value: options.force ? '是' : '否' },
      { key: 'dry-run', value: options.dryRun ? '是' : '否' },
    ]);

    if (!options.yes) {
      const confirmed = await prompt.confirm('\n确认执行以上计划? (y/N): ', false);
      if (!confirmed) {
        warn('已取消操作');
        return;
      }
    }

    const results = plans.map((plan) => executePlan(plan, options));

    console.log(`\n${divider()}`);
    printTable([
      { header: '项目', key: 'project' },
      { header: '结果', key: 'result', render: (row) => {
        if (row.success && row.skipped) return statusCell('skip', '已跳过');
        if (row.success) return statusCell('success', '成功');
        return statusCell('error', '失败');
      } },
      { header: '详情', key: 'detail' },
    ], results);
    console.log(divider());

    const successCount = results.filter((row) => row.success && !row.skipped).length;
    const skippedCount = results.filter((row) => row.skipped).length;
    const failCount = results.filter((row) => !row.success).length;

    info(`成功: ${successCount} | 跳过: ${skippedCount} | 失败: ${failCount} | 总计: ${results.length}`);

    if (failCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    prompt.close();
  }
}

module.exports = {
  run,
};
