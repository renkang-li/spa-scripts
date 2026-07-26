const parsedConcurrency = Number(process.env.SPA_SCRIPTS_CONCURRENCY);
const DEFAULT_CONCURRENCY = Number.isFinite(parsedConcurrency) && parsedConcurrency >= 1
  ? Math.floor(parsedConcurrency)
  : 8;

async function mapConcurrent(items, limit, iteratee) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await iteratee(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

module.exports = {
  DEFAULT_CONCURRENCY,
  mapConcurrent,
};
