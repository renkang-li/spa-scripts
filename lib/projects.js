const fs = require('fs');
const path = require('path');
const { CURRENT_REPO_NAME, resolveWorkspaceRoot } = require('./config');
const { selectProjects } = require('./prompt');

function listWorkspaceProjects(options = {}) {
  const workspaceRoot = resolveWorkspaceRoot();
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    return [];
  }

  const includeSelf = options.includeSelf === true;

  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => includeSelf || name !== CURRENT_REPO_NAME)
    .filter((name) => fs.existsSync(path.join(workspaceRoot, name, '.git')))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      path: path.join(workspaceRoot, name),
    }));
}

function resolveSelectedProjects(allProjects, projectNames) {
  const projectMap = new Map(allProjects.map((project) => [project.name, project]));
  const selected = [];
  const invalid = [];

  projectNames.forEach((projectName) => {
    const project = projectMap.get(projectName);
    if (project) {
      selected.push(project);
    } else {
      invalid.push(projectName);
    }
  });

  return { selected, invalid };
}

async function chooseProjects(allProjects, options) {
  const { prompt, columns, projectRows } = options;

  if (options.all) {
    return {
      selected: allProjects,
      invalid: [],
    };
  }

  if (options.projects.length > 0) {
    return resolveSelectedProjects(allProjects, options.projects);
  }

  const selectedNames = await selectProjects(prompt, projectRows, { columns });
  if (selectedNames === null) {
    return null;
  }

  return resolveSelectedProjects(allProjects, selectedNames);
}

module.exports = {
  chooseProjects,
  listWorkspaceProjects,
  resolveSelectedProjects,
};
