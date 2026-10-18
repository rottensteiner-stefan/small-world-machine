// scripts/goldens/skip-check.js
// Diff-Gate (M1 der Goldens-Optimierung): entscheidet OHNE Build und OHNE Browser, ob ein
// Golden-Capture/Compare-Lauf neue Pixel liefern KANN.
//
// Logik: Die committete Baseline (.agents/goldens/liquid/baseline) entstand aus einem bestimmten
// Source-Stand. Ändert sich seit dessen Commit nichts an einem Build-Input von Showcase 10
// (App-Quellen, packages, shared, Scripts, Dependency-Manifeste, Vite-/tsconfig-Dateien), so ist
// der Capture deterministisch pixel-identisch zur Baseline -> SKIP. Pfade, die die Canvas-Pixel
// nicht beeinflussen können (docs/, .agents/, andere Apps, public/-Design) erzwingen KEINEN Lauf.
//
// Fehlerrichtung ist konservativ: Im Zweifel -> RUN (exit 1). Geskippt wird nur, wenn es beweisbar
// nichts Output-Relevantes gibt; ein SKIP ist damit nie falsch-grün. (Vollständige Pixel-Determinismus
// des Golden-Mode: fester Timestep, Seeds, kein WallClock-Drift - siehe capture.js.)
//
// Exit-Codes: 0 = SKIP (nichts zu tun), 1 = RUN (etwas geändert / Git-Baseline unbekannt).
//
// CI-Nutzung: node scripts/goldens/skip-check.js --emit-status
//   haengt `should_run=true|false` an $GITHUB_OUTPUT; nachgelagerte Schritte gaten mit
//   `if: steps.skip.outputs.should_run == 'true'`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASELINE = ".agents/goldens/liquid/baseline";

// Jeder hier gematchte Pfad erzwingt einen Lauf. KONSERVATIV (Superset): lieber ein unnötiger
// Lauf als ein falsch-grüner Skip. Nicht enthalten: docs/, .agents/, andere Apps, public/.
const PREFIXES = [
  "apps/showcases/10/",
  "packages/",
  "shared/",
  "scripts/",
  ".github/workflows/ci.yml",
];
const ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".npmrc",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vitest.config.ts",
  "vitest.config.js",
  "tsconfig.json",
  "tsconfig.base.json",
]);

function parseArgs(argv) {
  const args = { baseline: DEFAULT_BASELINE, emitStatus: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--emit-status") {
      args.emitStatus = true;
    } else if (argv[i] === "--baseline") {
      args.baseline = argv[i + 1];
      i++;
    }
  }
  return args;
}

function git(repoRoot, gitArgs) {
  const r = spawnSync("git", ["-C", repoRoot, ...gitArgs], { encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

function resolveRepoRoot(startCwd) {
  const r = spawnSync("git", ["-C", startCwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

function parsePorcelainPath(line) {
  let p = line.slice(3).trim();
  const arrow = p.indexOf(" -> ");
  if (arrow >= 0) p = p.slice(arrow + 4); // renamed: "R  OLD -> NEW"
  return p.replace(/^"|"$/g, "").replace(/\\"/g, '"');
}

function changedPaths(repoRoot, baselineCommit) {
  const paths = [];
  const committed = git(repoRoot, ["diff", "--name-only", `${baselineCommit}..HEAD`]);
  if (committed.ok) {
    for (const p of committed.stdout.split("\n")) {
      const t = p.trim();
      if (t) paths.push(t);
    }
  }
  // Uncommittete/untrackte Änderungen im Worktree (lokal relevant; im CI-Clean-Checkout leer).
  const porcelain = git(repoRoot, ["status", "--porcelain"]);
  if (porcelain.ok) {
    for (const line of porcelain.stdout.split("\n")) {
      const p = line.trim();
      if (p) {
        const candidate = parsePorcelainPath(p);
        if (candidate) paths.push(candidate);
      }
    }
  }
  return paths;
}

function isBuildInput(rel) {
  if (ROOT_FILES.has(rel)) return true;
  for (const prefix of PREFIXES) {
    if (rel === prefix || rel.startsWith(prefix)) return true;
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exit = (shouldRun, reason) => {
    if (args.emitStatus && process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=${shouldRun ? "true" : "false"}\n`);
    }
    console.log(`[goldens:skip-check] ${shouldRun ? "RUN" : "SKIP"}: ${reason}`);
    process.exitCode = shouldRun ? 1 : 0;
  };

  const repoRoot = resolveRepoRoot(process.cwd());
  if (!repoRoot) return exit(true, "not a git repository");

  const baselineAbs = path.resolve(repoRoot, args.baseline);
  const baselineRel = path.relative(repoRoot, baselineAbs);
  const log = git(repoRoot, ["log", "-1", "--format=%H", "--", baselineRel]);
  const baselineCommit = log.ok ? log.stdout : "";
  if (!baselineCommit) {
    return exit(true, `baseline '${baselineRel}' ist nicht im Repo getrackt (kein Commit gefunden)`);
  }

  const changed = changedPaths(repoRoot, baselineCommit);
  const offending = changed.filter(isBuildInput);
  if (offending.length > 0) {
    const sample = offending.slice(0, 5).join(", ");
    const more = offending.length > 5 ? ` (+${offending.length - 5})` : "";
    return exit(
      true,
      `${offending.length} Build-Input-Änderung(en) seit Baseline ${baselineCommit.slice(0, 8)}: ${sample}${more}`,
    );
  }
  return exit(
    false,
    `seit Baseline ${baselineCommit.slice(0, 8)} keine Build-Input-Änderung (${changed.length} geänderte Pfade außerhalb des Build-Input)`,
  );
}

main();
