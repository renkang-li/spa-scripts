const {
  DEFAULT_BRANCH_BASE,
  resolveWorkspaceRoot,
} = require('../config');
const { chooseProjects, listWorkspaceProjects } = require('../projects');
const { parseArgs } = require('../parser');
const { createPrompt } = require('../prompt');
const { getCurrentBranch } = require('../git');
const {
  createBranchBatchPlan,
  describeAction,
  executeBranchBatch,
  summarizeBranchResults,
  validateBranchName,
} = require('../workflows/branch');
const {
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
  { name: 'dryRun', type: 'boolean' },
  { name: 'yes', alias: 'y', type: 'boolean' },
  { name: 'base', alias: 'b', type: 'string', default: DEFAULT_BRANCH_BASE },
  { name: 'fetch', type: 'boolean', default: true },
];

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
      --dry-run     仅预览，不实际创建分支
  -y, --yes         跳过确认
  -b, --base        指定基线引用，默认 auto
      --no-fetch    不执行 git fetch origin --prune

说明:
  --base auto 会优先尝试 origin/master、origin/main、master、main。
  如果本地或远程已经存在目标分支，会直接切换过去。
  如果所选项目中任意一个存在未提交更改，会整批停止并列出问题项目。

示例:
  node cli.js branch feature/checkout-funnel
  node cli.js branch -a -b origin/master feature/checkout-funnel
  node cli.js branch -p "spa-shop,spa-store" -b origin/master feature/weekly-sync
`);
}

function buildProjectRows(projects) {
  return projects.map((project) => ({
    name: project.name,
    currentBranch: getCurrentBranch(project.path) || 'unknown',
  }));
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
    const batchPlan = createBranchBatchPlan(selectedResult.selected, branchName, options);

    console.log('\n执行计划:');
    console.log(divider());
    printTable([
      { header: '项目', key: 'projectName', render: (row) => row.project.name },
      { header: '当前分支', key: 'currentBranch' },
      { header: '基线', key: 'baseRef', render: (row) => row.baseRef || '(无需新建)' },
      { header: '工作区', key: 'dirtyState', render: (row) => row.dirty ? 'dirty' : 'clean' },
      { header: '状态', key: 'planStatus', render: (row) => {
        if (row.error) return statusCell('error', '无法执行');
        if (row.dirty) return statusCell('error', '整批停止');
        return statusCell('info', describeAction(row));
      } },
    ], batchPlan.plans);
    console.log(divider());

    batchPlan.plans.filter((plan) => plan.fetchError).forEach((plan) => {
      warn(`${plan.project.name} fetch 警告: ${plan.fetchError}`);
    });

    if (batchPlan.blocked) {
      warn('检测到未提交更改，本次批量操作会在执行前整批停止。');
      batchPlan.dirtyProjects.forEach((item) => {
        warn(`${item.project} [${item.currentBranch}]: ${item.dirtyEntries.join(', ')}`);
      });
    }

    printKeyValues([
      { key: '分支名', value: branchName },
      { key: '基线', value: options.base },
      { key: 'dry-run', value: options.dryRun ? '是' : '否' },
    ]);

    if (!options.yes) {
      const confirmed = await prompt.confirm('\n确认执行以上计划? (y/N): ', false);
      if (!confirmed) {
        warn('已取消操作');
        return;
      }
    }

    const execution = executeBranchBatch(batchPlan, options);
    const results = execution.results;

    console.log(`\n${divider()}`);
    printTable([
      { header: '项目', key: 'project' },
      { header: '结果', key: 'result', render: (row) => {
        if (row.simulated) return statusCell('info', '预览');
        if (row.success && !row.changed) return statusCell('info', '无需变更');
        if (row.success) return statusCell('success', '成功');
        return statusCell('error', '失败');
      } },
      { header: '详情', key: 'detail' },
    ], results);
    console.log(divider());

    const summary = summarizeBranchResults(results);
    info(`成功: ${summary.successCount} | 实际切换/创建: ${summary.changedCount} | 失败: ${summary.failCount} | 总计: ${results.length}`);

    if (summary.failCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    prompt.close();
  }
}

module.exports = {
  run,
};
