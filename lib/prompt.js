const readline = require('readline');
const { divider, printTable } = require('./terminal');

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask(query) {
      return new Promise((resolve) => rl.question(query, resolve));
    },
    async confirm(query, defaultValue = false) {
      const answer = (await this.ask(query)).trim().toLowerCase();
      if (!answer) {
        return defaultValue;
      }
      return answer === 'y' || answer === 'yes';
    },
    close() {
      rl.close();
    },
  };
}

function parseSelectionInput(answer, projectNames) {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  if (normalized === 'a' || normalized === 'all' || normalized === '*') {
    return [...projectNames];
  }

  const indices = [];
  const selectedNames = [];

  for (const part of answer.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (/^\d+-\d+$/.test(part)) {
      const [start, end] = part.split('-').map((item) => parseInt(item, 10));
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      for (let index = from; index <= to; index += 1) {
        indices.push(index - 1);
      }
      continue;
    }

    if (/^\d+$/.test(part)) {
      indices.push(parseInt(part, 10) - 1);
      continue;
    }

    if (projectNames.includes(part)) {
      selectedNames.push(part);
    }
  }

  const fromIndices = indices
    .filter((index) => index >= 0 && index < projectNames.length)
    .map((index) => projectNames[index]);

  return [...new Set([...selectedNames, ...fromIndices])];
}

async function selectProjects(prompt, rows, options = {}) {
  const columns = options.columns || [
    { header: '#', key: 'index' },
    { header: '项目', key: 'name' },
  ];

  console.log('\n可用项目:');
  console.log(divider());
  printTable(columns, rows.map((row, index) => ({
    ...row,
    index: String(index + 1).padStart(2, ' '),
  })));
  console.log(divider());
  console.log('  输入项目编号、范围或项目名，例如: 1,3-5,spa-shop');
  console.log('  输入 a 全选，输入 q 退出');

  const answer = (await prompt.ask('\n请选择项目: ')).trim();
  if (!answer) {
    return [];
  }

  if (answer.toLowerCase() === 'q') {
    return null;
  }

  const projectNames = rows.map((row) => row.name);
  return parseSelectionInput(answer, projectNames);
}

module.exports = {
  createPrompt,
  selectProjects,
};
