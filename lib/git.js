const { DEFAULT_BRANCH_BASE_CANDIDATES } = require('./config');
const { runProcess } = require('./process');

function git(projectPath, args) {
  return runProcess('git', args, { cwd: projectPath });
}

async function getWorkingTreeStatus(projectPath) {
  const result = await git(projectPath, ['status', '--porcelain']);
  const entries = result.success && result.stdout
    ? result.stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean)
    : [];

  return {
    success: result.success,
    entries,
    output: result.stdout || '',
    error: result.combined || result.error || null,
  };
}

async function getRemoteUrl(projectPath, remoteName = 'origin') {
  const result = await git(projectPath, ['remote', 'get-url', remoteName]);
  return result.success ? result.stdout.trim() : null;
}

function extractRepoPathFromRemote(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }

  const normalized = remoteUrl.trim().replace(/\.git$/, '');

  const sshMatch = normalized.match(/^[^@]+@[^:]+:(.+)$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  try {
    const parsedUrl = new URL(normalized);
    return parsedUrl.pathname.replace(/^\/+/, '') || normalized;
  } catch {
    return normalized;
  }
}

async function getRemoteRepoPath(projectPath, remoteName = 'origin') {
  const remoteUrl = await getRemoteUrl(projectPath, remoteName);
  const repoPath = extractRepoPathFromRemote(remoteUrl);

  return {
    remoteUrl,
    repoPath,
  };
}

async function getCurrentBranch(projectPath) {
  const result = await git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.success ? result.stdout.trim() : null;
}

async function hasUncommittedChanges(projectPath) {
  const status = await getWorkingTreeStatus(projectPath);
  return status.entries.length > 0;
}

