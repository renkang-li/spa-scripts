function applyOptionValue(definition, rawValue) {
  if (typeof definition.parse === 'function') {
    return definition.parse(rawValue);
  }

  if (definition.type === 'list') {
    return rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return rawValue;
}

function normalizeOptionName(name) {
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function parseArgs(argv, schema) {
  const byLong = new Map();
  const byShort = new Map();
  const options = {};

  schema.forEach((definition) => {
    byLong.set(definition.name, definition);

    if (definition.alias) {
      byShort.set(definition.alias, definition);
    }

    if (definition.default !== undefined) {
      options[definition.name] = definition.default;
    } else if (definition.type === 'boolean') {
      options[definition.name] = false;
    } else if (definition.type === 'list') {
      options[definition.name] = [];
    } else {
      options[definition.name] = null;
    }
  });

  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [rawName, inlineValue] = arg.slice(2).split('=');

      if (rawName.startsWith('no-')) {
        const definition = byLong.get(normalizeOptionName(rawName.slice(3)));
        if (!definition || definition.type !== 'boolean') {
          throw new Error(`Unknown flag: --${rawName}`);
        }
        options[definition.name] = false;
        continue;
      }

      const name = normalizeOptionName(rawName);
      const definition = byLong.get(name);
      if (!definition) {
        throw new Error(`Unknown option: --${rawName}`);
      }

      if (definition.type === 'boolean') {
        options[definition.name] = true;
        continue;
      }

      const value = inlineValue !== undefined ? inlineValue : argv[++index];
      if (value === undefined) {
        throw new Error(`Option --${rawName} requires a value`);
      }

      options[definition.name] = applyOptionValue(definition, value);
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') {
      const shortName = arg.slice(1);
      const definition = byShort.get(shortName);
      if (!definition) {
        throw new Error(`Unknown option: -${shortName}`);
      }

      if (definition.type === 'boolean') {
        options[definition.name] = true;
        continue;
      }

      const value = argv[++index];
      if (value === undefined) {
        throw new Error(`Option -${shortName} requires a value`);
      }

      options[definition.name] = applyOptionValue(definition, value);
      continue;
    }

    positionals.push(arg);
  }

  return {
    options,
    positionals,
  };
}

module.exports = {
  parseArgs,
};
