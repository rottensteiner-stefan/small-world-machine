# Consuming the Engine from a Standalone Project

A game that lives in its own repository uses the engine like any third-party library: installed packages, public API
only, no engine source tree. This guide describes that boundary and how a version reaches such a project.

## What a project gets

Packages marked `"swm": { "release": true }` in their `package.json` are released:

| Package | Contents |
| :--- | :--- |
| `@small-world-machine/engine` | Renderers, scene graph, animation, glTF loading, input, behaviors |
| `@small-world-machine/vfx-extras` | Particle systems, `Fire` |
| `@small-world-machine/liquid-extras` | Specialised liquid/oil materials |
| `@small-world-machine/tools` | `attachDevTools`, Maker, Material Studio and other browser tools |

Each tarball ships `dist/index.js` (ES module), `.d.ts` files and a manifest with `exports` pointing at `dist`.
The extras declare the engine as a **peer dependency**, so a project installs the engine exactly once.

Not part of a release: the `swm` CLI, showcases, asset kits other than what a project brings itself, and any repo tooling.

## Rules for the consumer

- Import from the package root only (`import { Object3D } from "@small-world-machine/engine"`). Every symbol the engine
  intends for consumers is exported from `packages/engine/src/index.ts`; a deep path does not exist in a release.
- Missing capability: change the engine here, release again, bump the project. Never patch `node_modules`.
- The project owns its tsconfig, test setup, Vite config, shared CSS/fonts and asset kits. Nothing is read from the engine repo.

## Building a release

```sh
node .agents/scripts/release/pack-release.mjs --out release   # all marked packages
node .agents/scripts/release/pack-release.mjs --out release engine vfx-extras   # a subset
```

Per package the script runs a library build (`.agents/scripts/release/vite.package.config.ts`: externalises dependencies,
emits declarations), writes a dist-only manifest into a staging directory and runs `npm pack`. The repository keeps
`exports -> ./src/*` for development; only the staged manifest points at `dist`.

Node-side sources (the `swm` CLI) import light engine modules by deep path because the engine index drags in `?raw` shaders
that plain Node cannot load. The release build rewrites those deep paths to the package root.

## Taking a release into a project

Put the tarballs next to the project (for example `vendor/`) or attach them to a GitHub release, reference them as
`file:` or URL dependencies in `package.json`, run `npm install`, then `npm run typecheck && npm test`.
Because the engine is a peer of the extras, all four tarballs must come from the same release.

## Standalone Reference Projects

Real-world open-source standalone games consuming Small World Machine as versioned release packages:

- **[YAD (Yet Another Dungeon)](https://github.com/rottensteiner-stefan/yad):** A retro first-person grid-crawler dungeon game consuming `@small-world-machine/engine`. Features discrete grid movement, 3D billboard sprite rendering, custom canvas HUD, and ambient soundscapes.
- **[Minceraft](https://github.com/rottensteiner-stefan/minceraft):** An infinite chunk-streamed voxel world application consuming `@small-world-machine/engine`. Features multi-worker background meshing, baked vertex daylight/AO, continuous AABB sweep collision, and OPFS/IndexedDB delta persistence.
