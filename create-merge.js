#!/usr/bin/env node

/**
 * 批量创建合并请求脚本
 * 功能：
 * 1. 支持选择多个项目
 * 2. 配置源分支和目标分支
 * 3. 输入 MR 标题和描述
 * 4. 使用 glab 创建 Draft MR
 * 5. 显示结果汇总
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置
const SPA_ROOT = path.resolve(__dirname, '..');

// GitLab 仓库路径映射（本地目录名 -> GitLab 仓库路径）
const REPO_MAPPING = {
  'dental-blog': 'lf/minishops/templates/dental-blog',
  'dental-product': 'lf/minishops/templates/dental-product',
  'ease-blog': 'lf/minishops/templates/ease-blog',
  'ease-product': 'lf/minishops/templates/ease-product',
  'lush-product': 'lf/minishops/templates/lush-product',
  'next-home': 'lf/minishops/templates/next-home',
  'plantar-blog': 'lf/minishops/templates/plantar-blog',
  'plantar-product': 'lf/minishops/templates/plantar-product',
  'pluggy-product': 'lf/minishops/templates/pluggy-product',
  'remedy-blog': 'lf/minishops/templates/remedy-blog',
  'remedy-product': 'lf/minishops/templates/remedy-product',
  'renew-blog': 'lf/minishops/templates/renew-blog',
  'renew-product': 'lf/minishops/templates/renew-product',
  'revital-product': 'lf/minishops/templates/revital-product',
  'silkie-product': 'lf/minishops/templates/silkie-product',
  'snug-product': 'lf/minishops/templates/snug-product',
  'template-cleaner-blog': 'lf/minishops/template-cleaner-blog',
  'template-cleaner-product': 'lf/minishops/template-cleaner-product',
  'template-single-payment-page': 'lf/minishops/template-single-payment-page',
  'thick-product': 'lf/minishops/templates/thick-product',
  'toddhair-product': 'lf/minishops/templates/toddhair-product',
  'vital-blog': 'lf/minishops/templates/vital-blog',
  'vital-product': 'lf/minishops/templates/vital-product',
  'align-blog': 'lf/minishops/templates/align-blog',
  'align-product': 'lf/minishops/templates/align-product',
  'boost-product': 'lf/minishops/templates/boost-product',
  'cover-blog': 'lf/minishops/templates/cover-blog',
  'cover-product': 'lf/minishops/templates/cover-product',
  'dense-product': 'lf/minishops/templates/dense-product',
  'spa-shop': 'lf/minishops/spa-shop',
  'spa-store': 'lf/minishops/spa-store',
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'blue');
}

function logWarn(message) {
  log(`⚠ ${message}`, 'yellow');
}

/**
 * 获取 glab 可执行文件路径
 */
