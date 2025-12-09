#!/usr/bin/env node

/**
 * 批量创建分支脚本
 * 功能：
 * 1. 支持选择多个项目
 * 2. 切换到 master 分支
 * 3. 拉取最新代码
 * 4. 创建指定格式的分支 (feature/xxx)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置
const SPA_ROOT = path.resolve(__dirname, '..');
const BRANCH_PREFIX_PATTERNS = [
  /^feature\/.+$/,    // feature/xxx
  /^fix\/.+$/,        // fix/xxx
  /^hotfix\/.+$/,     // hotfix/xxx
  /^release\/.+$/,    // release/xxx
];

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
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
 * 验证分支名称格式
 */
function validateBranchName(branchName) {
  if (!branchName || branchName.trim() === '') {
    return { valid: false, message: '分支名不能为空' };
  }

  branchName = branchName.trim();

  // 检查是否匹配允许的前缀格式
  const isValidFormat = BRANCH_PREFIX_PATTERNS.some(pattern => pattern.test(branchName));

  if (!isValidFormat) {
    return {
      valid: false,
      message: `分支名格式不正确，请使用以下格式之一：\n  - feature/xxx\n  - fix/xxx\n  - hotfix/xxx\n  - release/xxx`,
    };
  }

  // 检查是否包含非法字符
  const invalidChars = /[\s~^:?*\[\]\\]/;
  if (invalidChars.test(branchName)) {
    return {
      valid: false,
      message: '分支名包含非法字符（空格、~、^、:、?、*、[、]、\\）',
    };
  }

  return { valid: true };
}

/**
 * 执行 Git 命令
 */
