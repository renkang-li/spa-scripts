const { listWorkspaceProjects } = require('../projects');
const { getCurrentBranch, getRemoteRepoPath, getWorkingTreeStatus } = require('../git');
const { DEFAULT_CONCURRENCY, mapConcurrent } = require('../async');

function buildProjectCatalog(projects = listWorkspaceProjects()) {
  return mapConcurrent(projects, DEFAULT_CONCURRENCY, async (project) => {
    const [currentBranch, remoteInfo, worktree] = await Promise.all([
      getCurrentBranch(project.path),
      getRemoteRepoPath(project.path),
      getWorkingTreeStatus(project.path),
    ]);

    return {
      name: project.name,
      path: project.path,
      currentBranch: currentBranch || 'unknown',
      repoPath: remoteInfo.repoPath || '(未配置 origin)',
      remoteUrl: remoteInfo.remoteUrl,
      dirty: worktree.entries.length > 0,
      dirtyEntries: worktree.entries,
    };
  });
}

module.exports = {
  buildProjectCatalog,
};
