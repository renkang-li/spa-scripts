const { parseArgs } = require('../parser');
const { chooseProjects, listWorkspaceProjects } = require('../projects');
const { createPrompt } = require('../prompt');
const { resolveWorkspaceRoot } = require('../config');
const {
  buildVersionProjectRows,
  createVersionBatchPlan,
  executeVersionBatch,
} = require('../workflows/version');
const {
  divider,
  error,
  info,
  printBanner,
  printKeyValues,
  printTable,
  statusCell,
  warn,
} = require('../terminal');

const schema = [
  { name: 'help', alias: 'h', type: 'boolean' },
  { name: 'projects', alias: 'p', type: 'list', default: [] },
  { name: 'all', alias: 'a', type: 'boolean' },
  { name: 'message', alias: 'm', type: 'string' },
  { name: 'push', type: 'boolean' },
  { name: 'dryRun', type: 'boolean' },
  { name: 'yes', alias: 'y', type: 'boolean' },
  { name: 'remoteBranch', type: 'string', default: '' },
];

function printHelp() {
  console.log(`
批量创建版本 Tag

用法:
  node cli.js version [选项]
  node create-version.js [选项]

选项:
  -h, --help           显示帮助
  -p, --projects       指定项目列表（逗号分隔）
  -a, --all            选择所有项目
  -m, --message        Tag 注释，默认使用版本号
      --push           创建后推送 tag（显式开启，跳过交互询问）
      --no-push        创建后不推送 tag（显式关闭，跳过交互询问）
      --dry-run        仅预览，不真正创建
      --remote-branch  在 origin/<branch> 上打 tag，而不是当前 HEAD
  -y, --yes            跳过确认

示例:
  node cli.js version -a --push
  node cli.js version -p "spa-shop,spa-store" --dry-run
  node cli.js version -a --remote-branch feature/checkout-funnel --push
`);
}

function buildExecutionOptions(options) {
  return {
    message: options.message || '',
    push: options.push === true,
    dryRun: options.dryRun === true,
    sourceMode: options.remoteBranch ? 'remote-branch' : 'head',
    remoteBranch: options.remoteBranch || '',
  };
}

function describePushDecision({ pushDecided, executionOptions, options }) {
  if (executionOptions.dryRun) {
    return '否（dry-run）';
  }

  if (pushDecided) {
    return executionOptions.push ? '是' : '否';
  }

  if (options.yes) {
    return '否（未指定 --push）';
  }

  return '稍后询问';
}

async function run(argv) {
  const { options, provided } = parseArgs(argv, schema);
  if (options.help) {
    printHelp();
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot();
  printBanner('批量创建版本 Tag', workspaceRoot || '未配置工作区');

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
    const projectRows = buildVersionProjectRows(allProjects);
    const selectedResult = await chooseProjects(allProjects, {
      ...options,
      prompt,
      projectRows,
      columns: [
        { header: '#', key: 'index' },
        { header: '项目', key: 'name' },
        { header: '最新正式版本', key: 'latestRelease' },
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

    info(`已选择 ${selectedResult.selected.length} 个项目，开始同步 tag 并计算下一个 RC 版本...`);
    const executionOptions = buildExecutionOptions(options);
    const batchPlan = createVersionBatchPlan(selectedResult.selected, executionOptions);

    batchPlan.previews.filter((preview) => preview.fetchError).forEach((preview) => {
      warn(`${preview.project.name} fetch tags 警告: ${preview.fetchError}`);
    });

    console.log('\n版本预览:');
    console.log(divider());
    printTable([
      { header: '项目', key: 'projectName', render: (row) => row.project.name },
      { header: '基础版本', key: 'baseVersion', render: (row) => row.baseVersion || '(无)' },
      { header: '新 RC', key: 'version', render: (row) => row.version || '(无法生成)' },
      { header: 'Tag 基于', key: 'sourceRef', render: (row) => row.sourceRef || 'HEAD' },
      { header: '状态', key: 'state', render: (row) => row.success ? statusCell('info', '可创建') : statusCell('error', '跳过') },
    ], batchPlan.previews);
    console.log(divider());

    const validCount = batchPlan.previews.filter((preview) => preview.success).length;

    // 解析 push 决策：显式 --push 或 --no-push 直接生效；否则在交互模式下询问，默认 yes。
    const pushDecided = provided.has('push');
    if (pushDecided) {
      executionOptions.push = options.push === true;
    }

    printKeyValues([
      { key: '可创建项目', value: String(validCount) },
      { key: 'Tag 来源', value: executionOptions.sourceMode === 'remote-branch'
        ? `origin/${executionOptions.remoteBranch}`
        : 'HEAD' },
      { key: '推送 tag', value: describePushDecision({ pushDecided, executionOptions, options }) },
      { key: 'dry-run', value: executionOptions.dryRun ? '是' : '否' },
    ]);

    if (!validCount) {
      error('没有可创建 tag 的项目');
      process.exitCode = 1;
      return;
    }

    if (!options.yes && !executionOptions.dryRun) {
      if (!pushDecided) {
        executionOptions.push = await prompt.confirm('是否推送 tag 到远程? (Y/n): ', true);
      }

      const confirmed = await prompt.confirm('确认创建这些 tag? (y/N): ', false);
      if (!confirmed) {
        warn('已取消操作');
        return;
      }
    }

    const execution = executeVersionBatch(batchPlan, executionOptions);
    const results = execution.results;

    console.log(`\n${divider()}`);
    printTable([
      { header: '项目', key: 'project' },
      { header: '结果', key: 'result', render: (row) => row.success ? statusCell('success', '成功') : statusCell('error', '失败') },
      { header: 'Tag', key: 'tag', render: (row) => row.tag || '(无)' },
      { header: '详情', key: 'detail' },
    ], results);
    console.log(divider());

    const successCount = results.filter((row) => row.success).length;
    const pushedCount = results.filter((row) => row.pushed).length;
    const failCount = results.filter((row) => !row.success).length;
    info(`成功: ${successCount} | 失败: ${failCount} | 已推送: ${pushedCount} | 总计: ${results.length}`);

    if (!executionOptions.push && successCount > 0 && !executionOptions.dryRun) {
      console.log('\n可直接复制的推送命令:');
      console.log(divider());
      results.filter((row) => row.success && row.tag).forEach((row) => {
        console.log(`cd ${row.project} && git push origin ${row.tag}`);
      });
    }

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
