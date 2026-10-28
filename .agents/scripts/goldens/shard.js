// Shared by capture.js and compare.js: split the pools of the liquid goldens over N parallel CI jobs.
// Cells are independent (each one renders in its own deterministic page), so sharding by pool changes nothing
// about the pixels; it only spreads the 26 s per cell over several runners.

/**
 * Parses `"i/N"` (1-based) into `{ index, total }`.
 * @param {string} value
 * @returns {{ index: number, total: number }}
 */
export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  const index = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;
  if (!match || index < 1 || index > total) {
    throw new Error(`--shard must look like "2/4" (1 <= i <= N), got "${value}"`);
  }
  return { index, total };
}

/**
 * The pools of one shard, dealt round-robin so every shard gets a similar mix.
 * @param {string[]} poolKeys
 * @param {{ index: number, total: number }} shard
 * @returns {string[]}
 */
export function poolsForShard(poolKeys, shard) {
  return poolKeys.filter((_, i) => i % shard.total === shard.index - 1);
}
