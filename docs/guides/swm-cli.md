# `swm` command line

`swm` runs the headless cores of the tools from a terminal: no browser, no dev server. It lives in `@small-world-machine/tools` as the `swm` bin and as `npm run swm -- <command>` in this repository (a thin wrapper around `packages/tools/src/cli/swm.mjs`, which loads the TypeScript through `tsx`).

```bash
npm run swm -- --help
npm run swm -- splatter --algorithm mud-splatter --seed 12 --size 1024 mud.png
npm run swm -- material --preset stone rock_diffuse.png ./out
npm run swm -- ibl --input panorama.png ./ibl-out
```

| Command | What it does |
| --- | --- |
| `swm map to-json <in> [out]` / `from-json` | ASCII map ↔ JSON grid (the Map Generator's format). `-` reads stdin. |
| `swm kit validate <dir>` | Validates a kit manifest (`kit.json`) and its assets, exit 1 when invalid. The same report is shown in the browser at `maker.html#kit`, where **Befund kopieren** (or Cmd/Ctrl+C with nothing selected) puts it on the clipboard as the same text this command prints. |
| `swm splatter [options] <out.png>` | Seeded splatter decal as a transparent PNG. |
| `swm material [gen] [options] <diffuse.png> <out-dir>` | Derives PBR texture maps (`height`, `normal`, `specular`, `roughness`, `ao`, `edge`, plus optional `diffuse`/`albedo`) from a diffuse PNG using `core/material.ts`. |
| `swm ibl [bake] [options] <out-dir>` | Bakes `env.png`, `irradiance.png`, `brdf_lut.png`, `prefilter/mip0..N.png` and `manifest.json` from an `--input` panorama or a seeded procedural panorama (`--seed`, `--panorama-only`). |

## `swm material`

Runs the same `derivePbrMaps` pipeline and `MATERIAL_STUDIO_PRESETS` (`default`, `stone`, `metal`, `wood`) as `maker.html#material` and `pbr-gen.html`. Every studio slider has a matching kebab-case flag (`--normal-strength`, `--normal-format opengl|directx`, `--rough-gamma`, `--ao-soft`, `--no-edge-invert`, …); `--maps` selects a comma-separated subset of maps to write.

## `swm ibl`

Uses `core/ibl.ts` (`generateTestEquirect`, `resolveIblGenOptions`) for seeded panorama generation and option validation, then runs the engine's WebGL2 `IBLBaker` inside a throw-away headless Chrome subprocess (SwiftShader) to write the cross-layout cubemaps, GGX mip chain, BRDF LUT, and `manifest.json` (with `sha256` per output). Pass `--panorama-only` to emit only the deterministic `input.png` and `manifest.json` without launching a browser.

## `swm splatter`

The three techniques of the [Splatter page](/tools/splatter-gen.html) (`noise-warp`, `metaballs`, `mud-splatter`) with the same slider defaults; flags are the kebab-cased option names (`--blob-count`, `--warp-strength`, `--satellite-range`, …). `swm splatter --help` lists them per algorithm.

- **Reproducible:** the same seed gives the same bytes. Blob and satellite placement come from a seeded integer PRNG, not from the page's `sin()` hash: that hash is chaotic, and Node and Chrome already disagree after a handful of draws, so a page seed never meant a fixed layout across engines. The page and the CLI therefore draw the same shapes, not the same layout, for one seed. The Perlin-warped main blob (the default `noise-warp` outline) is the same as the page's.
- **Rendering:** the core draws with a small anti-aliased coverage rasterizer and a Gaussian blur instead of Canvas2D. Against the browser it agrees to about 99.8 % alpha overlap at the default settings (the shape check runs with satellites and sub-blobs off, where both sides are deterministic) and about 98.5 % at extreme blur/threshold values.
- **Output:** the blob colour is written into every pixel, including the transparent ones, so bilinear filtering does not fringe dark.

## Adding a command

Core modules under `packages/tools/src/core/` must never import the `@small-world-machine/engine` package root, because the engine root pulls in `.glsl` shader files that plain Node cannot load (`Unknown file extension ".glsl"`). Use narrow subpath imports instead (such as `@small-world-machine/engine/enums/NormalMapFormat.js` in `core/material.ts`). `tests/cli/swmBin.test.ts` runs the real `swm.mjs` bin in a child process to guard this boundary.

Design background: [ADR 0034](/adr/0034-headless-core-cli-boundary).
