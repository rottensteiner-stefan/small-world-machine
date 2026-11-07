import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Library build of ONE workspace package, driven by `pack-release.mjs` via env:
 *  - `SWM_PKG_DIR`: package directory (`packages/<name>`)
 *  - `SWM_OUT_DIR`: staging directory; output lands in `<SWM_OUT_DIR>/dist`
 * Dependencies and peer dependencies stay external, so `engine` is never bundled into the extras.
 */
const pkgDir = resolve(requireEnv("SWM_PKG_DIR"));
const outDir = resolve(requireEnv("SWM_OUT_DIR"), "dist");
const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const externals = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

export default defineConfig({
  root: pkgDir,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    target: "esnext",
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(pkgDir, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: (id: string) =>
        id.startsWith("node:") || externals.some((dep) => id === dep || id.startsWith(`${dep}/`)),
      output: {
        // Node-side sources (the `swm` CLI) import light engine modules by deep path because the engine
        // index drags in `?raw` shaders that plain Node cannot load. A released package only ships
        // `dist/index.js`, so those deep paths collapse onto the package root (the index re-exports them).
        paths: (id: string) => (id.startsWith("@small-world-machine/engine/") ? "@small-world-machine/engine" : id),
      },
    },
  },
  plugins: [
    dts({
      // `engine/src/global.d.ts` declares the `*.glsl?raw` / `*.wgsl?raw` shader module shapes.
      // `tests/scripts/pngjs.d.ts` is the repo's ambient shim for `pngjs` (used by `tools`).
      include: [
        resolve(pkgDir, "src/**"),
        resolve(pkgDir, "../engine/src/global.d.ts"),
        resolve(pkgDir, "../../tests/scripts/pngjs.d.ts"),
      ],
      entryRoot: resolve(pkgDir, "src"),
      tsconfigPath: resolve(pkgDir, "../../tsconfig.json"),
    }),
  ],
});
