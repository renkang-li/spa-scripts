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
  bold: '\x1b[1m',
};

const symbols = {
  success: '✓',
  error: '✗',
  warn: '⚠',
  info: 'ℹ',
  skip: '⊘',
};

function paint(color, text) {
  const code = colors[color] || colors.reset;
  return `${code}${text}${colors.reset}`;
}

function stripAnsi(input) {
  return String(input).replace(/\u001b\[[0-9;]*m/g, '');
}

function visibleLength(input) {
  return stripAnsi(input).length;
}

function pad(input, width) {
  const text = String(input);
  const fill = Math.max(0, width - visibleLength(text));
  return text + ' '.repeat(fill);
}

function divider(width = 72, char = '─') {
  return char.repeat(width);
}

function printBanner(title, subtitle) {
  const width = 72;
  console.log(`\n${divider(width, '═')}`);
  console.log(paint('cyan', `  ${title}`));
  if (subtitle) {
    console.log(paint('dim', `  ${subtitle}`));
  }
  console.log(divider(width, '═'));
}

function printTable(columns, rows) {
  if (!rows.length) {
    console.log(paint('dim', '  (empty)'));
    return;
  }

  const renderedRows = rows.map((row) => columns.map((column) => {
    if (typeof column.render === 'function') {
      return String(column.render(row));
    }
    return String(row[column.key] ?? '');
  }));

  const widths = columns.map((column, index) => {
    const headerWidth = visibleLength(column.header);
    const rowWidth = Math.max(...renderedRows.map((row) => visibleLength(row[index])));
    return Math.max(headerWidth, rowWidth);
  });

  const header = columns.map((column, index) => pad(column.header, widths[index])).join('  ');
  const separator = columns.map((_column, index) => '─'.repeat(widths[index])).join('  ');

  console.log(header);
  console.log(separator);
  renderedRows.forEach((row) => {
    console.log(row.map((cell, index) => pad(cell, widths[index])).join('  '));
  });
}

function printKeyValues(items) {
  const keyWidth = Math.max(...items.map((item) => item.key.length), 0);
  items.forEach((item) => {
    console.log(`  ${item.key.padEnd(keyWidth)} : ${item.value}`);
  });
}

function info(message) {
  console.log(paint('blue', `${symbols.info} ${message}`));
}

function success(message) {
  console.log(paint('green', `${symbols.success} ${message}`));
}

function warn(message) {
  console.log(paint('yellow', `${symbols.warn} ${message}`));
}

function error(message) {
  console.log(paint('red', `${symbols.error} ${message}`));
}

function dim(message) {
  console.log(paint('dim', message));
}

function statusCell(type, text) {
  const colorMap = {
    success: 'green',
    error: 'red',
    warn: 'yellow',
    info: 'blue',
    skip: 'magenta',
  };

  const symbol = symbols[type] || '•';
  return paint(colorMap[type] || 'white', `${symbol} ${text}`);
}

module.exports = {
  colors,
  dim,
  divider,
  error,
  info,
  paint,
  printBanner,
  printKeyValues,
  printTable,
  statusCell,
  stripAnsi,
  success,
  symbols,
  warn,
};
