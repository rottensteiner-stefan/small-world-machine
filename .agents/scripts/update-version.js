import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.resolve(__dirname, "../../package.json");
const swRelative = "packages/engine/src/core/SmallWorldMachine.ts";
const swPath = path.resolve(__dirname, "../../" + swRelative);

// Staging is an explicit opt-in (`--stage`, used by .husky/pre-commit). A plain `npm run build`
// (prebuild) only rewrites the file and must never touch the git index.
const STAGE = process.argv.includes("--stage");

const VERSION_PATTERN = /export const ENGINE_VERSION = "[^"]*";/;

// Private app workspaces follow the engine release; library packages version independently
// (gltf-extensions, *-extras publish on their own cadence).
const APP_PACKAGES = ["apps/showcases/package.json", "apps/sample-apps/package.json"];

function syncAppVersion(relative, version) {
  const file = path.resolve(__dirname, "../../" + relative);
  const raw = fs.readFileSync(file, "utf8");
  const updated = raw.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (updated === raw) {
    return false;
  }
  fs.writeFileSync(file, updated);
  console.log(`[Build] ${relative} -> v${version}.`);
  if (STAGE) {
    spawnSync("git", ["add", "--", relative], { stdio: "inherit" });
  }
  return true;
}

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  if (!fs.existsSync(swPath)) {
    console.error(`[Build] SmallWorldMachine.ts nicht gefunden unter: ${swPath}`);
    process.exit(1);
  }

  let content = fs.readFileSync(swPath, "utf8");
  if (!VERSION_PATTERN.test(content)) {
    console.error("[Build] ENGINE_VERSION-Zeile nicht gefunden in SmallWorldMachine.ts");
    process.exit(1);
  }

  for (const relative of APP_PACKAGES) {
    syncAppVersion(relative, pkg.version);
  }

  const updated = content.replace(
    VERSION_PATTERN,
    `export const ENGINE_VERSION = "${pkg.version}";`,
  );

  if (updated === content) {
    console.log(`[Build] SmallWorldMachine.ts bereits auf v${pkg.version}.`);
    process.exit(0);
  }

  fs.writeFileSync(swPath, updated);
  console.log(`[Build] SmallWorldMachine.ts (v${pkg.version}) aktualisiert.`);
  if (STAGE) {
    spawnSync("git", ["add", "--", swRelative], { stdio: "inherit" });
  }
} catch (err) {
  console.error("[Build] Fehler:", err.message);
  process.exit(1);
}
