// scripts/goldens/adopt-ci.js (M4 der Goldens-Optimierung)
//
// Eine Kommandozeile für den Baseline-Neuaufnahme-Ablauf aus CI-Artefakten. Ersetzt die manuelle
// Kette „4 Artefakte laden + merge-shards + compare". Nach dem Lauf öffnet der Mensch den
// Review-Report; bei Bedarf wird mit `--accept` im selben Aufruf direkt adoptiert.
//
//   node scripts/goldens/adopt-ci.js --run-id <id> [--accept] [--out <dir>] [--baseline <dir>]
//
// Ablauf:
//   1. gh run download <run-id> -p 'liquid-goldens-*' -D <tmp>
//   2. merge-shards.js --out <merged> <liquid-goldens-*/current ...>  (Validiert Doppel-Zellen)
//   3. compare.js --baseline <baseline> --current <merged> --report <json> --report-html <review.html> [--accept]
//
// Wichtig (siehe README): Baseline auf dem Mac vs. Linux-Runner driftet (0,6–1,8 % in oblique),
// deshalb ist der CI-Artefakt-Weg der verbindliche Regenerate-Pfad.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..", "..");
const DEFAULT_BASELINE = path.join(ROOT, ".agents", "goldens", "liquid", "baseline");

function parseArgs(argv) {
  const args = { runId: null, accept: false, out: null, baseline: DEFAULT_BASELINE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id") {
      args.runId = argv[i + 1];
      i++;
    } else if (argv[i] === "--accept") {
      args.accept = true;
    } else if (argv[i] === "--out") {
      args.out = argv[i + 1];
      i++;
    } else if (argv[i] === "--baseline") {
      args.baseline = path.resolve(argv[i + 1]);
      i++;
    }
  }
  if (!args.runId) throw new Error("--run-id <id> ist Pflicht (z.B. 38385660823)");
  return args;
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", stdio: "inherit", ...opts });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = args.out ? path.resolve(args.out) : path.join(ROOT, ".agents", "scratches", "adopt");
  const tmp = path.join(outRoot, `download-${args.runId}`);
  const merged = path.join(outRoot, "merged");
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(merged, { recursive: true });

  console.log(`[adopt-ci] Downloading artifacts of run ${args.runId} …`);
  // Pattern OHNE Bindestrich: deckt sowohl die monolithische Baseline-Artefakt `liquid-goldens`
  // (vor-Sharding-Ära) als auch die vier Shards `liquid-goldens-1..4` ab. Das informationale
  // `liquid-goldens-gpu` wird unten explizit ausgeschlossen (WebGPU, im Runner immer blank).
  const dl = run("gh", ["run", "download", args.runId, "-p", "liquid-goldens*", "-D", tmp]);
  if (dl !== 0) {
    console.error(`[adopt-ci] gh run download fehlgeschlagen (status ${dl}). Läuft die Action?`);
    process.exit(dl);
  }

  const currentDirs = [];
  for (const entry of fs.readdirSync(tmp)) {
    if (entry === "liquid-goldens-gpu") continue; // informational WebGPU, keine GL2-Baseline-Zellen
    const dir = path.join(tmp, entry);
    const current = path.join(dir, "current");
    if (fs.statSync(dir).isDirectory() && fs.existsSync(current)) {
      currentDirs.push(current);
    }
  }
  currentDirs.sort();
  if (0 === currentDirs.length) {
    console.error(`[adopt-ci] Keine 'liquid-goldens-*/current' Artefakte in ${tmp} gefunden.`);
    process.exit(1);
  }

  console.log(`[adopt-ci] Merging ${currentDirs.length} Shard(s) → ${merged}`);
  const mg = run("node", [path.join(ROOT, ".agents", "scripts", "goldens", "merge-shards.js"), "--out", merged, ...currentDirs]);
  if (mg !== 0) process.exit(mg);

  const reportJson = path.join(outRoot, "compare.json");
  const reportHtml = path.join(outRoot, "review.html");
  const cp = run(
    "node",
    [
      path.join(ROOT, ".agents", "scripts", "goldens", "compare.js"),
      "--baseline",
      args.baseline,
      "--current",
      merged,
      "--report",
      reportJson,
      "--report-html",
      reportHtml,
      ...(args.accept ? ["--accept"] : []),
    ],
    {},
  );

  console.log(`\n[adopt-ci] Review-Report: ${reportHtml}`);
  if (args.accept) {
    console.log("[adopt-ci] --accept gesetzt: vergleichbare Zellen wurden in die Baseline übernommen.");
    console.log(`   Baseline: ${args.baseline}`);
    console.log("   Nächster Schritt: manuell reviewen und die Baseline committen (siehe README).");
  } else {
    console.log("   Nächster Schritt: Report prüfen, dann mit --accept erneut laufen lassen.");
  }
  process.exit(cp);
}

main();