function execGit(projectPath, command) {
  try {
    const result = execSync(`git ${command}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: result.trim() };
  } catch (error) {
    return { success: false, error: error.stderr?.trim() || error.message };
  }
}

/**
 * 检查是否有未提交的更改
 */
function hasUncommittedChanges(projectPath) {
  const result = execGit(projectPath, 'status --porcelain');
  return result.success && result.output.length > 0;
}

/**
 * 获取当前分支名
 */
function getCurrentBranch(projectPath) {
  const result = execGit(projectPath, 'rev-parse --abbrev-ref HEAD');
  return result.success ? result.output : null;
}

/**
 * 检查分支是否已存在
 */
function branchExists(projectPath, branchName) {
  const result = execGit(projectPath, `rev-parse --verify ${branchName}`);
  return result.success;
}

/**
 * 为单个项目创建分支
 */
async function createBranchForProject(projectName, branchName, options = {}) {
  const projectPath = path.join(SPA_ROOT, projectName);
  const results = {
    project: projectName,
    steps: [],
    success: false,
  };

  log(`\n${'─'.repeat(50)}`, 'cyan');
  logInfo(`处理项目: ${projectName}`);

  // 步骤1: 检查未提交的更改
  if (hasUncommittedChanges(projectPath)) {
    if (options.stash) {
      logWarn('检测到未提交的更改，将自动 stash...');
      const stashResult = execGit(projectPath, 'stash');
      if (!stashResult.success) {
        logError(`Stash 失败: ${stashResult.error}`);
        results.steps.push({ step: 'stash', success: false, error: stashResult.error });
        return results;
      }
      results.steps.push({ step: 'stash', success: true });
    } else {
      logError('存在未提交的更改，请先提交或使用 --stash 选项');
      results.steps.push({ step: 'check-changes', success: false, error: '存在未提交的更改' });
      return results;
    }
  }

  // 步骤2: 切换到 master 分支
  logInfo('切换到 master 分支...');
  const checkoutResult = execGit(projectPath, 'checkout master');
  if (!checkoutResult.success) {
    // 尝试 main 分支
    const checkoutMainResult = execGit(projectPath, 'checkout main');
    if (!checkoutMainResult.success) {
      logError(`切换分支失败: ${checkoutResult.error}`);
      results.steps.push({ step: 'checkout-master', success: false, error: checkoutResult.error });
      return results;
    }
    logSuccess('已切换到 main 分支');
  } else {
    logSuccess('已切换到 master 分支');
  }
  results.steps.push({ step: 'checkout-master', success: true });

  // 步骤3: 拉取最新代码
  logInfo('拉取最新代码...');
  const pullResult = execGit(projectPath, 'pull origin');
  if (!pullResult.success) {
    logError(`拉取代码失败: ${pullResult.error}`);
    results.steps.push({ step: 'pull', success: false, error: pullResult.error });
    return results;
  }
  logSuccess('已拉取最新代码');
  results.steps.push({ step: 'pull', success: true });

  // 步骤4: 检查目标分支是否已存在
  if (branchExists(projectPath, branchName)) {
    if (options.force) {
      logWarn(`分支 ${branchName} 已存在，将删除后重新创建...`);
      const deleteResult = execGit(projectPath, `branch -D ${branchName}`);
      if (!deleteResult.success) {
        logError(`删除分支失败: ${deleteResult.error}`);
        results.steps.push({ step: 'delete-existing', success: false, error: deleteResult.error });
        return results;
      }
    } else {
      logWarn(`分支 ${branchName} 已存在，跳过创建`);
      results.steps.push({ step: 'check-exists', success: true, skipped: true });
      results.success = true;
      return results;
    }
  }

  // 步骤5: 创建新分支
  logInfo(`创建分支: ${branchName}...`);
  const branchResult = execGit(projectPath, `checkout -b ${branchName}`);
  if (!branchResult.success) {
    logError(`创建分支失败: ${branchResult.error}`);
    results.steps.push({ step: 'create-branch', success: false, error: branchResult.error });
    return results;
  }
  logSuccess(`已创建并切换到分支: ${branchName}`);
  results.steps.push({ step: 'create-branch', success: true });

  results.success = true;
  return results;
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
  console.log('─'.repeat(50));

  projects.forEach((project, index) => {
    console.log(`  ${(index + 1).toString().padStart(2, ' ')}. ${project}`);
  });

  console.log('─'.repeat(50));
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

  const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1);
  const selectedProjects = indices
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
批量创建分支脚本

用法:
  node create-branch.js [选项] [分支名]

选项:
  -h, --help      显示帮助信息
  -p, --projects  指定项目列表（逗号分隔）
  -a, --all       选择所有项目
  -s, --stash     自动 stash 未提交的更改
  -f, --force     如果分支已存在则强制重新创建
  -y, --yes       跳过确认提示

示例:
  node create-branch.js feature/new-feature
  node create-branch.js -a feature/JIRA-123
  node create-branch.js -p "spa-shop,spa-store" feature/update
  node create-branch.js -a -s -f feature/reset-branch

分支名格式要求:
  - feature/xxx  (新功能)
  - fix/xxx      (Bug 修复)
  - hotfix/xxx   (紧急修复)
  - release/xxx  (发布版本)
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
    stash: false,
    force: false,
    yes: false,
    branchName: null,
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
      case '--stash':
        options.stash = true;
        break;
      case '-f':
      case '--force':
        options.force = true;
        break;
      case '-y':
      case '--yes':
        options.yes = true;
        break;
      default:
        if (!arg.startsWith('-') && !options.branchName) {
          options.branchName = arg;
        }
        break;
    }
  }

  return options;
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

  console.log('\n' + '═'.repeat(50));
  log('  批量创建分支工具', 'cyan');
  console.log('═'.repeat(50));

  // 获取所有项目
  const allProjects = getAllProjects();

  if (allProjects.length === 0) {
    logError('未找到任何 Git 项目');
    process.exit(1);
  }

  logInfo(`发现 ${allProjects.length} 个 Git 项目`);

  const rl = createInterface();
  let selectedProjects = [];
  let branchName = options.branchName;

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

    // 输入分支名
    if (!branchName) {
      branchName = await question(rl, '\n请输入要创建的分支名 (例如: feature/new-feature): ');
    }

    // 验证分支名
    const validation = validateBranchName(branchName);
    if (!validation.valid) {
      logError(validation.message);
      rl.close();
      process.exit(1);
    }

    branchName = branchName.trim();

    // 确认操作
    if (!options.yes) {
      console.log('\n即将执行以下操作:');
      console.log('─'.repeat(50));
      console.log(`  分支名: ${branchName}`);
      console.log(`  项目数: ${selectedProjects.length}`);
      console.log(`  项目列表:`);
      selectedProjects.forEach(p => console.log(`    - ${p}`));
      console.log('─'.repeat(50));

      const confirm = await question(rl, '\n确认执行? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
        log('\n已取消操作', 'yellow');
        rl.close();
        process.exit(0);
      }
    }

    rl.close();

    // 执行创建分支
    const results = [];
    for (const project of selectedProjects) {
      const result = await createBranchForProject(project, branchName, {
        stash: options.stash,
        force: options.force,
      });
      results.push(result);
    }

    // 打印汇总结果
    console.log('\n' + '═'.repeat(50));
    log('  执行结果汇总', 'cyan');
    console.log('═'.repeat(50));

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    results.forEach(r => {
      const status = r.success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
      const skipped = r.steps.some(s => s.skipped) ? ' (分支已存在)' : '';
      console.log(`  ${status} ${r.project}${skipped}`);

      if (!r.success) {
        const failedStep = r.steps.find(s => !s.success);
        if (failedStep) {
          console.log(`      └─ ${failedStep.error}`);
        }
      }
    });

    console.log('─'.repeat(50));
    logInfo(`成功: ${successCount} | 失败: ${failCount} | 总计: ${results.length}`);
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
