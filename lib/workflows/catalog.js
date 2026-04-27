const { listWorkspaceProjects } = require('../projects');
const { getCurrentBranch, getRemoteRepoPath, getWorkingTreeStatus } = require('../git');

function buildProjectCatalog(projects = listWorkspaceProjects()) {
  return projects.map((project) => {
    const currentBranch = getCurrentBranch(project.path) || 'unknown';
    const { repoPath, remoteUrl } = getRemoteRepoPath(project.path);
    const worktree = getWorkingTreeStatus(project.path);

    return {
      name: project.name,
      path: project.path,
      currentBranch,
      repoPath: repoPath || '(未配置 origin)',
      remoteUrl,
      dirty: worktree.entries.length > 0,
      dirtyEntries: worktree.entries,
    };
  });
}

module.exports = {
  buildProjectCatalog,
};
