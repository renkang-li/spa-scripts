const { SCRIPT_ROOT, resolveWorkspaceRoot } = require('../config');
const { parseArgs } = require('../parser');
const { chooseProjects, listWorkspaceProjects } = require('../projects');
const { createPrompt } = require('../prompt');
const {
  commitAll,
  getCurrentBranch,
  getRemoteRepoPath,
  hasUncommittedChanges,
  pushBranch,
  refExists,
} = require('../git');
const { commandExists, runProcess } = require('../process');
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
  { name: 'source', alias: 's', type: 'string', default: '@current' },
  { name: 'target', alias: 't', type: 'string', default: 'master' },
  { name: 'title', type: 'string' },
  { name: 'desc', type: 'string', default: '' },
  { name: 'draft', type: 'boolean', default: false },
  { name: 'commit', type: 'boolean' },
  { name: 'commitMsg', type: 'string' },
  { name: 'push', type: 'boolean' },
  { name: 'yes', alias: 'y', type: 'boolean' },
];

function findGlabPath() {
  return commandExists('glab', SCRIPT_ROOT) ? 'glab' : null;
}

function printHelp() {
  console.log(`
批量创建 Merge Request

用法:
  node cli.js merge [选项]
  node create-merge.js [选项]

选项:
  -h, --help         显示帮助
  -p, --projects     指定项目列表（逗号分隔）
  -a, --all          选择所有项目
  -s, --source       源分支，默认 @current（每个项目使用自己的当前分支）
  -t, --target       目标分支，默认 master
      --title        MR 标题
      --desc         MR 描述
      --draft        创建 Draft MR
      --no-draft     创建非 Draft MR
      --commit       先提交未提交更改
      --commit-msg   提交信息，默认复用 MR 标题
      --push         创建前推送分支
  -y, --yes          跳过确认

示例:
  node cli.js merge -a --title "feat: checkout polish"
  node cli.js merge -p "spa-shop,spa-store" -s feature/pay --push --title "feat: pay"
  node cli.js merge -a --commit --push --title "fix: retry logic"
`);
}

function buildProjectRows(projects) {
  return projects.map((project) => ({
    name: project.name,
    currentBranch: getCurrentBranch(project.path) || 'unknown',
  }));
}

function resolveSourceBranch(project, sourceOption) {
  if (sourceOption !== '@current') {
    return sourceOption;
  }
  return getCurrentBranch(project.path) || null;
}

function createMergeRequest(projectPath, glabPath, options) {
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

  const result = runProcess(glabPath, args, { cwd: projectPath });
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

function buildPlan(project, options) {
  const sourceBranch = resolveSourceBranch(project, options.source);
  const branchExists = sourceBranch ? refExists(project.path, sourceBranch) : false;
  const { repoPath, remoteUrl } = getRemoteRepoPath(project.path);

  return {
    project,
    repoPath: repoPath || '(未配置 origin)',
    remoteUrl,
    sourceBranch,
    branchExists,
    dirty: hasUncommittedChanges(project.path),
    error: sourceBranch ? null : '无法解析当前分支',
  };
}

function executePlan(plan, options, glabPath) {
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
    const commitResult = commitAll(plan.project.path, message);
    if (!commitResult.success) {
      const output = commitResult.combined || commitResult.error || '提交失败';
      if (!output.includes('nothing to commit') && !output.includes('no changes added')) {
        result.detail = output;
        return result;
      }
    }
  }

  if (options.push) {
    const pushResult = pushBranch(plan.project.path, plan.sourceBranch);
    if (!pushResult.success) {
      const output = pushResult.combined || pushResult.error || '';
      if (!output.includes('Everything up-to-date')) {
        result.detail = `推送失败: ${output}`;
        return result;
      }
    }
  }

  const mrResult = createMergeRequest(plan.project.path, glabPath, {
    sourceBranch: plan.sourceBranch,
    targetBranch: options.target,
    title: options.title,
    description: options.desc,
    draft: options.draft,
  });

  if (!mrResult.success) {
    if (mrResult.error.includes('already exists') || mrResult.error.includes('already open')) {
      result.success = true;
      result.skipped = true;
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

async function run(argv) {
  const { options } = parseArgs(argv, schema);
  if (options.help) {
    printHelp();
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot();
  printBanner('批量创建 Merge Request', workspaceRoot || '未配置工作区');

  if (!workspaceRoot) {
    error('未找到工作区目录，请检查 SPA_ROOT_DIR 或脚本所在位置');
    process.exitCode = 1;
    return;
  }

  const glabPath = findGlabPath();
  if (!glabPath) {
    error('未找到 glab，请先安装 GitLab CLI');
    process.exitCode = 1;
    return;
  }
  info(`使用 glab: ${glabPath}`);

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
      projectRows,
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

    if (!options.title) {
      options.title = (await prompt.ask('\n请输入 MR 标题: ')).trim();
    }
    if (!options.title) {
      error('MR 标题不能为空');
      process.exitCode = 1;
      return;
    }

    if (options.source === '@current' && !options.yes) {
      const sourceInput = (await prompt.ask('请输入源分支 [@current]: ')).trim();
      if (sourceInput) {
        options.source = sourceInput;
      }
    }

    if (!options.yes) {
      const targetInput = (await prompt.ask(`请输入目标分支 [${options.target}]: `)).trim();
      if (targetInput) {
        options.target = targetInput;
      }

      if (!options.desc) {
        options.desc = (await prompt.ask('请输入 MR 描述（可选）: ')).trim();
      }

      if (!options.commit) {
        options.commit = await prompt.confirm('是否自动提交未提交更改? (y/N): ', false);
      }

      if (options.commit && !options.commitMsg) {
        const commitInput = (await prompt.ask(`请输入提交信息 [${options.title}]: `)).trim();
        options.commitMsg = commitInput || options.title;
      }

      if (!options.push) {
        options.push = await prompt.confirm('是否在创建 MR 前推送分支? (Y/n): ', true);
      }
    }

    const plans = selectedResult.selected.map((project) => buildPlan(project, options));

    console.log('\n执行计划:');
    console.log(divider());
    printTable([
      { header: '项目', key: 'name', render: (row) => row.project.name },
      { header: '仓库', key: 'repoPath' },
      { header: '源分支', key: 'sourceBranch', render: (row) => row.sourceBranch || '(无法解析)' },
      { header: '工作区', key: 'dirty', render: (row) => row.dirty ? 'dirty' : 'clean' },
      { header: '状态', key: 'status', render: (row) => row.error ? statusCell('error', '无法执行') : statusCell('info', '可创建') },
    ], plans);
    console.log(divider());

    printKeyValues([
      { key: '目标分支', value: options.target },
      { key: 'MR 标题', value: options.title },
      { key: 'MR 描述', value: options.desc || '(无)' },
      { key: 'Draft', value: options.draft ? '是' : '否' },
      { key: '自动提交', value: options.commit ? '是' : '否' },
      { key: '推送分支', value: options.push ? '是' : '否' },
    ]);

    if (!options.yes) {
      const confirmed = await prompt.confirm('\n确认创建这些 MR? (y/N): ', false);
      if (!confirmed) {
        warn('已取消操作');
        return;
      }
    }

    const results = plans.map((plan) => executePlan(plan, options, glabPath));

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

    const urls = results.map((row) => row.url).filter(Boolean);
    if (urls.length > 0) {
      console.log('\nMR 链接:');
      console.log(divider());
      urls.forEach((url) => console.log(url));
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
