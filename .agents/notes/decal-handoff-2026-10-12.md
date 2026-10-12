# Decal system: handoff (2026-10-12)

Written by session `small-world-machine-49` so another session can continue. Read this, then
`docs/adr/0029-decal-system.md` (decisions) and `docs/guides/decals.md` (how it works, limits).
The human answers in German; everything between sessions (mailbox, notes) is English.

## State of the phases

Plan with the phase table: `docs/research/decal-system-plan-2026-10-12.md`.

| Phase | Content | State |
| --- | --- | --- |
| 0 to 2 | Box decals on WebGPU and WebGL2, thin normal buffer (ADR 0028), HBAO fixes, mip/gradient handling | committed, pushed, GPU-verified |
| 3 | `KitDecalItem` (normal/orm/emission/size/unlit), `LevelDescriptor.decals[]`, `KitRegistry.loadLevel`, schemas, validators, prologue migration of the six Plane decals | committed, pushed |
| ORM/emissive probe | `?orm=1` in `apps/showcases/decal-probe`, `ormChecks` in `scripts/check-decals.mjs` (AO, neutral, emissive, unlit, G=roughness, B=metallic) | committed, pushed |
| 4 | `SWM_decal` glTF plugin, `KitRegistry.hydrateDecal`/`resolveLevelDecals`, `DecalShell.ts`, Maker stamp tool (`D`), Raycaster `point`+`normal`, Maker no longer saves editor helpers | committed, pushed (`a7759617`) |
| 5 | Mesh-decal baker for WebGL1 (`bakeDecalMesh`, `bakeSceneDecals`, `packages/engine/src/core/decals/DecalMeshBaker.ts`), `?bake=1` in the probe, `bakeCheck` | implemented and verified (36 decal tests, WebGL1 GPU check: baked stripe vs WebGL2 box decal max channel diff 9); **not yet committed**. Claim `mv5ogdfcxfg` can be released once committed. |
| 6 | Plane-fit, wetness overlay re-scope, sockets, accumulator | open, not started |

## Uncommitted right now

- `packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts`: one removed `@inheritdoc` (fixes one typedoc warning). Commit it on its own with `git commit -- <path>`.
- Phase 5 files: `packages/engine/src/core/decals/DecalMeshBaker.ts`, `packages/engine/tests/core/decals/DecalMeshBaker.test.ts`, `packages/engine/src/core/index.ts`, `apps/showcases/decal-probe/showcase.ts`, `scripts/check-decals.mjs`, `docs/guides/decals.md`, `docs/adr/0029-decal-system.md`, `docs/research/decal-system-plan-2026-10-12.md`, `CHANGELOG.md`. Commit with explicit paths.
- Not ours, leave alone: `docs/public/api/*` (regenerated typedoc), `.agents/skills/collaborate/*`, `AGENTS.md`, `.agents/notes/backlog.md`.

## Decisions worth knowing (not obvious from the code)

- Decal box: projection along local -Y, +Y = surface normal, UV = box.xz + 0.5. `size` is `[width, height, depth]`; the node scale is `(w, depth, h)`. This mapping was a bug once (fixed in `bbfe9c19`).
- ORM map: R = AO, G = roughness, B = metallic. On WebGPU it sits in the shared `u_aoMap` slot (fixed binding table). WGSL gates it with `matParam6.x`, GLSL with `USE_DECAL_ORM`.
- HBAO never uses the normal buffer (flat geometric normal only).
- `SWM_decal`: payload `size` is authoritative on read; node scale is rewritten from it. Always `hydrateDecal` BEFORE adding a decal to a scene (texture changes after the first frame may not rebuild pipelines; unverified on a real GPU).
- Phase 5 simplification: no per-vertex alpha, so no edge/angle fade on baked decals (angle: hard cut at `angleFadeEnd`). Reason: avoid touching the Standard shaders on three backends.
- Maker: stamp mode `D`; click stamps, `R` rotates 15 degrees about the normal, arrows nudge, Shift+arrows scale, `Esc` leaves. Decals are not raycast-pickable (not collidable): select via hierarchy panel.

