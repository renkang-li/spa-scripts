#!/usr/bin/env node

/**
 * 批量创建版本 Tag 脚本
 * 功能：
 * 1. 支持选择多个项目
 * 2. 自动查找每个项目的最大正式版本号
 * 3. 基于最大版本号创建 RC 版本 tag
 * 4. 自动递增 RC 版本号
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置
const SPA_ROOT = process.env.SPA_ROOT_DIR
  ? path.resolve(process.env.SPA_ROOT_DIR)
  : path.resolve(__dirname, '..');

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
 * 解析版本号
 * 支持格式: v1.2.3, v1.2.3-rc.1, 1.2.3 等
 */
function parseVersion(versionStr) {
  // 移除开头的 'v'
  const cleanVersion = versionStr.replace(/^v/, '');

  // 分离主版本和预发布版本
  const [mainPart, prePart] = cleanVersion.split('-');
  const mainParts = mainPart.split('.').map(n => parseInt(n, 10));

  if (mainParts.some(isNaN) || mainParts.length < 3) {
    return null;
  }

  const result = {
    major: mainParts[0],
    minor: mainParts[1],
    patch: mainParts[2],
    preRelease: null,
    preReleaseNum: 0,
    original: versionStr,
  };

  // 解析预发布版本 (如 rc.1, alpha.2, beta.3)
  if (prePart) {
    const preMatch = prePart.match(/^(rc|alpha|beta)\.(\d+)$/i);
    if (preMatch) {
      result.preRelease = preMatch[1].toLowerCase();
      result.preReleaseNum = parseInt(preMatch[2], 10);
    }
  }

  return result;
}

/**
 * 比较两个版本号
 * 返回: 1 (a > b), -1 (a < b), 0 (a == b)
 */
function compareVersions(a, b) {
  // 比较主版本号
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  // 正式版本 > 预发布版本
  if (!a.preRelease && b.preRelease) return 1;
  if (a.preRelease && !b.preRelease) return -1;

  // 都是预发布版本
  if (a.preRelease && b.preRelease) {
    // 按字母排序: alpha < beta < rc
    const order = { alpha: 1, beta: 2, rc: 3 };
    if (order[a.preRelease] !== order[b.preRelease]) {
      return order[a.preRelease] - order[b.preRelease];
    }
    return a.preReleaseNum - b.preReleaseNum;
  }

  return 0;
}

/**
 * 从远程同步 tag
 */
function fetchTags(projectPath) {
  const result = execGit(projectPath, 'fetch --tags --force');
  return result;
}

/**
 * 获取项目的所有 tag
 */
function getAllTags(projectPath) {
  const result = execGit(projectPath, 'tag -l "v*"');
  if (!result.success || !result.output) {
    return [];
  }
  return result.output.split('\n').filter(t => t.trim());
}

/**
 * 获取最大的正式版本号
 */
function getMaxReleaseVersion(tags) {
  const versions = tags
    .map(parseVersion)
    .filter(v => v && !v.preRelease); // 只保留正式版本

  if (versions.length === 0) {
    return null;
  }

  versions.sort((a, b) => compareVersions(b, a)); // 降序排列
  return versions[0];
}

/**
 * 获取基于指定版本的最大 RC 版本号
 */
function getMaxRCVersion(tags, baseVersion) {
  const versions = tags
    .map(parseVersion)
    .filter(v => {
      if (!v || v.preRelease !== 'rc') return false;
      return (
        v.major === baseVersion.major &&
        v.minor === baseVersion.minor &&
        v.patch === baseVersion.patch
      );
    });

  if (versions.length === 0) {
    return 0;
  }

  versions.sort((a, b) => b.preReleaseNum - a.preReleaseNum);
  return versions[0].preReleaseNum;
}

/**
 * 生成下一个 RC 版本号
 */
function getNextRCVersion(tags) {
  const maxRelease = getMaxReleaseVersion(tags);

  if (!maxRelease) {
    return { success: false, error: '未找到正式版本 tag' };
  }

  const maxRC = getMaxRCVersion(tags, maxRelease);
  const nextRC = maxRC + 1;

  const nextVersion = `v${maxRelease.major}.${maxRelease.minor}.${maxRelease.patch}-rc.${nextRC}`;

  return {
    success: true,
    version: nextVersion,
    baseVersion: `v${maxRelease.major}.${maxRelease.minor}.${maxRelease.patch}`,
    rcNumber: nextRC,
  };
}

/**
 * 创建 tag
 */
