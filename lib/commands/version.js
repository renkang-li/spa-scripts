const { parseArgs } = require('../parser');
const { chooseProjects, listWorkspaceProjects } = require('../projects');
const { createPrompt } = require('../prompt');
const {
  createAnnotatedTag,
  fetchTags,
  getAllTags,
  getMaxReleaseVersion,
  getNextRcVersion,
  pushTag,
} = require('../git');
const { resolveWorkspaceRoot } = require('../config');
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
];

function printHelp() {
  console.log(`
批量创建版本 Tag

用法:
  node cli.js version [选项]
  node create-version.js [选项]

选项:
  -h, --help       显示帮助
  -p, --projects   指定项目列表（逗号分隔）
  -a, --all        选择所有项目
  -m, --message    Tag 注释，默认使用版本号
      --push       自动推送 tag 到远程
      --dry-run    仅预览，不真正创建
  -y, --yes        跳过确认

示例:
  node cli.js version -a --push
  node cli.js version -p "spa-shop,spa-store" --dry-run
`);
}

function buildProjectRows(projects) {
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

function buildPreview(project) {
  const fetchResult = fetchTags(project.path);
  const tags = getAllTags(project.path);
  const nextVersion = getNextRcVersion(tags);

  return {
    project,
    fetchError: fetchResult.success ? null : (fetchResult.combined || fetchResult.error),
    ...nextVersion,
  };
}

function executePreview(preview, options) {
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

async function run(argv) {
  const { options } = parseArgs(argv, schema);
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
    const projectRows = buildProjectRows(allProjects);
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
    const previews = selectedResult.selected.map((project) => buildPreview(project));

    previews.filter((preview) => preview.fetchError).forEach((preview) => {
      warn(`${preview.project.name} fetch tags 警告: ${preview.fetchError}`);
    });

    console.log('\n版本预览:');
    console.log(divider());
    printTable([
      { header: '项目', key: 'projectName', render: (row) => row.project.name },
      { header: '基础版本', key: 'baseVersion', render: (row) => row.baseVersion || '(无)' },
      { header: '新 RC', key: 'version', render: (row) => row.version || '(无法生成)' },
      { header: '状态', key: 'state', render: (row) => row.success ? statusCell('info', '可创建') : statusCell('error', '跳过') },
    ], previews);
    console.log(divider());

    const validCount = previews.filter((preview) => preview.success).length;
    printKeyValues([
      { key: '可创建项目', value: String(validCount) },
      { key: '推送 tag', value: options.push ? '是' : '否' },
      { key: 'dry-run', value: options.dryRun ? '是' : '否' },
    ]);

    if (!validCount) {
      error('没有可创建 tag 的项目');
      process.exitCode = 1;
      return;
    }

    if (!options.yes && !options.dryRun) {
      const shouldPush = await prompt.confirm('是否推送 tag 到远程? (Y/n): ', true);
      options.push = shouldPush;

      const confirmed = await prompt.confirm('确认创建这些 tag? (y/N): ', false);
      if (!confirmed) {
        warn('已取消操作');
        return;
      }
    }

    const results = previews.map((preview) => executePreview(preview, options));

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

    if (!options.push && successCount > 0 && !options.dryRun) {
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
