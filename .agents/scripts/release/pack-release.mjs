#!/usr/bin/env node
/**
 * Builds every workspace package marked `"swm": { "release": true }` and packs it as an installable
 * `.tgz` (what a third-party project consumes). The repo keeps `exports -> ./src/*` for development;
 * only the staged copy gets `exports -> ./dist/*`.
 *
 *   node .agents/scripts/release/pack-release.mjs [--out release] [name ...]
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outDir = resolve(root, outFlag >= 0 ? (args[outFlag + 1] ?? "release") : "release");
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");

const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ dir: join(root, "packages", e.name), file: join(root, "packages", e.name, "package.json") }))
  .filter((p) => existsSync(p.file))
  .map((p) => ({ ...p, json: JSON.parse(readFileSync(p.file, "utf8")) }))
  .filter((p) => p.json.swm?.release === true)
  .filter((p) => only.length === 0 || only.includes(p.json.name.split("/")[1]));

if (packages.length === 0) throw new Error("No release packages found");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const engine = packages.find((p) => p.json.name === "@small-world-machine/engine");

for (const pkg of packages) {
  const short = pkg.json.name.split("/")[1];
  const stage = join(outDir, ".stage", short);
  mkdirSync(stage, { recursive: true });
  console.log(`\n== ${pkg.json.name}@${pkg.json.version}`);

  execFileSync(
    "npx",
    ["vite", "build", "--config", join(root, ".agents/scripts/release/vite.package.config.ts")],
    { cwd: root, stdio: "inherit", env: { ...process.env, SWM_PKG_DIR: pkg.dir, SWM_OUT_DIR: stage } },
  );

  // Tarball manifest: dist-only exports, extras depend on the engine as a peer (never a nested copy).
  const manifest = { ...pkg.json };
  delete manifest.private;
  delete manifest.scripts;
  delete manifest.bin;
  delete manifest.devDependencies;
  delete manifest.swm;
  manifest.main = "./dist/index.js";
  manifest.module = "./dist/index.js";
  manifest.types = "./dist/index.d.ts";
  manifest.exports = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } };
  manifest.files = ["dist"];
  manifest.sideEffects = false;
  if (pkg !== engine && manifest.dependencies?.["@small-world-machine/engine"] !== undefined) {
    delete manifest.dependencies["@small-world-machine/engine"];
    manifest.peerDependencies = {
      ...manifest.peerDependencies,
      "@small-world-machine/engine": `^${engine?.json.version ?? "*"}`,
    };
  }
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const extra of ["LICENSE", "README.md"]) {
    const src = existsSync(join(pkg.dir, extra)) ? join(pkg.dir, extra) : join(root, extra);
    if (existsSync(src)) cpSync(src, join(stage, extra));
  }
  execFileSync("npm", ["pack", "--pack-destination", outDir], { cwd: stage, stdio: "inherit" });
}

rmSync(join(outDir, ".stage"), { recursive: true, force: true });
console.log(`\nTarballs in ${outDir}:`);
for (const f of readdirSync(outDir)) console.log(`  ${f}`);