function createTag(projectPath, tagName, message) {
  const result = execGit(projectPath, `tag -a "${tagName}" -m "${message}"`);
  return result;
}

/**
 * 推送 tag 到远程
 */
function pushTag(projectPath, tagName) {
  const result = execGit(projectPath, `push origin "${tagName}"`);
  return result;
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
  console.log('─'.repeat(70));

  for (let index = 0; index < projects.length; index++) {
    const project = projects[index];
    const projectPath = path.join(SPA_ROOT, project);
    // 先同步远程 tag
    fetchTags(projectPath);
    const tags = getAllTags(projectPath);
    const maxRelease = getMaxReleaseVersion(tags);
    const versionInfo = maxRelease
      ? `v${maxRelease.major}.${maxRelease.minor}.${maxRelease.patch}`
      : '无版本';
    const versionColor = maxRelease ? 'cyan' : 'dim';

    console.log(
      `  ${(index + 1).toString().padStart(2, ' ')}. ${project.padEnd(30)} ${colors[versionColor]}[${versionInfo}]${colors.reset}`
    );
  }

  console.log('─'.repeat(70));
  console.log('  a. 全选所有项目');
  console.log('  q. 退出');
  console.log('');

  const answer = await question(rl, '请输入项目编号（多个用逗号分隔，如: 1,2,3 或范围 1-5）: ');

  if (answer.toLowerCase() === 'q') {
    return null;
  }

  if (answer.toLowerCase() === 'a') {
    return projects;
  }

  // 支持范围选择
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
批量创建版本 Tag 脚本

用法:
  node create-version.js [选项]

选项:
  -h, --help       显示帮助信息
  -p, --projects   指定项目列表（逗号分隔）
  -a, --all        选择所有项目
  -m, --message    Tag 消息（默认使用版本号）
  --push           自动推送 tag 到远程
  --dry-run        仅显示将要创建的 tag，不实际执行
  -y, --yes        跳过确认提示

示例:
  node create-version.js
  node create-version.js -a --push
  node create-version.js -p "spa-shop,spa-store" --push
  node create-version.js -a --dry-run
  node create-version.js -a -m "Release candidate" --push

版本命名规则:
  - 基于最大正式版本号 (vX.Y.Z) 创建 RC 版本
  - 如果 v1.2.3 是最大版本，将创建 v1.2.3-rc.1
  - 如果已存在 v1.2.3-rc.1，将创建 v1.2.3-rc.2
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
    message: null,
    push: false,
    dryRun: false,
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
      case '-m':
      case '--message':
        if (args[i + 1]) {
          options.message = args[++i];
        }
        break;
      case '--push':
        options.push = true;
        break;
      case '--dry-run':
        options.dryRun = true;
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
 * 为单个项目创建 tag
 */
async function createTagForProject(projectName, options) {
  const { message, push, dryRun } = options;
  const projectPath = path.join(SPA_ROOT, projectName);

  const result = {
    project: projectName,
    success: false,
    tag: null,
    baseVersion: null,
    error: null,
    pushed: false,
  };

  log(`\n${'─'.repeat(60)}`, 'cyan');
  logInfo(`处理项目: ${projectName}`);

  // 先同步远程 tag
  logInfo('同步远程 tag...');
  const fetchResult = fetchTags(projectPath);
  if (!fetchResult.success) {
    logWarn(`同步 tag 失败: ${fetchResult.error}`);
  }

  // 获取所有 tag
  const tags = getAllTags(projectPath);
  if (tags.length === 0) {
    logError('未找到任何版本 tag');
    result.error = '未找到任何版本 tag';
    return result;
  }

  // 计算下一个 RC 版本
  const nextVersion = getNextRCVersion(tags);
  if (!nextVersion.success) {
    logError(nextVersion.error);
    result.error = nextVersion.error;
    return result;
  }

  result.tag = nextVersion.version;
  result.baseVersion = nextVersion.baseVersion;

  log(`  基础版本: ${nextVersion.baseVersion}`, 'dim');
  log(`  新 RC:    ${nextVersion.version}`, 'cyan');

  if (dryRun) {
    logWarn('(dry-run) 将创建此 tag');
    result.success = true;
    return result;
  }

  // 创建 tag
  const tagMessage = message || nextVersion.version;
  logInfo(`创建 tag: ${nextVersion.version}...`);
  const createResult = createTag(projectPath, nextVersion.version, tagMessage);

  if (!createResult.success) {
    logError(`创建 tag 失败: ${createResult.error}`);
    result.error = createResult.error;
    return result;
  }

  logSuccess(`Tag ${nextVersion.version} 创建成功`);
  result.success = true;

  // 推送 tag
  if (push) {
    logInfo('推送 tag 到远程...');
    const pushResult = pushTag(projectPath, nextVersion.version);
    if (!pushResult.success) {
      logWarn(`推送失败: ${pushResult.error}`);
    } else {
      logSuccess('Tag 已推送');
      result.pushed = true;
    }
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
  log('  批量创建版本 Tag 工具', 'cyan');
  console.log('═'.repeat(60));

  // 获取所有项目
  const allProjects = getAllProjects();

  if (allProjects.length === 0) {
    logError('未找到任何 Git 项目');
    process.exit(1);
  }

  logInfo(`发现 ${allProjects.length} 个 Git 项目`);

  const rl = createInterface();
  let selectedProjects = [];

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

    // 预览将要创建的 tag
    console.log('\n将要创建的 Tag:');
    console.log('─'.repeat(60));

    const previewResults = [];
    logInfo('正在同步远程 tag 并计算版本号...');
    for (const project of selectedProjects) {
      const projectPath = path.join(SPA_ROOT, project);
      // 同步远程 tag
      fetchTags(projectPath);
      const tags = getAllTags(projectPath);
      const nextVersion = getNextRCVersion(tags);

      if (nextVersion.success) {
        console.log(`  ${project.padEnd(30)} ${colors.cyan}${nextVersion.version}${colors.reset}`);
        previewResults.push({ project, ...nextVersion });
      } else {
        console.log(`  ${project.padEnd(30)} ${colors.red}(${nextVersion.error})${colors.reset}`);
        previewResults.push({ project, success: false, error: nextVersion.error });
      }
    }
    console.log('─'.repeat(60));

    const validProjects = previewResults.filter(p => p.success);
    if (validProjects.length === 0) {
      logError('没有可创建 tag 的项目');
      rl.close();
      process.exit(1);
    }

    // 交互式询问是否推送（如果命令行没有指定）
    let shouldPush = options.push;
    if (!options.push && !options.yes && !options.dryRun) {
      const pushAnswer = await question(rl, '\n是否推送 tag 到远程? (Y/n): ');
      shouldPush = pushAnswer.toLowerCase() !== 'n';
      options.push = shouldPush;
    }

    // 确认操作
    if (!options.yes && !options.dryRun) {
      console.log(`\n操作选项:`);
      console.log(`  推送 tag:  ${options.push ? '是' : '否'}`);
      console.log(`  有效项目:  ${validProjects.length} 个`);

      const confirm = await question(rl, '\n确认创建这些 tag? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
        log('\n已取消操作', 'yellow');
        rl.close();
        process.exit(0);
      }
    }

    rl.close();

    // 执行创建 tag
    const results = [];
    for (const project of selectedProjects) {
      const result = await createTagForProject(project, {
        message: options.message,
        push: options.push,
        dryRun: options.dryRun,
      });
      results.push(result);
    }

    // 打印汇总结果
    console.log('\n' + '═'.repeat(60));
    log('  执行结果汇总', 'cyan');
    console.log('═'.repeat(60));

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const pushedCount = results.filter(r => r.pushed).length;

    // 成功的
    if (successCount > 0) {
      log('\n创建成功:', 'green');
      results.filter(r => r.success).forEach(r => {
        const pushStatus = r.pushed ? ' (已推送)' : '';
        console.log(`  ✓ ${r.project.padEnd(30)} ${r.tag}${pushStatus}`);
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
    if (options.dryRun) {
      logWarn('(dry-run 模式，未实际创建任何 tag)');
    }
    logInfo(`成功: ${successCount} | 失败: ${failCount} | 已推送: ${pushedCount} | 总计: ${results.length}`);

    // 如果未推送，提示推送命令
    if (!options.push && successCount > 0 && !options.dryRun) {
      console.log('\n提示: 使用以下命令推送所有 tag:');
      results.filter(r => r.success).forEach(r => {
        console.log(`  cd ${r.project} && git push origin ${r.tag}`);
      });
    }

    // 输出简洁格式的版本列表（方便复制）
    if (successCount > 0) {
      console.log('\n版本列表（可复制）:');
      console.log('─'.repeat(60));
      results.filter(r => r.success).forEach(r => {
        console.log(`${r.project}:${r.tag}`);
      });
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
