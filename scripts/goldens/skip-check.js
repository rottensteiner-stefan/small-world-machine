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
import { fileURLToPath } from "node:url";

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

/**
 * Reine Entscheidungslogik des Diff-Gates (ohne Git testbar).
 *
 * Sicherheitsrichtung: SKIP nur, wenn es beweisbar nichts Output-Relevantes gibt.
 * Shallow-Repos (fetch-depth 1, CI-Default) lösen den Baseline-Commit nicht korrekt auf:
 * `git log -- <baseline-pfad>` meldet dann fälschlich HEAD als einzigen relevanten Commit, also
 * `baselineCommit === head` mit leerem Diff -> falsches Grün trotz geänderter Shader (so beim
 * ersten realen CI-Lauf 2026-10-18 beobachtet). In dem Fall wird gerendert (RUN).
 *
 * @param {{ baselineCommit: string, head: string, shallow: boolean, changed: string[] }} input
 * @returns {{ shouldRun: boolean, reason: string }}
 */
export function decide({ baselineCommit, head, shallow, changed }) {
  if (!baselineCommit) {
    return { shouldRun: true, reason: "baseline ist nicht im Repo getrackt / Commit nicht auflösbar" };
  }
  if (shallow && baselineCommit === head) {
    return {
      shouldRun: true,
      reason: `shallow checkout: Baseline '${baselineCommit.slice(0, 8)}' ist nicht von HEAD unterscheidbar — Historie unvollständig, es wird gerendert`,
    };
  }
  const offending = changed.filter(isBuildInput);
  if (offending.length > 0) {
    const sample = offending.slice(0, 5).join(", ");
    const more = offending.length > 5 ? ` (+${offending.length - 5})` : "";
    return {
      shouldRun: true,
      reason: `${offending.length} Build-Input-Änderung(en) seit Baseline ${baselineCommit.slice(0, 8)}: ${sample}${more}`,
    };
  }
  return {
    shouldRun: false,
    reason: `seit Baseline ${baselineCommit.slice(0, 8)} keine Build-Input-Änderung (${changed.length} geänderte Pfade außerhalb des Build-Input)`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // CI-Modus: `--emit-status` schreibt die Entscheidung NUR über `should_run` in $GITHUB_OUTPUT und
  // endet IMMER mit Exit 0. Ein non-zero Exit würde den CI-Step als fehlgeschlagen markieren; GitHub
  // verwirft dann die Step-Outputs, die `if:`-Gates liefen leer und der Fail-Closed-Guard schlüge
  // fälschlich an (im ersten realen Dispatch 39129094684 genau so beobachtet). Fehler (fs/git) werden
  // weiterhin per Exception gemeldet -> leerer `should_run` => Guard failt closed. Lokal (ohne
  // `--emit-status`) bleibt der dokumentierte Exit-Code-Vertrag: 0 = SKIP, 1 = RUN.
  const emitStatus = args.emitStatus && !!process.env.GITHUB_OUTPUT;
  const exit = (shouldRun, reason) => {
    if (emitStatus) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=${shouldRun ? "true" : "false"}\n`);
    }
    console.log(`[goldens:skip-check] ${shouldRun ? "RUN" : "SKIP"}: ${reason}`);
    process.exitCode = emitStatus ? 0 : shouldRun ? 1 : 0;
  };

  const repoRoot = resolveRepoRoot(process.cwd());
  if (!repoRoot) return exit(true, "not a git repository");

  const baselineAbs = path.resolve(repoRoot, args.baseline);
  const baselineRel = path.relative(repoRoot, baselineAbs);
  const log = git(repoRoot, ["log", "-1", "--format=%H", "--", baselineRel]);
  const baselineCommit = log.ok ? log.stdout : "";
  const head = git(repoRoot, ["rev-parse", "HEAD"]).stdout;
  const shallowFlag = git(repoRoot, ["rev-parse", "--is-shallow-repository"]).stdout;
  const shallow = shallowFlag === "true";

  const changed = baselineCommit ? changedPaths(repoRoot, baselineCommit) : [];
  const { shouldRun, reason } = decide({ baselineCommit, head, shallow, changed });
  exit(shouldRun, reason);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