function getGlabPath() {
  // 首先检查 PATH 中是否有 glab
  try {
    execSync('glab --version', { stdio: 'pipe' });
    return 'glab';
  } catch {
    // 尝试常见的安装位置
    const possiblePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'glab-1.22.0', 'bin', 'glab.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'glab', 'glab.exe'),
      'C:\\Program Files\\glab\\glab.exe',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

/**
 * 获取所有 Git 项目
 */
function getAllProjects() {
  const items = fs.readdirSync(SPA_ROOT);
  const projects = [];

  for (const item of items) {
    const itemPath = path.join(SPA_ROOT, item);
    const gitPath = path.join(itemPath, '.git');

    if (fs.statSync(itemPath).isDirectory() && fs.existsSync(gitPath)) {
      projects.push(item);
    }
  }

  return projects.sort();
}

/**
 * 获取项目当前分支
 */
function getCurrentBranch(projectPath) {
  try {
    const result = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * 检查分支是否存在
 */
function branchExists(projectPath, branchName) {
  try {
    execSync(`git rev-parse --verify ${branchName}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查是否有未提交的更改
 */
function hasUncommittedChanges(projectPath) {
  try {
    const result = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 暂存所有文件并提交
 */
function commitChanges(projectPath, message) {
  try {
    // 先暂存所有更改
    execSync('git add -A', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 提交
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { success: true };
  } catch (error) {
    const errorMsg = error.stderr?.trim() || error.message;
    // 如果是因为没有需要提交的更改，不视为错误
    if (errorMsg.includes('nothing to commit') || errorMsg.includes('no changes added')) {
      return { success: true, noChanges: true };
    }
    return { success: false, error: errorMsg };
  }
}

/**
 * 推送分支到远程
 */
function pushBranch(projectPath, branchName) {
  try {
    execSync(`git push -u origin ${branchName}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.stderr?.trim() || error.message };
  }
}

/**
 * 创建 Merge Request
 */
function createMergeRequest(projectPath, options) {
  const { glabPath, sourceBranch, targetBranch, title, description, isDraft } = options;

  const args = [
    'mr', 'create',
    '--source-branch', sourceBranch,
    '--target-branch', targetBranch,
    '--title', title,
    '--description', description || '',
    '--yes',
  ];

  if (isDraft) {
    args.push('--draft');
  }

  try {
    const result = spawnSync(glabPath, args, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const output = (result.stdout || '') + (result.stderr || '');

    if (result.status !== 0) {
      return { success: false, error: output.trim() };
    }

    // 提取 MR URL
    const urlMatch = output.match(/https?:\/\/[^\s]+\/merge_requests\/\d+/);
    const url = urlMatch ? urlMatch[0] : null;

    return { success: true, url, output: output.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 创建 readline 接口
 */
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 询问用户问题
 */
function question(rl, query) {
  return new Promise(resolve => rl.question(query, resolve));
}

/**
 * 显示项目列表并让用户选择
 */
async function selectProjects(rl, projects) {
  console.log('\n可用的项目列表:');
  console.log('─'.repeat(60));

  projects.forEach((project, index) => {
    const projectPath = path.join(SPA_ROOT, project);
    const currentBranch = getCurrentBranch(projectPath) || 'unknown';
    const branchColor = currentBranch === 'master' ? 'dim' : 'cyan';
    console.log(`  ${(index + 1).toString().padStart(2, ' ')}. ${project.padEnd(30)} ${colors[branchColor]}[${currentBranch}]${colors.reset}`);
  });

  console.log('─'.repeat(60));
  console.log('  a. 全选所有项目');
  console.log('  q. 退出');
  console.log('');

  const answer = await question(rl, '请输入项目编号（多个用逗号分隔，如: 1,2,3）: ');

  if (answer.toLowerCase() === 'q') {
    return null;
  }

  if (answer.toLowerCase() === 'a') {
    return projects;
  }

  // 支持范围选择，如 1-5
  const indices = [];
  const parts = answer.split(',').map(s => s.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          indices.push(i - 1);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num)) {
        indices.push(num - 1);
      }
    }
  }

  const selectedProjects = [...new Set(indices)]
    .filter(i => i >= 0 && i < projects.length)
    .map(i => projects[i]);

  if (selectedProjects.length === 0) {
    logError('未选择任何有效项目');
    return [];
  }

  return selectedProjects;
}

/**
 * 打印使用帮助
 */
function printHelp() {
  console.log(`
批量创建合并请求脚本

用法:
  node create-merge.js [选项]

选项:
  -h, --help           显示帮助信息
  -p, --projects       指定项目列表（逗号分隔）
  -a, --all            选择所有项目
  -s, --source         源分支名（默认当前分支）
  -t, --target         目标分支名（默认 master）
  --title              MR 标题
  --desc               MR 描述
  --draft              创建 Draft MR（默认是）
  --no-draft           创建非 Draft MR
  --commit             暂存所有文件并提交（需配合 --commit-msg）
  --commit-msg         提交信息（默认使用 MR 标题）
  --push               创建前先推送分支
  -y, --yes            跳过确认提示

示例:
  node create-merge.js
  node create-merge.js -a -s feature/new-feature --title "feat: 新功能"
  node create-merge.js -p "spa-shop,spa-store" -s fix/bug --title "fix: 修复问题"
  node create-merge.js -a --push -s feature/update --title "feat: 更新" --desc "#123456"
  node create-merge.js -a --commit --push --title "feat: 新功能" --commit-msg "feat: add new feature"
`);
}

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const options = {
    help: false,
    projects: [],
    all: false,
    sourceBranch: null,
    targetBranch: 'master',
    title: null,
    description: '',
    isDraft: true,
    commit: false,
    commitMsg: null,
    push: false,
    yes: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-p':
      case '--projects':
        if (args[i + 1]) {
          options.projects = args[++i].split(',').map(s => s.trim());
        }
        break;
      case '-a':
      case '--all':
        options.all = true;
        break;
      case '-s':
      case '--source':
        if (args[i + 1]) {
          options.sourceBranch = args[++i];
        }
        break;
      case '-t':
      case '--target':
        if (args[i + 1]) {
          options.targetBranch = args[++i];
        }
        break;
      case '--title':
        if (args[i + 1]) {
          options.title = args[++i];
        }
        break;
      case '--desc':
        if (args[i + 1]) {
          options.description = args[++i];
        }
        break;
      case '--draft':
        options.isDraft = true;
        break;
      case '--no-draft':
        options.isDraft = false;
        break;
      case '--commit':
        options.commit = true;
        break;
      case '--commit-msg':
        if (args[i + 1]) {
          options.commitMsg = args[++i];
        }
        break;
      case '--push':
        options.push = true;
        break;
      case '-y':
      case '--yes':
        options.yes = true;
        break;
    }
  }

  return options;
}

/**
 * 为单个项目创建 MR
 */
async function createMRForProject(projectName, options) {
  const { glabPath, sourceBranch, targetBranch, title, description, isDraft, commit, commitMsg, push } = options;
  const projectPath = path.join(SPA_ROOT, projectName);
  const repoPath = REPO_MAPPING[projectName] || `unknown/${projectName}`;

  const result = {
    project: projectName,
    repo: repoPath,
    success: false,
    url: null,
    error: null,
    skipped: false,
  };

  log(`\n${'─'.repeat(60)}`, 'cyan');
  logInfo(`处理项目: ${projectName}`);
  log(`  GitLab: ${repoPath}`, 'dim');

  // 检查源分支是否存在
  if (!branchExists(projectPath, sourceBranch)) {
    logError(`源分支 ${sourceBranch} 不存在`);
    result.error = `源分支 ${sourceBranch} 不存在`;
    return result;
  }

  // 如果需要提交
  if (commit) {
    if (hasUncommittedChanges(projectPath)) {
      const message = commitMsg || title;
      logInfo(`暂存并提交更改: ${message}`);
      const commitResult = commitChanges(projectPath, message);
      if (!commitResult.success) {
        logError(`提交失败: ${commitResult.error}`);
        result.error = `提交失败: ${commitResult.error}`;
        return result;
      }
      if (commitResult.noChanges) {
        logWarn('没有需要提交的更改');
      } else {
        logSuccess('更改已提交');
      }
    } else {
      log('  没有未提交的更改', 'dim');
    }
  }

  // 如果需要推送
  if (push) {
    logInfo(`推送分支 ${sourceBranch} 到远程...`);
    const pushResult = pushBranch(projectPath, sourceBranch);
    if (!pushResult.success) {
      // 如果是因为分支已存在于远程，不视为错误
      if (!pushResult.error.includes('Everything up-to-date')) {
        logWarn(`推送警告: ${pushResult.error}`);
      }
    } else {
      logSuccess('分支已推送');
    }
  }

  // 创建 MR
  logInfo(`创建 Merge Request...`);
  const mrResult = createMergeRequest(projectPath, {
    glabPath,
    sourceBranch,
    targetBranch,
    title,
    description,
    isDraft,
  });

  if (!mrResult.success) {
    // 检查是否是因为 MR 已存在
    if (mrResult.error.includes('already exists') || mrResult.error.includes('already open')) {
      logWarn('MR 已存在，跳过');
      result.skipped = true;
      result.success = true;
      return result;
    }
    logError(`创建失败: ${mrResult.error}`);
    result.error = mrResult.error;
    return result;
  }

  result.success = true;
  result.url = mrResult.url;
  logSuccess(`MR 创建成功`);
  if (mrResult.url) {
    log(`  URL: ${mrResult.url}`, 'cyan');
  }

  return result;
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('\n' + '═'.repeat(60));
  log('  批量创建合并请求工具', 'cyan');
  console.log('═'.repeat(60));

  // 检查 glab
  const glabPath = getGlabPath();
  if (!glabPath) {
    logError('未找到 glab CLI 工具');
    log('请安装 glab: https://gitlab.com/gitlab-org/cli', 'yellow');
    process.exit(1);
  }
  logInfo(`使用 glab: ${glabPath}`);

  // 获取所有项目
  const allProjects = getAllProjects();

  if (allProjects.length === 0) {
    logError('未找到任何 Git 项目');
    process.exit(1);
  }

  logInfo(`发现 ${allProjects.length} 个 Git 项目`);

  const rl = createInterface();
  let selectedProjects = [];
  let sourceBranch = options.sourceBranch;
  let targetBranch = options.targetBranch;
  let title = options.title;
  let description = options.description;

  try {
    // 选择项目
    if (options.all) {
      selectedProjects = allProjects;
    } else if (options.projects.length > 0) {
      selectedProjects = options.projects.filter(p => allProjects.includes(p));
      const invalidProjects = options.projects.filter(p => !allProjects.includes(p));
      if (invalidProjects.length > 0) {
        logWarn(`以下项目不存在: ${invalidProjects.join(', ')}`);
      }
    } else {
      selectedProjects = await selectProjects(rl, allProjects);
      if (selectedProjects === null) {
        log('\n已取消操作', 'yellow');
        rl.close();
        process.exit(0);
      }
    }

    if (selectedProjects.length === 0) {
      logError('未选择任何项目');
      rl.close();
      process.exit(1);
    }

    logInfo(`已选择 ${selectedProjects.length} 个项目`);

    // 输入源分支
    if (!sourceBranch) {
      // 尝试获取第一个项目的当前分支作为默认值
      const firstProjectPath = path.join(SPA_ROOT, selectedProjects[0]);
      const defaultBranch = getCurrentBranch(firstProjectPath) || 'feature/';

      const input = await question(rl, `\n请输入源分支名 [${defaultBranch}]: `);
      sourceBranch = input.trim() || defaultBranch;
    }

    // 输入目标分支
    if (!options.targetBranch || options.targetBranch === 'master') {
      const input = await question(rl, `请输入目标分支名 [${targetBranch}]: `);
      if (input.trim()) {
        targetBranch = input.trim();
      }
    }

    // 输入标题
    if (!title) {
      title = await question(rl, '\n请输入 MR 标题: ');
      if (!title.trim()) {
        logError('MR 标题不能为空');
        rl.close();
        process.exit(1);
      }
      title = title.trim();
    }

    // 输入描述
    if (!description) {
      description = await question(rl, '请输入 MR 描述（可选，如 Jira 单号）: ');
      description = description.trim();
    }

    // 确认操作
    if (!options.yes) {
      console.log('\n即将执行以下操作:');
      console.log('─'.repeat(60));
      console.log(`  源分支:   ${sourceBranch}`);
      console.log(`  目标分支: ${targetBranch}`);
      console.log(`  MR 标题:  ${title}`);
      console.log(`  MR 描述:  ${description || '(无)'}`);
      console.log(`  Draft:    ${options.isDraft ? '是' : '否'}`);
      console.log(`  提交更改: ${options.commit ? '是' : '否'}`);
      if (options.commit) {
        console.log(`  提交信息: ${options.commitMsg || title}`);
      }
      console.log(`  推送分支: ${options.push ? '是' : '否'}`);
      console.log(`  项目数:   ${selectedProjects.length}`);
      console.log('─'.repeat(60));

      const confirm = await question(rl, '\n确认执行? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
        log('\n已取消操作', 'yellow');
        rl.close();
        process.exit(0);
      }
    }

    rl.close();

    // 执行创建 MR
    const results = [];
    for (const project of selectedProjects) {
      const result = await createMRForProject(project, {
        glabPath,
        sourceBranch,
        targetBranch,
        title,
        description,
        isDraft: options.isDraft,
        commit: options.commit,
        commitMsg: options.commitMsg,
        push: options.push,
      });
      results.push(result);
    }

    // 打印汇总结果
    console.log('\n' + '═'.repeat(60));
    log('  执行结果汇总', 'cyan');
    console.log('═'.repeat(60));

    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const failCount = results.filter(r => !r.success).length;

    // 成功的
    if (successCount > 0) {
      log('\n创建成功:', 'green');
      results.filter(r => r.success && !r.skipped).forEach(r => {
        console.log(`  ✓ ${r.project}`);
        if (r.url) {
          log(`    ${r.url}`, 'dim');
        }
      });
    }

    // 跳过的
    if (skippedCount > 0) {
      log('\n已跳过（MR 已存在）:', 'yellow');
      results.filter(r => r.skipped).forEach(r => {
        console.log(`  ⊘ ${r.project}`);
      });
    }

    // 失败的
    if (failCount > 0) {
      log('\n创建失败:', 'red');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  ✗ ${r.project}`);
        log(`    ${r.error}`, 'dim');
      });
    }

    console.log('\n' + '─'.repeat(60));
    logInfo(`成功: ${successCount} | 跳过: ${skippedCount} | 失败: ${failCount} | 总计: ${results.length}`);

    // 输出所有 MR URL 列表（方便复制）
    const urls = results.filter(r => r.url).map(r => r.url);
    if (urls.length > 0) {
      console.log('\n所有 MR 链接:');
      console.log('─'.repeat(60));
      urls.forEach(url => console.log(url));
    }
    console.log('');

  } catch (error) {
    rl.close();
    logError(`发生错误: ${error.message}`);
    process.exit(1);
  }
}

main().catch(error => {
  logError(`发生错误: ${error.message}`);
  process.exit(1);
});