## Still unverified (do not claim these as done)

- Decal cost on other GPUs / mobile (all timings from one GPU); sampler anisotropy for decal textures (mip test used 1).
- ORM roughness direction: the G channel is proven to be read (value changes), the physical direction is not asserted.
- Maker: stamping on floor/slants/undersides was only unit-tested, only the front face was checked in the browser; reload of a bound project with stamps is jsdom-tested only (the folder picker cannot be automated).
- WebGL2 path for unmatched shaders is unit-tested only; spot-shadow on decals only checked visually.
- Maker saves `SunLight` and `Fill` (editor default lights); a reload may duplicate them. Not investigated.
- Old `scene.gltf` files saved before `a7759617` still contain gizmo/highlight nodes; no cleanup on load.
- Phase 5 baker: the normal map of baked decals uses UV-derived tangents (bitangent convention not checked against a normal-mapped scene); overlapping baked decals sort by distance to the decal centre, not by `priority` (no renderOrder exists); flat triangle normals (curved receivers look faceted); cost on big finely tessellated receivers not measured; the baker is NOT called automatically (explicit `if (renderer.type === RendererType.WEB_GL1) bakeSceneDecals(scene.root)`); indices are Uint16 below 65536 vertices (Uint32 gives INVALID_ENUM on WebGL1). `bakeCheck` now drains `gl.getError()` and fails on any code (negative control done: with Uint32 forced it reports 0x500 while the console shows nothing).
- 17 older typedoc warnings (undocumented exports, unused `@param`s): not ours, not fixed.

## How to verify (all runnable without asking)

- `npm run lint:fix`, `npx tsc --noEmit`, `npm run build:lib`, `npm run test` (270 files / 1757 tests were green).
- GPU: dev server must already run on https://localhost:5173 (started by session -49, log `.agents/scratches/vite.log`; do NOT start a second vite or kill it). Then `DECAL_REQUIRE_WEBGPU=1 npm run test:decals`.
- Visual: prologue `https://localhost:5173/apps/sample-apps/the-whisper/scenes/prologue/index.html` (`window.__prologue`), Maker `https://localhost:5173/public/tools/maker.html` (`window.makerApp`), probe `.../apps/showcases/decal-probe/index.html?orm=1` etc.

## Rules for any session in this tree

1. `.agents/skills/session-mailbox/SKILL.md`: read the mailbox first, claim paths before editing, release when done, post commit hashes.
2. Commit only explicit paths: `git add -- <paths>` then `git commit -m "..." -- <paths>`. Never `git add -A`, `-a`, stash, reset, history rewrites. The husky pre-commit hook runs typecheck/lint on the WHOLE tree: another session's broken file blocks your commit; ask them, do not use `--no-verify` without the human's explicit say-so.
3. Commit messages: a pure unique quote, no prefixes. Check `git log --format=%s | grep -cF "<quote>"` is 0 first. The harness adds a Co-Authored-By trailer per its own instructions.
4. Commit and push only when the human asks. Keep answers short and in German.

## What to do next (in this order)

1. Check the mailbox: Phase 5 is finished in the tree but may still be uncommitted under claim `mv5ogdfcxfg` of session -49. If the claim is stale (older than 12 h) tell the human before taking over.
2. Commit the Phase 5 result with explicit paths, then `WebGL2Renderer.ts` and this note separately.
3. Decide with the human whether to close the open questions above (cheap ones first: Maker floor/slant stamping in the browser, `SunLight`/`Fill` reload duplicates).
4. Phase 6 (see plan): plane-fit, wetness overlay, sockets, accumulator. Needs a short plan agreement with the human first (feature-sized).
5. Release 0.105.0 is not tagged; backup branch `backup/pre-history-fix` can be deleted once the human trusts the history repair.
