// Merges the per-shard capture folders of one CI run into a single folder (PNGs, manifest.json, summary.json),
// e.g. to promote a sharded run to the committed baseline:
//   gh run download <run-id> -p 'liquid-goldens-*' -D <dir>
//   node scripts/goldens/merge-shards.js --out .agents/goldens/liquid/baseline <dir>/liquid-goldens-*/current
// See README.md.

import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (outIndex === -1 || !args[outIndex + 1]) {
  console.error("Usage: merge-shards.js --out <dir> <shard-dir>...");
  process.exit(1);
}
const out = args[outIndex + 1];
const shardDirs = args.filter((_, i) => i !== outIndex && i !== outIndex + 1);
if (0 === shardDirs.length) {
  console.error("No shard directories given.");
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
const manifest = [];
const summaries = [];
for (const dir of shardDirs) {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`${dir}: manifest.json missing (not a capture folder?)`);
    process.exit(1);
  }
  manifest.push(...JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const summaryPath = path.join(dir, "summary.json");
  if (fs.existsSync(summaryPath)) summaries.push(JSON.parse(fs.readFileSync(summaryPath, "utf8")));
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".png")) fs.copyFileSync(path.join(dir, f), path.join(out, f));
  }
}

const seen = new Set();
for (const cell of manifest) {
  const key = `${cell.poolKey}__${cell.view}`;
  if (seen.has(key)) {
    console.error(`Cell ${key} appears in more than one shard.`);
    process.exit(1);
  }
  seen.add(key);
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
const okCount = manifest.filter((e) => e.ok).length;
const first = summaries[0] ?? {};
fs.writeFileSync(
  path.join(out, "summary.json"),
  JSON.stringify(
    {
      ...first,
      cellsTotal: manifest.length,
      cellsOk: okCount,
      ok: okCount === manifest.length,
      shards: shardDirs.length,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  `Merged ${shardDirs.length} shard(s): ${manifest.length} cells (${okCount} OK) -> ${out}`,
);
