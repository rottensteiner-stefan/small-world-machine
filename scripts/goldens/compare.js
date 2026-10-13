// Liquid goldens: drift comparison between a committed baseline and a fresh capture.
//
// Exit codes (documented in README.md):
//   0  all cells within tolerance and no technical errors
//   1  technical failure (missing image, unreadable PNG, blank current cell)
//   2  drift violation (diff ratio above threshold)

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import config from "./config.json" with { type: "json" };
import { parseShard, poolsForShard } from "./shard.js";

function parseArgs(argv) {
  const args = {
    baseline: null,
    current: null,
    maxDiffRatio: null,
    report: null,
    threshold: null,
    pool: null,
    shard: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--baseline":
        args.baseline = value;
        i++;
        break;
      case "--current":
        args.current = value;
        i++;
        break;
      case "--max-diff-ratio":
        args.maxDiffRatio = Number(value);
        i++;
        break;
      case "--pixelmatch-threshold":
        args.threshold = Number(value);
        i++;
        break;
      case "--pool":
        args.pool = value;
        i++;
        break;
      case "--shard":
        args.shard = parseShard(value);
        i++;
        break;
      case "--report":
        args.report = value;
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.baseline) {
    args.baseline = ".agents/goldens/liquid/baseline";
  }
  if (!args.current) {
    // Defaulting to the baseline would compare it with itself and report a false green.
    throw new Error("--current <dir> is required");
  }
  return args;
}

async function readManifest(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
}
const maxDiffRatio = args.maxDiffRatio ?? config.maxDiffRatio;
const pixelmatchThreshold = args.threshold ?? config.pixelmatchThreshold;

async function main() {
  const baselineFiles = {};
  if (fs.existsSync(args.baseline)) {
    for (const f of fs.readdirSync(args.baseline)) {
      if (f.endsWith(".png")) baselineFiles[f] = true;
    }
  }

  const shardPools = args.shard ? poolsForShard(config.poolKeys, args.shard) : null;
  const manifest = await readManifest(args.current);
  const cells = manifest ? [...manifest] : [];
  const cellFile = (cell) => cell.file ?? `${cell.poolKey}__${cell.view}.png`;
  const knownFiles = new Set(cells.map(cellFile));
  // A baseline cell the current run never produced must surface as an error, not vanish.
  for (const f of Object.keys(baselineFiles)) {
    if (args.pool && !f.startsWith(`${args.pool}__`)) continue;
    // A sharded run only produced its own pools; the other shards' baseline cells are not "missing".
    if (shardPools && !shardPools.some((pool) => f.startsWith(`${pool}__`))) continue;
    if (!knownFiles.has(f)) cells.push({ file: f });
  }

  const rows = [];
  let driftViolation = false;
  let technicalError = false;

  for (const cell of cells) {
    const file = cellFile(cell);
    const label = file.replace(/\.png$/, "");
    const currentPath = path.join(args.current, file);
    const baselinePath = path.join(args.baseline, file);

    if (!fs.existsSync(currentPath)) {
      rows.push({ label, status: "ERR", detail: "current image missing" });
      technicalError = true;
      continue;
    }
    if (!fs.existsSync(baselinePath)) {
      rows.push({ label, status: "ERR", detail: "baseline image missing" });
      technicalError = true;
      continue;
    }
    if (cell.blank) {
      rows.push({ label, status: "ERR", detail: "current cell is blank (stddev below threshold)" });
      technicalError = true;
      continue;
    }

    let img1, img2;
    try {
      img1 = readPng(baselinePath);
      img2 = readPng(currentPath);
    } catch (err) {
      rows.push({ label, status: "ERR", detail: `unreadable PNG (${err.message})` });
      technicalError = true;
      continue;
    }

    if (img1.width !== img2.width || img1.height !== img2.height) {
      rows.push({
        label,
        status: "ERR",
        detail: `size mismatch (${img1.width}x${img1.height} vs ${img2.width}x${img2.height})`,
      });
      technicalError = true;
      continue;
    }

    const width = img1.width;
    const height = img1.height;
    const diff = new PNG({ width, height });
    const diffCount = pixelmatch(img1.data, img2.data, diff.data, width, height, {
      threshold: pixelmatchThreshold,
    });
    const diffRatio = diffCount / (width * height);

    const poolKey = label.split("__")[0];
    const override = config.poolOverrides?.[poolKey];
    const allowed = Number.isFinite(override) ? override : maxDiffRatio;

    if (diffCount === 0) {
      rows.push({ label, status: "OK", detail: "byte-identical", diffRatio });
    } else if (diffRatio <= allowed) {
      rows.push({
        label,
        status: "DIFF",
        detail: `within tolerance (${(diffRatio * 100).toFixed(4)}%)`,
        diffRatio,
      });
    } else {
      rows.push({
        label,
        status: "FAIL",
        detail: `drift ${(diffRatio * 100).toFixed(4)}% > ${(allowed * 100).toFixed(2)}%`,
        diffRatio,
      });
      driftViolation = true;
    }
  }

  let width = 12;
  for (const r of rows) width = Math.max(width, r.label.length + 1);
  for (const r of rows) {
    const detail =
      "diffRatio" in r
        ? `  [${(r.diffRatio * 100).toFixed(4)}% diff] ${r.detail}`
        : `  ${r.detail}`;
    console.log(`${r.status.padEnd(5)} ${r.label.padEnd(width)} ${detail}`);
  }

  const readBrowser = (dir) => {
    const summaryPath = path.join(dir, "summary.json");
    if (!fs.existsSync(summaryPath)) return undefined;
    return JSON.parse(fs.readFileSync(summaryPath, "utf8")).browser;
  };
  const baselineBrowser = readBrowser(args.baseline);
  const currentBrowser = readBrowser(args.current);
  if (baselineBrowser === undefined) {
    console.log(
      "NOTE  baseline has no recorded browser version; drift cannot be attributed to a browser change.",
    );
  } else if (currentBrowser !== undefined && baselineBrowser !== currentBrowser) {
    console.log(
      `WARN  browser differs: baseline ${baselineBrowser}, current ${currentBrowser} -- drift may be browser-induced.`,
    );
  }

  const okRows = rows.filter((r) => r.status === "OK" || r.status === "DIFF").length;
  console.log(
    `\n${okRows}/${rows.length} cells within tolerance (threshold=${(maxDiffRatio * 100).toFixed(2)}%)`,
  );

  if (args.report) {
    const report = {
      baseline: args.baseline,
      current: args.current,
      maxDiffRatio,
      pixelmatchThreshold,
      rows,
      ok: !driftViolation && !technicalError,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
  }

  if (technicalError) return 1;
  if (driftViolation) return 2;
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
