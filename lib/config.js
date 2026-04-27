const fs = require('fs');
const path = require('path');

const SCRIPT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_WORKSPACE_ROOT = path.resolve(SCRIPT_ROOT, '..');
const CURRENT_REPO_NAME = path.basename(SCRIPT_ROOT);
const WORKSPACE_ENV_NAME = 'SPA_ROOT_DIR';

const DEFAULT_BRANCH_BASE = 'auto';
const DEFAULT_BRANCH_BASE_CANDIDATES = [
  'origin/master',
  'origin/main',
  'master',
  'main',
];

const BRANCH_PREFIX_PATTERNS = [
  /^feature\/.+$/,
  /^fix\/.+$/,
  /^hotfix\/.+$/,
  /^release\/.+$/,
];

function resolveWorkspaceRoot() {
  const fromEnv = process.env[WORKSPACE_ENV_NAME];
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }

  if (fs.existsSync(DEFAULT_WORKSPACE_ROOT)) {
    return DEFAULT_WORKSPACE_ROOT;
  }

  return null;
}

module.exports = {
  BRANCH_PREFIX_PATTERNS,
  CURRENT_REPO_NAME,
  DEFAULT_BRANCH_BASE,
  DEFAULT_BRANCH_BASE_CANDIDATES,
  SCRIPT_ROOT,
  WORKSPACE_ENV_NAME,
  resolveWorkspaceRoot,
};