async function localBranchExists(projectPath, branchName) {
  const result = await git(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
  return result.success;
}

async function remoteBranchExists(projectPath, branchName, remoteName = 'origin') {
  const result = await git(projectPath, ['show-ref', '--verify', '--quiet', `refs/remotes/${remoteName}/${branchName}`]);
  return result.success;
}

async function refExists(projectPath, refName) {
  const result = await git(projectPath, ['rev-parse', '--verify', `${refName}^{commit}`]);
  return result.success;
}

// 同一项目短时间内的重复 fetch 直接复用结果（UI 的 plan→run 会连续触发两次），
// 并发的同类 fetch 也共享同一个进程。仅缓存成功结果。
const parsedFetchTtl = Number(process.env.SPA_SCRIPTS_FETCH_TTL_MS);
const FETCH_TTL_MS = Number.isFinite(parsedFetchTtl) && parsedFetchTtl >= 0
  ? parsedFetchTtl
  : 30 * 1000;
const fetchCache = new Map();

function throttledFetch(cacheKey, runFetch) {
  const cached = fetchCache.get(cacheKey);
  if (cached) {
    if (cached.pending) {
      return cached.pending;
    }
    if (Date.now() - cached.finishedAt < FETCH_TTL_MS) {
      return Promise.resolve(cached.result);
    }
  }

  const pending = runFetch().then((result) => {
    if (result.success) {
      fetchCache.set(cacheKey, { result, finishedAt: Date.now() });
    } else {
      fetchCache.delete(cacheKey);
    }
    return result;
  }, (error) => {
    fetchCache.delete(cacheKey);
    throw error;
  });

  fetchCache.set(cacheKey, { pending });
  return pending;
}

function fetchOrigin(projectPath) {
  return throttledFetch(`origin:${projectPath}`,
    () => git(projectPath, ['fetch', 'origin', '--prune']));
}

function fetchTags(projectPath) {
  return throttledFetch(`tags:${projectPath}`,
    () => git(projectPath, ['fetch', '--tags', '--force']));
}

async function resolveBaseRef(projectPath, requestedBaseRef) {
  const candidates = requestedBaseRef === 'auto'
    ? DEFAULT_BRANCH_BASE_CANDIDATES
    : [requestedBaseRef];

  const existsList = await Promise.all(
    candidates.map((candidate) => refExists(projectPath, candidate))
  );
  const matchedIndex = existsList.findIndex(Boolean);
  if (matchedIndex >= 0) {
    return { success: true, ref: candidates[matchedIndex] };
  }

  return {
    success: false,
    error: requestedBaseRef === 'auto'
      ? `未找到可用基线，请检查 ${DEFAULT_BRANCH_BASE_CANDIDATES.join(', ')}`
      : `未找到基线 ${requestedBaseRef}`,
  };
}

function checkoutRef(projectPath, refName) {
  return git(projectPath, ['checkout', refName]);
}

function checkoutLocalBranch(projectPath, branchName) {
  return git(projectPath, ['checkout', branchName]);
}

function checkoutRemoteBranch(projectPath, branchName, remoteName = 'origin') {
  return git(projectPath, ['checkout', '--track', '-b', branchName, `${remoteName}/${branchName}`]);
}

function createBranch(projectPath, branchName, refName) {
  return git(projectPath, ['checkout', '-b', branchName, refName]);
}

function pushBranch(projectPath, branchName) {
  return git(projectPath, ['push', '-u', 'origin', branchName]);
}

async function commitAll(projectPath, message) {
  const addResult = await git(projectPath, ['add', '-A']);
  if (!addResult.success) {
    return addResult;
  }

  return git(projectPath, ['commit', '-m', message]);
}

async function getAllTags(projectPath) {
  const result = await git(projectPath, ['tag', '-l', 'v*']);
  if (!result.success || !result.stdout) {
    return [];
  }
  return result.stdout.split('\n').map((item) => item.trim()).filter(Boolean);
}

function createAnnotatedTag(projectPath, tagName, message) {
  return git(projectPath, ['tag', '-a', tagName, '-m', message]);
}

function createAnnotatedTagAt(projectPath, tagName, message, ref) {
  return git(projectPath, ['tag', '-a', tagName, '-m', message, ref]);
}

function pushTag(projectPath, tagName) {
  return git(projectPath, ['push', 'origin', tagName]);
}

function parseVersion(versionStr) {
  const cleanVersion = versionStr.replace(/^v/, '');
  const [mainPart, prePart] = cleanVersion.split('-');
  const mainParts = mainPart.split('.').map((value) => parseInt(value, 10));

  if (mainParts.length < 3 || mainParts.some(Number.isNaN)) {
    return null;
  }

  const version = {
    major: mainParts[0],
    minor: mainParts[1],
    patch: mainParts[2],
    preRelease: null,
    preReleaseNum: 0,
    original: versionStr,
  };

  if (prePart) {
    const matched = prePart.match(/^(rc|alpha|beta)\.(\d+)$/i);
    if (matched) {
      version.preRelease = matched[1].toLowerCase();
      version.preReleaseNum = parseInt(matched[2], 10);
    }
  }

  return version;
}

function compareVersions(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  if (!left.preRelease && right.preRelease) {
    return 1;
  }
  if (left.preRelease && !right.preRelease) {
    return -1;
  }

  if (left.preRelease && right.preRelease) {
    const order = { alpha: 1, beta: 2, rc: 3 };
    if (order[left.preRelease] !== order[right.preRelease]) {
      return order[left.preRelease] - order[right.preRelease];
    }
    return left.preReleaseNum - right.preReleaseNum;
  }

  return 0;
}

function getMaxReleaseVersion(tags) {
  const releases = tags
    .map(parseVersion)
    .filter((version) => version && !version.preRelease);

  if (!releases.length) {
    return null;
  }

  releases.sort((left, right) => compareVersions(right, left));
  return releases[0];
}

function getMaxRcVersion(tags, baseVersion) {
  const candidates = tags
    .map(parseVersion)
    .filter((version) => version
      && version.preRelease === 'rc'
      && version.major === baseVersion.major
      && version.minor === baseVersion.minor
      && version.patch === baseVersion.patch);

  if (!candidates.length) {
    return 0;
  }

  candidates.sort((left, right) => right.preReleaseNum - left.preReleaseNum);
  return candidates[0].preReleaseNum;
}

function getNextRcVersion(tags) {
  const maxRelease = getMaxReleaseVersion(tags);

  if (!maxRelease) {
    return { success: false, error: '未找到正式版本 tag' };
  }

  const nextRc = getMaxRcVersion(tags, maxRelease) + 1;
  const baseVersion = `v${maxRelease.major}.${maxRelease.minor}.${maxRelease.patch}`;

  return {
    success: true,
    version: `${baseVersion}-rc.${nextRc}`,
    baseVersion,
    rcNumber: nextRc,
  };
}

module.exports = {
  checkoutRef,
  checkoutLocalBranch,
  checkoutRemoteBranch,
  commitAll,
  createAnnotatedTag,
  createAnnotatedTagAt,
  createBranch,
  fetchOrigin,
  fetchTags,
  getAllTags,
  getCurrentBranch,
  getMaxReleaseVersion,
  getNextRcVersion,
  getRemoteRepoPath,
  getRemoteUrl,
  getWorkingTreeStatus,
  git,
  hasUncommittedChanges,
  localBranchExists,
  pushBranch,
  pushTag,
  refExists,
  remoteBranchExists,
  resolveBaseRef,
};
