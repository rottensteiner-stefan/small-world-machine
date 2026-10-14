import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.resolve(__dirname, "../package.json");
const swRelative = "packages/engine/src/core/SmallWorldMachine.ts";
const swPath = path.resolve(__dirname, "../" + swRelative);

const VERSION_PATTERN = /export const ENGINE_VERSION = "[^"]*";/;

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
  spawnSync("git", ["add", "--", swRelative], { stdio: "inherit" });
} catch (err) {
  console.error("[Build] Fehler:", err.message);
  process.exit(1);
}
