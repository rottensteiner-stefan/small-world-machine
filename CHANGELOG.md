# Changelog

## [0.105.0] - 2026-10-12

### "The greatest enemy of knowledge is not ignorance, it is the illusion of knowledge." - Daniel J. Boorstin

- **Features:**
  - *Box-projected decals* (`Decal`, `DecalMaterial`; WebGPU and WebGL2, WebGL1 ignores them): a unit box that draws only where it intersects the already-rendered opaque geometry. Depth is unprojected into box space, the decal is lit with the clustered lights and blended with its own normal map onto the receiver's normal from the normal buffer (through a tangent frame built on that normal: in the spirit of reoriented normal mapping, not the RNM formula), with edge and angle fade, camera-inside-box support and a static stacking order (`priority`, then volume, then creation order). Decals get their own pass after the opaque and before the transparent pass, so refractive materials see them. Normals and UV derivatives come from three depth taps per axis, so silhouettes no longer smear and distant decals sample the right mip. Decals never act as colliders or raycast targets, and negative scale is not supported.
  - *Normal buffer* (ADR 0028): a thin world-space octahedral `rg16float` second render target of the main pass, on WebGPU and WebGL2 (WebGL2 needs post-processing). `quality.normalBuffer` is `boolean | "auto"`, default `"auto"`: the buffer switches itself on as soon as a decal is visible and stays on; with no decals nothing is allocated or compiled.
  - *Decal options:* `unlit` (flat albedo, no light loop; leaves the normal buffer alone; about half the cost of a lit decal) and `mipBias` (default 0: the three-tap gradients already match hardware mip sharpness within 1 to 6 %, a negative bias only over-sharpens and shimmers).
  - *Decal probe page* `apps/showcases/decal-probe` and `npm run test:decals` (`scripts/check-decals.mjs`): 51 numeric GPU assertions on both backends (no validation/GL errors, normal-buffer integrity, decal normal blending, backend parity, forced and automatic normal buffer, HBAO independent of the normal buffer, WebGL1 omitting decals without errors).
  - *Decals in level descriptors* (ADR 0029, phase 3): `LevelDescriptor.decals[]` (`kitDecal`, position, rotation, size, fade, opacity, priority, tags, `parent` prop) is instantiated by `KitRegistry.loadLevel` into `Decal` objects (albedo, normal, ORM and emission maps from the kit's `decals/` folder; size from placement, else kit default, else 1 m) and exposed as `LevelInstance.decals`. Non-positive sizes, unknown parent ids and duplicate ids fail fast; a decal whose kit decal or textures cannot be loaded, or whose parent prop failed, is skipped with a warning like a failed prop. The level validator checks that every `kitDecal` and its map files exist. `level.schema.json` validates the new array.
  - *`SWM_decal` glTF extension* (ADR 0029, phase 4a): `WorldWriter` and `GltfLoader` round-trip a `Decal` with the `LevelDecalPlacement` payload (`kitDecal`, `size`, fade, opacity, priority, tags; id, transform and hierarchy from the node; the payload `size` wins over the node scale). The decal is read texture-less; new `KitRegistry.hydrateDecal(decal)` and `resolveLevelDecals(root)` load maps and `unlit` through the same code path as level loading and warn-and-skip unknown kit decals. `Decal.kitDecal` identifies the kit decal.
  - *Decal stamp tool in Maker* (ADR 0029, phase 4b): `D` toggles a modal stamp mode (`Ctrl/Cmd+D` stays Duplicate); double-clicking a kit decal in the Content Drawer arms it (decals are now real `Decal` objects instead of flat quads). A half-transparent ghost decal follows the mouse over the surface, a click stamps it as one undo step and `scene.gltf` autosave keeps it (`SWM_decal`; the ghost is never saved; `resolveLevelDecals` runs after loading a project). While active, `R`/`Shift+R` spin the stamp by 15 degrees about the surface normal, arrows nudge it in the surface plane (grid snap), `Shift`+arrows scale it, `Esc` leaves. `Raycaster` intersections now carry the world-space `point` and a ray-facing `normal` (inverse-transpose of the world matrix). `Decal` has an inspector (priority, opacity, edge fade, angle fade); material edits now trigger autosave, and the selection outline fits oriented (OBB) bounds. Decals still cannot be picked in the viewport, select them in the hierarchy.
  - *Mesh-decal baker for WebGL1* (ADR 0029, phase 5): `bakeDecalMesh(decal, receivers, options?)` clips the triangles of static receiver meshes against the decal box (Sutherland-Hodgman, 6 planes), maps UV = box.xz + 0.5, lifts the surface 2 mm along the triangle normal and returns one transparent, non-depth-writing mesh per decal with the decal's maps and opacity (`color.a`); `bakeSceneDecals(root)` does this for every decal in a scene and hides the baked boxes. Simplification: no edge or angle fade (triangles beyond `angleFadeEnd` are cut, the texture alpha shapes the edge). Skinned, instanced and geometry-less receivers are skipped with a warning. Not wired into engine start-up: call it explicitly on WebGL1 (the decal probe does so with `?bake=1`; `test:decals` checks the baked stripe against floor and against the WebGL2 box decal).
- **Architecture & Bugfixes:**
  - *HBAO was wrong at high resolution:* the depth-derived normal used an absolute threshold that rejected every cross product on large canvases (the camera axis became the normal for all pixels, open floor darkened to 0.61 instead of 1.0) and pointed away from the camera. The threshold is now relative to the edge lengths and the normal faces the camera. HBAO always uses the flat geometric normal (never the normal buffer, whose normal carries the receiver's normal map and would over-darken against flat depth, and which would change the AO whenever a decal switches the buffer on); the reconstruction picks, per axis, the neighbour closest in depth, so it no longer smears across silhouettes.
  - *HBAO radius in world units:* the sample steps followed fixed pixel distances, so `radius` shrank with resolution. The marching distance is now `clamp(radius * projScaleY * (H/2) / linearZ, 4, 128)` pixels; the affected fringe stays about the same between 2800 and 5600 px widths.
  - *Spot-light shadows:* the shadow camera is created on first use and kept on the light on both backends. WebGL2 never updated it, so a light whose `castShadow` was switched on after construction cast no shadow and a moving light's shadow never followed it.
  - *WebGPU pipeline cache rebuilt pipelines every frame:* an object drawn into more than one target per frame (main pass plus a planar reflection or probe face, each with its own pipeline key) released the previous pass's pipeline on every switch; at refCount 0 it was deleted and rebuilt on the next draw. Objects now stay counted in every key they use until they are released (`PipelineCacheRefCounting.test.ts` reproduced 6 pipeline creations in 3 frames instead of 2).
  - *Shaders the normal-buffer wrapper cannot rewrite* (unusual formatting in custom or imported shaders) no longer break the main pass: on WebGPU their pipelines fall back to a write-masked second target (a writable target without a matching output is a validation error), on WebGL2 their output 1 is switched off per program so no undefined values reach the buffer.
  - Compute modules that include the shared structs chunk (cluster culling, HZB test) now declare the per-pipeline constant the chunk's sampling helpers reference.
  - Fragment-output wrappers (`NormalOutputWrapper`, `NormalOutputWrapperGL`) add the normal output without touching any material shader; the second output carries the fragment alpha so decals blend their normal.
- **Housekeeping & Docs:**
  - ADR 0028 (thin normal buffer as MRT, no G-buffer, velocity separate); `lint:wgsl` also validates every material fragment shader through the normal-buffer wrapper.
  - Verified: typecheck, lint, `lint:wgsl`, library build, the full suite (1689 tests in 263 files) and `test:decals` on a real GPU. Not verified: other GPUs, mobile/tile-based GPUs, per-GPU decal cost beyond the probe measurements. API reference regenerated (`v0.105.0`).
  - A dev-server pitfall found on the way: starting a second `vite` dev server while one is running (port in use) wipes `node_modules/.vite/deps`, after which the running server answers 504 for every pre-bundled dependency (e.g. `fflate`) and every page importing `@small-world-machine/tools` stays black until the server is restarted.

## [0.104.0] - 2026-10-10

### "Order is Heaven's first law." - Alexander Pope

- **Architecture & Bugfixes:**
  - *Engine source re-organization* (public barrel API unchanged):
    - `core/materials/` is grouped by family: `surface/` (Basic, Lambert, Phong, Standard), `glass/` (Glass, Frostglass), `liquid/` (OpenWater, StylizedWater, LiquidWave, FluidSurface, Slime, Lava, StylizedLava); each family carries its own `shaders/` folder, shared chunks stay in `core/materials/shaders/chunks`.
    - Renderer layers merged: `core/renderers/` is dissolved, the shader infrastructure lives in `renderers/shaders/`; post-processing shaders (`AO`, `Bloom*`, `PostProcess*`, `HistoryBlend`, `MipDownsample`) moved to `renderers/post/shaders/`.
    - `engine/src/tools/` is dissolved: `ForgeTool` -> `core/forge/`, `GridLevelBuilder` -> `geometry/procgen/`.
    - Loose `core/` files grouped into `input/`, `culling/`, `reflection/`, `sky/`, `cameras/` and `sprites/`.
  - *IBL generator moved to `@small-world-machine/tools`* (`packages/tools/src/ibl-gen/`, exported from the package barrel); it is an offline tool without engine runtime use (ADR 0024 revised).
  - *`presentation.ts`* moved from the engine to `apps/showcases/presentation/`.
- **Housekeeping & Docs:**
  - `scripts/lint-wgsl.ts` scans all family shader folders and the post-processing folder; `Glsl100LightCalc.test.ts` searches shader sources recursively (same four shaders covered as before).
  - ADR 0024 revision note, ADR 0015/`REFERENCES.md` paths, new "Where Material Files Live" section in `docs/guides/adding-materials.md`; API reference regenerated (`v0.104.0`).
  - Verified: typecheck, lint, `lint:wgsl`, library and showcase builds and the full test suite (1628 tests) green.

## [0.103.0] - 2026-10-10

### "The name that can be named is not the eternal name." - Lao Tzu

- **Architecture & Bugfixes:**
  - *glTF vendor prefix `SW_*` -> `SWM_*`*: `SWM_stage_zone`, `SWM_stage_vanishing_point` and `SWM_prefab_instance` follow the re-brand (engine loaders/writers, tests, ADRs, guides, README). Level files written with the old `SW_*` names are no longer read. Historical changelog and log entries keep the old names.
  - *Extension classes*: `SwStageZone` -> `SwmStageZone`, `SwPrefabInstance` -> `SwmPrefabInstance` (files renamed accordingly).
- **Housekeeping & Docs:**
  - *Version alignment*: `packages/engine`, `packages/gltf-extensions`, `apps/sample-apps` and `apps/showcases` (previously `0.78.00` / `0.79.03`) are lifted to the root version; `ENGINE_VERSION`, `package-lock.json` and the generated API reference (`docs/public/api`, now regenerated) all read `0.103.0`.
  - *Re-brand audit of `docs/`*: product name, class names, paths and repository URLs verified; ADR 0015 now names `the-whisper` instead of the former `and-now` app.
  - *`REFERENCES.md`*: the Khronos material entries (`KHR_materials_ior`, `_volume`, `_iridescence`) point to the relocated `packages/liquid-extras` sources (`OilSlick`, `OilPuddle`, `shading/thinFilm`) instead of the removed `the-whisper` files.
  - Verified: library build and the full test suite green.

## [0.102.0] - 2026-10-10

### "What's in a name? that which we call a rose / By any other name would smell as sweet" - William Shakespeare

- **Features:**
  - *`OilPuddleMaterial`*: a new Graphic-Noir petroleum material in `@small-world-machine/liquid-extras` with six established looks (`mutedSheen`, `tar`, `chiaroscuro`, `tarSkin`, `whaleOil`, `posterRings`) and three fluid tunings (`crude`, `petrol`, `diesel`). Canvas-wide it runs on all three shader backends (GLSL300, GLSL100, WGSL). The underlying thin-film interference model lives once in the canonical shared module `shading/thinFilm/thinFilm.ts` (mutED, desaturated re-mix by design; pure functions without samplers or uniforms, injectable through the `composeStylizedWaterSources` hooks or standalone fragment shaders).
- **Architecture & Bugfixes:**
  - *Re-brand `Small World` to `Small World Machine`*: the engine entry point is renamed `SmallWorld` -> `SmallWorldMachine` (`packages/engine/src/core/SmallWorldMachine.ts`), the package scopes are `@small-world/*` -> `@small-world-machine/*`, the API pages, the documentation, the guides, ADRs, research docs, skills, CI, husky hooks, `CONTEXT.md`, `REFERENCES.md`, `VISION.md` and the `Makefile` all speak of Small World Machine only. Historical entries in changelogs and logs are preserved.
  - *Liquid material re-organization*: `NoirWater` and `OilSlick` move into their own folders under `packages/liquid-extras/src/materials/`; the `OilSlick` material is extracted from `the-whisper`'s character diorama and now ships in the extension package together with the shared thin-film module.
- **Housekeeping & Docs:**
  - *Vision skill canonicalization*: the `vision-image` skill and its script move into `.agents/skills/vision-image/` with a proper `SKILL.md`; the moved API doc page replaces `SmallWorld` with `SmallWorldMachine`.
  - *Tooling*: new `scripts/forge-tools-e2e.mjs` and `scripts/lib/forge-page.mjs` for the Forge tool browser tests; root `package.json` gains `author` and `contributors` metadata.
  - Verified: lint, library build and the full test suite green.

## [0.101.0] - 2026-10-10

### "Nothing endures but change." - Heraclitus

- **Features:**
  - *Stylized Lava, a lossless port of MinionsArt's "Simple Lava"*: [`StylizedLavaMaterial`](packages/engine/src/core/materials/StylizedLavaMaterial.ts) now follows the original Unity shader line by line (GLSL300, GLSL100 and WGSL): world-XZ projected `_MainTex` and `_DistortTex`, Unity's time bases (`_Time.x = t/20`, `_Time.z = 2t`), the red vertex colour as fade for texture, top layer, final colour, wave and UV offset, the two-colour tint lerp, depth edge and top layer. The first version replaced both textures with a procedural Voronoi web and had no vertex colours; that deviation is gone. `RampLUT` stays as an optional extension. Defaults are the Astro Kat settings. WebGL1 is supported (without scene depth, so no shore line).
  - *Vertex colours in all three renderers*: `Geometry.colors` is uploaded and bound (flag `USE_VERTEX_COLOR`; WebGL attribute location 11, WebGPU vertex buffer slot 6, opaque white when a mesh has none; not combinable with instancing). New `Texture.dispose()` frees a texture's CPU-side pixel data.
  - *Showcase 10*: the four stylized lava pools run on a horizontal `Ground` surface with a painted rim fade; "Volcanic" is the pure Unity reference (two-colour lerp), the others use thermal ramps. Replacement textures `lava_main.webp` and `lava_distort.webp` come from `scripts/gen-lava-textures.mjs` and can be swapped for the originals.
  - *Xtractor*: Cmd+D / Esc deselect, arrow-key nudge (Shift = 10 px), Cmd+0 / Cmd+1 fit and 100 %, undoable image removal, Shift+Enter in the chat; the AI chat can be cancelled with Esc.
- **Architecture & Bugfixes:**
  - *Stylized Lava failed on two backends before*: the WebGL2 program did not link (interface block `int` precision differed between the stages) and the WebGPU shader did not compile without maps (`USE_*` constants). The wave also moved vertices sideways inside a vertical `Plane`.
  - *WebGPU stylized water*: `StylizedWater.frag.wgsl` still read legacy uniform slots (`shininess`, `pad2`, `useReflectionMap`), which broke refraction and caustics on WebGPU for stylized, Noir and OilSlick water. New `LiquidUniformNameParity` test forbids legacy slots and checks every read field against what the manifest writes.
  - *Water surface probe*: `OpenWaterSurfaceProbe` mirrors the splat ring and the wall reflection (clapotis) of the vertex shader and reads the lanes live; new `OpenWaterMaterial.poolHalfExtent` (default 4.0, 0 = off) replaces the hard-coded wall distance. `emitSplat` lives on `OpenWaterMaterial`.
  - *Renderers*: the WebGL1 HDR target is no longer re-allocated on every bind; pipeline flags are sorted, de-duplicated and validated; the object ring buffer no longer leaks on a double grow and grows on overflow instead of reusing the last slot; pending destroys are drained on resize; `SmallWorldMachine.step` fails fast after `destroy()` and on invalid `dt`; `World.frag.glsl100` matches GLSL300/WGSL (blend weights, sRGB).
  - *Tools security and robustness*: zip and gzip ingest is size-limited before unpacking (zip bomb, zip slip); the Gemini key moves from the URL to a header; AI and error texts are no longer written with `innerHTML`; all AI requests have a timeout and can be cancelled; undo history has a 256 MB budget; `HttpVisionProvider` replaces four copies of the same request scaffold; OpenAI GPT-5 and o-series use `max_completion_tokens`.
  - *Scripts*: `goldens/compare.js` can no longer report a green result without a current capture or with missing cells; `capture.js` retries only blank frames and fails hard on console errors; `webgpu-resize-stress.js` fails when WebGPU is not active; `ibl-bake` passes its options through.
- **Housekeeping & Docs:**
  - `Xtractor.ts` shrank from 1781 to 687 lines (`AiChatPanel`, `CanvasViewport`, `CanvasSelection`, styles), `showcase.ts` of Showcase 10 from 2766 to 797 lines (pool presets as data, textures, props, behaviours, golden capture in their own modules; pixel-identical on all 16 WebGL2 cells).
  - About 9.5 MB of unused assets removed from showcases 10 and 12; steel and brass textures of showcases 12, 27, 28 and 30 now live once in `apps/showcases/shared/assets`.
  - Placebo tests replaced: probe tests against independently computed values, lane scanner without false passes, zero-allocation test covers the flag array. ADR 0027 (512-byte `ObjectUniforms`), the liquid wave data model guide, `REFERENCES.md` and `lava.md` (correction note) updated; Showcase 10 has a `docs/log.md` and a concept dossier.
  - Verified: 255 test files, 1611 tests, lint and `tsc` clean; 48 of 48 golden cells (16 pools on WebGL2, WebGL1 and WebGPU) render without console errors, WebGL2 and WebGPU match for the lava pools. The Xtractor refactor is covered by lint, types and a jsdom smoke test, not clicked through in a browser. `tsc -p packages/engine` still reports TS6059 because two engine tests import `liquid-extras`.

## [0.100.1] - 2026-10-09

### "Geometry is the archetype of the beauty of the world." - Johannes Kepler

- **Architecture & Bugfixes:**
  - *Showcase 10 pool curb tile layout*: Pool edge geometry and UV unwrap now precisely match the physical tile grid. The edge rim follows an exact symmetric joint spacing: half grout -> full tile -> full grout -> full tile -> half grout (`WALL_THICKNESS = 2 * TILE_UNIT_SIZE`, `POOL_SIZE = POOL_TILES_OUTER * TILE_UNIT_SIZE`). Switched pool border mesh from triplanar `WorldMaterial` to `LambertMaterial` so the tile atlas faithfully respects geometry UV coordinates across all rendering pipelines (WebGL & WebGPU).
  - *CustomShaderMaterial texture defines*: Automatically derives shader compilation flags (`USE_*_MAP`) from bound texture slots so `#ifdef`-guarded samplers in standard fragment templates compile without undeclared uniforms.
  - *DTS build isolation*: Restricted `vite-plugin-dts` in `packages/engine/vite.lib.config.ts` to `src/**`, eliminating TS6059 warnings when external extra packages are referenced by tests.
  - *Noir water ink transport*: Aligned `NoirWaterMaterial` shader posterization hooks and uniform lane transport with `LaneTransport` specifications (`posterizeSteps` default 4, `inkSteps = max(posterizeSteps - 1.0, 1.0)`).
- **Housekeeping & Docs:**
  - Cleaned default camera controllers in showcases 9 and 23 (`defaultCameraController = "none"`).
  - Verified: 246 test suites, 1505 unit tests green; clean linting and builds across core library and all showcases.

## [0.100.0] - 2026-10-08

### "Drop it anywhere, and it finds its way." - Anonymous

- **Features:**
  - *Map Generator on universal ingest*: [`MapGenerator`](packages/tools/src/MapGenerator.ts) now uses the shared `UniversalIngestDropzone` instead of its own text/file/URL panel: drag and drop (window-wide), file and folder picker, URL import and `Cmd+V`. ASCII maps (`.map`, `.txt`), JSON level descriptions (`map`, `ascii` or `grid` fields, or a plain string array), ZIP archives and image or SVG sprites (rasterised to the grid, palette-matched) all load through one route. New `loadFromImage()`. Covered by new tests in `MapGenerator.test.ts`.
- **Housekeeping & Docs:**
  - *Showcase imports*: all showcases import from the package names (`@small-world-machine/engine`, `@small-world-machine/tools`) instead of long relative `packages/.../src` paths; duplicate imports from one module are merged, names sorted. Only the shared audio test mock stays relative.
  - *Asset budgets*: ADR 0011 section 1.1 and the asset sourcing guideline fix a four-tier polycount budget by object size (clutter 800-1.5k, props 2.5-4.5k, furniture 6-10k, hero/architecture 10-16k triangles), set upstream at modelling or export.
  - Verified: `tsc` clean, 245 test files, 1499 tests; showcase build green. The Map Generator's drop routes were covered by unit tests only, not clicked through in a browser.

## [0.99.0] - 2026-10-07

### "Colors are the smiles of nature." - Leigh Hunt

- **Features:**
  - *Ramp LUT for stylized water* (ADR 0026, route (a)): `StylizedWaterMaterial.rampMap` takes a 256x1 colour ramp texture that replaces the hard-coded shallow/mid/deep blend, built from artist-style colour stops with the new `RampLUT` (`bakeRamp` is the pure, unit-tested baking function; `setStops()` re-bakes in place). It costs no uniform lane and leaves the 256-byte `ObjectUniforms` slot untouched. Without a ramp the output is unchanged.
- **Architecture & Bugfixes:**
  - *Three-backend plumbing*: shader flag `USE_RAMP_LUT` in GLSL100, GLSL300 and WGSL (texel-centre sampling, constant blend weight 0.6, `rampSoftness` ignored while a ramp is bound); WebGPU gets optional material texture binding 18 (`u_rampMap`, white fallback). WebGL1 indexes the ramp by a view-angle term, WebGL2 and WebGPU by water depth.
  - *Known limits*: a bound ramp reaches about 79-89 % of its end colours at the constant weight; `quality.disableTextures` renders it white.
- **Housekeeping & Docs:**
  - ADR 0026 and the liquid guide (section 5.1) document the first route-(a) consumer; showcase 10 has an opt-in `?__rampVerify=1` debug hook.
  - Verified: GL2 golden cells byte-identical to the pre-change capture with the flag off (24/24); flag-on checks (red/blue extremes, hue flip, toggle off, re-bake) pass on WebGL1, WebGL2 and WebGPU for toon-water. 244 test files, 1491 tests, lane scan clean. Not covered: flag-on for the other four stylized pools; the committed golden baseline was already red on HEAD (4 cells) independent of this change.

## [0.98.3] - 2026-10-05

### "Good design is as little design as possible." - Dieter Rams

- **Architecture & Bugfixes:**
  - *One tool per drop in the Forge*: every dropzone inside a Forge window (Pixler, Xtractor, Material Studio) listened to window-wide drops and pastes, so one drop was imported into all open tools, and pasted images were additionally imported by the Forge's own paste routing. [`UniversalIngestDropzone`](packages/tools/src/common/io/ui/UniversalIngestDropzone.ts) now only reacts to window drop and paste while its window is the topmost visible one, and leaves pasted images to the Forge. Outside the Forge nothing changes.
  - *Maker viewport*: an SVG dropped straight onto the viewport is now imported as a background reference like on the import panel.
- **Housekeeping & Docs:**
  - Verified in the browser: Forge with Pixler on top of Material Studio (the drop reaches only Pixler), kit-inspector ZIP import with the real bunker `kit.json` (validation report appears), Maker viewport SVG drop. 1360 tests, 0 lint errors.

## [0.98.2] - 2026-10-05

### "The proof of the pudding is in the eating." - Proverb

- **Architecture & Bugfixes:**
  - *PBR slot matching*: [`matchPbrSlots`](packages/tools/src/common/io/PbrSlotMatcher.ts) let single-letter abbreviations anywhere in a name win over the real suffix, so `m_albedo.png` became the metallic map and Material Studio showed the normal map as its source image. The trailing name token now decides; keywords elsewhere in the name only count when the last token names no slot. New `PbrSlotMatcher.test.ts`.
  - *Maker background import*: dropped SVGs were silently ignored, because `createImageBitmap` cannot decode SVG blobs. They are now rasterised to PNG at their normalised size before import.
- **Housekeeping & Docs:**
  - Verified in the browser: Maker background import (SVG, PNG, map set, drop on the viewport) and Material Studio (PBR-set drop shows the albedo map). 227 test suites, 1360 tests, 0 lint errors.

## [0.98.1] - 2026-10-05

### "Perfection is achieved when there is nothing left to take away." - Antoine de Saint-Exupéry

- **Architecture & Bugfixes:**
  - *Double import in the tools*: Xtractor (page and class) and pbr-gen reacted to one drop with up to three handlers (dropzone, legacy `ToolDropOverlay`, own canvas/paste listeners): an SVG drop loaded twice and showed a "no compatible image" warning next to the success toast. The dropzone now stops the drop from bubbling to window handlers, owns window drop and paste in Xtractor and pbr-gen, and the redundant legacy listeners are gone.
  - *Leftovers of the old ingest result shape in untyped pages*: ibl-gen read `pbrSet.diffuse`/`slots`/`items` (a PBR-set drop never enabled "Generate"), kit-inspector waited for `kind: "zip"` (ZIP and folder drops via the dropzone never imported). Both use the current `archive` / `files` / `gltf` / `pbr-set` results now.
- **Housekeeping & Docs:**
  - Verified in the browser: SVG, PNG, ZIP and PBR-set drops in Xtractor, Pixler (SVG becomes 64x32 for a 40x20 viewBox), pbr-gen and ibl-gen. Not checked: kit-inspector with a real kit, Material Studio, Maker import.

## [0.98.0] - 2026-10-05

### "A good tool improves the way you work." - Jeff Duntemann

- **Features:**
  - *Universal ingest for all tools*: [`UniversalIngestRouter`](packages/tools/src/common/io/UniversalIngestRouter.ts) routes dropped files, folders, ZIP/GZ archives, URLs, clipboard images and text into typed results (`image`, `svg`, `pbr-set`, `gltf`, `json`, `text`, `archive`, `files`); PBR map sets are matched by file name ([`PbrSlotMatcher`](packages/tools/src/common/io/PbrSlotMatcher.ts)), archives are unpacked ([`ArchiveDecompressor`](packages/tools/src/common/io/ArchiveDecompressor.ts)). Shared helpers in [`ingestResultHelpers.ts`](packages/tools/src/common/io/ingestResultHelpers.ts) (`primaryPbrTexture`, `firstImageItem`, `blobToDataUrl`).
  - *First-class SVG input*: SVG files, SVG data URLs and pasted SVG code arrive as `kind: "svg"` with `svgText`. [`normalizeSvg()`](packages/tools/src/common/io/svgNormalize.ts) gives every SVG an explicit pixel size and `viewBox` (long edge 1024 px by default, `svgLongEdge` option, 0 keeps the intrinsic size; px/pt/mm/cm/in understood, `%` ignored, missing `xmlns` added) instead of the browser's random 300x150 / 150x150 default. Pixler sizes vectors to 64 px.
  - *One compact upload zone, one template*: [`UniversalIngestDropzone`](packages/tools/src/common/io/ui/UniversalIngestDropzone.ts) is a single row (icon, short title, four SVG icon buttons for file, folder, URL and clipboard); formats, URL and Cmd+V live in the tooltip instead of permanent text. pbr-gen, ibl-gen, kit-inspector, xtractor, Pixler, Material Studio and the Maker background import all use it with the same short titles ("Textur ablegen", "HDR ablegen", "Kit ablegen", ...); the old per-page upload widgets and the dead `.dropzone` CSS are removed.
  - *Undo/redo and command history*: [`CanvasUndoHistory`](packages/tools/src/common/image/CanvasUndoHistory.ts) and [`CommandHistory`](packages/tools/src/common/io/ui/CommandHistory.ts) (arrow/page navigation, optional persistence); `bindToolShortcuts` gained Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z / Y.
- **Architecture & Bugfixes:**
  - *Ingest API migration finished*: Xtractor, Pixler, Material Studio and the Maker import still expected a previous result shape (`kind: "zip"`, `result.items`, `pbrSet.slots`, `IngestFileItem.dataUrl`); they now use the router's `archive` / `files` results and the shared helpers, so ZIP and PBR-set drops no longer fall through at runtime. `FileAssetSource` receives `{ path, file }` entries, strict-mode guards were added across the router, decompressor and matcher, and `IngestTargetKind` now includes `"files"`. The repo typechecks cleanly again (it had 49 errors in `packages/tools`).
  - *IBL generator*: `loadEquirectangularImage()` accepts a `Blob`, `File` or `ImageBitmap`.
- **Housekeeping & Docs:**
  - 13 new unit tests for `normalizeSvg`; all 226 test suites (1357 unit tests) pass, 0 lint errors, 0 type errors.
  - Known and unchanged: Pixler and the Maker background import were not re-checked visually after the label change; the SVG size for Pixler (64 px) is an assumption.

## [0.97.1] - 2026-10-05

### "Still waters run deep." - English Proverb

> Documents the Showcase 10 quality round (analysis, fixes and cross-reviews by four collaborating agents). Parts of it already shipped inside the 0.97.0 commit `af62c5f0` without a changelog entry and are listed here so that each change appears under the right heading.

- **Features:**
  - *Showcase 10 gallery*: ten pools side by side (clear water, toon, bold, soft, sparkle, dredge, noir, lava, slime, oil). The start camera now fits the near row to the aspect ratio (FOV 64°, pitch -28°), signs stand beside their own pool, dredge/noir/lava/slime/oil get dark tile frames, the sky has a clear colour plus linear horizon fog, the subtitle lists all ten pools, and public labels carry no trademark names.
  - *Noir ink look* (`@small-world-machine/liquid-extras`): the hook posterises in gamma space and draws constant-frequency pen hatching (8 lines per unit) whose line thickness follows tone from hairline to solid; cross-hatching only in the darkest band; `posterizeSteps` (2..8) is wired through `u_styleA.w`; thin broken foam rim.
  - *OilSlickMaterial* (`@small-world-machine/liquid-extras`): dark, viscous oil with a sparse rainbow sheen (smooth domain-warped flow noise instead of cell noise, sheen tied to fresnel and the sun, `iridescenceStrength` wired, absorption 1.8/1.5/1.2). Class docs no longer claim thin-film interference.
- **Architecture & Bugfixes:**
  - *Bright patch root cause*: the toon specular term `aaStepMask(0.99, nDotH, ...)` is a +-8 degree cone, but wave slopes are smooth over metres, so one cone covered about 20% of a pool. The cone is now narrow for all stylized styles (`aaStepMask(0.9993, nDotH, 0.0005)`, `smoothstep(0.9988, 0.9997, ...)` in GLSL100).
  - *WebGPU lava stripes*: `DepthPrePassGPU` drew opaque waved liquids with the flat shared `DepthMaterial` (no wave displacement), so displaced troughs failed the later less-equal depth test and the clear colour showed through. [`FluidSurfaceMaterial.getRenderManifest()`](packages/engine/src/core/materials/FluidSurfaceMaterial.ts) now sets `state.skipDepthPrePass` for opaque liquids with wave amplitude above 0 (unit test added).
  - *Clear water* ([`OpenWater.frag.*`](packages/engine/src/core/materials/shaders/OpenWater.frag.glsl)): caustics are projected along the sun ray with gain 0.1 and their own scale, seabed tint `mix(1, waterColor, 0.6)`, narrower specular, crest foam `smoothstep(0.65, 0.95) * 0.5`; WebGL1 samples the opaque capture with a real screen UV (`v_clipPos`) instead of the mesh UV, which removes a blue sub-rectangle.
  - *Stylized family* ([`StylizedWater.frag.*`](packages/engine/src/core/materials/shaders/StylizedWater.frag.glsl)): explicit integer style ids (0 toon, 1 soft, 2 sparkle, 3 extension, 4 dredge, 5 bold) instead of fractional ids; calmer foam rim (edge tint 0.2, foam weight 0.2) for soft/sparkle/dredge/bold; sparkle desaturation; dredge depth fog; WebGL1 edge weight capped at 0.3 and specular halved.
  - *Pool tuning*: lava reads orange-red (emissive 2.4, colour 1/0.2/0.03), slime keeps soft bubble highlights without dark rings and no longer blows out to white at the walls on WebGPU, the oil pool uses dull dark objects.
- **Housekeeping & Docs:**
  - *Research notes*: [`docs/research/stylized-water/README.md`](docs/research/stylized-water/README.md) now marks the planning sections as historical and summarises the quality analysis (the analysis, before/after images and cross-review boards stay local under `.agents/collaborate/scratches/water/`).
  - Known and unchanged: radial wall tile perspective, flat sky colour, WebGL1 water slightly milkier than WebGL2/WebGPU, no frame-time measurements.
  - 220 test suites (1303 unit tests) passing green with 0 lint errors in the water packages; `packages/tools` was left out of this release (work in progress).

## [0.97.0] - 2026-10-04

### "The river is everywhere at the same time, at the source and at the mouth, at the waterfall, at the ferry, at the current, in the ocean and in the mountains." - Hermann Hesse

- **Features:**
  - *Multi-Octave Gerstner Wave Cascade & Deep-Water Dispersion*: Upgraded `StylizedWaterMaterial` and `OpenWaterMaterial` vertex shaders across WebGL1, WebGL2, and WebGPU to a 6-wave harmonic spectrum with exact physical dispersion ($\omega_i = \sqrt{g k_i}$), golden ratio angular spread, and bimodal $60^\circ$ cross-swell.
  - *Analytical Jacobian Crest Whitecaps*: Integrated $O(1)$ Jacobian determinant calculation ($J = t_x b_z - t_z^2$) derived directly from accumulated Gerstner tangent/bitangent vectors to drive dynamic whitecaps without mesh self-intersections.
  - *Advanced Fluid Rheology & Looks*: Upgraded `LavaMaterial` and `SlimeMaterial` with non-Newtonian flow behaviors, Voronoi crust fracturing, and chromatic Beer-Lambert depth absorption.
- **Architecture & Bugfixes:**
  - *Zero-Allocation Render Hot Paths*: Preserved strict zero-allocation in CPU render loops and maintained standard UBO layouts across all three backend rendering pipelines.
  - *Blackboard & Collaborate Finalization*: Resolved and closed collaborate sessions `liquid-improve`, `showcase-10-ghibli`, `improve`, `liquid-architecture`, and `review`.
- **Housekeeping & Docs:**
  - *Hydrodynamic Analysis Documentation*: Fully documented fluid mechanics, dispersion laws, and literature references in `.agents/collaborate/liquid-improve.md`.
  - All 218 test suites (1291 unit tests) passing green with 0 lint errors.

## [0.96.0] - 2026-10-04

### "Art does not reproduce the visible; rather, it makes visible." - Paul Klee

- **Features:**
  - *Anime Fluid Pipeline & Preset Ladder*: Unified `StylizedWaterMaterial` into a modular stylized fluid shader core supporting presets (`flat`, `toon`, `bold`, `soft`, `sparkle`, `dredge`, `custom`) for water, magma, toxic slime, and oil.
  - *Stepped Star Glint & Smooth Voronoi Caustics*: Introduced procedural $F_1-\text{Smooth}F_1$ Voronoi caustic networks and quantized 4-point astroid star glints (8/12 FPS cadence for traditional animation feel) across WebGL1, WebGL2, and WebGPU.
  - *Modular Liquid Extensions*: Created `@small-world-machine/liquid-extras` package and compile-time injection hooks (`[WATER_EXT_DECL]`, `[WATER_EXT_SURFACE]`) enabling external look extensions (e.g. `NoirWaterMaterial`) with zero engine core overhead.
- **Architecture & Bugfixes:**
  - *Std140 Uniform Layout Alignment*: Added `u_styleA` and `u_styleB` (vec4) to `ObjectUniforms` (float offsets 56 and 60) within the 256-byte budget in `StandardWebGPULayout` and `structs.wgsl`.
  - *Architectural Decision Record*: Documented engine core vs. extension boundaries in ADR 0025 (`0025-stylized-liquid-looks-engine-vs-extension.md`).
- **Housekeeping & Docs:**
  - *Domain Modeling & Mathematical References*: Documented anime fluid family concepts in `CONTEXT.md` and mathematical derivations in `REFERENCES.md`.
  - *ESLint Engine Isolation*: Enforced boundary rule preventing `@small-world-machine/engine` from importing extension packages.
  - All 216 test suites (1278 unit tests) passing green with 0 lint errors.

## [0.95.2] - 2026-10-03

### "Small leaks sink great ships." - Benjamin Franklin

- **Architecture & Bugfixes:**
  - *Bounded GL error drain*: The stale-error drain before the opaque depth blit in [`WebGL2Renderer.copyToOpaqueDepthTexture()`](packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts) is capped at 8 iterations; a lost context reports `CONTEXT_LOST_WEBGL` forever and would have spun the loop endlessly. The sticky `_opaqueDepthUnsupported` verdict is now documented as intentional (no context-restore path exists).
  - *Lazy shader registration*: [`AbstractWebGLRenderer.requiresOpaqueDepth()`](packages/engine/src/renderers/AbstractWebGLRenderer.ts) no longer caches an unregistered shader id as "not needed", so a lazily registered shader is asked again.
  - *Gate uses the render shader id*: [`WebGLMainPass`](packages/engine/src/renderers/passes/WebGLMainPass.ts) now queries `getRenderManifest().shaderId` (the id the draw uses) instead of `material.type`, so material variants with a different shader are gated correctly.
  - *Known, unchanged*: The opaque colour capture is still taken whenever any transparent object exists; gating it needs a reliable `u_opaqueMap` detection across the standard layouts and is tracked in the backlog.
- **Housekeeping & Docs:**
  - *Tests*: Added an unregistered-shader-id caching case to `AbstractWebGLRenderer.test.ts`.
  - All 214 test suites (1270 unit tests) passing green with 0 lint errors.

## [0.95.1] - 2026-10-03

### "Every great advance in science has issued from a new audacity of imagination." - John Dewey

- **Architecture & Bugfixes:**
  - *WebGL2 opaque depth capture without post-processing*: [`WebGL2Renderer.copyToOpaqueDepthTexture()`](packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts) bailed out unless post-processing was enabled, so `u_opaqueDepthMap` stayed empty and materials such as StylizedWater (caustics, pool floor) and FluidSurface (absorption) rendered flat on WebGL2. It now blits from the default framebuffer, probes depth formats (`DEPTH24_STENCIL8`, `DEPTH_COMPONENT24`, `DEPTH_COMPONENT32F`, `DEPTH_COMPONENT16`) until a blit succeeds (Chrome's MSAA default framebuffer needs `DEPTH24_STENCIL8` although it reports no stencil bits), caches the working format, skips offscreen targets and reallocates on size or format change.
  - *Zero cost for other scenes*: New cached [`AbstractWebGLRenderer.requiresOpaqueDepth()`](packages/engine/src/renderers/AbstractWebGLRenderer.ts) checks the shader layout for `u_opaqueDepthMap`; [`WebGLMainPass`](packages/engine/src/renderers/passes/WebGLMainPass.ts) captures depth only when post-processing is on or a transparent material declares that sampler. Measured in Showcase 10: 324 captures in 324 frames with liquid pools, 0 in 360 frames without them.
- **Housekeeping & Docs:**
  - *Tests*: Added [`WebGLMainPassOpaqueDepthGating.test.ts`](packages/engine/tests/renderers/WebGLMainPassOpaqueDepthGating.test.ts) and a `requiresOpaqueDepth` case in `AbstractWebGLRenderer.test.ts`.
  - All 214 test suites (1269 unit tests) passing green with 0 lint errors.

## [0.95.0] - 2026-10-03

### "The sea, once it casts its spell, holds one in its net of wonder forever." - Jacques Cousteau

- **Features:**
  - *Showcase 10 liquid quality pass*: Four agents (collaborate session `showcase-10`, consensus P1) reworked all four pools without forking the two shader cores.
  - *Crest foam on clear water*: [`OpenWater.vert.*`](packages/engine/src/core/materials/shaders/OpenWater.vert.glsl) derives a Jacobian wave-folding metric from the Gerstner tangents and passes it as a varying; the fragment shaders turn it into whitecaps with `smoothstep` (no new uniforms).
  - *StylizedWater de-cluttering*: Hard `step()` masks replaced by an anti-aliased `aaStepMask` with per-effect softness, the x1.2 overdrives and the normal-slope crest foam removed, new `style: "flat" | "toon" | "bold"`, `causticStrength` and `specularStrength` on [`StylizedWaterMaterial`](packages/engine/src/core/materials/StylizedWaterMaterial.ts).
  - *FluidSurface substance*: [`FluidSurfaceMaterial`](packages/engine/src/core/materials/FluidSurfaceMaterial.ts) now samples `u_normalMap` and gains `rimStrength`, `specularStrength`/`specularPower`, `normalStrength`, `absorption` (Beer-Lambert over the opaque depth map), `shade`, noise-driven `emissiveMask`, `emissivePulse`/`emissivePulseSpeed`, `transitionSoftness` and `waveAmplitude`, all via free uniform slots in GLSL300, GLSL100 and WGSL. Defaults keep the old look.
  - *Lava and Slime looks*: New tileable crust and bubble textures with normal maps in `apps/showcases/10/assets`, new presets in [`LavaMaterial`](packages/engine/src/core/materials/LavaMaterial.ts) and [`SlimeMaterial`](packages/engine/src/core/materials/SlimeMaterial.ts).
- **Architecture & Bugfixes:**
  - *`viscosity` semantics*: Now drives slow, large-amplitude blobs (`3 / (1 + 0.1 * viscosity)` frequency, `0.03 + 0.006 * viscosity` amplitude) instead of a higher wave frequency; vertex normals are computed analytically so lighting reacts to the waves.
  - *FluidSurface WebGL1 vertex shader*: Read dead uniform names, so no waves appeared under WebGL1; it now uses the same uniform blocks as WebGL2.
  - *WebGL1 shore-foam proxy*: The `pow(1 - fresnel)` approximation covered pools top-down in flat white; replaced by a Fresnel `smoothstep` gate in [`StylizedWater.frag.glsl100`](packages/engine/src/core/materials/shaders/StylizedWater.frag.glsl100) and [`OpenWater.frag.glsl100`](packages/engine/src/core/materials/shaders/OpenWater.frag.glsl100).
  - *WebGPU crest metric*: `GPUPipelineCache` overwrites `Out.texIndex` before every vertex `return`, so a metric stored there is always 0; it is now carried in `Out.original_uv.x`.
  - *Known gap*: WebGL2 captures the opaque colour/depth maps only with post-processing enabled, so the stylized pool shows no caustics or floor and slime absorption is inert there (WebGPU always captures); tracked in `.agents/notes/backlog.md`.
- **Housekeeping & Docs:**
  - *Collaborate skill*: Added a rule that all agent-to-agent communication, prompts and board entries are written in English.
  - All 213 test suites (1264 unit tests) passing green with 0 lint errors.

## [0.94.0] - 2026-10-02

### "The mathematician's patterns, like the painter's or the poet's, must be beautiful." - G. H. Hardy

- **Features:**
  - *Realtime Numerical Primitives*: Added `smoothstep`, `smootherstep` (Perlin quintic polynomial $6t^5-15t^4+10t^3$), `inverseLerp`, framerate-independent `damp` ($1 - e^{-\lambda \Delta t}$), and bitwise `isPowerOfTwo` / `nextPowerOfTwo` in [`MathUtils.ts`](packages/engine/src/math/MathUtils.ts).
  - *Public GltfLoader Parse API*: Exposed typed `public async parse(gltf, baseUrl)` API on [`GltfLoader.ts`](packages/engine/src/loaders/GltfLoader.ts), cleanly eliminating all duck-typed `(loader as unknown as { _parse })` casts across tools and extension tests.
- **Architecture & Bugfixes:**
  - *Rodrigues Vector Optimization (-40% FLOPs)*: Replaced 4D Hamilton expansion in [`Vector3D.applyQuaternion()`](packages/engine/src/math/Vector3D.ts) with the vectorial Rodrigues formula $v' = v + 2w(q \times v) + 2(q \times (q \times v))$, reducing execution cost to 15 multiplications and 12 additions with zero allocations and branch-free flow.
  - *Quaternion Downward Gimbal Lock Correction*: Fixed yaw/roll sign inversion in [`Quaternion.toEuler()`](packages/engine/src/math/Quaternion.ts) during negative pitch ($-90^\circ$) singularity.
  - *Zero-Allocation Matrix Decomposition & Closed-Form Oblique Shear*: Replaced `MathPool` vector/matrix churn in [`Matrix4.decompose()`](packages/engine/src/math/Matrix4.ts) with algebraic register calculations via `Math.hypot()`, and eliminated 4x4 matrix multiplication in [`ObliqueProjection.update()`](packages/engine/src/math/projections/ObliqueProjection.ts).
  - *AnimationMixer Hot-Path Heap Allocation Elimination*: Replaced `for..of` Map-destructuring iterations in [`AnimationMixer.update()`](packages/engine/src/core/animation/AnimationMixer.ts) with pre-allocated flat indexed lists, eliminating ~12,000 GC array allocations per second on 50-bone character rigs.
  - *Object3D Transform Dirty-Flags & Indexed Traversal*: Added `matrixWorldNeedsUpdate` and `isStatic` skipping in [`Object3D.updateMatrixWorld()`](packages/engine/src/core/Object3D.ts) alongside index-based child loops.
  - *O(1) Amortized Keyframe Segment Search*: Added `_lastIndex` cache and forward linear evaluation to [`KeyframeTrack._findSegment()`](packages/engine/src/core/animation/KeyframeTrack.ts) with $O(\log N)$ binary search fallback.
  - *WebGPU Normal Scaling Fix & Tonemapping Pipeline Parity*: Corrected vertex normal fallback in [`base.vert.wgsl`](packages/engine/src/core/renderers/shaders/source/web_gpu/base.vert.wgsl) from transformed length to local dot products (preventing normal collapse on small scaled meshes), corrected linear HDR color mixing before tonemapping in [`Standard.frag.wgsl`](packages/engine/src/core/materials/shaders/Standard.frag.wgsl), guarded Reinhard tonemapping in [`Frostglass.frag.wgsl`](packages/engine/src/core/materials/shaders/Frostglass.frag.wgsl) and [`Glass.frag.wgsl`](packages/engine/src/core/materials/shaders/Glass.frag.wgsl), and integrated fog into Terrain and FluidSurface shaders.
  - *TypeScript Strictness & Any Elimination*: Replaced all `(DeviceOrientationEvent as any)` in [`DeviceOrientationController.ts`](packages/engine/src/core/controllers/DeviceOrientationController.ts) with typed `DeviceOrientationEventIOS`, replaced `ThreadTask<any, any>` in [`ThreadPool.ts`](packages/engine/src/core/threading/ThreadPool.ts) with `ThreadTask<unknown, unknown>`, introduced `isSkinnedMesh()` type guard, and removed `eslint-disable` suppressions.
- **Housekeeping & Docs:**
  - *Collaborative Review Blackboard & Math References*: Added documentation for Rodrigues rotation and Perlin Smootherstep in [`REFERENCES.md`](REFERENCES.md) and archived the multi-agent review session in [`.agents/collaborate/review.md`](.agents/collaborate/review.md).
  - All 213 test suites (1264 unit tests) passing green with 0 lint errors.

## [0.93.2] - 2026-10-02

### "In the right light, at the right time, everything is extraordinary." - Aaron Rose

- **Architecture & Bugfixes:**
  - *PBR F0 Clamping & NaN Bloom Elimination*: Clamped specular reflectance $F_0 = \text{mix}(F_{0,\text{dielectric}}, \text{albedo}, \text{metallic})$ to $[0, 1]$ in WebGL1, WebGL2, and WebGPU PBR shader chunks ([light_calc_pbr.frag.glsl](packages/engine/src/core/renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl), [light_calc_pbr.frag.glsl](packages/engine/src/core/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl), and [lighting_pbr.wgsl](packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl)). Prevents texture x tint multipliers from overshooting 1.0, which previously caused negative diffuse factor $k_D = (1 - k_S) \cdot (1 - \text{metallic}) < 0$, producing NaN during gamma/pow correction that the Bloom mip chain smeared into rectangular grid artifacts.
- **Housekeeping & Docs:**
  - *Shader & Pass Regression Test Suite*: Added unit tests in [NormalFallbackScaleIndependence.test.ts](packages/engine/tests/renderers/NormalFallbackScaleIndependence.test.ts) (verifying scale-independent vertex normal fallback and PBR F0 clamping across all 3 backends), [WebGLMainPassDepthMask.test.ts](packages/engine/tests/renderers/WebGLMainPassDepthMask.test.ts) (verifying depthMask restoration and state cache reset prior to depth clear), and [DirectionalLight.test.ts](packages/engine/tests/core/DirectionalLight.test.ts) (verifying freshly fitted cascade view-projection matrix calculation).
  - All 212 test suites (1248 unit tests) passing green with 0 lint errors.

## [0.93.1] - 2026-10-02

### "It's not that I'm so smart, it's just that I stay with problems longer." - Albert Einstein

- **Architecture & Bugfixes:**
  - *Showcase 29 WebGL2 darkness (root cause)*: [`base_vertex_main.vert.glsl`](packages/engine/src/core/renderers/shaders/source/web_gl2/chunks/base_vertex_main.vert.glsl) replaced the normal with `(0, 1, 0)` whenever the *transformed* normal's squared length was below `0.0001`. Meshes with a small world scale (103 of 117 Sponza meshes at 0.008, so `|N|^2 = 6.4e-5`) therefore had almost every normal collapse to +Y: floors looked right by accident, ceilings and walls received no point-light contribution and the sun lit ceiling undersides. The fallback now tests the *local* vertex normal, so it no longer depends on mesh scale. Measured luma median/mean on the same camera: WebGL2 14/34 -> 67/85, WebGPU 66/83.
  - *`depthMask` leak*: `WebGLMainPass` now restores `depthMask(true)` (and resets the renderer state cache) before the frame's depth clear, and `PostProcessPassGL` restores it after its fullscreen pass. Previously a `depthMask(false)` left over from transparent or post-process draws turned the next frame's depth clear into a no-op, which showed up as a black image whenever the sun had `castShadow = false` (the shadow pass otherwise masked the leak by setting `depthMask(true)` itself).
  - *Stale cascade view-projection*: `DirectionalLight.updateCascades()` now recomputes each cascade camera's view-projection matrix after applying the new orthographic bounds; it previously multiplied the previous frame's bounds.
- **Housekeeping & Docs:**
  - Found by a parallel multi-agent investigation (per-light-type contribution compared across WebGL2 and WebGPU on an identical camera). Known open issue: WebGPU-only rectangular green/blue Bloom artifacts (8 px grid), not part of this release.
  - 210 test suites (1240 unit tests) passing, 0 lint errors.

## [0.93.0] - 2026-10-02

### "The universe is not made of things, but of relations." - Carlo Rovelli

- **Features:**
  - *Unified Multi-Modal Ingest Architecture (`UnifiedIngestPanel`)*: Introduced a standardized, modular 3-way input component (`packages/tools/src/common/io/ui/UnifiedIngestPanel.ts`) providing unified File Drag & Drop, URL Fetch, and Raw Text/Code Direct Input tabs across the toolchain.
  - *Platform-Wide Dropzone Unification*: Replaced disparate ad-hoc file upload inputs with standardized token-based `.dropzone`, `.dropzone.compact`, and `.dropzone.hero` components in [`tool-theme.css`](public/assets/tool-theme.css) across `ibl-gen`, `pbr-gen`, `xtractor`, and `kit-inspector`.
  - *Global Clipboard Ingest (`Cmd+V`)*: Added container- and window-wide clipboard ingestion for images, sprite assets, GeoJSON, and ASCII map data without requiring explicit input focus.
  - *Map Generator & Maker Import Modernization*: Overhauled [`MapGenerator.ts`](packages/tools/src/MapGenerator.ts) and [`MapImportPanel.ts`](packages/tools/src/maker/MapImportPanel.ts) with multi-mode file/URL/text ingest and 1-click clipboard map export.
- **Architecture & Bugfixes:**
  - *Dropzone Token Strictness*: Fully bound all dropzone and ingest panel elements to semantic `:root` design tokens (`--tool-inset`, `--tool-border`, `--tool-card`, `--tool-hover`, `--tool-accent`, `--tool-accent-glow`), rigorously verified by `ToolTheme.test.ts`.
- **Housekeeping & Docs:**
  - *Ingest Test Suite & Quality Verification*: Added [`UnifiedIngestPanel.test.ts`](packages/tools/tests/UnifiedIngestPanel.test.ts) covering mode tabs, URL triggers, text parsing, and clipboard dispatch; verified all 210 test suites (1240 unit tests) green with 0 lint and 0 CSS token audit errors.

## [0.92.0] - 2026-10-02

### "The details are not the details. They make the design." - Charles Eames

- **Features:**
  - *Unified Compact Tool Headers*: Standardized ultra-compact 38px header layout across all 9 engine tool applications (`pbr-gen`, `splatter-gen`, `xtractor`, `pixler`, `kit-inspector`, `ibl-gen`, `maker`, `map-gen`, `gamepad-test`), eliminating legacy navigation buttons and introducing conditional `.tool-close-btn` (`✕`) window-close triggers for embedded iframes and modal popup workflows.
  - *Platform-Wide CSS Design Token System*: Parameterized all UI surfaces with semantic design tokens (`--tool-*`, `--showcase-*`, `--font-ui`, `--font-mono`) in [`tool-theme.css`](public/assets/tool-theme.css) and [`shared.css`](public/assets/shared.css), renaming trademarked `--tron-*` tokens to legally clean `--showcase-*` variables.
  - *Zero-Network Font Architecture & 100% WOFF2 Migration*: Completely severed all external Google Fonts network calls in favor of local SIL OFL-licensed `.woff2` fonts in [`fonts.css`](public/assets/fonts.css); converted the legacy `Dungeon.ttf` asset into an optimized `Dungeon.woff2` (64.4% size reduction from 29.4 KB down to 10.5 KB).
- **Architecture & Bugfixes:**
  - *CSS Audit & Design Token Validator*: Introduced CLI tool [`audit-css-tokens.js`](scripts/audit-css-tokens.js) (`npm run css:audit`) scanning stylesheets and tool pages for raw color literals and untokenized typography, achieving a verified 0-literal baseline across the tool ecosystem.
  - *Typography Fallback Streamlining*: Replaced fragmented font stacks (`Courier New`, `Inter`, `Georgia`, ad-hoc system chains) with centralized `--font-ui` and `--font-mono` tokens across portals, modals, launchers, and dioramas.
  - *Collaborate Multi-Agent Protocol*: Enhanced multi-agent peer protocol under `.agents/skills/collaborate/` with structured coordinator support, append-only event sourcing, and round-robin locks.
- **Housekeeping & Docs:**
  - *Full Test & Lint Verification*: 209 test suites (1236 unit tests) passing 100% green with zero lint issues and strict TypeScript types.

## [0.91.0] - 2026-10-01

### "Order is not pressure which is put on things from without, but salvation which comes from within." - Josiah Royce

- **Features:**
  - *Unified Tool I/O Architecture*: Symmetrical `IAssetSource` (input) and `IAssetSink` (output) contract across `packages/tools`, establishing standardized ZIP archives, local directory access, drag-and-drop, and native file pickers for Small World Machine tools.
  - *Kit Inspector Custom Kit Import & Export*: Direct drag-and-drop support for Kit ZIP archives and folder hierarchies with dual-registry architecture (`_presetRegistry` and `_kitRegistry`), strict/tolerant manifest validation (`KitManifestValidator`), live prop loading via `sw-asset://`, and 1-click full ZIP export.
  - *Material Studio & PBR Map Generator Modernization*: Complete removal of blocking browser `alert()` popups in favor of `ToastManager` notifications, added `ToolDropOverlay`, high-efficiency keyboard shortcuts, and full 7-map canvas + `pbr-profile.json` ZIP pack export generation.
  - *Xtractor Sprite Slicing & ZIP Export*: Seamless sprite image dropping, unified tool shortcut bindings, and instant 1-click sprite sheet slice export as structured ZIP archives.
- **Architecture & Bugfixes:**
  - *Engine Virtual Fetch Seam*: Extended `AssetManager` with `customFetch` hook and URI scheme detection (`sw-asset://`), allowing `KitRegistry` and engine loaders to resolve virtual, memory-backed, and unpacked archive assets transparently without engine coupling.
  - *Security & Resource Protection*: Comprehensive `SecurityValidator` with Zip-Slip path sanitization, directory traversal defense, MIME type whitelisting, and pre-flight worker size checks against OOM memory cloning failures.
  - *Lazy File Size Evaluation*: Folder source size validation shifted to lazy asset access (`read`), ensuring kits with unreferenced heavy working files (e.g. 50+ MB source FBXs) open seamlessly without failing the initial folder mount.
- **Housekeeping & Docs:**
  - *IO Unit Test Suite*: Added comprehensive unit tests in `packages/tools/tests/io/` covering security validation, ZIP extraction/compression roundtrips, manifest validator paths, and UI components (all 208 test suites, 1232 tests passing green).

## [0.90.0] - 2026-09-29

### "Darkness cannot drive out darkness; only light can do that." - Martin Luther King Jr.

- **Features:**
  - *Kit-Decals in scene staging (The Whisper prologue)*: The previously-unused `flakturm/decals` asset pack is now staged across Koje 42 and the Kältekammer instead of further procedural dressing — wall stencil „Koje 42" next to the blast door + „Nur für Hausangehörige!" notice on the back wall, an „AZS – Sektor 0" morgue badge, structural `rebar_damage` spalling above the rubble, a 45° hazard warning zone in front of the pulled K-42 tray, and a luminescent `guide_stripe_glow` corridor leading toward the exit. All decals are static, fail-fast logged, and driven purely by existing CC0 kit assets.
  - *Ground-truth lean architecture*: No new decal subsystem — decals remain transparent `Plane` + `StandardMaterial` (`diffuseMap = alphaMap`, `transparent` → depth-write auto-off, `cullMode = NONE`), a ~20-line helper in [`prologue.ts`](apps/sample-apps/the-whisper/scenes/prologue/prologue.ts).
- **Architecture & Bugfixes:**
  - *Mirror-safe wall decals*: The +X-facing wall rotation (`rotation.y = π/2`) mirrors the stencil, counteracted via `Texture.flipX()` (UV-repeat-based, no asset duplication); the 4:1 guide-stripe texture is laid along the corridor axis via a capped two-node rotation (`x = −π/2` + `z = π/2`) instead of an unsupported UV-rotation.
  - *No code-path duplication*: `_placeSceneDecals` had two call sites in the decal increment (inside `_loadKaeltekammerProps` and the async boot chain), causing duplicate decal trees — consolidated to the single boot-chain call.
- **Housekeeping & Docs:**
  - *Verified in browser*: all six decals confirm correct world axes (normals toward the room, stripe long axis on Z, `y = 0.006` above the floor), textures loaded (512 px), zero console errors.
  - *Test status*: 201 test files green; sole failure (`SDFShaderChunks` `isContextLost`) confirmed pre-existing WebGPU load flakiness — passes in isolation, unrelated to this change.

## [0.89.0] - 2026-09-29

### "We shape our tools and thereafter our tools shape us." - Marshall McLuhan

- **Features:**
  - *Asset-First-Refactor Koje 42 & Kältekammer*: Complete removal of the procedural greybox furniture fallback in [`prologue.ts`](apps/sample-apps/the-whisper/scenes/prologue/prologue.ts) (−197 lines net) — the Koje is now staged exclusively through the declarative [`koje42.level.json`](apps/sample-apps/the-whisper/scenes/prologue/koje42.level.json) with real Kit glTF props (desk, stool, lantern, grinder, shelf, towels, bunk bed, boots, rug, ceiling lamp, vent breach, mess tin). New [`kaeltekammer.level.json`](apps/sample-apps/the-whisper/scenes/prologue/kaeltekammer.level.json) wires the Kältekammer's wall-rubble pile and a cold bulkhead ceiling lamp as Kit props; morgue floor/back-wall now use the dedicated `concrete_damp_efflorescence` kit material.
  - *Declarative Level Loading Unblocked (bugfix with feature impact)*: `.level.json` descriptors are now loaded via Vite `new URL("./…", import.meta.url)`, fixing a silent runtime 404 that had left the Koje furniture missing in dev **and** build since the descriptor migration. The staged scene now actually renders all 17 Kit props.
  - *Failure Transparency*: Missing Kit props now log a tagged `console.error` (Fail Fast region/name) instead of silently falling back to greybox.
- **Architecture & Bugfixes:**
  - *Blast-Door Asset QS finding + adaptation*: Measured `flakturm/bunker_blast_door` renders as a ~0.92×1.0×0.94m block at recommendedScale (meta says 1.8×2.2×0.25m); the scene uses it as the Koje's static heavy armored door (front face flush to the inner wall, excess depth in the un-modeled corridor) and the cutscene's door beat is now told as hallway-beam choreography plus a subtle creak-nudge instead of an en-masse swing.
- **Housekeeping & Docs:**
  - *Bin-aware cleanup*: Removed the now-dead `createFluorescentLamp`/`createDebrisCluster` scene usages (builder methods remain, covered by their tests), terminal screen-flicker moved from a dead material reference to a real `ScreenGlow` point-light, and `applyKitTextures` no longer targets removed procedural meshes.
  - *Test Coverage*: 201 test files / 1194 tests green; `LevelValidation` now validates both `koje42` and `kaeltekammer` descriptors (JSON, schema strict, manifest/meta references).

## [0.88.0] - 2026-09-29

### "Give me six hours to chop down a tree and I will spend the first four sharpening the axe." - Abraham Lincoln

- **Features:**
  - *Unreal-Engine-5-Style Content Drawer & Asset Browser for Maker*: Dockable, resizable bottom drawer ([`ContentDrawer.ts`](packages/tools/src/maker/ContentDrawer.ts)) with Ctrl/Cmd+Space toggle, two-pane layout (folder tree + live asset grid), instant search, type filter pills (Props, PBR Materials, Decals, Primitives, Lights, Prefabs), native HTML5 drag & drop directly onto the 3D viewport with ground-plane/scene raycasting, double-click placement and Pin/Snap-Drop UX — wired into Maker via new `contentDrawer`/`kitRegistry` accessors and full placement/raycast callbacks in [`MakerApp.ts`](packages/tools/src/maker/MakerApp.ts).
  - *Kit Inspector Decal Preview Rework*: Decal quad now derives its aspect ratio dynamically from the decoded image to eliminate distortion, uses `flipY` sampling, a transparent double-sided `CullMode.NONE` material and a properly framed camera; filter pills respect the selected Kit and live search, with an explicit empty-state message.
- **Architecture & Bugfixes:**
  - *KitRegistry Manifest Hardening*: `manifest.items` is now accessed null-safely in both `getPropMeta`/`loadProp` paths ([`KitRegistry.ts`](packages/engine/src/loaders/kit/KitRegistry.ts)), preventing crashes on kits whose manifest lacks an items array.
- **Housekeeping & Docs:**
  - *PBR Pipeline Script Rework*: [`pbr.sh`](scripts/pbr.sh) grown into a full CLI — `--json`/`--config` input, profile-override flags and `--set KEY=VALUE`, explicit `--maps` selection, `--resize`, `--out-format`/`--quality`, `--force`/`--keep-temp`, and a `--help` usage page. `stone.conf` retuned (stronger AO detail, higher normal strength). Removed the obsolete `extract-webgpu-error.js` and `generate-petra-textures.js` scripts.
  - *Flakturm Texture Production*: New `travertine` PBR material set (albedo/ao/normal/roughness) via the reworked pipeline; `brick_aged` textures regenerated with improved AO.
  - *Test Coverage*: [`ContentDrawer.test.ts`](packages/tools/tests/maker/ContentDrawer.test.ts) covers drawer DOM/toggle/shortcut, double-click instantiation, drag & drop placement with raycast, texture drop-on-mesh, and prefab refresh.

## [0.87.0] - 2026-09-27

### "The universe is under no obligation to make sense to you." - Neil deGrasse Tyson

- **Features:**
  - *8 New Standard Geometry Primitives*: Added `OpenFrame`, `LShape`, `Rhombus`, `TriStar`, `CylindricalArch`, and `HollowTruncatedCone` as first-class standard engine primitives ([`packages/engine/src/geometry/`](packages/engine/src/geometry/)), plus enhanced analytical formula methods on `Cone` and `Capsule`. All shapes include fully outward-facing normals, UV maps, and correct winding order for both 2D planar and 3D volumetric representations.
  - *Showcase 6 — Full Geometry Catalogue (48 Entries)*: All 48 known geometries are now on display in [`apps/showcases/6/showcase.ts`](apps/showcases/6/showcase.ts). 3D bodies show as a triplet (Wireframe + Random PBR Solid + Fireplace-Brick PBR), 2D planar shapes as a pair (Wireframe + Solid), 1D primitives as a single Wireframe. Every booth has a white ground plaque with navy-blue text showing the English geometry name.
- **Architecture & Bugfixes:**
  - *Outward-Facing Normal Guarantee*: Introduced a dot-product self-verifying `addQuad` convention across all new geometry classes, ensuring 100% outward normals in the Small World Machine right-handed (+Y-up, -Z-forward) coordinate system.
  - *WebGL2 Shader-Churn Stutter Elimination (P1)*: Removed the per-object DEPTH-program acquire in the shadow pass ([`WebGL2Renderer.ts`](packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts)), which flip-flopped every caster's refcount key between shadow and material programs each frame and deleted+recompiled the *shared* programs (~12 links + 12 deletes/frame) — the root cause of the ~14.5 FPS WebGL2 stutter while WebGL1 stayed smooth. After fix: 0 links / 0 compiles / 0 deletes, ~120 FPS (≈8×). Verified pre-existing via A/B against base code.
  - *Native WebGL2 Vertex Array Objects (P2)*: Fixed attribute-location reservations (0-5, instancing 6-9/10) bound before linking in [`WebGLProgramCache.ts`](packages/engine/src/renderers/WebGL2/managers/WebGLProgramCache.ts) enable a cached per-mesh VAO ([`Mesh.bindVAO`](packages/engine/src/renderers/Mesh.ts)) restoring all vertex pointers via a single `bindVertexArray`; standard and depth passes use it (WebGL1 and instancing keep the manual `Mesh.bind` path). Reduces 6-8 driver calls per draw to 1 bind.
- **Housekeeping & Docs:**
  - *REFERENCES.md*: All 8 new geometry entries documented under `## Geometry & Mathematics` with full analytical formulas, derivations, and citations to `rechneronline.de`.
  - *Test Coverage*: [`NewRechneronlineGeometries.test.ts`](packages/engine/tests/geometry/NewRechneronlineGeometries.test.ts) and [`OutwardFacingNormals.test.ts`](packages/engine/tests/geometry/OutwardFacingNormals.test.ts) cover all mathematical properties, UV layout, and normal orientation. [`Showcase6Plaques.test.ts`](apps/showcases/tests/Showcase6Plaques.test.ts) enforces that every geometry has a plaque, wire/solid/brick instances, and zero bounding-box overlaps.
  - *Zero-Allocation Hardening (P2/P3)*: `Object3D.lookAt`/`getWorldPosition` default arguments now reuse shared module-level scratch constants; the residual per-call `new BoundingSphere` in `sphereCast` became a scratch field; [`Scene.add`/`remove`](packages/engine/src/core/Scene.ts) invalidate the cached render list against out-of-loop mutations.
  - *Thermo-Nuclear Review Chapters 1-4 Verified + WebGL2 Browser Smoke-Test*: All remaining findings from the review are closed ([`.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md`](.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md)); the WebGL2 VAO path was live-tested on showcases 13/16/2 (instancing+shadows, PBR-glTF, wireframe) at 120 FPS with 0 program relinks and 0 GL errors.

## [0.86.0] - 2026-09-27

### "Speed is useful only if you are running in the right direction." - Joel Barker

- **Performance & Zero-Allocation:**
  - *Physics Contact Solver Pool Leak Elimination (P0)*: Fixed vector pool memory leak in [`ContactSolver.ts`](packages/engine/src/physix/solvers/ContactSolver.ts) by releasing `contactPt`, `velA`, and `velB` back to `MathPool`, preventing runaway heap allocation and fallback `new Vector3D()` instantiations during iterative impulse solves.
  - *Texture Manager & Texture Resource Cache Zero-Allocation (P1)*: Replaced object-literal clones (`{ ...lastTextures }`) and `Object.keys()` iterations in [`GPUTextureResourceCache.ts`](packages/engine/src/renderers/WebGPU/managers/GPUTextureResourceCache.ts), [`WebGLTextureManager.ts`](packages/engine/src/renderers/WebGL2/managers/WebGLTextureManager.ts), and [`WebGL1Renderer.ts`](packages/engine/src/renderers/WebGL1/WebGL1Renderer.ts) with direct dictionary caching and `for...in` traversal, eliminating hundreds of garbage collections per frame across render passes.
  - *WebGPU Shadow Pass Bind Group Caching (P1)*: Added dirty check caching to `_shadowCasterBindGroup` in [`CascadedShadowPassGPU.ts`](packages/engine/src/renderers/passes/CascadedShadowPassGPU.ts) and [`SpotShadowPassGPU.ts`](packages/engine/src/renderers/passes/SpotShadowPassGPU.ts), avoiding redundant driver bind group creation every frame.
  - *Single-Pass Scene Traversals & Sorted Render List Caching (P1)*: Added camera-keyed frame cache in [`Scene.ts`](packages/engine/src/core/Scene.ts) (`getVisibleObjectsSorted()`) and [`FrustumCuller.ts`](packages/engine/src/core/FrustumCuller.ts) (`cull()`), cutting redundant quad-traversals and transparent sorting passes across depth pre-passes, shadow passes, and main passes down to a single pass per frame.
  - *Joint & SAT Inner Loop Allocation Freeing (P1)*: Eliminated per-iteration `axes` array/object allocations in [`BallSocketJoint.ts`](packages/engine/src/physix/joints/BallSocketJoint.ts) and [`HingeJoint.ts`](packages/engine/src/physix/joints/HingeJoint.ts) using static scratch axes; converted `{ overlap, x, y, z }` object literals in [`Collision.ts`](packages/engine/src/physix/Collision.ts) to static scratch results.
  - *Spatial Query Scratch Caching (P1)*: Replaced per-query `new BoundingBox()` instantiations and `RaycastHit` allocations in [`SpatialQueries.ts`](packages/engine/src/physix/solvers/SpatialQueries.ts) with static scratch boxes and hits.
  - *Cluster Grid Coverage Scratch Optimization (P2)*: Added optional `out` parameter to [`ClusterGrid.lightClusterCoverage()`](packages/engine/src/math/ClusterGrid.ts) and reused static scratch vectors in [`WebGLClusterCullPass.ts`](packages/engine/src/renderers/passes/WebGLClusterCullPass.ts).
  - *PBR Schlick Fresnel Math Optimization (P2)*: Optimized `F_Schlick` power computation in [`pbr_math.frag.glsl`](packages/engine/src/core/renderers/shaders/source/web_gl2/chunks/pbr_math.frag.glsl) and [`pbr_math.wgsl`](packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl) from expensive `pow(..., 5.0)` to 3 scalar multiplications (`x2 * x2 * x`).
- **Housekeeping & Docs:**
  - *Thermo-Nuclear Quality Review*: Completed Chapter 3 of the Thermo-Nuclear Code Quality Review, eliminating critical hot-path GC bottlenecks and driver allocations ([`.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md`](.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md)).

## [0.85.0] - 2026-09-27

### "Nothing can dim the light which shines from within." - Maya Angelou

- **Rendering & Shaders:**
  - *WebGL2 Directional Light Negation Fix*: Corrected double negation in WebGL2 [`light_calc.frag.glsl`](packages/engine/src/core/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl) and [`light_calc_pbr.frag.glsl`](packages/engine/src/core/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl) from `-u_dirLightDir` to `u_dirLightDir`, restoring consistent sun/light direction and correct lighting facing angles across WebGL1, WebGL2, and WebGPU.
  - *WebGPU HBAO Normal Reconstruction Accuracy*: Fixed [`AO.frag.wgsl`](packages/engine/src/core/materials/shaders/AO.frag.wgsl) to fetch real neighbor depths at `centerCoord + (1, 0)` and `centerCoord + (0, 1)` rather than passing center `linearZ` into `reconstructViewPos`, resolving the issue where reconstructed normals were statically forced to $(0, 0, -1)$.
  - *WebGPU Glass & Frostglass Spotlight Attenuation*: Corrected spotlight cone formula and epsilon calculation in [`Glass.frag.wgsl`](packages/engine/src/core/materials/shaders/Glass.frag.wgsl) and [`Frostglass.frag.wgsl`](packages/engine/src/core/materials/shaders/Frostglass.frag.wgsl) to eliminate inverted inner/outer spotlight beams and integrate distance falloff.
  - *WebGPU CSM Cascade Fallback*: Hardened cascade index selection in [`lighting.wgsl`](packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/lighting.wgsl) and [`lighting_pbr.wgsl`](packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl) to initialize `cascadeIndex = max(numCascades, 1u) - 1u`, ensuring far fragments beyond cascade splits seamlessly use the coarsest cascade instead of snapping to cascade 0.
  - *Non-PBR & Area Light Attenuation*: Wired `distance` and `decay` attenuation into Non-PBR spot lights and AreaLights across [`light_calc.frag.glsl`](packages/engine/src/core/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl), [`light_calc_pbr.frag.glsl`](packages/engine/src/core/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl), [`lighting.wgsl`](packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/lighting.wgsl), and [`lighting_pbr.wgsl`](packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl); updated `AreaLight` struct layouts in UBO/SSBO and GLSL headers.
  - *WGSL SDF Domain Repetition Modulo Parity*: Replaced symmetric `%` with floored modulo ($q - c \cdot \lfloor q / c \rfloor$) in [`sdf_math.wgsl`](packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/sdf_math.wgsl) to ensure correct negative domain repetitions matching GLSL.
  - *GLSL Material Fog & Cutout Parity*: Injected `[FOG_CALC]` chunk and alpha-cutout discard checks across `Phong.frag.glsl`, `Lambert.frag.glsl`, `Basic.frag.glsl`, and their `glsl100` variants.
- **Housekeeping & Docs:**
  - *Thermo-Nuclear Quality Review*: Completed Chapter 2 of the Thermo-Nuclear Code Quality Review, resolving all 7 shader, lighting, and shadow parity issues ([`.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md`](.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md)).

## [0.84.1] - 2026-09-27

### "Measure what is measurable, and make measurable what is not so." - Galileo Galilei

- **Architecture & Bugfixes:**
  - *Normal Matrix Transposition Fix*: [`Matrix3.getNormalMatrix()`](packages/engine/src/math/Matrix3.ts) corrected to compute the true transposed inverse $(M^{-1})^T = \frac{1}{\det M} \text{Cof}(M)$ in column-major order rather than inverting the cofactor transposition, preserving strict orthogonality for surface normals under non-uniform scaling; added `Matrix3.transformVector()` and dedicated test suite [`Matrix3.test.ts`](packages/engine/tests/math/Matrix3.test.ts).
  - *Gear Kinematics Counter-Rotation*: [`GearMath.getMeshingRotation()`](packages/engine/src/math/GearMath.ts) corrected to subtract `rollAngle` instead of adding it, ensuring meshing external gears counter-rotate in opposing directions per physical gearing laws; added [`GearMath.test.ts`](packages/engine/tests/math/GearMath.test.ts).
  - *LookAt Collinear Singularity Protection*: [`Matrix4.lookAt()`](packages/engine/src/math/Matrix4.ts) hardened against degenerating into zero matrices when eye-to-target and up vectors are collinear along the X axis, perturbing orthogonal components based on primary axis alignment.
  - *Spatial Query Surface Normal Accuracy*: [`SpatialQueries.sphereCast()`](packages/engine/src/physix/solvers/SpatialQueries.ts) now computes exact perpendicular surface normals for `BoundingBox` (AABB) and `OBB` colliders based on the closest hit face rather than pointing radially towards the bounding volume center.
  - *Quaternion Render-Interpolation & Tensor Angular Acceleration*: [`EulerIntegrator.interpolateTransform()`](packages/engine/src/physix/solvers/EulerIntegrator.ts) now synchronizes and interpolates `obj.quaternion` alongside Euler rotation; [`EulerIntegrator.integrateAngular()`](packages/engine/src/physix/solvers/EulerIntegrator.ts) now utilizes the 3D principal moments of inertia (`inverseInertiaTensor`).
  - *ConvexHull Normal Transformation*: [`ConvexHull.transform()`](packages/engine/src/physix/ConvexHull.ts) now transforms face normals using a cached normal matrix instead of the model matrix, keeping SAT separation axes orthogonal under non-uniform scale.
  - *Archimedean Buoyancy Hydrostatics*: [`BuoyancySolver.applyFluidForces()`](packages/engine/src/physix/fluids/BuoyancySolver.ts) rewritten to compute hydrostatic buoyant force from displaced volume ($F_A = \rho_{\text{fluid}} \cdot V_{\text{submerged}} \cdot g$) rather than scaling with the body's own mass; cached static result object to eliminate per-call heap allocations.
  - *OBB Local Geometry Offset Preservation*: [`OBB`](packages/engine/src/physix/OBB.ts) gained `_localCenter` tracking to preserve non-zero geometry offsets across `transform()` calls and `Object3D.computeBounds()`.
- **Housekeeping & Docs:**
  - *Thermo-Nuclear Quality Review*: Completed Chapter 1 of the Thermo-Nuclear Code Quality Review, resolving all 8 mathematical and physical formula errors ([`.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md`](.agents/notes/thermo-nuclear-code-quality-review-2026-09-27.md)).

## [0.84.0] - 2026-09-27

### "It's not what you don't know that gets you into trouble. It's what you know for sure that just ain't so." - Mark Twain

- **Features:**
  - *Real Post-Processing Camera Flash*: [`FlashEffect`](packages/engine/src/core/cameras/effects/FlashEffect.ts) now drives an actual full-screen flash overlay through a new `PostProcessingEffectType.FLASH` / [`FlashElement`](packages/engine/src/renderers/post/elements/FlashElement.ts), wired per-frame from the camera into the renderer ([`SmallWorldMachine.ts`](packages/engine/src/core/SmallWorldMachine.ts)) across WebGPU (`DynUniforms` extended to 11×vec4f) and both WebGL shader pipelines — previously it only produced a camera-position jolt, never an actual screen flash.
  - *`@small-world-machine/tools` Ecosystem Package (ADR 0024)*: Maker, MaterialStudio, Pixler, Xtractor, MapGenerator, and Forge moved out of the core engine into their own package (`packages/tools/`), reachable via `attachDevTools(app)` instead of the removed `EngineOptions.enableInspector` — a breaking change for any app that relied on that flag; 12 showcases and 1 sample app migrated to the new call.
- **Architecture & Bugfixes:**
  - *Camera Shake Rewrite*: [`ShakeEffect`](packages/engine/src/core/cameras/effects/ShakeEffect.ts) now shakes pitch/yaw rotation instead of position (rotating the view direction can never clip the camera through geometry, unlike a positional offset) and uses a single clamped trauma value (Eiserloh's model) via a new optional `CameraEffect.merge()` hook, instead of stacking unboundedly many independent shake instances on repeated triggers.
  - *Camera Cancel API*: [`Camera`](packages/engine/src/core/Camera.ts) gained `removeEffect()`/`clearEffects()`; `applyEffect()`/`addEffect()` now return the resulting effect.
- **Housekeeping & Docs:**
  - *`docs/guides/` Fully Translated to English*: All 25 guides converted from German to English and verified line-by-line against the current codebase, fixing real staleness found along the way (wrong class names, moved file paths, a non-existent `AppEvents` construct, an invented ASCII-legend, a duplicated section number, dead anchor links, and inconsistent `"small-world-machine"` import examples unified to the actually-working `@small-world-machine/engine` specifier).
  - *Research Archive Cleanup*: The `thermo-nuclear` code-quality review (`docs/research/codebase-review-2026-09-18-thermo-nuclear.md`) closed and removed — all findings resolved except a deliberately out-of-scope group of four >1000-line files, tracked in `.agents/notes/backlog.md` instead. `aaa-engine-techniques.md` and `showcase-feature-audit.md` rebuilt as maintainable wishlists of open items instead of point-in-time snapshots.

## [0.83.2] - 2026-09-27

### "Divide each difficulty into as many parts as is feasible." - René Descartes

- **Architecture & Bugfixes:**
  - *MakerApp & MaterialStudio Monolith Split (MAJ-10)*: [`MakerApp.ts`](packages/engine/src/tools/maker/MakerApp.ts) (2,147 → 1,698 lines) split into three focused domain services — [`MakerPrefabPipeline`](packages/engine/src/tools/maker/MakerPrefabPipeline.ts) (prefab save/instantiate + thumbnail capture), [`MakerImportAndZoneTools`](packages/engine/src/tools/maker/MakerImportAndZoneTools.ts) (ASCII/background-image import + click-to-draw stage-zone tooling), and [`MakerToolbarBuilder`](packages/engine/src/tools/maker/MakerToolbarBuilder.ts) (palette/gizmo/snap/camera-bookmark toolbar wiring). `MakerApp` retains only selection, the gizmo drag loop, pointer picking/marqueeing, and the undo-backed scene-edit operations that all three extracted services route back through via constructor-injected callbacks; it stays above 1k lines by design (that remaining core shares `_undo`/`_selection`/`_propertyPanel`/`_project` too tightly to split further without turning into callback-passing wrappers). [`MaterialStudio.ts`](packages/engine/src/tools/MaterialStudio.ts) (2,189 → 218 lines) split into [`materialStudioStyles`](packages/engine/src/tools/material-studio/materialStudioStyles.ts) (CSS), [`MaterialStudioUiBuilder`](packages/engine/src/tools/material-studio/MaterialStudioUiBuilder.ts) (DOM construction), and [`MaterialStudioController`](packages/engine/src/tools/material-studio/MaterialStudioController.ts) (PBR-map orchestration + UI event wiring, kept as one class since both share the same mutable state); `MaterialStudioApp` is untouched (external contract for `public/tools/pbr-gen.html` and `SmallWorldMachine.ts`).
- **Housekeeping & Docs:**
  - *Hot-Path TypeScript Performance Standard*: Added a new section to the `coding-guide` skill codifying zero-allocation rules for the render/update loop (scratch objects instead of `new`, classic `for` loops over iterator chains, typed arrays, stable object shapes, hoisted lookups), scoped explicitly to hot-path code rather than setup/editor code.

## [0.83.1] - 2026-09-26

### "A body at rest stays at rest, and a body in motion stays in motion, unless acted upon by an external force." - Isaac Newton

- **Architecture & Bugfixes:**
  - *Physics Joint Solver Overhaul*: [`HingeJoint`](packages/engine/src/physix/joints/HingeJoint.ts) rewritten with a correct axial inverse-inertia term and a continuously-tracked (never accumulated) relative hinge angle, fixing a motor-torque sign inversion and unreliable angle-limit enforcement. `Joint`/`BallSocketJoint`/`DistanceJoint`/`SpringJoint`/`HingeJoint` now skip solving entirely once every connected dynamic body is asleep ([`Joint.isFullyAsleep`](packages/engine/src/physix/joints/Joint.ts)), matching the collision solver's existing sleep behavior.
  - *Broadphase Reinsertion Fix*: [`PhysicsBroadphase`](packages/engine/src/physix/broadphase/PhysicsBroadphase.ts) gained a single `_placeCollider()` insertion path (deduplicating `update()` and CCD reinsertion) and a new `reinsertCollider()` used by `SweptSphereCCD`, so a body clamped mid-frame by continuous collision detection is immediately re-placed at its new octree location instead of being missed by the next query.
- **Housekeeping & Docs:**
  - *Agent Instructions Consolidated*: `AGENTS.md` moved to the repo root (was `.agents/AGENTS.md`); `CLAUDE.md`/`GEMINI.md` are now plain symlinks to it instead of duplicated pointer files. Added a "Further Documentation" map (`CONTEXT.md`, `docs/adr/`, `docs/guides/`, `docs/research/`, the living `.agents/notes/` files) and the complete skill list.
  - *Guides & Apps Indexes*: Added `docs/guides/index.md` and `docs/apps/index.md` — both folders already had VitePress sidebar entries but no landing page.
  - *Research Archive Cleanup*: `.agents/notes/session-state.md` folded into `.agents/notes/backlog.md`; `.agents/notes/thermo-nuclear-codebase-review.md` and `plan-0-from-phase-1.md` moved into `docs/research/`. Verified every `docs/research/` report against the live codebase and removed the ones fully resolved (`codebase-review-2026-08-22.md`, `diorama-environment-architecture.md`, `projekt-raum.md`, `xdp-game-networking.md`); annotated the ones kept but stale (`showcase-feature-audit.md`, `oil-puddle-shader-technique.md`).

## [0.83.0] - 2026-09-25

### "The sun never sees the shadow." - Leonardo da Vinci

- **Features:**
  - *Basis Universal / KTX2 GPU Texture Transcoding*: Integrated WASM-based Basis Universal transcoder ([`packages/gltf-extensions/src/basisu/`](packages/gltf-extensions/src/basisu/)) with automatic hardware format negotiation for BC7, ASTC, ETC2, and BC3.
  - *Showcase 36 Glass Broken Window*: Refined refractive transmission rendering with ACES filmic tone mapping, calibrated bloom thresholds, and moody skybox attenuation for high-contrast glass specular highlights ([`showcase.ts`](apps/showcases/36/showcase.ts)).
- **Architecture & Bugfixes:**
  - *Skybox Shader Parity*: Unified `u_color` tinting across GLSL300, GLSL100, and WGSL pipelines in [`SkyboxMaterial`](packages/engine/src/core/materials/SkyboxMaterial.ts).
  - *WebGPU Texture Resource Cache & Pipeline Hardening*: Added granular dirty checking, sampler cache reuse, and mip texture view preservation in GPU passes.
  - *Raycaster & BoundingBox Math*: Enhanced raycasting and oriented bounding box transform precision across physics routines.
- **Housekeeping & Docs:**
  - Extended test coverage for Basis transcoder, Maker tooling, and shader binding suites.

## [0.82.0] - 2026-09-18

### "The purpose of computing is insight, not numbers." - Richard Hamming

- **Features:**
  - *Declarative Level & Kit Pipeline*: Implemented [`KitRegistry`](packages/engine/src/loaders/kit/KitRegistry.ts) and JSON Schema draft 2020-12 validation ([`level.schema.json`](public/schemas/level.schema.json)) for declarative scene descriptors, socket light mounting, and procedural kit fallback (ADR 0020).
  - *The Whisper*: Koje-42 prologue scene migrated to declarative descriptor [`koje42.level.json`](apps/sample-apps/the-whisper/scenes/prologue/koje42.level.json).
- **Architecture & Bugfixes:**
  - Resolved 8 critical repository-wide P0 blocker findings from the Thermo-Nuclear Code Quality Review:
    - **[BLK-R1]**: Fixed WebGL2 clustered lighting cell buffer starvation and allocation desync in [`WebGLClusterCullPass`](packages/engine/src/renderers/passes/WebGLClusterCullPass.ts).
    - **[BLK-R2]**: Added bounds checks to WGSL and GLSL clustered lighting shaders (`lighting.wgsl`, `lighting_pbr.wgsl`, `light_calc.frag.glsl`, `light_calc_pbr.frag.glsl`) to prevent out-of-bounds spot shadow uniform reads.
    - **[BLK-R3]**: Eliminated 60-FPS WebGPU render pipeline re-compilation churn in [`BloomPassGPU`](packages/engine/src/renderers/post/passes/BloomPassGPU.ts) and [`PostProcessPass`](packages/engine/src/renderers/passes/PostProcessPass.ts) by caching mip texture views and decoupling bind groups.
    - **[BLK-R4]**: Fixed stale directional light reference leaks in [`AbstractRenderer.extractLights()`](packages/engine/src/renderers/AbstractRenderer.ts).
    - **[BLK-R5]**: Hardened [`RendererFactory`](packages/engine/src/renderers/RendererFactory.ts) candidate cascade (WebGPU $\to$ WebGL2 $\to$ WebGL1) against driver blocklists and context creation failures.
    - **[BLK-C1]**: Resolved 2D GPU texture and ref-count leaks on engine teardown in [`WebGLTextureManager.dispose()`](packages/engine/src/renderers/WebGL2/managers/WebGLTextureManager.ts).
    - **[BLK-C2]**: Fixed broadphase Octree bounding extents freezing bug on moving colliders in [`PhysicsBroadphase`](packages/engine/src/physix/broadphase/PhysicsBroadphase.ts).
    - **[BLK-C3]**: Fixed `TypeError` crash on 3-parameter calls without target in [`Matrix4.scale()`](packages/engine/src/math/Matrix4.ts) with strict overload signatures and fallback instantiation.
- **Housekeeping & Docs:**
  - Added **ADR 0020**: [Declarative Level Descriptors & Kit Runtime](docs/adr/0020-declarative-level-descriptors-and-kit-runtime.md).
  - Conducted repository-wide Thermo-Nuclear Code Quality Review ([`.agents/notes/thermo-nuclear-codebase-review.md`](.agents/notes/thermo-nuclear-codebase-review.md)).
  - Expanded unit test suite coverage across all fixed blocker paths to 865 passing tests across 150 test suites.

## [0.81.0] - 2026-09-18

### "A pile of rocks ceases to be a rock pile the moment a single man contemplates it, carrying within him the image of a cathedral." - Antoine de Saint-Exupéry

- **Features:**
  - *The Whisper*: 10 new game-ready Koje-42 props sourced via the 2D-concept-to-Tripo3D pipeline and wired into the prologue scene — `bunker/metal_stool`, `bunker/kerosene_lantern` (with a flickering `FlameGlow` point light socket), `bunker/combat_boots`, `bunker/metal_desk`, `bunker/wall_shelf_supplies`, `bunker/mess_tin_set`, `bunker/hanging_towels`, `bunker/worn_rug`, `flakturm/ceiling_lamp` (with a `BulbLight` point light socket), and `flakturm/vent_wall_breach` (the escape-shaft hotspot on the east wall).
  - New [`FlakturmKit`](apps/sample-apps/the-whisper/builder/FlakturmKit.ts) procedural builders — `createPillar`, `createBeam`, `createSegmentedWall` — implementing ADR 0019's modular scale doctrine (3m/5m structural rhythm, damp baseboard zoning, separating pilasters) for breaking up long wall spans without visible texture tiling.
  - Two new Flakturm PBR texture sets: `concrete_damp_efflorescence` (moisture/salt-bloom baseboard) and `concrete_panel_smooth`.
  - New **ADR 0019**: [Modular Environment Texturing & 4-Pillar Scale Doctrine](docs/adr/0019-modular-environment-texturing-and-scale-doctrine.md) — multizonal PBR palettes, the bunker modular grid, a dual macro/micro decal hierarchy, and deterministic UV-jitter against tiling artifacts.
- **Architecture & Bugfixes:**
  - Added a `NormalMapFormat` enum (`packages/engine/src/enums/NormalMapFormat.ts`), replacing untyped `"opengl"`/`"directx"` string literals in [`MaterialStudio`](packages/engine/src/tools/MaterialStudio.ts) and [`TextureFilters`](packages/engine/src/tools/common/dsp/TextureFilters.ts).
  - Fixed a real bug caught by pre-commit type-checking: the worn-rug prop's reload-guard referenced a nonexistent `_rugMesh` field instead of the declared `_wornRugMesh`, which would have thrown at runtime on every hot-reload of the prop. Also removed a dead `_ceilingBulbLight` field that was written but never read.
- **Housekeeping & Docs:**
  - Documented the ADR 0019 doctrine in [`asset-sourcing-guideline.md`](.agents/notes/asset-sourcing-guideline.md) and indexed the ADR in `docs/adr/index.md`.
  - Added [`.agents/notes/plan-0-from-phase-1.md`](.agents/notes/plan-0-from-phase-1.md), the approved masterplan for migrating *The Whisper*'s imperative prologue scene to a declarative `KitRegistry` + level-descriptor pipeline.

## [0.80.0] - 2026-09-17

### "If you cannot measure it, you cannot improve it." - William Thomson, Lord Kelvin

- **Features:**
  - *And Now? / "The Whisper — A Viennese Requiem"*: new interactive hotspot proximity system ([`HotspotManager`](apps/sample-apps/and-now/ui/HotspotManager.ts)) and the Amts-Terminal 2100 modal UI ([`TerminalModal`](apps/sample-apps/and-now/ui/TerminalModal.ts)), wired into the prologue's free-exploration mode.
  - New procedural [`BunkerKit`](apps/sample-apps/and-now/builder/BunkerKit.ts) builder: a corrected morgue cold-storage tray (handle + ID plate on the head end only, matching a real mortuary drawer — the Tripo3D-sourced model had them on all four sides) and real 3D rivet/bolt geometry for the Terminal 2100 casing, measured from the actual mesh and projected onto its true rounded surface (the documented `meta.json` dimensions didn't match the real geometry).
  - [`FlakturmKit`](apps/sample-apps/and-now/builder/FlakturmKit.ts)'s procedural fixtures (caged fluorescent ceiling lamps, wall conduit runs, rubble debris clusters) placed into the prologue scene for the first time, replacing bare point lights.
  - The full Flakturm PBR texture set (`concrete_board`, `concrete_weathered`, `brick_aged`, `steel_corroded`, `steel_painted`) applied to the Koje-42/Kältekammer architecture for the first time — walls, ceiling, blast door, bed frame, morgue rack.
  - Regenerated all Flakturm decal textures (warning signage, glow guide stripe) with real anti-aliased typography and weathering instead of low-resolution pixel-font placeholders.
  - Story renamed to *"The Whisper — A Viennese Requiem"*, plus the new *Lebensader* (1. Wiener Hochquellenwasserleitung) worldbuilding pillar tying into the Haus des Meeres location.
- **Architecture & Bugfixes:**
  - Unified the `kit.json`/`meta.json` asset-kit schema across `bunker`, `flakturm`, and `industrial` (ADR 0011) — `bunker`/`flakturm` had silently drifted onto an unvalidated shape (`props`/`model`, no `meta` link, no top-level `id`) that [`AssetKitValidation.test.ts`](packages/engine/tests/loaders/AssetKitValidation.test.ts) never checked, since it only ever validated `industrial`. The test now discovers and validates every kit under `public/assets/kits/`.
  - Added formal JSON Schema (draft 2020-12) for both files — [`public/schemas/kit.schema.json`](public/schemas/kit.schema.json), [`public/schemas/prop-meta.schema.json`](public/schemas/prop-meta.schema.json) — with Ajv-based validation in the test and a `"$schema"` pointer in every real `kit.json`/`meta.json` for editor-time validation.
  - Fixed a race condition where prop-kit PBR texture application could run against a procedural placeholder mesh (e.g. the bunk bed) that the async glTF swap had already removed from the scene.
- **Housekeeping & Docs:**
  - ADR 0011 updated with the ratified, verbatim `kit.json`/`meta.json` schema and the naming decision between `kit.json`, `manifest.json`, `package.json`, and `sw.json`.
  - Fixed `scripts/pbr.sh`'s Normal/Roughness/AO generation, which previously produced degenerate near-black/collapsed output regardless of ImageMagick version — rewritten to match the engine's own [`TextureFilters.ts`](packages/engine/src/tools/common/dsp/TextureFilters.ts) semantics and re-verified producing correct, non-degenerate maps.

## [0.79.16] - 2026-09-14

### "Simplicity is about subtracting the obvious and adding the meaningful." - John Maeda

- **Architecture & Performance:**
  - Marked `touchstart` and `wheel` event listeners on [`ForgeWindow`](packages/engine/src/tools/forge/ForgeWindow.ts) with `{ passive: true }`, eliminating browser scroll-blocking violation warnings (`[Violation] Added non-passive event listener to a scroll-blocking event`) when opening tools and inspector windows in showcases.
  - Added unit test in [`packages/engine/tests/tools/ForgeWindow.test.ts`](packages/engine/tests/tools/ForgeWindow.test.ts) asserting that touch and wheel listeners are registered passively.

## [0.79.15] - 2026-09-14

### "Order is not pressure which is imposed on reality from without, but the true shape of things from within." - José Ortega y Gasset

- **Architecture & Bugfixes:**
  - Resolved WebGPU `Destroyed texture used in a submit` validation errors occurring during resize and offscreen rendering passes in scenes with transparent / reflective materials (such as *Character Diorama Studio*).
  - Added `activeColorTexture` and `activeDepthTexture` getters to [`WebGPURenderer`](packages/engine/src/renderers/WebGPU/WebGPURenderer.ts) so that offscreen passes (such as planar reflection cameras or probe captures) correctly isolate and capture their own `RenderTarget` textures instead of accessing the canvas swapchain texture.
  - Refactored [`MainRenderPass`](packages/engine/src/renderers/passes/MainRenderPass.ts) to utilize `renderer.activeColorTexture` during opaque texture capture.
  - Guarded swapchain texture acquisition (`getCurrentTexture().createView()`) in [`WebGPURenderer.render()`](packages/engine/src/renderers/WebGPU/WebGPURenderer.ts) to execute lazily only when drawing directly to the canvas framebuffer.
  - Expanded unit test coverage in [`packages/engine/tests/renderers/WebGPUOffscreenTargetFormat.test.ts`](packages/engine/tests/renderers/WebGPUOffscreenTargetFormat.test.ts) and [`packages/engine/tests/renderers/MainRenderPass.test.ts`](packages/engine/tests/renderers/MainRenderPass.test.ts).
  - Added entry 123 to *And Now?* dev log ([`apps/sample-apps/and-now/docs/log.md`](apps/sample-apps/and-now/docs/log.md)).

## [0.79.14] - 2026-09-14

### "It is not the answer that enlightens, but the question." - Eugène Ionesco

- **Architecture & Bugfixes:**
  - Added texture format matching validation to [`captureOpaqueTexture`](packages/engine/src/renderers/WebGPU/WebGPURenderer.ts) and [`captureOpaqueDepth`](packages/engine/src/renderers/WebGPU/WebGPURenderer.ts) in `WebGPURenderer`. Fixed an issue where switching between HDR float buffers (`rgba16float`) and SDR canvas targets (`bgra8unorm`) retained an old cached texture with a mismatched format, causing WebGPU `copyTextureToTexture` validation failures and invalid command buffer aborts.
  - Added unit test coverage in [`packages/engine/tests/renderers/WebGPUOffscreenTargetFormat.test.ts`](packages/engine/tests/renderers/WebGPUOffscreenTargetFormat.test.ts) covering dynamic format transitions in opaque captures.

## [0.79.13] - 2026-09-14

### "The creation of a thousand forests is in one acorn." - Ralph Waldo Emerson

- **Architecture & Bugfixes:**
  - Fixed Vite `copy-assets` plugin in [`vite.config.ts`](vite.config.ts) to prevent `copyRecursiveSync` from overwriting Vite-bundled `index.html` entry points in `apps/sample-apps/` with raw unbundled source HTML files containing TypeScript `<script>` tags, resolving 404 errors for `showcase.ts` on GitHub Pages and production static servers.

## [0.79.12] - 2026-09-14

### "A bridge is a promise between two shores." - Mehmet Murat Ildan

- **Housekeeping & Docs:**
  - Prefixed direct showcase, tool, and concept-dossier links with `/small-world-machine/showcases/...` across documentation files ([`docs/apps/and-now.md`](docs/apps/and-now.md), [`docs/apps/maker.md`](docs/apps/maker.md), [`docs/apps/yad.md`](docs/apps/yad.md), [`docs/apps/light-cycle-arena.md`](docs/apps/light-cycle-arena.md)), ensuring correct path resolution on GitHub Pages when opening links in new browser tabs.
  - Added entry 122 to *And Now?* dev log ([`apps/sample-apps/and-now/docs/log.md`](apps/sample-apps/and-now/docs/log.md)).

## [0.79.11] - 2026-09-14

### "An obstacle is often a stepping stone." - William Prescott

- **Architecture & Bugfixes:**
  - Added support for `blob:` and `data:` schemes in [`AssetManager.resolveUrl`](packages/engine/src/loaders/AssetManager.ts) and [`resolveAssetUrl`](apps/sample-apps/and-now/ui/ViennaMapModal.ts), preventing embedded glTF buffer textures (such as in Showcase 13 *DamagedHelmet*) from being erroneously prefixed with base URLs.

## [0.79.10] - 2026-09-14

### "Patience is the companion of wisdom." - Saint Augustine

- **Architecture & Bugfixes:**
  - Fixed npm workspace dependency format in [`packages/gltf-extensions/package.json`](packages/gltf-extensions/package.json) from `workspace:*` to `*` to resolve `EUNSUPPORTEDPROTOCOL` error during `npm ci` in GitHub Actions.

## [0.79.09] - 2026-09-14

### "Truth is much too complicated to allow anything but approximations." - John von Neumann

- **Architecture & Bugfixes:**
  - Enabled `lfs: true` in GitHub Actions workflows (`.github/workflows/deploy-docs.yml` and `.github/workflows/ci.yml`), resolving an issue where Git LFS binary assets (.glb 3D models, .webp textures, HDR skyboxes, audio) were checked out as raw 130-byte LFS text pointer files, causing `InvalidStateError` and `Not a valid .glb file` decoding errors on GitHub Pages.

## [0.79.08] - 2026-09-14

### "There are no shortcuts to any place worth going." - Beverly Sills

- **Architecture & Bugfixes:**
  - Added centralized base-URL resolution to [`AssetManager`](packages/engine/src/loaders/AssetManager.ts) via `resolveUrl(url: string): string`, automatically prepending the Vite base path (`import.meta.env.BASE_URL`) or custom `_baseUrl` to root-relative asset requests (`/assets/...`) across all loaders (`Texture.fromUrl`, `GltfLoader`, `ObjLoader`, `TextLoader`, `streamBinary`).
  - Resolved GitHub Pages subpath deployment (`/small-world-machine/showcases/`) HTTP 404 errors for textures and 3D models across all showcases, tools, and sample apps while preserving explicit relative paths (`./`, `../`) and absolute URLs.
  - Added `resolveAssetUrl` helper in [`ViennaMapModal.ts`](apps/sample-apps/and-now/ui/ViennaMapModal.ts) for dynamically constructed DOM `<img>` elements.
- **Housekeeping & Docs:**
  - Added comprehensive unit test suite [`AssetManagerResolveUrl.test.ts`](packages/engine/tests/loaders/AssetManagerResolveUrl.test.ts) covering absolute, relative, and base-path URL transformations.
  - Documented deployment fix in *And Now?* dev log entry 121 (`apps/sample-apps/and-now/docs/log.md`).

## [0.79.07] - 2026-09-14

### "The doors of wisdom are never shut." - Benjamin Franklin

- **Features:**
  - Upgraded central launcher into an All-in-One Small World Machine Portal (`public/index.html`) featuring real-time search, category filtering, spotlight game cards, and direct links to tools, show-scenes, and concept dossiers.
  - Added dedicated "Spiele & Welten" navigation to VitePress documentation portal with complete narrative profiles for *And Now? (Wien 2100)*, *YAD*, *Light Cycle Arena*, and *Maker*.
  - Configured full asset and documentation pipeline in `vite.config.ts` to package and serve all concept dossiers, maps, and markdown docs across production bundles and GitHub Pages.
- **Architecture & Bugfixes:**
  - Integrated ADR 0018 (*glTF Data-Level Extensions*) into the official architecture registry and VitePress navigation.
- **Housekeeping & Docs:**
  - Automated deployment workflow (`deploy-docs.yml`) configured to deploy the unified portal, guides, and 3D showcases to GitHub Pages.

## [0.79.06] - 2026-09-14

### "Color is the keyboard, the eyes are the hammers, the soul is the piano with many strings." - Wassily Kandinsky

- **Features:**
  - Added diegetic Vienna Map Modal (`ViennaMapModal.ts`) and interactive exploration map for *And Now? (Wien 2100)* with district transit, archetype previews, and František's field notes.
  - Graphic Noir shader post-processing pipeline (`filter_noir.glsl`, `filter_noir.wgsl`) supporting selective colorkey isolation for cinematic high-contrast moments.
  - Complete faction archetype roster and visual character concept library for the 6 factions of post-apocalyptic Vienna 2100.
- **Architecture & Bugfixes:**
  - Formalized the 2-Tier Visual Architecture for *And Now?*: rich, desaturated atmospheric Graphic-Noir baseline world with targeted, high-contrast Sin-City Chiaroscuro colorkey punctuation for key narrative beats.
- **Housekeeping & Docs:**
  - Synchronized game narrative doctrine in `story.md`, updated `concept-dossier.html` visual architecture banner, and added comprehensive dev log entry 120.
  - New test suite for Vienna map exploration (`ViennaMap.test.ts`).

## [0.79.05] - 2026-09-13

### "A rose-red city half as old as time." - John William Burgon

- **Features:**
  - Added Showcase 38 ("Al-Khazneh — The Treasury of Petra"): a museum-grade 40m rock-hewn facade reconstruction, towering Siq canyon approach gorge, and walkable 3-chamber rock-cut inner sanctum.
  - Authentic classical architectural masonry detailing: stepped monumental portal surround with multi-fascia jambs and over-door console cornice, equestrian Dioscuri bas-relief panels, 6 Corinthian portico columns with engaged back-wall pilasters, 3-tier architrave, floral frieze, dentil & modillion cornice, pediment tympanum medallion with apex floral acroterion, upper broken-pediment wings with sculptured Amazon niches, circular Tholos pavilion with Tyche/Isis-Fortuna statue, and colossal funerary urn crowning the dome.
  - Seamless, high-resolution PBR sandstone textures derived from natural rock photography with flat-field illumination normalization.
  - Web Audio canyon wind ambiance and 11 dynamic, de-correlated organic flame torches and central atrium fire brazier.
- **Architecture & Bugfixes:**
  - Fixed `FlickerBehavior` de-correlation: instances previously sampled identical noise coordinates at $y=0$ starting from $t=0$, causing all lights across a scene to pulse synchronously. Added per-instance `noiseOffset`, `frequency`, and staggered phase timers.
  - Enhanced glTF extension pipeline with `KHR_materials_variants` support and ADR 0018 ecosystem decoupling.
- **Housekeeping & Docs:**
  - New unit tests for `FlickerBehavior` de-correlation (`FlickerBehavior.test.ts`), `GltfVariants.test.ts`, and updated showcase registry.

## [0.79.04] - 2026-09-13

### "The first principle is that you must not fool yourself -- and you are the easiest person to fool." - Richard Feynman

- **Architecture & Bugfixes:**
  - Fixed Showcase 15's three "absolute mirror" spheres showing no reflection at all under WebGL1, WebGL2, and WebGPU alike -- two separate, unrelated regressions that happened to land at the same time.
  - `WebGL1Renderer` had no concept of a `RenderTargetCube` (the GPU render target every `DynamicReflectionProbe` renders into): `setRenderTarget`/`bindMainRenderTarget` only understood flat 2D `RenderTarget`s, so each mirror sphere's env map was silently allocated as a broken, permanently-black `TEXTURE_2D`. Added a real cube-map FBO path mirroring WebGL2's existing implementation.
  - WebGL2 and WebGPU: enabling scene-level IBL (`Scene.irradianceMap`/`prefilterMap`) made every material's ambient-lighting code unconditionally reflect the scene's static, blurry baked environment for its specular term -- silently hiding any object's own sharper real-time reflection probe (`envMap`) behind it. Fixed by checking the per-object `envMap` first, in both the GLSL2 and WGSL ambient chunks.
- **Housekeeping & Docs:**
  - New regression tests (`WebGL1RenderTargetCube.test.ts`, `ReflectionProbeIblPriority.test.ts`) covering both fixes, each verified to fail against the pre-fix code.

## [0.79.03] - 2026-09-13

### "You never really understand a person until you consider things from his point of view... until you climb into his skin and walk around in it." - Harper Lee

- **Features:**
  - Showcase 30's puddles now show a real planar reflection (`PlanarReflectionNode`) of the car, neon signs, and rain rig, instead of only the static skybox envMap.
  - Replaced the hand-built box-primitive "hover car" with a real low-poly vehicle mesh (Kenney "Car Kit", CC0), re-skinned with the showcase's own neon materials, plus a proper front/rear headlight-taillight split and a visible (not just implied) underglow strip.
- **Architecture & Bugfixes:**
  - Replaced two assets that had been silently reused from unrelated showcases and didn't fit the scene at all: the street's "asphalt" material was actually a brass/gear "steampunk" PBR set, and the skybox was a bright space-nebula texture that blew out through the building gap. Both replaced with new AI-generated textures (a proper wet-asphalt PBR set, and a dark cyberpunk night-sky cubemap).
  - Reframed the default camera to a genuine low, near-puddle-level "wet street photography" angle: the puddle's reflection strength is Fresnel-driven exactly like real water, so it reads strongly at a grazing angle and close to the surface, and reads as nearly nothing from a taller, more overhead framing -- confirmed by comparing camera height/elevation directly against what the reflection actually showed at each.
  - Removed the puddle "ripple ring" decorations (flat torus rings), which read as illegible thin arcs from any oblique camera angle instead of the circular ripples they were meant to suggest.
- **Housekeeping & Docs:**
  - New `REFERENCES.md` entries crediting the Kenney car model and documenting the AI-generated textures and why they replaced the originals.

## [0.79.02] - 2026-09-13

### "The nice thing about standards is that there are so many to choose from." - Andrew S. Tanenbaum

- **Architecture & Bugfixes:**
  - Fixed a WebGPU pipeline/render-target format bug that silently broke rendering into any custom `RenderTarget` (e.g. `PlanarReflectionNode`) whenever post-processing was enabled: `_renderSubgroup`'s pipeline format only checked `postProcessing.enabled`, ignoring whether an offscreen target was actually active, so WebGPU rejected the resulting command buffer as an attachment-state mismatch (dropped silently, no visible error to the showcase). Replaced with a single `currentColorTargetFormat` getter that both `_renderSubgroup` and the shadow passes now share.
  - Fixed a related bug this exposed in `CascadedShadowPassGPU`/`SpotShadowPassGPU`: their dummy color attachment was created once and cached forever at whichever format was current on first use, which broke as soon as the same pass ran in both the main scene pass and an offscreen sub-render within one frame. Now cached per format.
  - Fixed a custom `RenderTarget`'s depth texture missing `GPUTextureUsage.COPY_SRC` (present on the main canvas depth texture, but not on a `RenderTarget`'s own), which broke `captureOpaqueDepth()` for any transparent object rendered into one.
  - Showcase 16 ("Reflection Moons") now renders its floor reflections correctly under the default (WebGPU) renderer -- previously broken by the same bug, silently falling back to a flat, unreflective floor.
- **Housekeeping & Docs:**
  - New regression tests (`WebGPUOffscreenTargetFormat.test.ts`) covering all three fixes, each verified to fail against the pre-fix code.

## [0.79.01] - 2026-09-12

### "A place for everything, and everything in its place." - Benjamin Franklin

- **Architecture & Bugfixes:**
  - `and-now`, `yad`, and `light-cycle-arena` folded from three separate workspace packages into one `@small-world-machine/sample-apps` package (`apps/sample-apps/<app>/`); all 34 numbered showcases folded into a new `@small-world-machine/showcases` package (`apps/showcases/<n>/`).
  - Fixed `AbstractShowcase`'s PREV/NEXT navigation, which silently assumed a contiguous `1..35` range: it now walks an explicit list of the showcase IDs that actually exist, correctly skipping the intentional gap at 25 (absorbed into Showcase 10 earlier) instead of navigating to a dead URL -- and Showcase 36 (previously unreachable, since the old bound was one short) is reachable again too.
  - Fixed the `showcase-layout` Vite plugin's header/subtitle injection, which silently failed for any showcase using multi-line HTML attribute formatting (Showcases 29-31 rendered with no header at all).
  - Fixed vitest's `apps/*/tests/**/*.test.ts` include glob, which stopped matching anything once app tests moved one directory level deeper into `apps/sample-apps/<app>/tests/` -- silently dropped 2 test files (10 tests) from every run with no error.
  - Housekeeping: swept up several path references left stale from the previous npm-workspaces migration and this move (a dead `showcases/yad` link in `MapGenerator`, a scan root in `MaterialUsage.test.ts`, comment references across `Optics`/`Ray2D`/three renderer files, `REFERENCES.md`).

## [0.79.00] - 2026-09-12

### "The nice thing about standards is that there are so many to choose from." - Andrew S. Tanenbaum

- **Features:**
  - Maker can now author 2.5D stage zones directly in the editor: click-to-draw zone placement (`Z` to toggle), draggable point handles on existing zones, a PropertyPanel point-list editor (add/remove/edit U/V/Scale per point, each change its own undo step), and aspect-ratio-safe background image import via drag & drop, so a whole stage scene can be built from a reference picture without touching code.
- **Architecture & Bugfixes:**
  - `StageZone` generalized from a rigid 4-point quad to an arbitrary n-point polygon (fan triangulation for `getScaleAt`, byte-identical to the old two-triangle math for existing 4-point zones); new `StageZoneMarker` (`Object3D`) gives zones a real scene-graph presence for the first time.
  - `StageMovementBehavior`'s ad-hoc `uvToWorld` closure replaced by a serializable `StageProjection` (`"flat-plane"` | `"custom"`); `flakturm-tunnel` now runs on `"flat-plane"`, `character-diorama` stays `"custom"` (its floor mapping doesn't fit the flat-plane shape).
  - New generic glTF extension plugin registry (`GltfExtensionPlugin`, `registerGltfExtension`) replaces the two hardcoded `KHR_lights_punctual`/`SW_prefab_instance` if/else branches in `GltfLoader`/`WorldWriter`; `SW_stage_zone` is the third, clean registry entry, making stage zones round-trip through glTF saves and loads. Documented in new ADR 0017.
  - Fixed a real, pre-existing `BasicMaterial` bug found while wiring up the zone gizmos: `transparent = true` silently had no effect because `getRenderManifest()` never synced `state.blending` from it, unlike `StandardMaterial`/`PhongMaterial`.
- **Housekeeping & Docs:**
  - New unit tests for the n-point `StageZone` math, `StageZoneMarker`, and `SW_stage_zone` glTF round-tripping (4- and 6-point fixtures).

## [0.78.00] - 2026-09-12

### "Good fences make good neighbors." - Robert Frost

- **Features:**
  - Landing page (`public/index.html`) reorganized into four clearly separated sections --
    Intro, Interactive Showcases, Development Tools, Apps -- instead of mixing showcases and
    apps into one grid. The stale "System Initialization // Engine Diagnostics" subtitle
    (left over from a much earlier iteration of the page) replaced with "Showcase &
    Development Hub".
- **Architecture & Bugfixes:**
  - Repository restructured into an npm-workspaces monorepo: `src/` became `packages/engine/`
    (its own `@small-world-machine/engine` package, `exports` mapping both the root barrel and every
    subpath), and the three apps (`and-now`, `yad`, `light-cycle-arena`) moved from
    `src/apps/<app>/` to top-level `apps/<app>/`, each its own package depending on
    `@small-world-machine/engine`. `yad` and `light-cycle-arena`'s HTML entry points and assets moved
    from `showcases/yad`/`showcases/light-cycle-arena` into their own app folders, matching
    `and-now`'s existing layout.
  - New ESLint rule enforces the boundary the engine/apps split exists for: nothing under
    `packages/engine/` may import from `apps/`. Verified with a real violation before landing.
    (A working TypeScript resolver would have been the more "correct" way to enforce this via
    `import/no-restricted-paths`, but it turned the existing `import/extensions` rule far
    stricter and produced 2000+ new errors repo-wide -- reverted in favor of a resolver-free
    `no-restricted-imports` pattern match instead.)
  - `docs:dev` (VitePress) now runs on a fixed port (5174) instead of colliding with the main
    engine dev server's port 5173, which it was silently taking over.
- **Housekeeping & Docs:**
  - `docs/` swept for stale path references left over from the restructuring: active guides and
    ADRs (0007, 0009, 0010, 0014, 0015) updated to the new paths; dated audit snapshots (e.g.
    `codebase-review-2026-08-22.md`) intentionally left with their original, now-historical
    paths plus a short caveat note, not rewritten. The committed TypeDoc API reference
    (`docs/public/api/`) regenerated rather than hand-edited.
  - Removed every hardcoded absolute local file path (`file:///Users/...`) found across
    `CHANGELOG.md`, `apps/and-now/docs/log.md`, and a skill doc -- these leak a specific
    machine's directory layout and must never be written into a repository file.

## [0.77.29] - 2026-09-12

### "Not everything that is faced can be changed, but nothing can be changed until it is faced." - James Baldwin

- **Architecture & Bugfixes:**
  - All 16 Architecture Decision Records audited against the actual current codebase, not just
    re-read: ADR 0008 cited a `FrustumCuller` field (`lastVisibleObjects`) that no longer exists
    and overstated `enableInspector`'s default; ADR 0009 described a lantern-attachment mechanism
    (direct scene-graph child of the hand bone) that this session's own earlier work had already
    replaced with world-space tracking; ADR 0011 documented two delivery phases (out-of-tree asset
    repo, catalog CLI) that were never actually implemented. Each corrected with an "Update"/
    "Status" note rather than silently rewriting the historical decision.
  - ADR 0014 (Modular Ecosystem & Domain Layering): `BillboardInstancer` and the
    `RatGroomingBehavior`/`GroomingRat` creature behaviors were still living at their pre-ADR
    locations (`src/core/BillboardInstancer.ts`, `src/core/behaviors/creatures/`) instead of the
    domain paths the ADR itself specifies. Actually moved to match
    (`src/core/objects/BillboardInstancer.ts`, a new top-level `src/behaviors/creatures/`), every
    import updated (barrels, direct imports, 2 relocated test files), full test suite (744 tests)
    and `tsc --noEmit` verified green afterward.
- **Housekeeping & Docs:**
  - Git LFS set up for the engine's binary asset types (`*.glb`, `*.gltf`, `*.fbx`, `*.jpg`,
    `*.jpeg`, `*.png`, `*.webp`, `*.wav`, `*.mp3`, `*.zip`, `*.hdr`, `*.exr`) per ADR 0011 --
    stops the repository's binary footprint from growing further (existing history untouched,
    a separate, more invasive decision). Husky hooks added (`pre-push`, `post-checkout`,
    `post-commit`, `post-merge`) so LFS stays correctly wired through the project's existing hook
    manager instead of a raw `.git/hooks` file.
  - "And Now?"'s own `docs/log.md` brought up to date with four missing entries (104-107)
    covering the Flakturm-Tunnel review, the 2.5D-scenes guide's origin, the Zone C vanishing-line
    fix, and the Diorama movement/HUD work -- all of which had happened without a log entry.

## [0.77.28] - 2026-09-12

### "The limits of my language mean the limits of my world." - Ludwig Wittgenstein

- **Features:**
  - "And Now?" Character Diorama: the character can now actually walk across the stage
    (`StageMovementBehavior`/`StageZone`, real 3D depth via the free-orbiting camera, `scale: 1.0`
    throughout since no forced perspective is needed here) instead of only rotating in place;
    existing `[Left]`/`[Right]` rotation moved behind `[Shift]` so the two controls never fight
    over `rotation.y`, and stage position now survives a character switch (`[C]`).
  - "And Now?" Flakturm-Tunnel: the character's status HUD now shows live `(u, v)` stage position
    and current forced-perspective scale -- the same values that previously had to be read out of
    the browser console during zone verification.
- **Architecture & Bugfixes:**
  - "And Now?" Flakturm-Tunnel: the status HUD followed the character across the stage
    (world-to-screen projection of head position), obscuring it especially high up the stairs,
    where it is already small on screen. Now fixed to the top of the screen regardless of stage
    position.
  - Flakturm-Tunnel Zone C (the staircase)'s far-left corner was traced past the actual painted
    stair edge into the shadow beside it -- measured directly against the background art and
    corrected (`u: 0.278` to `u: 0.305`).
  - Two Architecture Decision Records referenced app code that had since been fully deleted
    (`neon-labyrinth`, `disc-wars`) or contained a leaked internal-memory-file reference with no
    meaning in public docs (`[[...]]` syntax); both classes of staleness found and fixed across
    the affected ADRs and research docs.
- **Housekeeping & Docs:**
  - New ADR 0016: 2.5D stage zones as a glTF extension (`SW_stage_zone`) instead of a second save
    format, extending the existing Maker/glTF pipeline -- includes generalizing `StageZone` from a
    fixed 4-point quad to an arbitrary walkable polygon.
  - New guide: `docs/guides/2-5d-scenes.md` -- perspective/vanishing-point matching, movement-zone
    authoring, camera-strategy trade-offs, and the real bugs found building "And Now?"'s 2.5D
    scenes.
  - All of `docs/` (guides, ADRs, research) translated to German, including the site navigation.

## [0.77.27] - 2026-09-11

### "Light thinks it travels faster than anything but it is wrong. No matter how fast light travels, it finds the darkness has always got there first." - Terry Pratchett

- **Architecture & Bugfixes:**
  - "And Now?" Flakturm-Tunnel: the playable character was rendered with `BasicMaterial` -- a
    fully unlit material (`fragColor = u_color * texColor`, no lighting term at all in the
    shader) -- so the scene's ambient light, directional light, and even the character's own
    hand-held lantern had zero effect on it no matter how their intensities were tuned; it only
    ever showed its raw diffuse texture color. Switched to `StandardMaterial` (matching
    character-diorama's already-lit approach for the same shared model), tuned matte
    (`roughness: 0.92`, `metallic: 0.02`) to avoid unwanted shine. The painted background plane
    stays unlit on purpose -- it's 2D art, not a 3D-lit surface -- only the character needed this.
- **Housekeeping & Docs:**
  - `.agents/notes/backlog.md`: noted that the movement-speed fix does not (and structurally
    cannot) address the still-open, separately-tracked short `stairs_down` animation clip --
    movement speed and animation playback speed are unrelated in this engine.

## [0.77.26] - 2026-09-10

### "Everything we hear is an opinion, not a fact. Everything we see is a perspective, not the truth." - Marcus Aurelius

- **Features:**
  - "And Now?" Flakturm-Tunnel: the previously fixed stage camera can now be zoomed with the mouse
    wheel (a straight dolly along its own axis, clamped so it never crosses the background plane
    or pulls back past the original framing) and the character can be spun in place with
    `[Shift]+[Left]`/`[Shift]+[Right]` without triggering normal movement.
- **Architecture & Bugfixes:**
  - Flakturm-Tunnel: the character's default starting orientation faced directly away from the
    (permanently fixed) camera, landing its stance exactly on the one viewing axis where a leg
    self-occludes behind the other -- correct perspective, but guaranteed to happen at every
    single session start rather than being a rare angle. `StageMovementBehavior` gained a small
    `startFacingNudge` option (a few degrees added only to the initial facing) to break that exact
    alignment without changing the intended starting direction.
  - Flakturm-Tunnel: walk/run speed roughly halved (`StageMovementBehavior`'s `speed`) after the
    original pace crossed the entire stage, and a full staircase, in about a second -- too fast to
    read as walking, and part of why the animation looked more like twitching than a real gait.
- **Housekeeping & Docs:**
  - `.agents/notes/backlog.md`: the full, occasionally back-and-forth investigation into "a leg
    disappears at some viewing angles" is written up in one place -- what turned out to be a
    lighting misread, what turned out to be real (camera-angle self-occlusion, confirmed with
    culling explicitly ruled out), and why the same geometry matters in one scene and not another.

## [0.77.25] - 2026-09-10

### "What we observe is not nature itself, but nature exposed to our method of questioning." - Werner Heisenberg

- **Architecture & Bugfixes:**
  - "And Now?" character diorama & Flakturm-Tunnel: fixed the hand-held lantern for all three
    playable figures (male, female, Yoshi). Three independent causes, found one at a time as each
    "fixed" state turned out to still be wrong from an untested angle: Yoshi's hand bone was
    misdiagnosed as broken from a bind-pose snapshot taken before his animation had blended in
    (it wasn't — he now tracks it exactly like the humans); the diorama's lantern was parented to
    the rotatable `_dioramaRoot` instead of the true scene root, so its always-world-space
    position silently drifted the moment the diorama's turntable rotated it, invisible at the
    default camera angle; both scenes' lantern-hand-bone resolution otherwise confirmed correct
    for the human rigs.

## [0.77.24] - 2026-09-09

### "A river cuts through rock not because of its power, but its persistence."

- **Features:**
  - Showcase 29 ("Sponza Atrium"): reworked Mediterranean lighting into a Crytek-style
    chiaroscuro pass with ACES Filmic tonemapping, bloom, HBAO, and vignette; added simulated
    diffuse GI bounce (arch-soffit and courtyard bounce lights) and a live tuning HUD with
    presets, keyboard shortcuts, and per-parameter sliders. Volumetric god rays are now off by
    default (toggle with `[V]` or the HUD checkbox).
- **Architecture & Bugfixes:**
  - WebGPU `GPUTextureResourceCache.acquireTextures()` no longer wholesale-replaces a texture's
    tracked-key snapshot on every call; a narrower-keyed manifest (e.g. the depth pre-pass's)
    could spuriously release+recreate a texture another pass still had bound, churning every GPU
    texture in the scene every frame.
  - `DepthPrePassGPU` now groups alpha-cutout objects by their real diffuse texture instead of
    sharing one never-updated `DepthMaterial`, fixing both the texture churn above and a latent
    bug where alpha-tested geometry got early-Z'd as fully opaque.
  - WebGL2 clustered light culling: the packed cluster grid/index textures no longer alias
    `WebGL2Renderer`'s PCSS raw-depth read (both wanted texture unit 14); `WebGLClusterCullPass`
    now guards its fixed-unit binds against the device's real `MAX_TEXTURE_IMAGE_UNITS` and
    degrades gracefully instead of silently corrupting on 16-unit-minimum hardware.
  - HBAO's WGSL NaN guards (added alongside the existing GLSL ones) were incomplete -- `isnan`/
    `isinf` have no reliable WGSL builtin, so two of the three guards were dropped during
    porting. Completed via the portable `x != x` NaN check in both `AO.frag.wgsl` and
    `PostProcess.frag.wgsl`.
- **Housekeeping & Docs:**
  - Removed the two completed review-cleanup note directories (`full-review-2026-09-03/`,
    `continous-review-2026-09-04/`) now that their findings are addressed.
  - Introduced `.agents/notes/backlog.md`, a living, project-wide journal of ideas, open items,
    and their decisions/status, replacing ad-hoc session-scoped TODO notes.

## [0.77.23] - 2026-09-08

### "The sun does not realize how wonderful it is until after a room is made." - Louis Kahn

- **Features:**
  - **Showcase 29 ("Sponza Atrium: Global Illumination & Volumetric Light Shafts"):** completely restored and migrated to the full Khronos Sponza Atrium glTF model with 69 optimized WebP PBR textures, raking directional sunlight cascades, flickering cloister lanterns, and atmospheric god rays streaming through clerestory arches.
  - Added Mediterranean sky panorama skydome sphere enclosing the exterior vistas.
  - Added new `FlyController` for 6-DOF free spectator flight with true 3D pitch/yaw navigation, Sprint (Shift) and Crawl (Alt/Ctrl) modifiers.
- **Architecture & Bugfixes:**
  - `Cylinder` geometry now supports `openEnded: true` to skip generating top and bottom cap faces (ideal for volumetric light shafts, exhaust plumes, and hollow tubes).
  - Fixed an issue where unpopulated `staticOctree` culling in scenes with un-transformed glTF nodes caused all meshes to be wrongly tagged as outside the frustum (`inFrustum = false`).
  - Added `FlyController` unit tests and comprehensive glTF loading tests for multi-primitive models.

## [0.77.22] - 2026-09-08

### "A good tool improves the way you work." - Jeff Duntemann

- **Housekeeping & Docs:**
  - Fully removed the deprecated `neon-labyrinth` application and showcase from the repository (`src/apps/neon-labyrinth/`, `showcases/neon-labyrinth/`, `tests/apps/neon-labyrinth/`).
  - Updated Showcase 14 ("Detective Interrogation Room") to employ `FrostglassMaterial` for the one-way observation mirror.
  - Setup `.agents/collaborate/.gitignore` ensuring the folder is tracked in Git without polluting the repository with ephemeral collaboration transcripts or locks.

## [0.77.21] - 2026-09-08

### "Structure is not an impediment to the creative process, but the very foundation for it." - Twyla Tharp

- **Housekeeping & Docs:**
  - Audited and updated the entire documentation site under `docs/`: restructured VitePress navigation and sidebar to feature dedicated sections for Guides, Architecture Decision Records (ADRs 0001–0015), and Technical Research.
  - Added dedicated index pages for `docs/adr/index.md` and `docs/research/index.md`.
  - Migrated and consolidated research notes into `docs/research/diorama-environment-architecture.md` and `docs/research/oil-puddle-shader-technique.md`.
  - Updated `REFERENCES.md` with fully qualified file paths and added official Khronos glTF PBR material extension references and formulas (`KHR_materials_ior`, `KHR_materials_volume`, `KHR_materials_iridescence`).
  - Fixed dead links and updated outdated API notes across guides (Material Studio, AudioSystem).

## [0.77.20] - 2026-09-08

### "Simplicity is the final achievement." - Frédéric Chopin

- **Housekeeping & Docs:**
  - Cleaned up developer comments in `LevelBuilder.ts` for lava and slime floor tile overrides.
  - Finalized all pending action items and session state notes from the continuous codebase review.

## [0.77.19] - 2026-09-08

### "The whole is greater than the sum of its parts." - Aristotle

- **Housekeeping & Docs:**
  - `vite.config.ts` gained the missing `showcase1`-`showcase7` entries in the build's rollup input map -- they existed as showcases but were never actually registered for production builds.

## [0.77.18] - 2026-09-08

### "Alone we can do so little; together we can do so much." - Helen Keller

- **Architecture & Bugfixes:**
  - **And Now? (Flakturm Tunnel & Character Diorama):** fixed the player's hand-held lantern detaching from the hand and drifting on character rotation -- the per-frame grip offset is now transformed through the hand bone's full world matrix (rotation included) instead of added as a raw world-space constant, and divided by the bone's accumulated world-space scale first (Mixamo-rigged hands carry a ~94x baked cm-to-m scale that was otherwise blowing a small local offset up to a near-meter position error).
  - Fixed the brass handle ring rendering flat/horizontal instead of upright as a carry grip -- `Torus` geometry defaults to the horizontal XZ plane and was never rotated.
  - Hand-bone resolution now walks a single prioritized candidate list (finger bones first, then wrist, then the Yoshi/tripo rig) and requires an actual `Bone` instance, shared verbatim between both scenes.
  - Result of a 3-role `/collaborate` session (Architect, Tech Art, Performance & Runtime Verification) -- consensus reached, both scenes implemented, a scale bug found and fixed in each during verification, final acceptance granted.

## [0.77.17] - 2026-09-08

### "Colours are the deeds and sufferings of light." - Johann Wolfgang von Goethe

- **Features:**
  - **Showcase 35 "PBR Sphere Grid":** the classic Khronos glTF Sample Viewer "MetalRoughSpheres" reference test -- a 7x7 grid of `StandardMaterial` spheres with metallic increasing left-to-right and roughness increasing bottom-to-top, for visually comparing PBR shading across the WebGL1/WebGL2/WebGPU renderers via `?rendererType=`.
- **Architecture & Bugfixes:**
  - **And Now? Character Diorama:** `OilSlickMaterial` gained an analytic environment-reflection term -- since the scene has no cubemap/skybox, a constant damp-ambient tint is weighted by a Schlick Fresnel term using the Khronos `KHR_materials_ior` F0 value for oil/water (IOR 1.333, F0=0.0204), instead of a real cubemap probe.
  - Replaced the puddle's single-layer, static-frequency thin-film shimmer with two independently-scrolling noise layers -- a "wandering wave" look for the colour shimmer only, deliberately without any normal/geometry perturbation, preserving the material's documented "thick, settled pool that never moves" design.
  - Replaced the thin-film shimmer's arbitrary phase-shifted-sine colour shift with a real two-beam thin-film interference calculation (Schlick Fresnel at both the air-film and film-base interfaces, phase difference from the optical path length, evaluated per RGB wavelength) -- the same physical model `KHR_materials_iridescence` is built on, simplified from its full spectral/Airy-sum form.
- **Housekeeping & Docs:**
  - `REFERENCES.md` gained an entry for the Khronos glTF-Sample-Assets "MetalRoughSpheres" reference test.

## [0.77.16] - 2026-09-08

### "We don't see things as they are, we see them as we are." - Anaïs Nin

- **Features:**
  - **And Now? Character Diorama:** `OilSlickMaterial` gained a `floorVisibility` parameter -- the puddle's thin rim now blends in the real, captured floor colour (screen-space, all 3 renderers) instead of a flat procedural edge, so it reads as translucent oil film over actual pavement.
- **Architecture & Bugfixes:**
  - Fixed two independent bugs in the same feature, both only caught via a user-requested screenshot followed by quantitative pixel-diff verification (not visual inspection alone): a tint formula that multiplied the real floor colour by a near-black constant (crushing it to near-zero regardless of the parameter), and a lighting-order bug that re-darkened the already fully-lit captured floor colour a second time.

## [0.77.15] - 2026-09-06

### "Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away." - Antoine de Saint-Exupéry

- **Features:**
  - **Showcase 28:** Added a secret manual turntable control -- Ctrl+T toggles between the existing automatic wobble and a manual mode where LEFT/RIGHT arrow keys spin the turntable directly, holding it steady until released.
- **Housekeeping & Docs:**
  - `REFERENCES.md` gained an "AI Coding & Architecture Assistants" section documenting the AI models consulted during development.
  - `vite.config.ts` raised the build's chunk-size warning threshold to 800kb.

## [0.77.14] - 2026-09-04

### "There is nothing so useless as doing efficiently that which should not be done at all." - Peter Drucker

- **Architecture & Bugfixes:**
  - Removed the last of the review's identified dead or speculative code paths: deleted the never-wired `GeometryWorkerProcessor` (which duplicated `AbstractGeometry`'s normal/tangent formulas) and the unused `PrologueScene`; dropped `Scene`'s `_scratchFrustum` working state that computed a frustum on every cull call but was never read.
  - `MathUtils.fastSin`/`fastCos` replaced the lookup-table path (whose `init()` was never called, so the tables silently returned 0) with a direct `Math.sin`/`Math.cos`; the public API and its tests are unchanged.
  - `FrustumCuller` is no longer a bag of page-wide `static` state: its `_frustum`, `_queryHits`, `lastIntersectedNodes`, and `lastVisibleCount` became per-instance members, and `SmallWorldMachine` owns a private culler. A second concurrently running `SmallWorldMachine` instance (e.g. GadgetInspector's `MaterialStudioApp` preview) could previously clobber the shared fields mid-frame.
  - Loader robustness: `GltfSkinParser` now validates each `skin.joints` index and throws a clear `Skin ${i} references invalid joint node ${jIdx}` instead of passing `undefined` through a blind cast; `ObjLoader` wraps `mtlLoader.load()` in `try/catch` and falls back to neutral default materials when the referenced `.mtl` is missing or broken, so the geometry still loads and renders.
  - `AudioSystem.load()` no longer swallows load/decode failures -- it now throws, giving callers an explicit error path consistent with the rest of the loaders. It also gained an optional injected, per-instance event bus and dispatches the new `EventType.AUDIO_LOADED` after a successful decode; `SmallWorldMachine` wires its own `app.events` into it. (The error case intentionally stays a throw rather than an event.)
  - Zero-allocation animation blending in `AnimationMixer`: per-frame weighted contributions no longer allocate fresh sample lists; state is folded incrementally into reused accumulator objects, with a generation stamp distinguishing first-from-later contributions within a frame.
  - `Skeleton.invert()` no longer re-applies a singular mesh-world matrix twice on a zero-scale "pop-in" spawn -- it falls back to identity when the matrix can't be inverted.
  - `DirectionalLight.updateCascades()` now drives cascaded shadows for orthographic (ISOMETRIC) cameras too, adding an orthographic frustum-corner path and linear cascade splits instead of early-returning for non-perspective cameras.
  - Renderer robustness: WebGL2 init now falls back to WebGL1 when the context reports `WEBGL1` capability; the WebGL1 texture path keeps first-upload and `needsUpdate` in lockstep via a shared sampler-params helper (power-of-two mipmaps, NPOT `CLAMP_TO_EDGE`); `WebGLTextureManager` centralized its otherwise divergent filter/wrap state the same way and fixed a `needsUpdate`-path divergence.
  - `ShaderRegistry` now warns with an actionable message on a cache miss that silently falls back from the instance registry to the global singleton.
  - `PropertyPanel` context menus now remove their `pointerdown` listener on every close path (menu item click included) via a shared `closeMenu()`, fixing a listener leak; `AsciiMapLegend` fixed a module-level mutable marker counter shared across legend builders by scoping it per legend.
  - Removed the `gadget:audio:*` window-event coupling from the `SmallWorldMachine` constructor now that the audio system has a proper injected event bus.

## [0.77.13] - 2026-09-04

### "Simplicity is the ultimate sophistication." - Leonardo da Vinci

- **Features:**
  - **LavaMaterial & SlimeMaterial:** New shipped presets on `FluidSurfaceMaterial` -- opaque/emissive molten-rock and translucent/faintly-glowing ooze looks, both built on the same noise-driven flow mechanism instead of bespoke shaders. `FluidSurfaceMaterial` itself gained an optional `emissiveColor`/`emissiveStrength` glow, packed into previously-unused uniform slots.
  - **Showcase 10 ("Waterworld"):** The lava/slime pools now use the new `LavaMaterial`/`SlimeMaterial` classes instead of a raw, un-preset `FluidSurfaceMaterial`.
- **Architecture & Bugfixes:**
  - **`LiquidWaveMaterial`:** New shared base class for `OpenWaterMaterial` and `StylizedWaterMaterial`, which had independently duplicated the same Gerstner-wave displacement and Worley-noise foam logic almost verbatim. The duplicated shader code itself is now factored into two new shared chunks, `liquid_gerstner_wave` and `liquid_worley_noise`, registered through the engine's existing `ShaderRegistry` chunk mechanism (the same one `FOG_CALC`/`PBR_MATH` already use). Public constructors (`new OpenWaterMaterial(...)`, `new StylizedWaterMaterial(...)`) are unchanged.
  - Removed the orphaned `Liquid.*.wgsl`/`Liquid.*.glsl` shader files, which were imported by nothing anywhere in the codebase. See `docs/adr/0013-unified-liquid-surface-material.md` for the full rationale, including why the wave family (transparent/refractive) and the flow family (opaque/emissive-capable) share shader text but not a single uniform layout.
- **Housekeeping & Docs:**
  - Split the flat `extensions/` package into domain-specific homes: `BillboardInstancer`/`ImposterSprite` moved into `core/`, `WeatherEmitter` into `environment/`, the imposter baker into `renderers/imposter/`, and the procedural grid level builder into `tools/procgen/`. See `docs/adr/0014-modular-ecosystem-and-domain-layering.md`.

## [0.77.12] - 2026-09-03

### "I have not failed. I've just found 10,000 ways that won't work." - Thomas Edison

- **Features:**
  - **Showcase 25:** Reworked wave amplitude to come from a large wavelength rather than high steepness (~1.3 units of real crest-to-trough height now, versus under 0.3 before), and lowered the camera to a grazing angle -- wave height only reads visually when crests can occlude each other and the horizon, not from a bird's-eye view. An earlier attempt using high per-wave steepness for the same amplitude instead folded the crests into sharp mountain-like cusps (overlapping Gerstner waves add their horizontal displacement, so combined steepness has to stay low even when each wave looks safe in isolation).
  - **OpenWaterMaterial:** Added a splash pulse -- intersection foam intensity now oscillates over time (approximating wave1's travel direction/speed as a baked-in constant) instead of being a static band, so it reads as water repeatedly slapping an object rather than a painted-on ring.
  - **Showcase 31:** Added rocks poking through the trench water and a rubble "beach" pile spilling from the platform edge into one trench, giving `OpenWaterMaterial`'s refraction/foam actual geometry to intersect.
- **Housekeeping & Docs:**
  - Attempted wave-crest foam (foam breaking on open water at steep slopes, independent of any solid intersection) via a `normal.y` threshold; reverted. The per-vertex analytic normal of overlapping Gerstner waves carries real high-frequency curvature noise that a threshold there picks up as a busy, cracked-looking network instead of clean crest patches -- confirmed not a mesh-resolution artifact (tested at 2x subdivision, identical result). Left as a documented dead end in `OpenWater.frag.glsl`/`.frag.glsl100`/`.frag.wgsl` for whoever revisits it with a coarser crest-steepness estimate.

## [0.77.11] - 2026-09-03

### "Nature is pleased with simplicity." - Isaac Newton

- **Features:**
  - **OpenWaterMaterial:** Added procedural caustics -- a second, lighter Worley-noise layer that fades out with depth, giving the water surface the animated underwater light-net look without a texture asset. Reuses the foam noise's own scale/speed controls rather than adding new ones (the uniform budget is fully spent after refraction/absorption/foam). Approximates the caustics' projection using the water surface's own world position rather than the true refracted seabed position -- a perspective-correct version would need to reconstruct world position from the depth buffer via new `INV_VIEW_MATRIX`/`INV_PROJECTION_MATRIX` uniforms, which don't exist yet anywhere in the renderer and would be a shared, cross-material addition, not something scoped to one material. Implemented across WebGL2 (GLSL300), WebGPU (WGSL), and WebGL1 (GLSL100, using the existing Fresnel depth proxy).
- **Housekeeping & Docs:**
  - Last of the planned `OpenWaterMaterial` upgrade series (refraction, Beer-Lambert absorption, foam, caustics) inspired by a stylized water shader breakdown at gameidea.org.

## [0.77.10] - 2026-09-03

### "Thousands have lived without love, not one without water." - W. H. Auden

- **Features:**
  - **OpenWaterMaterial:** Added procedural shoreline/intersection foam -- a Worley (cellular) noise pattern drifting in world-space XZ, masked to the same depth-based band the existing edge blend already uses, so foam only collects where the water actually meets other geometry instead of covering the whole open surface. New `foamColor`, `foamCutoff`, `foamNoiseScale`, `foamNoiseSpeed` options. Implemented across WebGL2 (GLSL300), WebGPU (WGSL), and WebGL1 (GLSL100).
- **Housekeeping & Docs:**
  - Third of the planned `OpenWaterMaterial` upgrade series (caustics still to follow). Scoped down from a fuller foam design (no separate shadow/bubble sub-layers, no dedicated depth-start/end uniforms) to fit the remaining free uniform slots -- wave1/2/3 already occupy every dedicated vec4 slot, so refraction, absorption, and foam all had to be packed into unrelated named float/vec2 slots (PBR fields, skinning fields, padding) that this material doesn't otherwise use.

## [0.77.9] - 2026-09-03

### "Water is the driving force of all nature." - Leonardo da Vinci

- **Features:**
  - **OpenWaterMaterial:** Replaced the linear depth-to-`deepWaterColor` fade with proper Beer-Lambert absorption -- each color channel now fades out at its own exponential rate via a new `waterAbsorption` option (default tuned so red fades fastest, matching real water), instead of all channels blending at the same rate toward one flat color. Gives the refracted seabed color its own tint before it attenuates with depth. Implemented across WebGL2 (GLSL300), WebGPU (WGSL), and WebGL1 (GLSL100, using the existing Fresnel term as WebGL1's stand-in for depth, since it has no real depth capture).
- **Housekeeping & Docs:**
  - Second of the planned `OpenWaterMaterial` upgrade series (procedural foam, caustics still to follow).

## [0.77.8] - 2026-09-03

### "Appearances are often deceiving." - Aesop

- **Features:**
  - **OpenWaterMaterial:** Added real screen-space refraction -- the water surface now samples the already-existing opaque-color capture (`u_opaqueMap`, previously only used by `GlassMaterial`/`FrostglassMaterial`) instead of only fading to a flat `deepWaterColor`, so what's actually below the surface becomes visible, distorted by the wave normal. New `refractionStrength` option. Includes a depth-based fallback to the undistorted sample so a steep wave slope near the shore can't accidentally reveal a foreground object. Implemented across WebGL2 (GLSL300), WebGPU (WGSL), and WebGL1 (GLSL100, using mesh UV as a screen-space stand-in, same approximation `Glass.frag.glsl100` already uses).
- **Housekeeping & Docs:**
  - First of a planned series of `OpenWaterMaterial` upgrades (Beer-Lambert absorption, procedural foam, caustics to follow), inspired by a stylized water shader breakdown at gameidea.org.

## [0.77.7] - 2026-09-03

### "The snake which cannot cast its skin has to die." - Friedrich Nietzsche

- **Architecture & Bugfixes:**
  - **Behaviors:** Fixed `HoverBehavior` never overriding `onDetach()` -- the pointer-enter/leave closures it wires directly onto the target `Object3D` survived `detachBehavior()` and kept mutating the object's material emissive color/intensity indefinitely, even though the scale animation correctly stopped. `onDetach()` now clears its own handlers via an identity check, so a handler set by a different behavior in the meantime is left untouched. Also fixed `Object3D.onPointerEnter`/`onPointerLeave` tripping `exactOptionalPropertyTypes` once explicitly cleared to `undefined`.
- **Housekeeping & Docs:**
  - Added unit tests for `HoverBehavior`'s attach/detach lifecycle. Closes the last open 🔴 finding from the 2026-09-03 full codebase review.

## [0.77.6] - 2026-09-03

### "Mirrors would do well to reflect a little more before sending back images." - Jean Cocteau

- **Architecture & Bugfixes:**
  - **Core:** Fixed `DeviceCaps.init()` leaking two never-released throwaway WebGL1/WebGL2 probe contexts on every call -- each `SmallWorldMachine` instance gets its own private `DeviceCaps`, so pages creating several engine instances at once (e.g. Showcase 14's 9-way comparison wall) could hit the browser's per-page WebGL context cap and start losing live rendering contexts. Now explicitly released via `WEBGL_lose_context` right after reading limits.
  - **Rendering:** Fixed `PlanarReflectionNode` rendering its own reflective surface (e.g. a mirror floor sampling `renderTarget` as `reflectionMap`) into that same texture during its own reflection sub-render -- invalid on WebGPU (a texture can't be a `RenderAttachment` and a `TextureBinding` in the same pass) and semantically wrong on every backend. Added `excludedObjects` to hide any object sampling the reflection texture during its own render; wired up in Showcases 15 and 16.
  - **Assets:** Fixed a stale `.png` texture reference in Showcases 3/4's `vehicle-racer.mtl` left over from an earlier `.webp` conversion pass (404 on load).
  - **Showcase 6:** Fixed a mislabeled geometry entry silently rendering `Ground` under the "Plane" label instead of the actual `Plane` class; added the previously-missing `Octahedron` and `Line` primitives to the gallery.
  - **Showcase 11:** Replaced a bespoke, drifted axis-cross implementation with the engine's own `AxesHelper`, matching its neon color standard and eliminating duplicated label-rendering logic.
- **Housekeeping & Docs:**
  - Added unit tests for the `DeviceCaps` probe-context cleanup and `PlanarReflectionNode`'s `excludedObjects`.

## [0.77.5] - 2026-09-03

### "Do not multiply entities beyond necessity." - William of Ockham

- **Architecture & Bugfixes:**
  - **WebGL2:** Fixed `WebGLShadowPass` regressing the method-parameter-bivariance hazard `WebGLClusterCullPass` already closed -- replaced its `renderer as unknown as { renderShadowMaps?; updateGlobalUBO? }` duck-typed cast with the same `instanceof WebGL2Renderer` guard + typed direct access.
  - **WebGPU:** `CascadedShadowPassGPU`/`SpotShadowPassGPU` now upload only the byte range of `GlobalUniforms` they actually touch (288/320 bytes) instead of re-uploading the whole 848-byte buffer on top of `_updateGlobalBuffers()`'s own once-per-frame upload -- up to 3 full-buffer writes per frame down to 1.
  - **Animation:** Removed `Bone.updateMatrixWorld()`, a byte-for-byte duplicate of `Object3D.updateMatrixWorld()` -- `Bone` now inherits it unchanged.
- **Housekeeping & Docs:**
  - Added a unit test covering the narrowed `GlobalUniforms` upload range.
  - Updated full review dossiers (`.agents/notes/full-review-2026-09-03/`).

## [0.77.4] - 2026-09-03

### "The details are not the details. They make the design." - Charles Eames

- **Architecture & Bugfixes:**
  - **WebGPU:** Fixed `UniformPacker`'s MAT4 base alignment (was 64 bytes, WGSL/std140 spec requires 16 bytes -- a matrix's base alignment matches its column type, not its total size). Currently latent in every existing layout (MAT4 always first, offset 0 either way), but would silently corrupt every uniform packed after a MAT4 in any future custom layout that places one elsewhere.
  - **Lights:** Made the `AreaLight` light-count cap's TS/GLSL coupling explicit -- `MAX_AREA_LIGHTS` (`AreaLight.ts`) and the four independently hardcoded `u_areaLights[4]` GLSL array declarations now cross-reference each other in comments, since GLSL can't import the TS constant.
- **Housekeeping & Docs:**
  - Added unit tests for the MAT4 alignment fix.
  - Updated full review dossiers (`.agents/notes/full-review-2026-09-03/`).

## [0.77.3] - 2026-09-03

### "To attain knowledge, add things every day. To attain wisdom, remove things every day." - Lao Tzu

- **Architecture & Bugfixes:**
  - **Maker:** Bounded `UndoStack`'s history to 50 entries (matching Pixler's own cap) instead of growing it forever; the discarded redo branch is now dropped on every new action, not just at capacity.
  - Added an optional `UndoCommand.discard()` hook, called whenever a command permanently leaves history (capacity trim, redo-branch drop, or `clear()`), so a soft-deleted object parked in `MakerApp`'s trash bin is no longer left unreachable-but-referenced forever -- `_disposeTrashedObject()` now routes it through the scene's real GPU-resource release queue.
- **Housekeeping & Docs:**
  - Added unit test suites for the `UndoStack` capacity/discard fix.
  - Updated full review dossiers (`.agents/notes/full-review-2026-09-03/`).

## [0.77.2] - 2026-09-03

### "The end is where we start from." - T.S. Eliot

- **Architecture & Bugfixes:**
  - **Loaders:** Migrated `GltfLoader`, `ObjLoader`, `ImageLoader`, `MtlLoader`, `TextLoader`, `SkyboxLoader`, `BinaryStreamLoader`, and `GltfMaterialParser` off the deprecated process-wide `AssetManager` singleton onto an injectable, per-loader instance (`LoaderOptions.assetManager`), closing the last leg of the instance-based `RendererContext` migration.
  - **Audio:** `SynthSFX.startDrone()`/`startFire()` now return a `SoundHandle` that stops and disconnects their endless oscillator/noise graphs; `AudioSystem` tracks active handles and gained a `dispose()` that stops them all and closes the `AudioContext`, now wired into `SmallWorldMachine.destroy()`.
  - **Light Cycle Arena:** Fixed `ArenaGrid.isFree()` treating a cycle's own trail cells as permanently free, which let it survive looping back into itself -- removed the `ownerId` exception entirely.
  - **Forge:** `ForgeWindow`'s drag/resize handlers and `ResizeObserver` are now torn down in `destroy()` instead of leaking 10 permanent `window` listeners per window; `Forge` gained its own `destroy()` (closing every window plus its own `keydown`/`paste` listeners), wired into `SmallWorldMachine.destroy()`.
- **Housekeeping & Docs:**
  - Added unit test suites for all 4 resolved review findings above.
  - Updated full review dossiers (`.agents/notes/full-review-2026-09-03/`).

## [0.77.1] - 2026-09-03

### "Small disciplines repeated with consistency every day lead to great achievements." - John C. Maxwell

- **Architecture & Bugfixes:**
  - **Core & Lifecycle:** Fixed `Object3D.lookAt()` quaternion sync when quaternion rotation is enabled; added clean window/DOM listener removal to `Input.destroy()`; corrected `PlanarReflectionNode` mirrorCamera up-vector alignment order before `lookAt()`; implemented zero-allocation Copy-on-Write event dispatching in `EventDispatcherImpl`.
  - **Materials, Lights & Behaviors:** Encapsulated `Color.WHITE` against accidental mutation; isolated `CameraStrategyFactory` instances to prevent cross-engine state leaks; extended `CloneUtils.shallowCloneWithValueTypes` with deep cloning for `Vector2D`, arrays, and typed arrays; integrated PBR lighting evaluation for `AreaLight` across WebGL1, WebGL2, and WebGPU; added window keydown and DOM button cleanup in `AbstractShowcase.destroy()`.
  - **Rendering Backends:** Resolved Clustered Forward+ lighting layout divergence (aligned WebGL2 std140 UBO stride and fixed WebGPU NDC-Y compute coordinate mapping); resolved WebGPU `_packObjectUniforms()` alpha fallback for custom materials; added render-target guards preventing offscreen passes from contaminating persistent TAA history; fixed WebGPU `_depthTexture` and `_opaqueDepthTexture` resize and teardown leaks; unified WebGL1 vignette formula with WebGL2/WebGPU; isolated WebGL post-processing uber-shader recompilation by passing continuous tuning sliders via per-frame uniforms.
  - **Geometry & Physics:** Fixed `PhysicsSystem` resting contact continuous oscillation by removing artificial `+0.005` displacement bias; preserved manually assigned `OBB` bounds on `Object3D` with geometry and activated world scale extraction in `OBB.transform()`; implemented systemic parameter clamping and division-by-zero guards across all parametric geometries (`Sphere`, `Torus`, `Cylinder`, `Cone`, `Capsule`, `Tube`, `Plane`, `Ground`, `Pyramid`, `Circle`, `Disk`, `Cube`, `Gear`, `Octahedron`, `ExtrudeGeometry`).
- **Housekeeping & Docs:**
  - Added unit test suites for all 18 resolved core, backend, math, and geometry review findings (124 test suites, 669 tests passing).
  - Updated full review dossiers (`.agents/notes/full-review-2026-09-03/`).

## [0.77.0] - 2026-08-30

### "The strength of the structure lies in the harmony of its parts." - Vitruvius

- **Features:**
  - Added the **Modular Asset Kit Architecture** (`public/assets/kits/industrial/`): standard self-contained kit structure (`model.glb` + `preview.jpg` + `meta.json` + `kit.json`) for friction-free engine ingestion and out-of-tree distribution.
  - Implemented 4 game-ready PBR industrial props with official ADR/GHS hazard labeling:
    - `wall_lamp`: Weathered cast-iron bulkhead cage lamp with ribbed glass dome diffuser and halogen point light.
    - `barrel_oil_black`: Rusted 200L steel drum with 2×3 corrugated reinforcement bands and black oil residue (ADR Class 3).
    - `barrel_hazard_yellow`: Caution yellow steel drum with diagonal hazard stripes and toxic skull decal (ADR Class 6.1 / GHS06).
    - `barrel_chemical_blue`: Dark teal-blue chemical barrel with flammable red diamond and German stencil typography (ADR Class 3).
  - Added **Small World Machine Maker** (`src/tools/maker/`, `public/tools/maker.html`): Interactive visual 3D Level & Scene Editor with hierarchy tree, transform gizmos, object palette, undo/redo stack, and live project scene binding.
  - Added `WorldWriter` serializer (`src/loaders/WorldWriter.ts`): Standalone binary glTF and JSON scene serializer capturing hierarchy, PBR materials, lights, and custom behavior parameters.
- **Architecture & Bugfixes:**
  - Added `docs/adr/0010-maker-editor-architecture.md` defining the embedded visual level-building architecture.
  - Added `docs/adr/0011-modular-asset-kits-and-remote-catalog.md` establishing the 3-phase modular asset kit and remote catalog standard.
  - Added `Inspectable` interface (`src/core/Inspectable.ts`) across `Object3D`, materials, and lights for zero-boilerplate reflection in inspector UIs.
  - Added knuckle/palm-based hand socket alignment for carried props (`mixamorig:LeftHandMiddle1`) and matte PBR material traversal.
- **Housekeeping & Docs:**
  - Updated `VISION.md` with Säule 5 (Asset Bloat & Open Standards Ingestion) and Core Philosophy 6 (Open Standards & Frictionless Ingestion).
  - Appended dev log entries 89–93 in `src/apps/and-now/docs/log.md`.
  - Added test coverage for `Inspectable`, `WorldWriter`, and `ProjectBinding` (96 test suites, 546 unit tests passing).

## [0.76.33] - 2026-08-27

### "The map is not the territory." - Alfred Korzybski

- **Architecture & Bugfixes:**
  - Fixed two bugs found while re-verifying Showcase 33's Hierarchical-Z occlusion culling (0.76.32) live in the browser. `FrustumCuller.lastVisibleObjects`/`lastVisibleCount` are `static` and shared page-wide, so GadgetInspector's `MaterialStudioApp` preview panel (itself a `SmallWorldMachine` instance running its own `cull()` on its own scene every frame) was silently overwriting them before `HzbOcclusionPassGPU` ever read them -- it now derives its candidate list by walking the actual rendered `Scene` directly instead of trusting that shared static state.
  - `applyPendingOcclusionResults()` relied on `mapAsync()`'s promise resolving to learn when a staging buffer was readable; when that promise didn't fire reliably, the two-slot ping-pong buffer deadlocked permanently after its first cycle (confirmed via real `used in submit while mapped` WebGPU validation errors flooding the console). It now polls `GPUBuffer.mapState` directly every frame instead -- the GPU's own ground truth, which can't get stuck the same way a dropped promise callback can.
- **Housekeeping & Docs:**
  - Updated `docs/adr/0008-hzb-occlusion-culling-webgpu-only.md` with both findings and the `mapState`-polling design rationale.

## [0.76.32] - 2026-08-27

### "What is essential is invisible to the eye." - Antoine de Saint-Exupéry

- **Features:**
  - Added Hierarchical-Z (HZB) occlusion culling, opt-in via `EngineOptions.enableOcclusionCulling` (WebGPU-only, no-op on WebGL1/WebGL2 -- see `docs/adr/0008-hzb-occlusion-culling-webgpu-only.md`). Implements AAA research item #14: a new `HzbOcclusionPassGPU` builds a max-reduction depth pyramid from each frame's opaque depth, tests every frustum-visible object's bounding sphere against it via compute, and reads the results back asynchronously (`mapAsync`, necessarily one frame stale) to skip drawing objects that were fully hidden behind other geometry.
  - Added Showcase 33 ("Hidden City"): an occluding wall hides a dense field of individually-drawn objects behind it, with a console readout (`frustum-visible`/`occlusion-culled`/`rendered`) proving the pipeline is doing real work.
- **Architecture & Bugfixes:**
  - New `Object3D.occlusionCulled` flag and a second gate in `Scene._collectVisible()` (after the existing frustum check), `FrustumCuller.lastVisibleObjects` (a byproduct of the culling walk it already does, feeding the occlusion test's candidate list with no extra scene traversal), and `Renderer.applyPendingOcclusionResults()` (optional interface method, WebGPU-only override) wired into `SmallWorldMachine`'s per-frame loop.
- **Housekeeping & Docs:**
  - Added unit test coverage for the new WGSL dispatch/AABB-packing logic (mocked `GPUCommandEncoder`, matching `ClusterCullPassGPU.test.ts`'s style) and the `Scene`/`FrustumCuller` occlusion bookkeeping.
  - Registered Showcase 33 in `vite.config.ts`, the `public/index.html` gallery, and `scripts/check-showcases.js`'s smoke-test list; re-threaded the showcase navigation chain (32 → 33 → 34 → yad); fixed `AbstractShowcase`'s hardcoded `totalShowcases` prev/next-wraparound constant, stale since showcase 27 (was still 26).

## [0.76.31] - 2026-08-27

### "We are what we pretend to be." - Kurt Vonnegut

- **Features:**
  - Added the `BillboardInstancer` extension (`src/extensions/billboard/`): a reusable, `InstancedMesh`-backed field of camera-facing billboard quads (grass/foliage/crowds), with Y-axis-locked or fully spherical facing computed per instance directly into the shared instance-matrix buffer — no renderer changes, since the engine's existing sprite billboard path never runs on the instanced draw path.
  - Added the `ImposterBaker` extension (`src/extensions/imposter/`): `bakeImposter()` renders a standalone object into N camera-angle `RenderTarget` snapshots (reusing `PlanarReflectionNode`'s render-to-texture recipe), and `ImposterSprite` swaps between them by view angle at runtime — implements AAA research item #15 (Billboards/Imposter).
  - Added Showcase 34 ("Billboard Grove"): a forest glade with an instanced grass field and baked imposter trees standing next to real 3D comparison trees.
- **Architecture & Bugfixes:**
  - Fixed `_getTextureView`/`_getWebGLTexture` (WebGPU/WebGL2/WebGL1) to recognize an already-rendered `RenderTarget` and reuse its cached GPU texture instead of requiring `.image` (which a `RenderTarget` never has) — previously any `RenderTarget` sampled as a regular material texture (e.g. `PlanarReflectionNode`'s `reflectionMap`, or a baked imposter) silently fell back to a blank white texture. Mirrors `_getGPUCubeTextureView`'s existing `RenderTargetCube` handling.
- **Housekeeping & Docs:**
  - Added unit test coverage for `BillboardInstancer` and `ImposterBaker`/`ImposterSprite` (mocked `Renderer`, no GPU needed).
  - Registered Showcase 34 in `vite.config.ts`, the `public/index.html` gallery, and `scripts/check-showcases.js`'s smoke-test list; re-threaded the showcase navigation chain (32 → 34 → yad); Showcase 33 is reserved for the upcoming Hierarchical-Z Occlusion Culling showcase.

## [0.76.30] - 2026-08-27

### "As above, so below." - Hermes Trismegistus

- **Architecture & Bugfixes:**
  - Extended WebGPU's PCSS soft shadows (blocker-search + variable-radius PCF, previously the directional light's primary cascade only) to spot lights: `getShadowPCSS` was already fully generic (identical signature to `getShadowPCF`, no directional-specific uniform access), so this was a pure function swap in `lighting.wgsl`/`lighting_pbr.wgsl`, no new bindings.
  - Updated `docs/adr/0006-pcss-directional-light-only.md` to reflect this and add a WebGL2/WebGL1 feasibility assessment: WebGL2 spot-light PCSS is technically possible (the directional light's dual-sampler trick would replicate) but constrained by texture-unit budget already tight at the 16-unit spec minimum; WebGL1 has no shadow mapping at all.

## [0.76.29] - 2026-08-27

### "Nothing is lost, nothing is created, everything is transformed." - Antoine Lavoisier

- **Features:**
  - Added the `WeatherEmitter` extension (`src/extensions/weather/`): a reusable, `InstancedMesh`-backed atmospheric particle emitter (falling ash/dust/rain/snow) with a fixed-capacity particle pool, wind drift with per-particle gustiness phase, toroidal horizontal wrap, and floor-plane recycling — no per-frame allocation, no renderer changes. Implements AAA research item #16 (weather particle VFX) as a pure application-level utility, mirroring `GridLevelBuilder`'s opt-in extension pattern rather than the renderer-integrated post-processing composite pass AAA engines use (unnecessary at this particle scale, and deliberately avoided to stay clear of renderer-core work in flight elsewhere).
  - Added Showcase 32 ("Radioactive Ashfall: Fallout Zone Vienna"), the "And Now?" world's Donauauen fallout belt: a ruined street flanked by collapsed apartment blocks, a glowing radioactive hot zone with toppled drums, an irregularly flickering "geiger click" point light, and two `WeatherEmitter` instances (high-altitude ashfall + a dense ground-hugging toxic dust layer) — re-themed from the research doc's generic "blizzard" concept to fit the setting's established radiation/toxicity lore instead.
  - Exercises the engine's existing `Fog` (EXP2 mode) for the toxic haze, plus `AbstractRenderer.setClearColor()` to tint the empty sky instead of rendering pure black behind a skybox-less ruin.
- **Housekeeping & Docs:**
  - Added unit test coverage for `WeatherEmitter` (pool sizing, floor-plane recycling incl. the exact-boundary edge case, wind drift, dirty-flag behavior).
  - Registered Showcase 32 in `vite.config.ts`, the `public/index.html` gallery, and `scripts/check-showcases.js`'s smoke-test list; re-threaded the showcase navigation chain (31 → 32 → yad).
  - Updated `docs/research/aaa-engine-techniques.md` item #16's status to implemented.

## [0.76.28] - 2026-08-27

### "The wise man does at once what the fool does finally." - Baltasar Gracián

- **Architecture & Bugfixes:**
  - Fixed a WebGPU validation error ("used in submit while destroyed") on the dummy vertex buffers: `_ensureDummyBufferSize` used to destroy the old normal/UV/tangent buffers synchronously when growing, even though an earlier object in the same not-yet-submitted frame could already reference them via `setVertexBuffer`. Now deferred into `_dummyBuffersPendingDestroy` and drained right after `queue.submit()`, the same pattern already used for `_objectRingPendingDestroy`.
  - Added per-cascade frustum culling to `CascadedShadowPassGPU` (`SpotShadowPassGPU` already had it): each cascade now only draws casters that actually intersect its own, much tighter light-space frustum instead of the full main-camera-culled render list.
  - Added `DepthPrePassGPU`: a Z-only pre-pass for opaque objects using the shared `DepthMaterial` pipeline (same one-pipeline-for-everyone approach the shadow passes use), populating the main depth buffer before `MainRenderPass`'s color pass. `MainRenderPass`'s opaque pass now loads instead of clearing that depth buffer, so its unchanged `depthCompare: "less-equal"` rejects occluded fragments via hardware early-Z before their PBR + clustered-lighting fragment shader ever runs.

## [0.76.27] - 2026-08-27

### "Nature does not hurry, yet everything is accomplished." - Lao Tzu

- **Features:**
  - Added Showcase 31 ("Overgrown Subway: Karlsplatz Junction Ruin"), set at the "And Now?" world's U-Bahn-Knoten Karlsplatz: a Jugendstil island-platform hall with a jagged ceiling breach pouring cascaded sunlight, procedurally chained hanging vines/roots, and drifting dust motes onto a flooded, wrecked platform.
  - The flooded track trenches use `OpenWaterMaterial` for reflective, rippling water; foliage, dust, and debris are drawn via `InstancedMesh`; three flickering point lights (kept within the engine's 4-light global cap) light the ruin.
- **Housekeeping & Docs:**
  - Registered Showcase 31 in `vite.config.ts`, the `public/index.html` gallery, and `scripts/check-showcases.js`'s smoke-test list (which also picked up the previously-missing 27-30 entries), and re-threaded the showcase prev/next navigation chain (29 → 30 → 31 → yad).

## [0.76.26] - 2026-08-27

### "Everything flows, nothing stands still." - Heraclitus

- **Architecture & Bugfixes:**
  - Replaced WebGPU's per-object `GPUBuffer`/`GPUBindGroup` allocation with a single shared dynamic-offset ring buffer (`_objectRingBuffer`) in `WebGPURenderer`, sized from the previous frame's actual slot usage instead of growing unbounded.
  - Added GPU-side mip-chain generation (`_generateMipmaps`, `MipDownsample.frag.wgsl`) for runtime 2D textures, since WebGPU has no `gl.generateMipmap()` equivalent.
  - Introduced a per-draw dynamic-offset view-projection uniform (group 3, `ViewUniforms` in `structs.wgsl`) so `CascadedShadowPassGPU` and `SpotShadowPassGPU` write each cascade/light's matrix into its own slot instead of clobbering the shared `GlobalUniforms.vp` and submitting a separate command encoder per cascade/light.
  - Moved `PostProcessPass`'s continuous tuning parameters (exposure, vignette, grain, bloom, quantize, outline) out of compile-time WGSL constants into a per-frame `DynUniforms` buffer, so adjusting a slider no longer triggers a shader/pipeline rebuild.
- **Housekeeping & Docs:**
  - Added unit test coverage for the object ring buffer, mipmap generation, per-draw view uniforms, and post-process dynamic uniforms.

## [0.76.25] - 2026-08-22

### "Drawing is the honesty of the art. There is no possibility of cheating. It is either good or bad." - Salvador Dalí

- **Features:**
  - Added `OutlineElement` (`PostProcessingEffectType.OUTLINE`) with Sobel edge detection across WebGPU (`PostProcess.frag.wgsl`) and WebGL2/WebGL1 (`PostProcess.frag.glsl`) post-processing pipelines for Comic / Graphic Novel ink rendering with configurable thickness, sensitivity, and color.
  - Added Showcase 30 ("The Rain-Drenched Cyberpunk Albedo: SSR & Neon Wetness") featuring high-reflectance asphalt puddles, metallic roughness maps, concentric water ripples, oscillating neon spotlights, and IBL skybox reflections.
  - Added Showcase 28 ("The Quantum Optical Resonator: Spot Shadows & Roughness Dial") and Showcase 29 ("The Sponza Atrium: Cascaded Sunlight & Classical Colonnade") with real-world CC0 PBR texture sets and IBL.
  - Enhanced Showcase 14 ("Surveillance Video Wall") with `CAM-09 (GRAPHIC NOVEL)` post-processing preset, click-to-zoom fullscreen inspection modal with ESC key exit, and round ceramic cups with vertical Torus handles.
- **Architecture & Bugfixes:**
  - Resolved WebGPU read/write synchronization hazard (`Depth32Float` bound simultaneously as render attachment and texture binding) by introducing dedicated persistent dummy shadow texture views in `WebGPURenderer`, `CascadedShadowPassGPU`, and `SpotShadowPassGPU`.
  - Registered `OutlineElement` in `PostProcessingGroup` and exported from post elements index.
- **Housekeeping & Docs:**
  - Added unit test coverage for `OutlineElement` (`tests/renderers/post/elements/OutlineElement.test.ts`).
  - Documented the Master Dramaturgy (4 Acts), 20 key locations, faction ecosystem, radiation mechanics, and urban compression principles for the "And Now?" post-apocalyptic Vienna app.


### "Light and shadow are opposite sides of the same coin." - Leonardo da Vinci

- **Features:**
  - Added Showcase 27 ("Shadow Sanctuary / High-Precision Shadow Lab") featuring "The Celestial Armillary Sphere" (nested counter-rotating Torus rings), 12 Doric colonnade pillars, dual chromatic orbiting spotlights with PCF filtering, and raking sunlight with 3-tier Cascaded Shadow Maps.
  - Enhanced Showcase 13 (`DamagedHelmet.glb`) with an exhibition pedestal, studio ground shadow receiver, and orbiting key spotlight casting real-time shadows.
- **Architecture & Bugfixes:**
  - Fixed WebGPU driver validation errors for compute Ambient Occlusion by migrating `AOPassGPU` storage texture and shader format from non-standard `r8unorm` / `r32float` to universally compliant `rgba8unorm` supporting both `STORAGE_BINDING` writes and filterable `float` post-processing sampling.
- **Housekeeping & Docs:**
  - Registered Showcase 27 in `vite.config.ts` build manifest and `public/index.html` showcases gallery.

## [0.76.23] - 2026-08-22

### "Simplicity is the prerequisite for reliability." - Edsger W. Dijkstra

- **Features:**
  - Added full glTF Ambient Occlusion map (`aoMap`) support across WebGPU (`u_aoMap` texture binding 17) and WebGL2/WebGL1 pipelines with automatic `occlusionTexture` resolution in `GltfLoader`.
  - Added support for the `KHR_materials_emissive_strength` glTF extension in `GltfLoader` and `StandardMaterial`, enabling true HDR emissive bloom on glowing surfaces.
  - Implemented `BinaryStreamLoader` and `AssetManager.streamBinary` for progressive chunked binary streaming (DirectStorage Web adaptation) with non-blocking geometry normal and tangent computation via `GeometryWorkerProcessor`.
- **Architecture & Bugfixes:**
  - Modernized `AOPassGPU` into a full WebGPU compute pass with `@workgroup_size(8, 8, 1)` and `r8unorm` storage texture output to eliminate render pass overhead.
  - Hardened WebGPU context loss recovery and driver limits clamping in `WebGPURenderer` and `DeviceCaps` (`device.lost` handling, storage buffer binding limit clamping).
  - Fixed shadow caster bind group recreation during cascaded and spot shadow passes.
  - Enhanced Showcase 13 (`DamagedHelmet.glb`) with IBL prefilter maps, occlusion textures, and natural HDR bloom thresholds.
- **Housekeeping & Docs:**
  - Added unit test coverage for `BinaryStreamLoader`, `GeometryWorkerProcessor`, and WebGPU device limits.

## [0.76.22] - 2026-08-21

### "It is not the daily increase but daily decrease. Hack away at the inessentials." - Bruce Lee

- **Architecture & Bugfixes:**
  - Removed the Disc Wars app entirely (`src/apps/disc-wars/` and `showcases/disc-wars/`, including its `GridWallMaterial`, maze generator, level builder, HUD, and the `spaceship_ambience.mp3` ambience track) to clear space for a new direction; its standalone Vite build entry (`discWars` in `vite.config.ts`) is removed along with it.
- **Housekeeping & Docs:**
  - Dropped the resulting dead references: the Disc Wars link in `public/index.html`, its now-orphaned Pixabay "Spaceship Ambience" credit in `REFERENCES.md`, and its row in `.agents/notes/app-docs-convention.md`'s app-log table.

## [0.76.21] - 2026-08-20

### "Chance favors the prepared mind." - Louis Pasteur

- **Features:**
  - New `TeqlerMeasuringCylinder` showcase asset (`showcases/12/assets/objects/TeqlerMeasuringCylinder.ts`): a graduated-cylinder-style lab vessel with a hexagonal Teqler-style foot, a flared pouring lip, and 8-10 short, irregular arc-segment tick marks (alternating "major"/"minor" lengths, never a full ring) that suggest a printed scale without ever rendering legible text.
  - Showcase 12's workbench table now holds 12 vessels -- 4 Erlenmeyer flasks, 4 apothecary bottles, 4 Teqler measuring cylinders -- each a unique color drawn from a 12-hue palette spaced 30 degrees apart (so every color stays clearly distinguishable by eye, not just numerically different), 2 randomly generated but lab-glassware-sensible sizes per vessel type, and scattered across the tabletop by rejection sampling instead of a fixed grid (footprint-aware: the Teqler cylinder's flared hex foot, not its narrower glass tube, is what's checked against the table edge and neighboring vessels).
- **Architecture & Bugfixes:**
  - Slowed and thickened Showcase 12's oil-puddle ripple response (`OilPuddleMaterial.ts`) so crates landing in the puddle read as viscous oil rather than water: lower ripple frequency and spatial decay for broader, blurrier wavefronts, lower propagation speed, and a faster time-decay exponent so ripples settle down quickly instead of ringing.

## [0.76.20] - 2026-08-20

### "Good fences make good neighbours." - Robert Frost

- **Architecture & Bugfixes:**
  - Restored real encapsulation on `WebGPURenderer`, `WebGL2Renderer`, `WebGL1Renderer`, and `AbstractWebGLRenderer`: dozens of `public _x` fields existed only so separate `RenderPass`/`WebGLRenderPass` classes could reach them (TypeScript has no "friend" concept). Fields are `private`/`protected` again; passes now go through named getters (no leading underscore), with `get`/`set` accessor pairs only for the three fields actually mutated externally (`globalBindGroup`, `defaultDirShadowTextureView`, `defaultSpotShadowTextureView` -- rebuilt once by a shadow pass the first time a real shadow map exists, not every frame). Deliberately-public methods (`_renderBatch`, `_updateGlobalBuffers`, `_createGlobalBindGroup`, `renderShadowMaps`, `writeClusterGridUniforms`, `captureOpaqueTexture`) were left alone -- a designed public method isn't the same kind of leak as an exposed raw field.
  - Fixed `WebGLClusterCullPass`'s `execute(renderer: WebGL2Renderer, ...)` signature, which exploited a TypeScript method-parameter bivariance gap to silently satisfy the shared `WebGLRenderPass` interface (`WebGL1Renderer.addPass()` would have accepted it without a type error). Now typed against `AbstractWebGLRenderer` like every other pass, with a real `instanceof WebGL2Renderer` runtime guard.
  - `AbstractWebGLRenderer._frameProjMatrix` is threaded through `WebGLRenderPass.execute()` as an explicit trailing parameter instead of being read directly off the renderer.
  - Moved WebGL2's four clustered-lighting texture unit numbers from `public static readonly` class fields to plain exported constants in `src/math/ClusterGrid.ts` -- they're the same for every instance, not renderer state.
  - Removed two real dead fields surfaced by the visibility tightening (TypeScript only flags unused *private* members): `WebGPURenderer._blackTexView` (created, never read) and `WebGL1Renderer`/`WebGL2Renderer._opaqueTextureWrapper` (write-only bookkeeping; the actual cache-key object was already used locally without it).
  - Removed two genuinely unused dependencies, `gl-matrix` and `jpeg-js`, from `package.json` -- neither was imported anywhere in `src/` or `scripts/`, directly contradicting `VISION.md`/`README.md`'s own "no external math libraries like glMatrix" claim.
- **Housekeeping & Docs:**
  - Corrected several stale/false claims in `README.md` and `VISION.md`, caught by a verification pass against the actual repo state: a nonexistent `Application` base class (twice in `README.md`), shadow mapping described as WebGL2-only (WebGPU has equal support), an unqualified "zero dependencies" claim, an `npm install small-world-machine` instruction that can't work against a `"private": true` package, `examples/`/`public/engine/` paths that don't exist (real: `showcases/`, `public/assets`/`resources`/`tools`), "IXtractor" (real name: `Xtractor`), a hardcoded `~` toggle key that's actually configurable, and an overstated "WebGPU compute shaders are standard" claim (the engine's first-ever compute shader shipped this same session, for Clustered Lighting only).
  - Added `.husky/pre-commit`'s missing `npm run typecheck` step -- `npm run build:lib` (esbuild-based transpilation) does not reliably catch cross-file type errors like private-field access from another module; only `tsc --noEmit` (already run in CI via `ci.yml`, just not locally pre-commit) catches them before a wasted push-and-fail CI round-trip.

## [0.76.19] - 2026-08-20

### "The first principle is that you must not fool yourself -- and you are the easiest person to fool." - Richard Feynman

- **Housekeeping & Docs:**
  - Corrected several stale/false claims in `README.md`, caught by a verification pass against the actual repo state: a nonexistent `Application` base class (the real one is `SmallWorldMachine`, as the README's own code samples already showed) in two places; "Shadow Mapping (WebGL 2)" narrowed out WebGPU's equally real Cascaded/Spot shadow passes; "WebGPU Compute Shaders ... including workgroup memory" was never true (the engine's very first compute shader, this session's `cluster_cull.wgsl`, doesn't use `var<workgroup>` either); `npm install small-world-machine` can't work against a `"private": true` package that was never prepared for publishing (replaced with git-clone setup instructions); `examples/` and `public/engine/` don't exist (real paths: `showcases/`, `public/assets`/`public/resources`/`public/tools`); the Xtractor tool was misspelled "IXtractor"; and the Forge overlay's toggle key was stated as a fixed `~` when it's actually a configurable option.
  - Added README features that existed in code but were missing from the feature list entirely: Clustered/Tiled Forward+ Lighting, physics CCD/fixed-timestep sub-stepping/`FluidVolume`, and the HBAO/TAA/MotionTrail post-processing effects.
  - `CONTEXT.md`: added HBAO, MotionTrail, Post-Processing (Pipeline), and TAA (Simplified) -- each chosen because it either collides with a similar in-project term or deliberately falls short of (or renames away from) the textbook version of the technique, not because the acronym itself is project-specific. Explicitly declined five further candidates (PBR Rendering, RigidBodies, Tone-Mapping, sRGB Gamma Correction, Automated GPU Memory Management) as generic industry/CS terms with no project-specific naming nuance to resolve.

## [0.76.18] - 2026-08-20

### "Divide each difficulty into as many parts as is feasible for its proper solution." - Rene Descartes

- **Features:**
  - Implemented Clustered/Tiled Forward+ Lighting (item #5 in `docs/research/aaa-engine-techniques.md`) for WebGPU and WebGL2: the camera frustum is split into a 3D grid of Clusters (16x16px tiles x 24 logarithmic depth slices by default, configurable via `quality.clusteredLighting`), and each fragment now only evaluates the point/spot lights referenced by its own cell's Per-Cell Light List instead of looping over every light in the scene. Scene-wide point/spot light cap raised 16 to 64 (`MAX_CLUSTERED_LIGHTS_PER_TYPE`) -- WebGPU consumes the full 64, WebGL2/WebGL1 still only read the first 16 (see `docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md`).
- **Architecture & Bugfixes:**
  - WebGPU: new `ClusterCullPassGPU` compute pass (`cluster_cull.wgsl`) computes each light's screen-space + radial-distance coverage directly against `global.vp`/`global.viewPos` (no separate view matrix needed, and no view/world-space mismatch to get wrong), writing fixed-capacity-per-cluster grid+index storage buffers that `lighting.wgsl`/`lighting_pbr.wgsl` read via a Cluster lookup instead of iterating every light.
  - WebGL2: new `WebGLClusterCullPass` runs the identical coverage formula (`lightClusterCoverage()` in the new `src/math/ClusterGrid.ts`, shared with the WebGPU compute shader) on the CPU, only visiting the cells within a light's own range rather than testing every cell against every light, and uploads the result into four new RG32UI/R32UI integer textures (WebGL2 has no 1D texture target, so they're laid out on a fixed 1024px-wide 2D texture instead). `light_calc.frag.glsl`/`light_calc_pbr.frag.glsl` now `texelFetch` the grid instead of looping 0 to 16.
  - `PointLight`/`SpotLight`'s `applyTo()` cap moved from a hardcoded `16` to the new `MAX_CLUSTERED_LIGHTS_PER_TYPE = 64` constant on `AbstractLight`; `WebGL1Renderer`/`WebGL2Renderer` explicitly clamp their own consumption back to 16 since their raw uniform/UBO light arrays didn't grow.
  - `AbstractWebGLRenderer._frameProjMatrix` is now `public` (was `protected`) so `WebGLClusterCullPass` -- a `WebGLRenderPass`, unlike HBAO -- can read this frame's raw projection matrix directly, since the shared pass-execute signature has no projection-matrix parameter of its own.
- **Housekeeping & Docs:**
  - Added `docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md` (fixed-capacity-per-cluster over atomics, WebGL1 excluded, WebGL2's raw light array deliberately stays at 16) and pointed `docs/adr/0004-point-spot-light-global-cap.md` at it.
  - `docs/research/aaa-engine-techniques.md`: item #5 marked implemented; new section records a dedicated fog/weather research pass -- current fog confirmed to be a plain analytic distance/height blend with zero light interaction, real volumetric scattering needs the same Cluster grid and is the next planned step, and a blizzard/weather-VFX comparison found the reference engines solve that as a particle-overdraw problem, not a fog one.
  - `CONTEXT.md`: added Cluster, Clustered/Tiled Forward+ Lighting, Light Coverage, Per-Cell Light List, Culling, Broadphase/Narrowphase, Camera Strategy, Event Bus, Forge/ForgeTool, MathPool, State Data, and Zero-Allocation (Hot Path). Resolved a naming collision between the existing Context Object entry and the FSM's per-machine payload object by introducing State Data as a deliberately distinct term, and synced `docs/guides/state-machines.md`'s example/prose to match.
  - Translated `.agents/notes/app-docs-convention.md` to English.
  - Dropped the redundant "2" from "WebGL2/WebGPU" wherever it appeared alongside WebGPU (`AGENTS.md`, `docs/index.md`, `docs/guides/configuration.md`, `package.json`, `scripts/check-showcases.js`, and historical `CHANGELOG.md` entries); added `CLAUDE.md` as a one-line pointer to `AGENTS.md`.

## [0.76.17] - 2026-08-20

### "Save the time of the reader." - S.R. Ranganathan

- **Housekeeping & Docs:**
  - `AGENTS.md`'s `domain-modeling` skill line now also mentions ADRs (`docs/adr/`), not just `CONTEXT.md` maintenance -- `ADR-FORMAT.md` already lived in that skill folder but wasn't referenced from the always-loaded entry point, so a future session had no way to discover the ADR practice introduced last version without already knowing to look for it.

## [0.76.16] - 2026-08-20

### "Those who cannot remember the past are condemned to repeat it." - George Santayana

- **Housekeeping & Docs:**
  - Started recording architectural decisions as ADRs (`docs/adr/`, lightweight single-paragraph format per `.agents/skills/domain-modeling/ADR-FORMAT.md`). First six: config shape uses named keys instead of `{ type, ... }` arrays when order isn't semantically meaningful (0001); TAA jitter is baked into the shared view-projection matrix rather than a separate one (0002); hit-stop scales gameplay time globally, not per entity (0003); the point/spot light cap is global, not per-object nearest-N selection (0004); CCD covers sphere bodies only (0005); PCSS covers directional lights only, spot lights stay fixed-radius PCF (0006).
  - Added short pointer comments at each decision's actual code site (`Camera.ts`, `SmallWorldMachine.ts`, `PointLight.ts`/`SpotLight.ts`, `PhysicsSystem.ts`, `light_calc.frag.glsl`, `EngineOptions.ts`) referencing the relevant ADR, and trimmed the fuller inline explanations that used to live only in those comments — the ADR is now the canonical "why", the code just points to it.

## [0.76.15] - 2026-08-20

### "Form ever follows function." - Louis Sullivan

- **Architecture & Bugfixes:**
  - Restructured `EngineOptions.renderer` from a `{ type, attributes }[]` array to a `RendererConfig` object keyed by backend name (`WEB_GPU`/`WEB_GL2`/`WEB_GL1`). Same reasoning as `PostProcessingConfig.effects` last version: the array's order was silently ignored — the actual WebGPU → WebGL2 → WebGL1 fallback chain is hardcoded in `RendererFactory`, and the array was only ever looked up by `.find(rc => rc.type === ...)`, i.e. a keyed lookup wearing an ordered-list costume. `RendererFactory` gained a small `_getBackendAttributes()` helper replacing the two duplicated `.find()` call sites.
- **Housekeeping & Docs:**
  - Fixed `docs/guides/configuration.md`'s renderer section, which also had a stale field name (`"renderers"`, plural) that never matched the actual `renderer` (singular) field.

## [0.76.14] - 2026-08-20

### "The map is not the territory." - Alfred Korzybski

- **Housekeeping & Docs:**
  - Removed `docs/.vitepress/dist/` (301 files) from git tracking. It's already listed in `.gitignore`, but had been committed to history at some point before that rule existed, so every subsequent `docs:build` kept showing up as unrelated diff noise in `git status`. Files remain on disk (`git rm --cached`, not a delete) and regenerate normally via `npm run docs:build`.

## [0.76.13] - 2026-08-20

### "Order and simplification are the first steps toward mastery of a subject." - Thomas Mann

- **Architecture & Bugfixes:**
  - Restructured `PostProcessingConfig`: per-effect settings (`toneMapping`, `vignette`, `grain`, `bloom`, `quantize`, `hbao`, `taa`, `motionTrail`) now nest under a new `effects` object instead of sitting as flat top-level keys, so general pipeline settings (`enabled`, `filterMode`) stay structurally separate from individual effects' own tunables. Not an array of `{ type, ... }` entries — the pipeline's effect order is fixed internally (Bloom → HBAO → Tonemapping → Vignette → Grain → Quantize), so an array would have implied an ordering control that doesn't actually exist.
  - Removed a stale comment (`// Add defaults so when enabled, it behaves like before`) left over from an earlier refactor.
- **Housekeeping & Docs:**
  - Added `docs/guides/shadows.md`: a full guide to the shadow system (CSM for directional lights, spot-light shadow maps, PCF, normal-offset bias, this session's CSM texel-snapping/cascade-blending polish, and PCSS), registered in the VitePress sidebar. This was previously undocumented outside of `docs/research/aaa-engine-techniques.md`.
  - Fixed `docs/guides/configuration.md`'s Post-Processing section, which described a schema that didn't match the actual code at all (a `type`-tagged `effects` array with non-existent effect types like `filmGrain`/`retro`) — pre-existing and unrelated to this session's other work, caught while documenting HBAO/TAA/MotionTrail. Rewritten to match the real (now `effects`-nested) shape.

## [0.76.12] - 2026-08-20

### "In the fields of observation, chance favors only the prepared mind." - Louis Pasteur

- **Features:**
  - Added `MotionTrailElement`: a deliberate ghost/afterimage motion-trail post-processing effect, born from noticing during live TAA verification that the "ghosting on fast movement" trade-off (documented as a limitation in item #9) looks genuinely good as an intentional stylistic effect at a higher feedback value. Reuses the exact same exponential history-blend mechanism as TAA — its own separate instance/history buffer, no camera jitter — chained after TAA in the post-processing pipeline. Off by default, WebGL2 + WebGPU only, credited to Haeberli & Akeley's 1990 Accumulation Buffer paper (the shared ancestor technique behind both TAA and deliberate motion-trail effects).
- **Architecture & Bugfixes:**
  - Renamed the TAA-specific pass classes/shaders to reflect that they're now shared, generic infrastructure rather than a single-purpose TAA tool: `TAAPassGL`/`TAAPassGPU` → `HistoryBlendPassGL`/`HistoryBlendPassGPU`, `TAA.frag.glsl`/`TAA.frag.wgsl` → `HistoryBlend.frag.glsl`/`HistoryBlend.frag.wgsl`. Their `execute()` signature now takes a structural `{ feedback: number }` instead of the concrete `TaaElement` class, so `MotionTrailElement` can reuse them without a fake dependency on TAA's own type.
- **Housekeeping & Docs:**
  - Updated `docs/research/aaa-engine-techniques.md` and `REFERENCES.md` for the rename and the new effect, crediting Haeberli & Akeley (SIGGRAPH 1990).

## [0.76.11] - 2026-08-20

### "All models are wrong, but some are useful." - George E. P. Box

- **Features:**
  - Implemented PCSS (Percentage-Closer Soft Shadows) for directional-light shadows (item #6 of `docs/research/aaa-engine-techniques.md`): a blocker-search step reads raw (non-comparison) depth to estimate occluder distance, then scales the PCF filter radius accordingly, so shadows harden near contact and soften with distance from their caster. WebGL2 needed a second non-comparison sampler bound to the same depth texture (`u_dirShadowMapRaw`, via a dedicated `WebGLSampler`); WebGPU reads the same depth texture directly via `textureLoad`, no extra binding needed. Spot-light shadows intentionally kept on fixed-radius PCF.
  - Implemented CSM polish (item #7): texel-snapping rounds each cascade's light-space center to the shadow-map's own texel grid, eliminating sub-pixel shimmer as the camera moves, and cascade blending fades between adjacent cascades near their boundary instead of a hard cut.
  - Implemented a simplified screen-space ambient occlusion pass (item #8) — honestly named `HbaoElement`/HBAO in code, not GTAO: per-direction horizon search reconstructs view-space position and normal from the existing opaque-depth buffer and estimates occlusion from `dot(sampleDirection, normal)`. Still missing relative to real HBAO: proper horizon-angle accumulation, per-pixel direction rotation, and a bilateral blur pass. Still missing relative to GTAO on top of that: cosine-weighted arc integration, multi-bounce approximation, thin-object handling, and temporal filtering. WebGL2 and WebGPU only. Fixed a real pre-existing bug along the way: opaque-depth capture only ever ran when a scene had transparent objects (for underwater refraction) — never for an opaque-only scene, which is exactly what this new pass needed every frame it's enabled.
  - Implemented simplified TAA (item #9): a Halton(2,3) sub-pixel camera jitter baked directly into the view-projection matrix, resolved via an exponential history blend (ping-ponged, no copy) against the previous frame — no motion vectors or reprojection, so it smooths static/slow scenes but visibly ghosts under fast movement, an accepted trade-off for a smaller engine. Runs before Bloom/HBAO/the final post-process pass so everything downstream reacts to the temporally-smoothed color, not the raw per-frame jittered one.
  - Implemented cheap "game feel" (item #11): `ShakeEffect` now decays through a trauma² envelope sampled via continuous simplex noise instead of per-frame white noise; `SmallWorldMachine.triggerHitStop()` briefly scales gameplay deltaTime while the camera keeps running at full speed, so its shake/flash effects still sell the impact; a new `SquashStretchBehavior` applies a damped-spring squash/stretch impulse. Wired into Neon Labyrinth's existing impact moments (Wisp strikes, fall resets) and its spawned impact shards.
- **Architecture & Bugfixes:**
  - Audited GPU-instancing usage (item #10): Disc Wars and Neon Labyrinth already batch all repeated maze geometry (walls, floors, ceilings, seams) through `InstancedMesh` correctly — no code changes needed.
  - `Renderer.render()` gained an optional trailing `projMatrix` parameter (the camera's raw perspective matrix), needed for HBAO's view-space reconstruction; `AbstractWebGLRenderer` now stashes it alongside near/far per frame so `flushPostProcess()` can read it later in the same frame.
- **Housekeeping & Docs:**
  - Updated `docs/research/aaa-engine-techniques.md` for items #6–#11, including an explicit, corrected note that our ambient occlusion implementation is a simplified HBAO, not GTAO.
  - Added `REFERENCES.md` entries for HBAO (Bavoil, Sainz, Dimitrov — SIGGRAPH 2008), TAA jitter/history blend (Karis — SIGGRAPH 2014), PCSS (Fernando — SIGGRAPH 2005), and game-feel technique sources (Eiserloh; Jonasson & Purho).

## [0.76.10] - 2026-08-20

### "Shadow is the obstruction of light." - Leonardo da Vinci

- **Features:**
  - Implemented normal-offset shadow bias (item #2 of `docs/research/aaa-engine-techniques.md`): shadow-map sample positions are now offset along the surface normal, scaled by NdotL, before the light-space transform — instead of only biasing the compared depth value. Reduces shadow acne and peter-panning simultaneously. Applied to directional and spot light shadows, standard and PBR material paths, in GLSL300 and WGSL. WebGL1 is intentionally untouched — it has no shadow-mapping implementation at all today, so there's nothing to bias.
  - Raised the global point/spot light cap from 4 to 16 (item #4, partial): `PointLight`/`SpotLight` now allow up to 16 simultaneous lights instead of 4. WebGL2's global uniform buffer layout grew accordingly (`u_pointLights[16]`/`u_spotLights[16]`, buffer resized with recomputed byte offsets), WebGL1's uniform arrays grew to match, and WebGPU needed no shader/buffer changes since its storage buffers and light loop were already dynamically sized. This is still a single global light list shared by every object, not true per-object nearest-light selection — see `docs/research/aaa-engine-techniques.md` for what a fuller implementation would require.
- **Housekeeping & Docs:**
  - Updated `docs/research/aaa-engine-techniques.md` to reflect implementation status for items #1 (ACES tonemapping was already implemented, no action needed), #2, #3, and #4.
  - Added a `REFERENCES.md` entry crediting Catlike Coding's normal-offset bias tutorial.

## [0.76.9] - 2026-08-20

### "Nature uses only the longest threads to weave her patterns, so each small piece of her fabric reveals the organization of the entire tapestry." - Richard Feynman

- **Features:**
  - Implemented fixed-timestep render interpolation (item #3 of `docs/research/aaa-engine-techniques.md`): `RigidBody` now snapshots `prevPosition`/`prevRotation` before each physics substep, and `PhysicsSystem.applyRenderInterpolation()` blends each tracked body's rendered transform between its previous and current physics state (`interpolationAlpha = accumulator / fixedTimeStep`), instead of snapping straight to the latest completed substep. Eliminates visual stutter whenever the render framerate doesn't line up evenly with `fixedTimeStep`. Rotation interpolates via shortest-path angle blending across the ±π wraparound. Wired into `SmallWorldMachine._loop()` after `FrustumCuller.cull()` and before rendering, gated by `config.enablePhysics`.
- **Housekeeping & Docs:**
  - Added a `REFERENCES.md` entry crediting Glenn Fiedler's "Fix Your Timestep!" as the source technique.

## [0.76.8] - 2026-08-19

### "Research is formalized curiosity. It is poking and prying with a purpose." - Zora Neale Hurston

- **Housekeeping & Docs:**
  - Added `docs/research/aaa-engine-techniques.md`: a prioritized survey of rendering/physics techniques from Unreal, Babylon.js, three.js, and Godot that are realistically adoptable here (clustered/tiled lighting against our 4-point/4-spot-light cap, PCSS and CSM polish on top of our existing shadows, ACES tonemapping, fixed-timestep render interpolation, GPU-instancing usage audit, and more), cross-checked against a fresh grounding pass over our own current renderer/physics code.
  - Added `docs/research/xdp-game-networking.md`: notes on XDP/eBPF Linux kernel packet processing for game servers, parked for reference since `small-world-machine` is a client-only engine with no networking layer today.

## [0.76.7] - 2026-08-19

### "Music is the silence between the notes." - Claude Debussy

- **Features:**
  - **Disc Wars:** Added a looping spaceship-ambience background track, credited in `REFERENCES.md`. `AudioSystem` gained a `playMusic()` method that routes through the dedicated `musicGain` bus (instead of `sfxGain`, like the existing `play()`), replacing the placeholder synthesized `startDrone()` in the click-to-resume handler.
- **Architecture & Bugfixes:**
  - The downloaded ambience source turned out to be the same ~35s sample looped ~17 times to fill a 9:53 runtime. Found the exact loop period via autocorrelation and re-cut the asset down to a single, seamlessly cross-faded loop — 18.99 MB → 820 KB — since the engine already loops it in code.

## [0.76.6] - 2026-08-19

### "The most dangerous phrase in the language is, 'We've always done it this way.'" - Grace Hopper

- **Architecture & Bugfixes:**
  - **Disc Wars:** Fixed a WebGPU crash (`Cannot read properties of undefined (reading 'replace')`) caused by `GridWallMaterial` hand-rolling its own MVP uniforms and GLSL300-only source with no WGSL counterpart. Rebuilt it on the engine's standard vertex pipeline and `StandardWebGPULayout` (same pattern as `RetroScreenMaterial`), so it now renders correctly on WebGL1, WebGL2, and WebGPU alike.
  - `WebGPURenderer._getShaderModule` now throws a descriptive error instead of a blind non-null assertion when a material definition has no WGSL source, matching the existing guard already present in `WebGL1Renderer`/`WebGL2Renderer`.

## [0.76.5] - 2026-08-19

### "Not all those who wander are lost." - J.R.R. Tolkien

- **Housekeeping & Docs:**
  - Linked **Disc Wars** and **Light Cycle Arena** on the main showcase index (`public/index.html`) — both apps were already registered as Vite build entries but had no way to reach them from the gallery page.

## [0.76.4] - 2026-08-19

### "The absence of evidence is not evidence of absence." - Carl Sagan

- **Architecture & Bugfixes:**
  - **Disc Wars:** Fixed two `tsc` errors introduced with the app: `App.ts` constructed `EmissivePulseBehavior` with a `minIntensity`/`maxIntensity`/`speed` shape that never matched its actual `EmissivePulseOptions` (`baseIntensity`/`pulseAmplitude`/`pulseSpeed`); and `GridWallMaterial`'s `ShaderLayout` was missing the required (if empty) `textures` map, matching every other texture-less `CustomShaderMaterial` layout in the engine.

## [0.76.3] - 2026-08-19

### "Small opportunities are often the beginning of great enterprises." - Demosthenes

- **Architecture & Bugfixes:**
  - **Neon Labyrinth:** Fixed the app's `index.html` loading its script from the wrong path (`/apps/neon-labyrinth/App.ts`, a 404) instead of `/src/apps/neon-labyrinth/App.ts`, matching every other app's convention.
- **Housekeeping & Docs:**
  - Corrected a leftover reference to the app's old working title ("Hollow Circuit") in a `MaterialType` doc comment; the app has been "Neon Labyrinth" for several releases.
  - **README:** Swapped the header image for the project's own logo.

## [0.76.2] - 2026-08-19

### "What gets measured gets managed." - Peter Drucker

- **Housekeeping & Docs:**
  - **Material Usage Test:** Added `tests/core/MaterialUsage.test.ts`, which fails per-material if a `MaterialType` entry is never actually instantiated (`new <Material>(`) anywhere outside its own definition file — a cheap static check against the class of bug where a material passes its unit tests but has never had its shaders compiled by a real renderer (see the RetroScreenMaterial fix in `[0.74.10]`).
- **Architecture & Bugfixes:**
  - Running the new test immediately caught `LambertMaterial` in the same unused state; fixed by using it for the floor in Showcase 1 instead of `PhongMaterial` (a pure diffuse floor needs no specular term).

## [0.76.1] - 2026-08-19

### "The palest ink is better than the best memory." - Chinese Proverb

- **Housekeeping & Docs:**
  - **App Docs Convention:** Established a fixed documentation structure for every app under `src/apps/<app>/`: a `docs/` subfolder holding `concept-dossier.html` (visual concept) and `log.md` (living dev log, read at session start, appended at session end). Migrated Neon Labyrinth's existing `concept-dossier.html` into that structure and backfilled a `docs/` folder for YAD. Documented in `.agents/notes/app-docs-convention.md` and referenced from `AGENTS.md`. `docs/research/` remains for project-wide (non-app-specific) research notes.

## [0.76.0] - 2026-08-19

### "The bicycle is a curious vehicle. Its passenger is its engine." - John Howard

- **Features:**
  - **New App: Light Cycle Arena:** Added a Tron-style grid duel (player vs. an AI rival) built almost entirely out of engine primitives that had zero usages anywhere before this — `GridMovementBehavior`'s orthogonal grid movement, the `Ground`/`Grid` geometries for the glowing floor, and `InstancedMesh` for each cycle's permanent trail wall. Its signature mechanic: the whole arena's time slows to a crawl whenever the player isn't holding a direction, turning a reflex chase into a deliberate routing puzzle. Isometric orthographic camera, perimeter walls, bloom, and a diegetic HUD round it out.

## [0.75.0] - 2026-08-19

### "Speed is the essence of war." - Sun Tzu

- **Features:**
  - **New App: DISC WARS:** Added the first sector of "THE GRID", a Tron-inspired Neon-Virus universe — a procedurally generated single-floor maze (`MazeGenerator`) with FPS movement, a custom `GridWallMaterial` shader, a bloom-lit glowing Disc placeholder, and a diegetic HUD. This is the Phase 1 vertical slice; Disc physics, trajectory preview, enemies, and Derezz mechanics are follow-up phases per the app's own dev log.

## [0.74.10] - 2026-08-18

### "Words are a lens to focus one's mind." - Ayn Rand

- **Features:**
  - **TextTexture:** Added a new `TextTexture` utility (`src/core/text/`) to render variable fonts with Canvas2D effects (outline, shadow, gradient, wrapping) into a texture.
  - **Texture Re-upload:** Added `needsUpdate` to `Texture` and extended `Texture.fromCanvas()` to accept `HTMLCanvasElement`. All three renderers (WebGL1/2, WebGPU) now detect this flag and re-upload the canvas buffer to the GPU, unlocking dynamic in-scene text.
  - **New Showcase:** Added Showcase 26 ("Monitor Screen Text") demonstrating a dynamic `TextTexture` mapped onto a `RetroScreenMaterial` plane updating every second.
- **Architecture & Bugfixes:**
  - **RetroScreenMaterial:** Fixed `u_liquidParams` never being declared in the GLSL300/GLSL100 fragment shaders (undeclared-identifier compile error) and the WGSL shader reading it as `obj.u_liquidParams`/`obj.u_extraParams` instead of the actual struct fields `obj.liquidParams`/`obj.extraParams` (WGSL parse error). The material had never been exercised in a real renderer before Showcase 26 and failed to compile/link on all three backends.

## [0.74.9] - 2026-08-10

### "The details are not the details. They make the design." - Charles Eames

- **Features:**
  - **Neon Labyrinth:** Wired sound/camera juice into every existing hazard event. A Wisp strike or a hard fall now shakes the camera and plays a harsh procedural tone; a successful Void Catch or reaching the Exfil point flashes the camera and plays a rising chime; Disc pickup gets a light blip; an ambient drone now starts on first click. `Camera.applyEffect` (shake/flash) and `AudioSystem.playTone`/`startDrone` already existed in the engine but had never been called by any app before this. This closes the full 7-item gap list from the original concept-dossier review.

## [0.74.8] - 2026-08-10

### "It is good to have an end to journey toward; but it is the journey that matters, in the end." - Ursula K. Le Guin

- **Features:**
  - **Neon Labyrinth:** Added a real Exfil point — a goal beacon placed on the maze's top floor (`MazeGenerator.getExfilPoint`), reached the same way as a Disc. Reaching it fires `EXFIL_REACHED` and shows an "Extraction Complete" HUD overlay. The app had no win condition before this — only collecting Discs and surviving.
- **Housekeeping & Docs:**
  - **Tests:** Added a `MazeGenerator` test for `getExfilPoint`.

## [0.74.7] - 2026-08-10

### "Two roads diverged in a yellow wood, and sorry I could not travel both." - Robert Frost

- **Features:**
  - **Neon Labyrinth:** Added Maze Flow's real route choice — carving now knocks down the single wall that saves the most path length between two floor cells, turning the perfect maze into one with a genuine shortcut. The original long way stays intact and ordinarily violet-lit; the new opening (`CellType.FLOOR_SHORTCUT`) is flanked by Frostglass panels where possible and rendered with a distinct cyan seam, reading as riskier because it's dim and see-through rather than brightly lit.
- **Architecture & Bugfixes:**
  - **Neon Labyrinth LevelBuilder:** `build()` now takes a `shortcutSeamMat` and renders a `FLOOR_SHORTCUT` cell's own seams in it instead of the ordinary violet seam, still deferring to the brighter LED strip wherever the neighbor is a Frostglass panel.
- **Housekeeping & Docs:**
  - **Tests:** Added `MazeGenerator` tests covering shortcut placement and Frostglass flanking.

## [0.74.6] - 2026-08-10

### "The wound is the place where the Light enters you." - Rumi

- **Features:**
  - **Neon Labyrinth:** Added Impact Trace — a handful of small emissive shards flash and fade near the point of a Wisp strike or a hard fall reset, giving both hazards real visual feedback for the first time.
- **Architecture & Bugfixes:**
  - **Neon Labyrinth:** Added `ImpactFlashBehavior`, a short-lived per-object fade-and-self-remove behavior. Uses individual `Object3D` shards rather than the shared `InstancedSeams` mesh, since that mesh's one per-instance data channel is already used for texture-atlas indexing across all three renderer backends, not emissive/color control.
- **Housekeeping & Docs:**
  - **Tests:** Added a test covering `ImpactFlashBehavior`'s fade-and-removal lifecycle.

## [0.74.5] - 2026-08-10

### "For every action, there is an equal and opposite reaction." - Isaac Newton

- **Features:**
  - **Neon Labyrinth:** Added the Void Catch skill move — a fall through a void tile can be caught with a well-timed Clarity Pulse input (Bloomsight), landing the player exactly one floor down instead of continuing to a full respawn. Ground-floor voids have nothing beneath them and stay an unrecoverable hazard.
  - **Neon Labyrinth:** Wisp contact now shoves the player away with decaying momentum instead of doing nothing. Whether that's dangerous depends entirely on what's underfoot in the push direction — the shove couples directly into the existing fall/Void Catch system with no separate "near an edge" logic needed.
- **Architecture & Bugfixes:**
  - **Neon Labyrinth Controller:** Fixed a severe bug where fall velocity accumulated unbounded every frame even while standing on solid ground (the "big fallback void zone" covers the whole map and never reset), eventually tunneling the player through floor plates and silently resetting them to spawn every few seconds. Grounding is now detected via the collision system's own upward correction.
  - **Neon Labyrinth Controller:** Fixed the `E` key being double-bound to both God Mode vertical flight and Clarity Pulse, which could fire a wasted pulse attempt while flying.
- **Housekeeping & Docs:**
  - **Tests:** Added 8 new Controller tests covering the fall/tunneling regression, Void Catch success/failure paths, knockback decay, and God Mode blocking knockback.

## [0.74.4] - 2026-08-10

### "There is a crack in everything, that's how the light gets in." - Leonard Cohen

- **Features:**
  - **Neon Labyrinth:** Built actual Frostglass chambers into the procedurally generated maze — five wall cells bordering a floor per floor are converted to `CellType.WALL_FROSTGLASS` and rendered as individually-tagged panels, each with its own `FrostglassMaterial` instance, giving the Controller's existing Clarity Pulse mechanic real geometry to reveal. Added a matching LED strip treatment where seam edges touching a Frostglass panel light up brighter than ordinary wiring.
- **Architecture & Bugfixes:**
  - **FrostglassMaterial:** Added `clone()` so each panel can animate its own Clarity Pulse reveal independently instead of sharing state with every other panel.
  - **Neon Labyrinth LevelBuilder:** Fixed a seam-strip bug where only two of each floor cell's four boundary edges were ever drawn, leaving every corridor missing light on two of its four wall-adjacent edges.
- **Housekeeping & Docs:**
  - **Tooling:** Added `allowScripts` npm allowlist entries for `puppeteer`, `esbuild`, and `fsevents`.

## [0.74.3] - 2026-08-03

### "To improve is to change; to be perfect is to change often." - Winston Churchill

- **Housekeeping & Docs:**
  - **Dependencies:** Updated all NPM libraries to their latest major, minor and patch versions to ensure stability and incorporate latest fixes.
  - **Build System:** Refactored `vite.config.ts` to replace deprecated `__dirname` calls with modern `import.meta.dirname`, resolving Vite 8 native config loader warnings.
  - **Tooling:** Pinned TypeScript to `^6.0.3` to maintain compatibility with `typedoc` version `0.28.20`.

## [0.74.2] - 2026-07-29

### "Before software can be reusable it first has to be usable." - Ralph Johnson

- **Features:**
  - **Object3D:** Added `getWorldPosition(target?: Vector3D)` to easily extract global position from the world matrix.
  - **ProximitySensorBehavior:** Added `planar` option to limit distance checks strictly to the XZ-plane, ignoring height differences.
- **Architecture & Bugfixes:**
  - **YAD App:** Fixed `EnemyBehavior` to properly query the scene's static octree for collision resolution, preventing enemies from walking through walls.
- **Housekeeping & Docs:**
  - **Tests:** Added comprehensive test suites for `getWorldPosition`, planar proximity sensing, and `EnemyBehavior` wall collision logic.

## [0.74.1] - 2026-07-29

### "Leave the code cleaner than you found it." - Robert C. Martin

- **Architecture & Bugfixes:**
  - **App Refactoring:** Restructured the internal architecture of the `YAD` app, organizing its components into dedicated `core/`, `enums/`, and `behaviors/` directories to match the engine's folder standards.
  - **GadgetInspector:** Fixed the selection highlight mesh to correctly wrap and scale around `BoundingSphere` objects (previously only supported `BoundingBox`).

## [0.74.0] - 2026-07-29

### "Talk is cheap. Show me the code." - Linus Torvalds

- **Features:**
  - **New App Showcase:** Added a completely new showcase app, `Neon Labyrinth`.
  - **Raycaster & Selection:** Implemented `Ray.intersectsSphere` and updated `Raycaster` to support picking and selecting sphere-bounded objects. `GadgetInspector` now properly highlights selected spherical bounds.
- **Architecture & Bugfixes:**
  - **GadgetInspector:** Optimized scene overview tree to refresh on a throttled interval rather than every frame, massively improving performance in dense scenes.
- **Housekeeping & Docs:**
  - **Tests:** Added comprehensive test suites for `Ray` and `Raycaster` intersection logic.

## [0.73.0] - 2026-07-28

### "The most incomprehensible thing about the universe is that it is comprehensible." - Albert Einstein

- **Features:**
  - **Physics (CCD):** Implemented Continuous Collision Detection (CCD) for fast-moving spherical bodies. Swept-sphere collision tests (against spheres, boxes, and OBBs) prevent high-velocity objects from tunneling through thin walls in a single substep.
- **Housekeeping & Docs:**
  - **Tests:** Added comprehensive test coverage for the new sweep algorithms and CCD integration in `PhysicsSystem`.
  - **Docs:** Updated `physics.md` to document the new CCD capabilities and `ccdMotionThreshold` parameter.

## [0.72.3] - 2026-07-28

### "Clean code always looks like it was written by someone who cares." - Robert C. Martin

- **Housekeeping & Docs:**
  - **Showcases Cleanup:** Standardized showcase class names (`Showcase12`, `Showcase13`, `Showcase14`, `Showcase24`) for better consistency across all examples.
  - **Docs:** Improved `tools.md` guide with clearer explanations on how to integrate `enableInspector` and wire events into custom `Forge` overlay setups.

## [0.72.2] - 2026-07-28

### "Quality is not an act, it is a habit." - Aristotle

- **Architecture & Bugfixes:**
  - **Showcase Tests:** Introduced concurrency and sequential retry logic to `check-showcases.js` to eliminate transient GPU context failures during CI runs.
  - **Renderers:** Fixed a rare WebGPU crash where an uninitialized (0x0) canvas would attempt to generate a degenerate HDR Bloom texture on the very first frame.
  - **AudioSystem:** Allowed dependency injection of `AudioContext` for better unit testing.
- **Housekeeping & Docs:**
  - **Tests:** Enabled `v8` coverage reporting in `vite.config.ts`.

## [0.72.1] - 2026-07-28

### "Nature is written in mathematical language." - Galileo Galilei

- **Features:**
  - **Math Library Enhancements:** Added robust interpolation functions including `MathUtils.lerp`, `Vector3D.lerp`, and a numerically stable shortest-arc `Quaternion.slerp`.
- **Architecture & Bugfixes:**
  - **Tests:** Added comprehensive test coverage for the new `lerp` and `slerp` math functions.
- **Housekeeping & Docs:**
  - **Exports:** Exported `SynthSFX` module for better external access.

## [0.72.0] - 2026-07-28

### "The ability to simplify means to eliminate the unnecessary so that the necessary may speak." - Hans Hofmann

- **Architecture & Bugfixes:**
  - **Shader Cleanup:** Massive structural cleanup of the engine's shader source code. Deleted numerous deprecated and redundant material shaders (`.glsl` and `.wgsl`) across all renderers (WebGL1, WebGL2, WebGPU), centralizing the logic.
  - **Renderers:** Cleaned up unused properties (`_materialBGL`) in `WebGPURenderer` and improved generic uniform validation logic in `WebGL1Renderer` using `StandardWebGPULayout`.
  - **Materials:** Tweaked and improved `FluidSurfaceMaterial` and `Terrain` shaders.
- **Housekeeping & Docs:**
  - **Docs:** Updated `physics.md` documentation guide and synced internal `.agents/notes/`.

## [0.71.3] - 2026-07-27

### "Make it work, make it right, make it fast." - Kent Beck

- **Features:**
  - **WebGL1 Bloom Post-Processing:** Added full fallback support for the high-quality Dual-Kawase Bloom effect in WebGL1 using GLSL 1.0.0 shaders and custom mip-chain targets.
- **Architecture & Bugfixes:**
  - **Renderers:** Updated `WebGL1Renderer` and `WebGPURenderer` for improved compatibility, and refined `DeviceCaps` hardware checks.
  - **Materials:** Tweaked `FluidSurfaceMaterial` and post-process GLSL100 shaders for the new Bloom integration.

## [0.71.2] - 2026-07-27

### "Truth is ever to be found in simplicity, and not in the multiplicity and confusion of things." - Isaac Newton

- **Architecture & Bugfixes:**
  - **WebGL Renderers:** Fixed a console spam issue by throttling `MAX_TEXTURE_IMAGE_UNITS` warnings to only warn once per uniform/unit. Fixed WebGL1 NPOT (non-power-of-two) texture binding by disabling mipmaps and setting `CLAMP_TO_EDGE` wrap modes automatically.

## [0.71.1] - 2026-07-27

### "The most robust algorithm is the one you don't have to write." - Steve Maguire

- **Architecture & Bugfixes:**
  - **Renderer Updates:** Minor fixes and refinements in `WebGL1Renderer`, `WebGL2Renderer`, and the `Standard` GLSL 1.0.0 shader.
  - **Tests:** Updated `ProgramRefCounting` tests to reflect renderer memory management changes.
- **Housekeeping & Docs:**
  - **Docs:** Added a new comprehensive guide (`adding-materials.md`) and updated the VitePress configuration.

## [0.71.0] - 2026-07-27

### "The best preparation for tomorrow is doing your best today." - H. Jackson Brown Jr.

- **Features:**
  - **Renderer Near/Far Planes:** Added support for camera near and far planes across all renderers and shadow passes, and enabled `copyToOpaqueDepthTexture()` in `WebGLMainPass`.
  - **Materials & Shaders:** Introduced `OpenWaterMaterial` with accompanying WGSL and GLSL shaders. Refactored `Glass` and `Standard` shaders for improved lighting and shadow handling.
  - **Math Projections:** Enhanced projection matrix calculations across `Oblique`, `Orthographic`, and `Perspective` projections.
- **Architecture & Bugfixes:**
  - **Refactoring:** Removed the `Singleton` pattern from `CollisionVisualizer` and `OctreeVisualizer`, converting them into standard instantiable classes to comply with engine strictness.
  - **Behaviors:** Improved `HoverBehavior` stability.
- **Housekeeping & Docs:**
  - **Showcases Cleanup:** Removed outdated `script.ts` files across all showcases in favor of a centralized approach, updating `index.html` and `showcase.ts` files accordingly.
  - **Git Optimization:** Removed heavy builds, unit tests, and showcase tests from the local `.husky/pre-commit` hook to dramatically speed up local commit times, shifting this responsibility fully to CI.
  - **Docs & Configs:** Updated `getting-started.md` and cleaned up unused configuration files (`small-world-machine.json`).

## [0.70.2] - 2026-07-27

### "Words are, of course, the most powerful drug used by mankind." - Rudyard Kipling

- **Housekeeping & Docs:**
  - **Memory Management & Materials:** Expanded `README.md` and added comprehensive VitePress documentation guides (`docs/guides/architecture.md`, `docs/guides/materials.md`) covering the new automated GPU resource Reference-Counting and advanced `OpenWaterMaterial` / `captureOpaqueDepth` shader logic.

## [0.70.1] - 2026-07-27

### "A place for everything, and everything in its place." - Benjamin Franklin

- **Architecture & Bugfixes:**
  - **Reference-Counted GPU Resource Disposal:** Implemented per-object reference counting for geometry buffers, shader programs/pipelines, and textures across the WebGL1, WebGL2, and WebGPU renderers, with a `Scene`-level removal queue driving release on object/scene teardown. `RenderTarget`/`RenderTargetCube` are explicitly protected from being destroyed via this path since their lifecycle is independent of any single material reference.
  - **Fallback Cleanup:** Removed a fragile topology-guessing heuristic (`indices.length === 2 ? "line-list" : "triangle-list"`) from the render passes and `Scene`, replaced by an explicit `Topology.DEFAULT` fallback.
- **Housekeeping & Docs:**
  - **Continuous Integration:** Added a GitHub Actions workflow running typecheck/lint/test/build on every push and PR, plus a non-blocking showcase visual smoke-test job.
  - **Magic String/Number Cleanup:** Replaced duplicated raw string literals with existing enum members (`CullMode`, `Topology`, `BlendingMode`, `TextureFilter`, `TextureWrap`) across the renderers and shadow passes.
  - **Enum `DEFAULT` Convention:** Introduced a `DEFAULT` member on the 13 enums that have one real, consistently-used fallback value (`Topology`, `BlendingMode`, `CameraStrategyType`, `CubeLayout`, `CullMode`, `FogMode`, `InputMode`, `OscillatorType`, `ProjectionType`, `RendererType`, `TextureFilter`, `TextureWrap`, `ToneMappingMode`), replacing the repeated concrete literal at every fallback call site.

## [0.70.0] - 2026-07-26

### "Order is the shape upon which beauty depends." - Pearl S. Buck

- **Features:**
  - **Open Water Evolution:** Increased Gerstner wave octaves from 3 to 5 using shader-side derivations for highly organic, irregular water surfaces in `OpenWaterMaterial`.
- **Housekeeping & Docs:**
  - **Strict Scope Expansion:** Added `showcases/**/*` and `tests/**/*` to `tsconfig.json` for strict type checking.
  - **Massive Type Refactoring:** Fixed countless null-assertion errors in tests (`!`), renamed hundreds of private class properties to use a leading underscore `_`, and standardized `AbstractMaterial` typing across all showcases to strictly adhere to engine guidelines.

## [0.69.9] - 2026-07-25

### "To attain knowledge, add things everyday. To attain wisdom, subtract things everyday." - Lao Tzu

- **Housekeeping & Docs:**
  - **Comment Purge:** Executed a massive codebase sweep removing over 300 redundant `/// src/path/to/file.ts` header comments from all TypeScript files to reduce visual noise and improve maintainability.
## [0.69.8] - 2026-07-25

### "A user interface is like a joke. If you have to explain it, it's not that good." - Martin LeBlanc

- **Features:**
  - **Tron Navigation:** Centralized the UI panel for showcase navigation into `AbstractShowcase`, rolling out consistent neon-styled ◀ / ▶ buttons across all showcases.
- **Housekeeping & Docs:**
  - **Showcase Restructuring:** Renamed branching paths (15_v1 and 15_v2) into a linear sequence (15 through 24). Replaced raw `SmallWorldMachine` instantiation with `AbstractShowcase` in later examples to inherit the new UI.
## [0.69.7] - 2026-07-25

### "The details are not the details. They make the design." - Charles Eames

- **Features:**
  - **Standalone Tool Exports:** Exported `MaterialStudioApp` to allow proper independent instantiation of the PBR Map Generator tool without relying on internal `Forge` execution flows.
- **Housekeeping & Docs:**
  - **Strict Linting Compliance:** Resolved trailing syntax warnings and missing explicit types in `GadgetInspector`, `Pixler`, and `AbstractShowcase` to return the engine to 100% strict compliance.
## [0.69.6] - 2026-07-24

### "Out of clutter, find simplicity. From discord, find harmony." - Albert Einstein

- **Features:**
  - **Clean Wireframes:** Refactored geometry generation across all 13 primitives (Cube, Sphere, Cylinder, etc.) to compute purely structural `wireframeIndices`. Unnecessary and distracting quad-diagonals are now removed.
- **Architecture & Bugfixes:**
  - **Strict Topology Enforcement:** Removed legacy `number | string` typing from `RenderBatch.topology` and enforced strict `Topology` string enums (`"triangle-list"`, `"line-list"`).
  - **Renderer Cleanup:** Eradicated magical fallback checks (e.g. `topology === 2`) in WebGL1, WebGL2, WebGPU, and all Shadow Passes.
  - **Dependency Injection:** Enforced `audio` option passing across all controllers (`FPSController`, `OrbitController`, `WASDController`, etc.) to resolve type errors and respect strict DI.
- **Housekeeping & Docs:**
  - **Showcase Navigation:** Fixed looping logic across all showcases (1-23 and yad) to correctly circle back and forth without dead ends.
  - **Agent Guidelines:** Cemented strict rule against unprompted Git commits into the core AI workflow skills.

## [0.69.5] - 2026-07-24

### "Simplicity is the ultimate sophistication." - Leonardo da Vinci

- **Architecture & Bugfixes:**
  - **Zero-Allocation Spatial Partitioning:** Replaced `Map<string, Collidable[]>` in `SpatialHash` with a highly optimized flat array buffer and integer hashing to eliminate dynamic string keys and array instantiation per frame.
  - **Zero-Allocation Octree Node Pooling:** Introduced a static `OctreeNode` pool. Nodes are now recycled on `clear()` and retrieved via `OctreeNode.acquire()` during subdivisions, preventing garbage collector spikes.
  - **Zero-Allocation Render Queries:** Eliminated `.filter()` calls inside the WebGPU shadow passes (`CascadedShadowPassGPU`, `SpotShadowPassGPU`), reusing module-level scratch arrays.
  - **Zero-Allocation Physics Queries:** Core physical sub-systems (`PhysicsSystem`, `FrustumCuller`, `InteractionManager`) and controllers (`EnemyBehavior`, `YadController`) now utilize module-level `outResult` cache arrays instead of creating new Array structures.
  - **Zero-Allocation Render Batching:** Removed the deeply nested `Map<string, Map<string, Object3D[]>>` in `RenderList`, replacing it with a flat `RenderBatch[]` array. This eliminates thousands of temporary iterators (`entries()`, `values()`) per frame across all renderers (WebGL1, WebGL2, WebGPU) and shadow passes, significantly reducing GC pressure.
  - **Transform Math Pooling:** `AbstractGeometry` vertex transformers (`scale`, `rotateX`, etc.) now acquire and release `Matrix4` instances from `MathPool` instead of instantiating new objects.

## [0.69.4] - 2026-07-24

### "The function of good software is to make the complex appear to be simple." - Grady Booch

- **Architecture & Bugfixes:**
  - **Singleton Eradication (Audio & Input):** Removed the final remaining global singletons `Input.instance` and `AudioSystem.instance`.
  - **Dependency Injection Enforcement:** Controllers (`FirstPersonController`, `FPSController`, `YadController`) and Behaviors (`EnemyBehavior`) now strictly require `input` and `audio` dependencies via their constructor options.
  - Refactored `GadgetInspector` to communicate audio changes via native browser `CustomEvent` dispatching (`gadget:audio:master`, etc.) to the `SmallWorldMachine` application context to maintain loose coupling.
- **Housekeeping & Docs:**
  - `custom-game.md` updated to showcase the dependency injection pattern in controllers.
  - `Input.test.ts` updated to remove all Singleton references.

## [0.69.3] - 2026-07-24

### "Read, not to contradict and confute; nor to believe and take for granted; nor to find talk and discourse; but to weigh and consider." - Francis Bacon

- **Architecture & Bugfixes:**
  - **Inversion of Control (IoC) for Configuration:** Removed internal asynchronous loading of `small-world-machine.json` via `fetch`. The engine now accepts configuration synchronously via its constructor (`new SmallWorldMachine(config)`). This removes network waterfalls during startup and improves bundler compatibility.
  - Implemented exact `devicePixelRatio` clamping via `quality.maxPixelRatio` (defaults to 2). Rendering now cleanly handles 3x mobile displays without sacrificing exact resolutions for Retro modes.
  - Enhanced `quality.autoDowngrade` to be optionally toggleable.
- **Housekeeping & Docs:**
  - Added comprehensive `configuration.md` guide and updated README to reflect the new configuration instantiation pattern.
## [0.69.2] - 2026-07-24

### "The secret of change is to focus all of your energy, not on fighting the old, but on building the new." - Socrates

- **Architecture & Bugfixes:**
  - **UniversalEventBus Removal:** Eradicated the global `UniversalEventBus` singleton to strictly enforce the "No Global Singletons" architecture and support proper multi-instancing.
  - **EventBus Injection:** The engine base class (`SmallWorldMachine`) now manages its own local `this.events: EventDispatcherImpl`. This instance is strictly propagated via dependency injection to all subsystems (`PhysicsSystem`), Tools (`Pixler`, `Xtractor`), and Application logic (`YadController`, `YadHud`), ensuring total isolation between engine contexts.
  - Updated documentation (`custom-game.md`, `eventbus.md`) to reflect the new dependency injection pattern.

## [0.69.1] - 2026-07-23

### "In union there is strength." - Aesop

- **Architecture & Bugfixes:**
  - **Physics Broadphase Single Pass:** Merged the historically separate scene-graph traversals (`_collectBodiesRecursive` and `_collectCollidersRecursive`) into a unified `_collectRecursive` loop, collecting both rigidbodies and generic colliders in O(N). Simplifies testing and slightly reduces CPU overhead during the physics `step()`.

## [0.69.0] - 2026-07-22

### "The hardest part of design is keeping features out." - Donald Norman

- **Features:**
  - **Box-OBB Collision:** Implemented Box-OBB detection and resolution logic utilizing a zero-alloc temporary OBB to recycle existing SAT tests without memory overhead.
- **Architecture & Bugfixes:**
  - **WebGL Renderer Pass-System:** Dismantled the monolithic rendering loop from WebGL1/WebGL2 renderers. Ported the modular, composable pass-based architecture (`WebGLRenderPass`, `WebGLMainPass`, `WebGLShadowPass`) to ensure structural symmetry with the WebGPU path. 
  - **UniformPacker Rejection:** Actively rejected the `UniformPacker` in WebGL paths to prevent redundant float array unpack loops and maintain maximum performance on native WebGL calls.
- **Housekeeping & Docs:**
  - Removed outdated prototyping comments for `lavaNoiseMap` in YadApp.
  - Updated `PROJECT_FINDINGS.md` and moved completed findings to the resolved section.

## [0.68.0] - 2026-07-19

### "Progress is not created by contented people." - Frank Tyger

- **Features:**
  - **DeviceOrientationController:** Created a new behavior to translate physical smartphone orientation (`alpha`, `beta`, `gamma` Euler angles) directly into engine `theta`/`phi` polar coordinates, enabling gyroscope/accelerometer-based camera and object rotation.
- **Architecture & Bugfixes:**
  - **DeviceCaps Modernization:** Completely replaced the legacy `DeviceDetector` (User-Agent sniffing) with robust API feature detection inside `DeviceCaps` (Async, Wasm, Workers, Sensors, Touch Media Queries).
  - **Auto-Destroy Lifecycle:** Added `destroy()` logic to `SmallWorldMachine` engine base class. Hooked it to `window.pagehide` and added a DOM detachment check (`!document.body.contains(this.canvas)`) in the `_loop` to automatically free GPU memory and halt RAF when frontend frameworks (React/Vue) destroy the canvas node.


## [0.67.0] - 2026-07-19

### "Where there is much light, the shadow is deep." - Johann Wolfgang von Goethe

- **Features:**
  - **Cascaded Shadow Maps (WebGPU):** Implemented a complete `CascadedShadowPassGPU` supporting directional lights. Resolved command encoder queuing synchronization to correctly record and execute shadow depth textures per cascade.
- **Architecture & Bugfixes:**
  - **Physics Broadphase Implementation:** Replaced the legacy collision loop in `PhysicsSystem` with an Octree-based broadphase filtering approach, including a robust `_broadphaseFallback` for out-of-bounds objects.
  - **WebGPU Shader Fixes:** Fixed WGSL uniform buffer offsets (`cascadeSplits` and `dirShadowInfo`) and ensured shadow-casting passes use a dedicated depth-only shader instead of the full scene lighting shader.
  - Fixed VP corruption bugs in WebGPU shadow matrices and rebuilt global bind groups correctly when shadow textures update.
- **Housekeeping & Docs:**
  - Tracked new research and analysis text files documenting physics broadphase and shadow mapping structures.

## [0.66.0] - 2026-07-19

### "Out of nothing I have created a strange new universe." - János Bolyai

- **Features:**
  - Expanded Showcase 23 (The Shader Gallery) into a fully interactive 3D gallery with dynamic zooming and raycasted screen selection.
  - Moved monitor shader source codes to individual asset files to clean up engine boilerplate.
- **Architecture & Bugfixes:**
  - **Physics Broadphase Optimization:** Replaced the legacy $O(n^2)$ brute-force collision loop in `PhysicsSystem` with an Octree-based spatial partitioning system. Implemented dynamic AABB tracking and O(1) deduplication via Map, vastly improving collision detection performance for scenes with high object counts while consciously accepting acceptable array allocations.
  - Resolved raycaster bounding box logic where `computeBounds()` was not reliably accounting for shifted world matrices during interaction loops.
  - Fixed an issue where WebGL2 contexts assigned inverted shaders to Monitor 2 and Monitor 3.
- **Housekeeping & Docs:**
  - Removed outdated OFF switch from Showcase 23 HTML layout.
  - Added new `Escape` key binding to reset camera behavior states.


## [0.65.0] - 2026-07-19

### "Simplicity is the ultimate sophistication." - Leonardo da Vinci

- **Features:**
  - **Showcase 23 (Shader Gallery Expansion):** Doubled the gallery to 6 screens per API. New WebGL2 examples: a comic/toon-shaded raymarched creature (cel-shading bands, grazing-angle ink outline, halftone shadow dots), a Voronoi stained-glass mosaic, and a procedural retro CRT/ASCII terminal. New WebGPU examples: a toon-shaded spinning raymarched toy, a hex-grid sci-fi hologram, and a Matrix-style digital rain.
- **Architecture & Bugfixes:**
  - **PhysicsSystem Memory Leak:** Fixed the rotation-integration branch leaking 4 pooled vectors per frame for bodies with angular velocity; all `MathPool` vectors acquired during `compose`/`decompose` are now correctly released, restoring the true zero-allocation guarantee.
  - **WGSL Reserved Keywords:** Fixed two shader-creation errors in the new Showcase 23 compute shaders caused by using `target` and `active` as identifiers — both are reserved words in the WGSL spec.
  - **`small-world-machine/tools` Barrel Exports:** Added the missing `Forge`, `ForgeTool`, `Xtractor`, and `MapGenerator` exports to `src/tools/index.ts`.
- **Housekeeping & Docs:**
  - **Documentation Accuracy Audit:** Cross-checked all 10 files in `docs/guides/` against the actual source. Corrected references to a non-existent `Application` class (use `SmallWorldMachine`), fabricated `GlassMaterial`/`GridLevelBuilder` API options, a wrong `FPSController` option name, a sign error in the look-direction formula, an overstated Octree complexity claim, and clarified that the `small-world-machine/tools` subpath isn't a resolvable package export yet.
  - **Commit Convention:** `AGENTS.md` now explicitly forbids reusing a commit-message quote already present in `git log`.

## [0.64.0] - 2026-07-18

### "Out of clutter, find simplicity." - Albert Einstein

- **Features:**
  - None
- **Architecture & Bugfixes:**
  - **Tool UI Refactor:** Removed the legacy `Forge` taskbar architecture from `Pixler` and `MapGenerator`. All tools now instantiate directly as full-screen native apps in `.container` divs, resulting in a cleaner and 100% unified tool experience.
  - **Xtractor Rename:** Officially renamed `IXtractor` to `Xtractor` across all files, classes, and routing paths.
  - **App Footer Overlap Fix:** Added a `:has(.tool-header)` CSS selector to switch `.app-footer` from `fixed` to `relative` only on tool pages. This ensures the footer dynamically sits at the bottom of the flex layout instead of covering tool UI elements.
  - **Splatter-Gen Layout Fix:** Removed the hardcoded `calc(100vh - 75px)` height from `splatter-gen.html`'s `.app-container` and added `overflow: hidden`, allowing the footer to render correctly at the bottom of the layout.
  - **Renderer Safety:** Added `DeviceCaps` checks inside `RendererFactory` to enforce safe fallbacks from WebGPU to WebGL2, mitigating crashes on unsupported hardware.
- **Housekeeping & Docs:**
  - **Mobile Responsive Showcases:** Overhauled `public/index.html` and `public/assets/shared.css` with unified grid styles and `@media (max-width: 768px)` queries. Headers, example navigation, and grids now scale correctly on mobile devices without relying on inline CSS overrides.
  - **Xtractor AI Mock:** Added a clear, explicit `@DEVELOPER_NOTE` JSDoc in `Xtractor.ts` to document that the "AI chat" is currently a hardcoded regex mock, preventing confusion for future developers looking for a backend API connection.
  - **Hardware Diagnostics:** `DeviceDetector` and `DeviceCaps` now log extended hardware capabilities (cores, resolution, device type) into the console banner at engine startup.

## [0.63.0] - 2026-07-18

### "Pure mathematics is, in its way, the poetry of logical ideas." - Albert Einstein

- **Features:**
  - **Showcase 23 (Shader Gallery):** Deployed a robust multi-API shader gallery featuring three advanced WebGPU compute shaders (Kishimisu's Neon Fractal, Inigo Quilez's SDF Raymarching, and a Retro Synthwave grid).
  - **Showcase 1 (Basic Engine Setup):** Enabled `CameraStrategyType.SMOOTH` and attached an `OrbitController` to provide out-of-the-box user navigation instead of a rigidly fixed camera.
- **Architecture & Bugfixes:**
  - **CustomShaderMaterial Framework:** Introduced a massive architectural leap with `CustomShaderMaterial`, allowing raw, highly customized GLSL/WGSL shaders to seamlessly integrate into the engine's rendering pipeline.
  - **Universal Shader Importers:** Engineered the `ShadertoyImporter`, `GLSLSandboxImporter`, and `ComputeToysImporter`. These robust adapters instantly translate and inject external shader code from popular platforms into our internal material system without requiring manual syntax conversions.
  - **ExternalShaderUniformBehavior:** Developed a dedicated behavior system to automatically bind dynamic uniform data (like `iTime`, `iResolution`, `custom.time`, `custom.resolution`) required by imported external shaders.
  - **WGSL Compilation Error Logging:** Integrated `getCompilationInfo()` into `WebGPURenderer.ts` to surface hidden pipeline creation failures and syntax errors (e.g. reserved keywords) directly to the browser console.
  - **ComputeToysImporter UV Resolution:** Fixed a critical Y-axis inversion and screen-space UV mapping bug where compute shaders incorrectly evaluated global screen coordinates instead of the local 3D billboard geometry coordinates.
  - **Collision Resolution (Deslop):** Fixed `TypeError: Cannot read properties of undefined (reading 'x')` in `FPSController`, `FirstPersonController`, and `EnemyBehavior` by explicitly branching on `obj.bounds.type` (SPHERE vs BOX) before resolving collisions.
  - **Showcase 23 Layout:** Added the standard layout template (Navigation, Header, Footer) to Showcase 23 to match the rest of the application.
- **Housekeeping & Docs:**
  - **DeviceCaps & Telemetry:** Enhanced the engine initialization banner. `DeviceDetector` and `DeviceCaps` now log the device type, performance tier, active GPU model (`WEBGL_debug_renderer_info`), CPU core count, and memory limit directly into the console table.
  - **AI Deslopping:** Audited and cleaned up redundant AI-generated slop (unnecessary `try/catch` blocks around engine startup, overzealous defensive logs, and duplicate `_logTimer` fields) across Showcases 22 and 23.
  - **Testing Infrastructure:** Successfully implemented and verified `scripts/check-showcases.js` using Puppeteer. All showcases now run flawlessly in CI without errors.
  - **REFERENCES.md:** Added a new "Shaders & Procedural Art" section to officially credit Kali, Kishimisu, and Inigo Quilez for their foundational shader mathematics.

## [0.60.2] - 2026-07-17

### "There are two hard things in computer science: cache invalidation, naming things, and off-by-one errors." - Phil Karlton

- **Architecture & Bugfixes:**
  - `Scene` now uses an internal `root: Object3D` node to manage its hierarchy. This resolves the architectural bug where objects could exist simultaneously in `scene.objects` and as a child of another `Object3D` group, causing them to be updated/rendered twice. `scene.objects` is now a safe getter returning `scene.root.children`.

## [0.60.1] - 2026-07-17

### "Talk is cheap. Show me the code." - Linus Torvalds

- **Architecture & Bugfixes:**
  - Physics system now collects dynamic rigidbodies and static colliders recursively. Complex objects (e.g. cars with child wheels) are now processed correctly.

## [0.60.0] - 2026-07-17

### "There is nothing more deceptive than an obvious fact." - Arthur Conan Doyle

- **Features:**
  - **Start Portal (Showcase 22):** Added a beautiful, glowing Sci-Fi Hexagon portal as a start trigger.
  - **Invisible Hitboxes (Best Practice):** Implemented an invisible `Cube` without a material to act as a pure, zero-draw-call collision body for the Start Portal. This resolves raycast flickering (jittering) that occurred when hovering over the hollow Torus shape.
  - **Physics Regression Tests:** Added strict test cases for the `NaN` crash bug and sphere-vs-box tunneling to the Vitest suite.
- **Architecture & Bugfixes:**
  - **Zombie Bounds Physics Crash:** Fixed a critical issue where `Object3D.computeBounds()` would implicitly recreate bounds for objects (like visual drone trails) that were explicitly stripped of them. This caused thousands of ghost hitboxes to spawn at `(0,0,0)`, overloading the collision resolver and causing `NaN` physics states and tunneling.
  - **Drone Collisions:** Drones and trails now override `computeBounds()` with an empty function to guarantee they never participate in the physics engine.
  - **NaN Restitution Safety:** Safeguarded the `PhysicsSystem.step()` logic to handle restitution correctly even if one of the colliding objects lacks a `RigidBody`.

## [0.59.0] - 2026-07-16

### "I am a brain, Watson. The rest of me is a mere appendix." - Sherlock Holmes

- **Features:**
  - **Showcase 22 (Drone Swarm):** Implemented a rigorous 120-drone swarming simulation spawning symmetrically from 4 outer corners (`+/- 34.0`) and converging organically toward the center.
  - Replaced ad-hoc coordinate sign flips with an elegant `Round-Robin` math logic to strictly manage quad-directional symmetric corner allocations.
- **Architecture & Bugfixes:**
  - **Collision Broadphase Optimization:** Solved a critical ghost-collision bug where 2400 pre-allocated, invisible `DroneTrail` objects artificially triggered PhysicsSystem impulses. The broadphase now strictly ignores `obj.isVisible === false` objects, granting a massive performance boost.
  - **High-Velocity Tunneling Fixed:** Prevented the dynamic `Marble` from tunneling through the floor at high frame-deltas by correctly recalculating and expanding the static floor's physical `Y`-depth to 10.0 units, without modifying its visual rendering surface.

## [0.58.0] - 2026-07-16

### "Always code as if the guy who ends up maintaining your code will be a violent psychopath who knows where you live." - John Woods

- **Housekeeping & Docs:**
  - Resolved GC memory leaks in the hot paths (`PhysicsSystem.step()`) ensuring absolute Zero-Allocation guarantees.
  - Switched internal `bodies` and `allColliders` arrays in physics resolution to be strictly pre-allocated and reused every frame.
  - Replaced ad-hoc object literals for `UniversalEventBus` collision events with a strictly reused instance object to eliminate garbage collection pressure completely.
  - Introduced `tests/physix/ZeroAllocation.test.ts` to mathematically guarantee zero math-pool leakage and strict array re-use during physics simulation.
  - Confirmed 100% test coverage integrity with 161 passing tests, flawless compilation, and zero `any` TypeScript violations.

## [0.57.0] - 2026-07-13

### "Programs must be written for people to read, and only incidentally for machines to execute." - Harold Abelson

- **Features:**
  - **Showcase 21 (Supermassive Black Hole):** Created a new interactive showcase demonstrating extreme gravity and physical accretion disks.
  - Added a procedural, ultra-dense glowing Accretion Disk simulated via 400 overlapping inelastic rigid bodies spiraling toward the singularity.
  - Implemented **Gravitational Lensing** in both WGSL and GLSL post-processing shaders, accurately calculating the aspect-ratio-corrected Einstein Ring and light-bending distortions caused by the event horizon.
  - Added Event Horizon masking to ensure absolute zero light emission from the singularity center.
  - Implemented a procedural Gaussian White Noise generator via Box-Muller transform in `AudioSystem.startDrone()`.
  - Upgraded the drone to a full **Cinematic Deep Space Ambient** generator:
        - Added a massive 42Hz Sub-bass rumble to simulate the gravitational weight of the singularity.
        - Added a ghostly, atonal sine-wave choir (minor 9th cluster) to evoke cosmic isolation.
        - Modulated the Gaussian noise through a 250Hz lowpass filter with a 20-second LFO to create a "breathing" stellar wind effect.
- **Housekeeping & Docs:**
  - Updated `REFERENCES.md` to formally credit Dr. Katie Bouman and Dr. Sara Issaoun for their groundbreaking work on the Event Horizon Telescope and the first visual proofs of black holes.

## [0.56.0] - 2026-07-13

### "Any fool can write code that a computer can understand. Good programmers write code that humans can understand." - Martin Fowler

- **Features:**
  - Created a dynamic, physics-based Galton Board / Plinko machine using the new physics engine.
  - Implemented event-driven generative audio: objects emit pentatonic synth notes based on collision impulses (`physics:collision` events) and vertical position.
  - Showcased advanced materials with refractive glass pegs and glowing/flashing cyber-pink emissive spheres.
- **Architecture & Bugfixes:**
  - Fixed a critical physics bug where extreme damping (`friction = 0.1`) caused RigidBodies to lose 90% of their velocity per frame, leading to extreme slow-motion falling and negligible collision impulses.
  - Restored the missing `PhysicsSystem.instance` instantiation and `step()` loop in `Showcase20` to properly drive gravitational and collision physics.
  - Fixed an undefined property crash (`lerp` on `emissive`) by manually implementing RGB interpolation for hit-flash cooling effects.
- **Housekeeping & Docs:**
  - Introduced **Object Pooling** (`_spherePool`) in `Showcase20` to prevent real-time `StandardMaterial` instantiations, completely eliminating WebGPU shader recompilation stuttering during the simulation loop.
  - Reduced dynamic object count in showcases to drastically improve `O(N^2)` collision detection performance.
  - Disabled the `GadgetInspector` by default (`enableInspector: false` in `SmallWorldMachine` base class) to prevent unnecessary background overhead and unwanted asset loading (e.g. `rock.png`) in simple showcases.

## [0.55.0] - 2026-07-13

### "Truth can only be found in one place: the code." - Robert C. Martin

- **Features:**
  - Introduced a completely custom, impulse-based physics engine integrated directly into `PhysicsSystem`, utilizing a **Semi-Implicit Euler** integration loop.
  - Implemented `RigidBody` component for managing linear and angular dynamics (`velocity`, `force`, `torque`, `inertia`, `friction`, `angularDamping`).
  - Added support for perfectly elastic and inelastic collisions via the `restitution` property.
  - Introduced exact rotation mapping between `Quaternion` physics states and `Euler` angles for `Object3D` sync.
  - Transitioned from simple overlap tests to full **Separating Axis Theorem (SAT)** resolution.
  - Implemented `Collision.resolveSphereBox` and `Collision.resolveSphereSphere` to calculate exact correction vectors.
  - Added **Positional Correction** based on inverse mass ratios to prevent objects from sinking into each other.
  - Added **Impulse Resolution** to simulate realistic bouncing and momentum transfer between dynamic and static bodies.
- **Architecture & Bugfixes:**
  - Enforced strict `@typescript-eslint/no-explicit-any` checks across the entire codebase to maintain absolute type safety.
  - Refactored `AbstractWebGLRenderer`, `WebGL1Renderer`, and `WebGL2Renderer` to correctly use `_`-prefixed protected variables (`_gl`, `_defaultTexture`, etc.) adhering strictly to internal engine coding standards.
  - Expanded unit test coverage in `tests/physix/` with 150+ tests covering extreme math edge cases (negative mass/inertia, tunneling, $dt \le 0$ safety).
- **Housekeeping & Docs:**
  - Expanded `REFERENCES.md` to credit pioneering physicists and collision detection researchers (including Jessica Hodgins, Ming C. Lin, and Nadia Magnenat Thalmann).
  - Wrote a comprehensive `physics.md` guide for VitePress explaining the internal math and usage of the physics system.
  - Updated `README.md` to reflect the new physics capabilities.

## [0.54.0] - 2026-07-10

### "First, solve the problem. Then, write the code." - John Johnson

- **Features:**
  - Implemented `SpatialHash` for O(1) grid-based collision broad-phase checks, highly optimized for large grid maps (like YAD).
  - Refactored `Object3D` to implement the new lightweight `Collidable` interface instead of relying on heavy inheritance for physics.
  - Introduced `StaticCollider`, a minimal `Collidable` object, preventing massive `Object3D` overhead when building static walls in maps.
  - Updated `Octree`, `FPSController`, `EnemyBehavior`, and `InteractionManager` to seamlessly query the new `SpatialHash`.
- **Architecture & Bugfixes:**
  - Replaced the old "I"-prefixed interface (`ICollidable` -> `Collidable`) to match modern TypeScript guidelines.
  - Implemented `TextureArray` capabilities directly into the engine, allowing `YadLevelBuilder` to render entire levels in a single draw call via `InstancedMesh`.
  - Removed outdated global `events` drilling.
- **Housekeeping & Docs:**
  - Established a new brand color: **Cyber Purple** (`#B000FF`).
  - Updated the developer console welcome banner to reflect the new Cyber Purple brand identity.
  - Upgraded global CSS variables and Forge UI themes to match the new engine aesthetic.

## [0.53.0] - 2026-07-10

### "Experience is the name everyone gives to their mistakes." - Oscar Wilde

- **Features:**
  - Added a new Toolbar UI using lightweight emojis instead of external icon libraries.
  - Implemented an Active Color Indicator in the palette.
  - Added a "Trim" button to automatically crop the canvas to its non-background pixels.
  - Added a Bucket Fill (Flood Fill) tool for quickly filling enclosed areas (`F`).
  - Added a Color Picker (Eyedropper) tool (`I`), also accessible via `Alt+Click`.
  - Added a Line Tool (`L`) for drawing straight lines, also accessible by pressing `Shift+Click`.
  - Added Symmetry Mode (X and Y axis) for drawing symmetrical sprites or tiles.
  - Added Panning capability with wrapping by using `Shift + Arrow Keys`.
  - Added Flipping (Mirroring) capability horizontally and vertically by using `Shift + Cmd + Arrow Keys`.
  - Added Undo and Redo functionality with full history support (`Cmd+Z` / `Cmd+Shift+Z`).
- **Architecture & Bugfixes:**
  - Resolved `[INEFFECTIVE_DYNAMIC_IMPORT]` Vite warnings across `YadLevelBuilder`, `CubeTexture`, `Texture`, and `TextureArray` by replacing ineffective dynamic imports with standard static imports.

## [0.52.0] - 2026-07-10

### "In order to be irreplaceable, one must always be different." - Coco Chanel

- **Architecture & Bugfixes:**
  - Removed "prop-drilling" of the core `EventDispatcher` through deeply nested constructors (e.g. `FirstPersonControllerOptions`, `ForgeToolOptions`).
  - Introduced `UniversalEventBus`, a globally exported singleton instance of `EventDispatcherImpl` residing in `src/core/events`.
  - Replaced all legacy `this.events` and `this._options.events` usages in `YadController`, `YadHud`, `IXtractor`, and `Pixler` with direct `UniversalEventBus` imports.
  - Eliminated the `events` property from the `SmallWorldMachine` base class entirely to enforce the pure "1 Engine Instance per Page" architecture.
- **Housekeeping & Docs:**
  - Rewrote the EventBus guide (`eventbus.md`) to reflect the new `UniversalEventBus` singleton pattern.
  - Added "Universal Singletons" to the official engine architectural patterns in `AGENTS.md`.

## [0.51.0] - 2026-07-10

### "Java is to JavaScript what car is to Carpet." - Chris Heilmann

- **Features:**
  - Added support for generating PBR maps directly from clipboard images via `Cmd+V` or `Ctrl+V`.
  - Implemented one-click texture downloads by clicking directly on the 2D map preview.
  - Improved UI layout: the preview canvases are now consistently aligned to the top.
  - Irrelevant parameters in the sidebar are now automatically hidden when a specific texture map is active.
- **Architecture & Bugfixes:**
  - Prevented window bounding boxes from being dragged or resized above the visible browser viewport, eliminating the risk of unreachable title bars.
  - Corrected custom tile parsing logic so that custom sprites no longer erroneously block floor and ceiling generation on the same tile.
  - Consolidated redundant import statements across all source files via a new `import/no-duplicates` ESLint rule.
  - Improved strict TypeScript typings in `MaterialStudio` and resolved outstanding pre-commit hook ESLint errors.

## [0.50.0] - 2026-07-09

### "Knowledge is power." - Francis Bacon

- **Architecture & Bugfixes:**
  - Consolidated and extracted inline CSS styles from all Forge tools (`IXtractor`, `MapGenerator`, `Pixler`, `GadgetInspector`) into a central `ForgeTheme.ts`.
  - Upgraded the `Forge` window manager with a modern, high-fidelity **Glassmorphism** aesthetic using dynamic blur (`backdrop-filter`), neon borders, and drop shadows.
  - Eliminated global CSS bleeding by scoping all tool elements to specific namespaces (`.swf-ix-*`, `.swf-btn`, etc.).
- **Housekeeping & Docs:**
  - Expanded `custom-game.md` to reference the **YAD (Yet Another Dungeon)** showcase as the canonical example for custom controllers, finite state machines, and decoupled UI integration.
  - Updated `eventbus.md` to formally document and encourage the use of strongly-typed `as const` object registries (`AppEvents`, `ToolEvents`) over magic strings.
  - Added the powerful `GadgetInspector` to the list of official tools in `forge.md`.

## [0.49.0] - 2026-07-09

### "Sometimes it pays to stay in bed on Monday, rather than spending the rest of the week debugging Monday's code." - Dan Salomon

- **Features:**
  - Added pickups for armor, health, and weapons in the YAD showcase with corresponding HUD logic and UI flashes.
  - Integrated the **Forge**, an extensible in-game window manager and developer overlay.
  - Added new visual utilities: `Pixler` (in-game sprite editor), `IXtractor` (asset extractor/cropper), and `MapGenerator` (grid map painter).
  - Minor type and ESLint cleanups across all tool classes.
- **Architecture & Bugfixes:**
  - Abstracted the core logic of the Dungeon clone showcase (YAD) into a reusable `GridLevelBuilder` extension, genericizing ASCII-based level map generation.
  - Extracted the FPS-style logic out of `YadController` and introduced a dedicated `FirstPersonController` inside the engine core (`src/core/behaviors`), promoting reuse for custom FPS or adventure games.
  - Implemented a unified `EventBus` (`EventDispatcherImpl`) injected globally into `SmallWorldMachine` instances as `this.events`. Removed direct `window.addEventListener` and DOM-coupled custom events, fully separating the UI, gameloop, and game behaviors.

## [0.48.0] - 2026-07-08

### "Perfection is achieved not when there is nothing more to add, but rather when there is nothing more to take away." - Antoine de Saint-Exupery

- **Architecture & Bugfixes:**
  - Enforced strict Barrel-File (`index.ts`) architecture across all `src/` subdirectories.
  - Resolved massive circular dependencies that broke class inheritance (`TypeError: Class extends value undefined is not a constructor or null`) during Vite/Rollup initialization by migrating `export *` statements to Named Exports (`export { ClassName }`) for critical base classes.
  - Re-routed internal imports for base classes (`AbstractRenderer`, `AbstractWebGLRenderer`, `AbstractLight`) to use direct file references (`./AbstractRenderer.js`), fully breaking evaluation loops involving `PostProcessingGroup` and `Scene`.
  - Reorganized renderer architecture, moving backend-specific components cleanly into `WebGL1/`, `WebGL2/`, and `WebGPU/` directories.
  - Standardized TS file headers (`/// src/path/to/file.ts`) across the entire repository.

## [0.47.0] - 2026-07-08

### "Ruby is rubbish! PHP is phpantastic!" - Nikita Popov

- **Features:**
  - Added a complete "Yet Another Dungeon" (YAD) clone showcase featuring an advanced `YadLevelBuilder`, `YadController`, and raycasted `EnemyBehavior`.
  - Upgraded the rudimentary `AudioSystem` with a complete Audio Mixer (Master, Music, SFX channels).
  - Implemented procedural Reverb (ConvolverNode with procedurally decaying white noise impulse response) for dungeon atmosphere, eliminating external asset dependencies.
  - Routed existing procedural synthesizers (`startFire`, `playFootstep`, `playShoot`, `playHurt`) to the SFX channel and `startDrone` to the Music channel.
- **Housekeeping & Docs:**
  - Added formal documentation for `AudioSystem` and recent application behaviors (`EnemyBehavior`, `YadController`, `BobbingBehavior`) to the `README.md`.

## [0.46.2] - 2026-07-05

### "Code is like humor. When you have to explain it, it’s bad." - Cory House

- **Features:**
  - Implemented a rigorous `DeviceDetector` that calculates a device `PerformanceTier` based on experimental navigator features (`hardwareConcurrency`, `deviceMemory`, `navigator.gpu`) and thermal throttling estimates. Mobile devices are now aggressively down-scaled (Bloom off, HDR off, 0 MSAA, 512px Shadows) to guarantee 60fps on smartphone GPUs.
  - Added a global toggle switch `disableTextures` inside the `Renderer Settings` folder, which overrides rendering on all backends (WebGL1/2, WebGPU) with a 1x1 fallback texture to visually debug geometry and lighting instantly.
- **Architecture & Bugfixes:**
  - Changed `drop_console` to `false` in the Terser minification config. `console.log` statements are now properly preserved in production, ensuring engine initialization logs and performance tier reports are visible in deployed builds.
  - Fixed a 404 error when loading `small-world-machine.json` on GitHub Pages by adapting the fetch logic to first probe the correct repository sub-path (`/small-world-machine/config/small-world-machine.json`) before falling back to local domain root.
  - Responsive design logic injected into the showcase templates. Navigation UI automatically scales down and drops verbose text labels on smartphones (`max-width: 768px`), leaving only arrows and improving viewport clarity.

## [0.46.1] - 2026-07-05

### "Fix the cause, not the symptom." - Steve Maguire

- **CI/CD & Housekeeping**: Upgraded GitHub Actions workflow dependencies (`checkout@v7`, `setup-node@v6`, `configure-pages@v6`, `deploy-pages@v5`, `upload-pages-artifact@v5`) to their latest major versions. This completely resolves the Node 20 deprecation warnings on GitHub Actions runners during documentation deployment.

## [0.46.0] - 2026-07-05

### "Optimism is an occupational hazard of programming: feedback is the treatment." - Kent Beck

- **Housekeeping & Docs:**
  - **TypeScript Strictness**: Enforced explicit `: void` return types on all Arrow Functions across showcases, examples, and tools (`showcase.ts`, `ibl-gen.ts`, tests) to perfectly align with engine coding guidelines.
  - **WebGPU Shader Optimization**: Eradicated dynamic branching (`if / else if`) inside the `PostProcess.frag.wgsl` pipeline. Migrated parameters from mutable `LocalUniforms` structs back to globally evaluated compile-time `const` flags (`u_filterMode`, `u_vignetteEnabled`, etc.), ensuring absolute dead-code elimination by the shader compiler. This ensures massive performance gains on the GPU for branch-free pipeline execution.

## [0.45.0] - 2026-07-04

### "When to use iterative development? You should use iterative development only on projects that you want to succeed." - Martin Fowler

- **Features:**
  - Officially published the engine under the permissive MIT License. Added a `LICENSE` file and updated the `package.json` license metadata.
  - Replaced 1px `WireframeMaterial` grids with a dynamically generated procedural Canvas texture on a `Plane` geometry using `BasicMaterial` in Showcase 19, eliminating Moiré aliasing and enabling true physical HDR Bloom for Tron-like aesthetics without PBR tone mapping interference.
- **Architecture & Bugfixes:**
  - Fixed a critical bug in the core engine where `StandardMaterial` defaulted `u_texRepeat` and `u_texOffset` to `[1, 1]` if a `diffuseMap` was missing, even when other maps (like `emissiveMap` or `normalMap`) were present and configured with custom UV repeating.

## [0.44.0] - 2026-07-04

### "Simplicity is the soul of efficiency." - Austin Freeman

- **Features:**
  - **InteractionManager**: Added a built-in interaction layer to `SmallWorldMachine` that listens to mouse and touch events and projects them into the 3D scene.
  - **Object Events**: `Object3D` now natively supports `onPointerEnter`, `onPointerLeave`, `onPointerClick`, `onPointerDown`, `onPointerUp`, and `onPointerMove`.
  - **Behaviors**: Introduced `HoverBehavior` (scales and emits neon glow on hover) and `DraggableBehavior` (allows free 3D drag & drop aligned with the camera's viewing plane).
  - **Octree Acceleration**: Integrated $O(\log n)$ Raycasting via the engine's `Octree`. The `InteractionManager` will automatically use the `staticOctree` and `dynamicOctree` if present to skip thousands of intersections.
  - **Pixel-Perfect Picking (Möller-Trumbore)**: Upgraded `Raycaster.ts` to perform a hybrid intersection strategy. After passing the AABB check, it performs mathematically precise Möller-Trumbore ray-triangle intersections against the object's geometry, allowing selection of exact pixels, irregular meshes, and holes.
  - **Performance Optimization**: Extracted local bounding box caching into `AbstractGeometry` and optimized `Object3D.computeBounds()` to be zero-allocation (reusing instances), preventing GC freezes in scenes with thousands of moving objects.

## [0.43.0] - 2026-07-03

### "Before software can be reusable it first has to be usable." - Ralph Johnson

- **Features:**
  - Added a new browser-based tool (`public/tools/ibl-gen.html`, `src/tools/ibl-gen.ts`, `src/tools/IBLShaders.ts`) for real-time client-side generation of PBR Environment Maps (Irradiance/Radiance).
- **Architecture & Bugfixes:**
  - Moved interactive examples from `src/showcases` to the root `showcases/` directory and restructured them into dedicated folders.
  - Migrated static engine assets (models, textures, levels, etc.) from `public/resources/` to `public/engine/`.
  - Moved shader files from `public/resources/shaders/` directly into the core source tree (`src/core/renderers/shaders/source/`) to allow better code bundling.

## [0.42.2] - 2026-07-02

### "Make it work, make it right, make it fast." - Kent Beck

- **Features:**
  - Added `RenderTargetCube` and `DynamicReflectionProbe` for real-time cube map rendering.
  - Implemented Time-Slicing logic to update one cube face per frame, drastically reducing CPU/GPU overhead.
  - Extended `WebGL2Renderer` (`WebGL2CubeFrameBuffer`) and `WebGPURenderer` to natively support dynamic CubeMap Array-Layer rendering via `Renderer.setRenderTarget(target, activeCubeFace)`.
  - Upgraded Showcase 15 with dynamic reflections on the large spheres.

## [0.42.1] - 2026-07-02

### "Clean code always looks like it was written by someone who cares." - Robert C. Martin

- **Terrain WGSL Fix**: Fixed an issue in `Terrain.frag.wgsl` where `thresholds.w` was incorrectly used as a hard upper bound instead of the softness blend width for the `smoothstep` transition. Restored slope blending for rock textures on steep surfaces.
- **Engine Capabilities Logging**: Added a nice startup banner to `SmallWorldMachine.ts` which prints the engine version, active renderer, and full hardware capabilities via `console.table`.
- **GadgetInspector**: Integrated a comprehensive "Capabilities" folder in the Tweakpane UI overlay (`CMD+ALT+G`) to view device capability limits live across all examples.

## [0.42.0] - 2026-07-02

### "Of course bad code can be cleaned up. But it’s very expensive." - Robert C. Martin

- **Architecture & Bugfixes:**
  - Fixed a major Vite configuration issue where production builds (`npm run start`) served unprocessed, unbundled HTML files due to `publicDir` copying conflicts. Added a script step (`cp -a dist/public/. dist/ && rm -rf dist/public`) to properly merge and overwrite raw assets with processed bundles.
  - Corrected the `ProceduralTerrain` mesh generation loop in Showcase 17 to instantiate an `Object3D` node instead of `Mesh`.
  - Switched from a non-existent `GeometryData` constructor to `ModelGeometry` for passing Float32Arrays safely to the GPU.

## [0.41.0] - 2026-07-01

### "Programming isn't about what you know; it's about what you can figure out." - Chris Pine

- **Features:**
  - Implemented a generalized `ThreadPool` utility (`src/core/threading/ThreadPool.ts`) allowing dynamic, non-blocking execution of heavy logic without bundler configuration by using Blob URLs.
  - Added `Showcase 16` to showcasesnstrate `ThreadPool` usage against a blocked main thread.
  - Fixed a syntax error during `ThreadPool` execution by building a robust object-wrapping deserializer fallback for ES6 class method stringifications.
  - Overhauled the central `index.html` dashboard, HTML Slides Presentation (`presentation.html`), and `examples.css` with a high-fidelity "Tron: Legacy" aesthetic, featuring glassmorphism, neon glows (`#00e5ff`, `#ff6600`), and the `Rajdhani` font.
  - Translated all UI navigation labels across all 18 HTML examples to English.

## [0.40.0] - 2026-07-01

### "The only way to learn a new programming language is by writing programs in it." - Dennis Ritchie

- **Features:**
  - Implemented VitePress for developer guides and tutorials under `/docs`.
  - Added automated API extraction via TypeDoc to `docs/public/api`.
  - Authored a comprehensive Architecture Overview and translated all concepts (`getting-started`, `coordinate-system`, `state-machines`, `REFERENCES.md`) to English.
- **Housekeeping & Docs:**
  - Added file headers (`/// src/path/to/file.ts`) to 18 files.
  - Standardized all relative ES module imports to use explicit `.js` extensions across the codebase for runtime resolution.
  - Fixed strict TypeScript issues (e.g. `any` casting in `pbr-preview.ts` by declaring a strict global `Window` interface, fixing `?raw.js` imports, and correcting `Camera` vs `CameraInterfaceData` assignments).
  - Standardized the UI and Navigation for all 17 interactive examples in `public/showcases/*.html` using a centralized, sleek layout in `examples.css`.

## [0.39.0] - 2026-07-01

### "Testing leads to failure, and failure leads to understanding." - Burt Rutan

- **Features:**
  - Created `PerspectiveProjection.test.ts` to mathematically guarantee scale factors (proving radians are expected and avoiding FOV distortions).
  - Extended `ShaderAssembly.test.ts` to statically analyze assembled WGSL source strings and catch duplicate global `var` and `@binding` declarations in WebGPU pipelines.
  - Implemented `showcase15_v1` with 1000 bouncing instanced rubber balls inside the mirror room.
  - Implemented `showcase15_v2` with rotating moons around perfectly reflective mirror planets.
- **Architecture & Bugfixes:**
  - Increased `EventEmitter.defaultMaxListeners` in `vite.config.ts` to prevent warning/crashes when multiple Vite examples trigger hot reloads simultaneously.
  - Fixed FOV calculation in `DynamicReflectionProbe` (`fov: Math.PI / 2`) by using correct radian conversion instead of degrees. This fixed incorrect culling / frustum rendering anomalies in dynamic cube maps.
  - Removed duplicate global uniform variable declarations (`u_color`, `u_normalMap`, `u_extraParams`, etc.) from `Glass.frag.wgsl`, `Glass.frag.glsl`, and `Glass.frag.glsl100` that conflicted with injected base header chunks, causing `Invalid RenderPipeline` state in WebGPU.

## [0.38.1] - 2026-06-25

### "The most disastrous thing that you can ever learn is your first programming language." - Alan Kay

- **Features:**
  - Implemented `InstancedMesh` class in [InstancedMesh.ts](src/core/InstancedMesh.ts) to manage instance counts and dynamic transform matrices.
  - Added support in [WebGL2Renderer.ts](src/renderers/WebGL2Renderer.ts) for dynamically compiling instanced shader variants using `#define USE_INSTANCING 1` and rendering via `gl.drawElementsInstanced`/`gl.drawArraysInstanced` with vertex divisor attributes.
  - Added support in [WebGPURenderer.ts](src/renderers/WebGPURenderer.ts) for dynamically rewriting WGSL vertex shader sources to include instanced layouts and rendering via `rp.drawIndexed`/`rp.draw` with an instance count parameter.
  - Added full unit test coverage in [InstancedMesh.test.ts](tests/core/InstancedMesh.test.ts) to verify matrix initialization, indexing, and dirty flagging.

## [0.38.0] - 2026-06-24

### "It’s not a bug – it’s an undocumented feature." - Anonymous

- **Features:**
  - Implemented a fully generic, type-safe, and zero-allocation `StateMachine` class in [StateMachine.ts](src/core/fsm/StateMachine.ts).
  - Added support for state configs defining custom `onEnter`, `onUpdate`, and `onExit` lifecycle callbacks, auto-transitions based on elapsed state duration, and event-based transitions mapped to events.
  - Implemented the `StateMachineBehavior` component in [StateMachineBehavior.ts](src/core/behaviors/StateMachineBehavior.ts) to seamlessly integrate state machines into the engine's standard update tick loop (`Scene.update()`).
  - Added full test coverage for the FSM framework in [StateMachine.test.ts](tests/core/fsm/StateMachine.test.ts) verifying event transitions, update ticks, auto-transitions, and `StateMachineBehavior` operation.
- **Architecture & Bugfixes:**
  - Refactored [showcase15.ts](src/showcases/showcase15.ts) to decouple physics, collision detection, and lifecycle states from the monolithic example update loop.
  - Attached a `StateMachineBehavior` to each bouncing ball, managing `"active" | "falling" | "exploding"` states and updating them natively within the engine's recursive behavior tick.
  - Moved initial ball positioning, restitution velocity resets, and dissolution scales into corresponding state enter/update lifecycle callbacks, leaving the example's update loop clean and modular.

## [0.37.0] - 2026-06-24

### "Software is like sex: it's better when it's free." - Linus Torvalds

- **Features:**
  - Developed and integrated Showcase 15 (`public/showcases/showcase15.html` and `src/showcases/showcase15.ts`), a tribute to classic Amiga 500 showcases rendered with high-fidelity PBR.
  - Implemented **Procedural Checkerboard Diffuse & Roughness Map Generation**: Utilizes an offscreen canvas to dynamically paint reflective black tiles (`roughness = 0.06`) and rough white tiles (`roughness = 0.9`), repeated and loaded into StandardMaterials without static assets.
  - Developed **Planar Floor Reflections (Virtual Geometry / Mirror Room)**: Renders 100 bouncing balls and 3 large spheres flipped symmetrically across the Y axis under a transparent floor (`transparent: true` with `alpha = 0.45`), blending PBR envMap reflections on top of the reflected geometry.
  - Developed **Dynamic Sphere Inversion Reflections**: Calculates real-time conformal reflections of all 100 bouncing balls inside 3D mirror spheres by inverting position vectors ($P' = C + V \cdot \frac{R^2}{d^2 - r^2}$) and radius scale ($r' = \frac{r \cdot R^2}{d^2 - r^2}$).
  - Configured the smallest mirror sphere (Rose) as a **highly reflective mirror** (`transparent: true`, `alpha = 0.80`, `metallic = 1.0`, `roughness = 0.02`), while keeping the other two spheres semi-transparent (`alpha = 0.78`) to show the ball-reflections.
  - Created a **Physics State Machine & Lifecycle Loop**: Bouncing balls now transition from `active` bouncing to `falling` (scaling down and dissolving over 1s when rolling off limits) or `exploding` (scaling up 4x and fading out over 0.5s when resting on the floor for 2s), continuously recycling via `respawnBall` to maintain exactly 100 active balls.
  - Constrained the main Tweakpane panel height to `90vh` and added auto vertical scrolling (`overflow-y: auto`, `overflow-x: hidden`). This prevents the inspector overlay from overflowing off the bottom of the screen when numerous folders are open.

## [0.36.0] - 2026-06-24

### "If debugging is the process of removing software bugs, then programming must be the process of putting them in." - Edsger Dijkstra

- **Features:**
  - Implemented static parameter injection for post-processing shaders, compiling settings (Vignette offset/roundness/darkness, Film Grain intensity, Bloom threshold/intensity, ToneMapping mode) directly into shader pipelines.
  - Configured dynamic shader recompilation triggered automatically when the post-processing configuration signature changes (providing optimal production performance while retaining developer flexibility in the inspector).
  - Reduced per-frame uniform updates to write only the dynamic `time` uniform, saving CPU cycles and GPU uniform register bandwidth.
  - Added global `postProcessing` configuration schema to `small-world-machine.json` and `EngineOptions` types to enable app-wide default parameters.

## [0.35.1] - 2026-06-24

### "Measuring programming progress by lines of code is like measuring airplane building progress by weight." - Bill Gates

- **Architecture & Bugfixes:**
  - Decomposed all inline shader chunk strings inside [CoreShaderChunks.ts](src/core/renderers/shaders/CoreShaderChunks.ts) (fog and color grading filters) into 16 individual file assets under `src/core/materials/shaders/chunks/`.
  - Configured CoreShaderChunks to statically raw-import chunks using Vite `?raw` suffix, maintaining zero HTTP request runtime overhead.
  - Upgraded the WGSL linter (`scripts/lint-wgsl.ts`) to dynamically scan the local chunks folder and assemble the color grading logic in memory.
- **Housekeeping & Docs:**
  - Moved `AGENTS.md` rules into the `.agents/` customization root to declutter the workspace.
  - Expanded the `coding-guide` skill [SKILL.md](.agents/skills/coding-guide/SKILL.md) with comprehensive TypeScript templates, clean code flow rules, WebGL/WebGPU parity tables, and Vitest unit testing mock patterns.

## [0.35.0] - 2026-06-23

### "Nine people can't make a baby in a month." - Fred Brooks

- **Features:**
  - Refactored post-processing to support a custom `filterMode` attribute on `PostProcessingGroup`.
  - Added modular shader chunks (`FILTER_GLITCH_DISTORT`, `FILTER_VHS_DISTORT`, `FILTER_COLOR_GRADING`) in `CoreShaderChunks.ts` for both GLSL and WGSL.
  - Implemented 8 distinct, premium post-processing configurations (Aces Filmic, phosphor-green Night Vision with scrolling scanlines and luma flickering, Noir Film with warm highlights and cool shadows with edge chromatic aberration, Cyber Glitch with cyan/magenta neon tint and blocky line offset shifts, VHS Tape with signal tracking distortion, desaturated colors and line noise, Underworld with warm sepia amber contrast, Old Projector with screen vertical jumps, white vertical scratches and hair/dirt spots, and Thermal Sensor heat map vision).
  - Toggled monitor power saving: Clicking on any of the 8 monitor green LEDs turns it red and pauses the respective 3D rendering loop (`app.stop()`) saving CPU/GPU execution cycles, while applying a smooth CSS fade-out transition.
  - Created a robust unit test suite in `tests/renderers/PostProcessing.test.ts` verifying that `filterMode` registers successfully, shader chunks contain correct keywords, and the post-processing shader template assembles correctly in WebGL2 and WebGPU.
  - Bumped engine minor version to `0.35.0` in `package.json` (propagated to `SmallWorldMachine.ts` via the prebuild build-step).

## [0.34.0] - 2026-06-23

### "There is nothing quite so permanent as a quick fix." - Anonymous

- **Features:**
  - Developed a custom, premium 5-slide HTML presentation for the Small World Machine at `public/presentation.html`.
  - Implemented responsive keyboard and mouse controls for slide transitions (Space, Arrow keys, PageUp/PageDown, and previous/next buttons).
  - Designed the presentation with a modern glassmorphism aesthetic using high-end dark-themed HSL gradients and Outfit/Inter typography.
  - Implemented a resource-friendly activation system that automatically starts the 3D rendering loop only when the showcase slide is active and stops it when leaving the slide.
  - Integrated the "Damaged Helmet" interactive PBR 3D showcases with cinematic letterbox sliding bars and custom overlays for camera control instructions.
  - Modified `vite.config.ts` to register the presentation entry point for production compilation, and linked the slides deck on the main index page (`public/index.html`).
  - Designed and developed a dark-themed retail store "Video Wall" mockup at `public/showcases/showcase14.html`.
  - Configured a grid of 6 monitors, each running a separate rendering instance of a procedural interrogation room scene.
  - Implemented 6 distinct post-processing configurations (Clean Feed, Night Vision green bloom, Noir B&W, Cyberpunk hot magenta bloom, VHS analog tape, Underworld amber glow) showcasesnstrating the engine's ToneMapping, Vignette, Grain, and Bloom elements.
  - Created a synchronized surveillance sweep animation (panning security camera) and animated swinging/flickering light fixtures controlled by a shared simulation panel.
  - Added entry configurations in `vite.config.ts` and registered the new example on the landing page index.

## [0.33.0] - 2026-06-22

### "Programming is the art of telling another human what one wants the computer to do." - Donald Knuth

- **Features:**
  - Implemented the `UniversalGamepadController` to unify and abstract input handling from both the native standard browser Gamepad API (Xbox, PlayStation, mapped generic controllers) and the WebHID API (Nintendo Joy-Cons via `joy-con-webhid`).
  - Added dynamic loader/import for `joy-con-webhid` to ensure compatibility with Node.js environments (vitest) and SSR setups.
  - Implemented automatic grouping of Left and Right Joy-Cons into a single logical `GamepadDevice` when both are active, mapping physical buttons (A/B/X/Y, triggers, system buttons, and sticks) to standard gamepad indices (0-17).
  - Integrated `UniversalGamepadController` into the core `Input` class, keeping keyboard and mouse inputs functional while seamlessly falling back to gamepad input.
  - Provided static accessors `Input.gamepadController` and `Input.requestJoyConConnection()` to trigger browser pairing dialogs in response to user gestures.
  - Wrote a comprehensive unit test suite in `tests/core/controllers/UniversalGamepadController.test.ts` to verify standard gamepad mapping, raw/mocked Joy-Con packet parsers, and connection management.
  - Adapted the **Gamepad Diagnostic Tool** (`public/tools/gamepad-test.html`) to support WebHID controller pairing and display the normalized outputs of the new unified gamepad system.

## [0.32.0] - 2026-06-22

### "Walking on water and developing software from a specification are easy if both are frozen." - Edward V. Berard

- **Features:**
  - Created a specialized `RetroScreenMaterial` designed to run locally on meshes (e.g. TV screens) to simulate custom camera/display artifacts.
  - Implemented two distinct retro simulation modes:
        - **1950s TV Mode**: Converts output to grayscale, renders horizontal scanlines, adds animated static snow/noise, simulates horizontal tearing/waves, and implements vertical rolling.
        - **19th Century Film Mode**: Applies grayscale and sepia tint, simulates random exposure flicker, adds vignette shadow, spawns dynamic dust/dirt spots, and renders jittering vertical hair scratches.
  - Fully compatible with WebGL2 (GLSL 300), WebGL1 (GLSL 100) fallbacks, and WebGPU (WGSL) rendering pipelines.
  - Added unit test suite in `tests/core/RetroScreenMaterial.test.ts` to verify default states, custom config options, and RenderManifest properties.
  - Removed obsolete `SlimeMaterial.ts` class and its registration in `MaterialType.ts`.
  - Re-routed toxin floor tiles (`"T"`) in the Yad Level Builder to use the more performant `LavaMaterial` instead.
  - Cleaned up unused slime assets and maps in `YadApp.ts` and `YadLevelBuilder.ts`.

## [0.31.0] - 2026-06-20

### "A primary cause of complexity is that software vendors uncritically adopt almost any feature that users want." - Niklaus Wirth

- **Features:**
  - Created a browser-based utility at `public/tools/pbr-gen.html` in the style of the Splatter Generator.
  - Implemented real-time texture map generation from user-uploaded images or presets:
        - **Normal Map**: Computed using a discrete 3x3 Sobel kernel to obtain image gradients in X and Y, mapped into tangential coordinate space.
        - **Specular Map**: Derived using a sigmoidal-contrast S-curve function to raise highlight brightness without clipping.
        - **Ambient Occlusion Map**: Calculated using discrete Laplacian cavity operators (`4 * center - sum(neighbors)`) to map micro-crevices, combined with blurred height values.
        - **Roughness & Height Maps**: Generated from intensity mappings with adjustable box blur and inversion filters.
  - Added material presets (Default, Stone, Wood, Metal) for quick parameters adjustment.
  - Developed `PbrPreviewApp` in `src/tools/pbr-preview.ts` which extends `SmallWorldMachine` to render a rotating mesh (Sphere, Cube, Torus, Plane) with custom-generated PBR textures in real-time.
  - Resolved initialization blank-screen bug: Replaced `display: none` tab toggles with absolute offscreen rendering (`position: absolute; left: -9999px`) to maintain client dimensions and avoid `NaN` camera aspect ratios during WebGL setup.
  - Added real-time property bindings (Normal strength, Metallic, Roughness slider updates) dynamically linked to the preview shader.
  - Registered `pbrgen` in `vite.config.ts` rollup options to include the tool in production builds.
  - Satisfied TypeScript `strict: true` type safety by replacing `any` references with `GeometryDataInterface` and adding explicit return types.
  - Linked PBR Generator and Splatter Generator to the main index page (`public/index.html`).
  - Appended detailed mathematical sources and references to `REFERENCES.md`.

## [0.30.0] - 2026-06-19

### "Without requirements or design, programming is the art of adding bugs to an empty text file." - Louis Srygley

- **Features:**
  - Centralized the `GadgetInspector` overlay directly inside the `SmallWorldMachine` base class.
  - Added `enableInspector` property to `EngineOptions` (defaulting to `true` globally since the panel starts hidden).
  - Used type-only compile-time imports combined with asynchronous runtime dynamic imports (`import()`) to avoid circular dependencies between the tools and the core scene graph.
  - Removed manual inspector boilerplate code (imports, properties, instantiation, and manual updates) from Showcase 1, Showcase 6, Showcase 10, and Showcase 13.
  - Added a `color` property to `BloomElement` allowing developers to tint the glow of highlights.
  - Updated WebGPU and WebGL2 post-processing pipelines and fragment shaders to accept and multiply bloom highlights by the configured color.
  - Tinted the bloom highlights in Showcase 13 with a beautiful purple shade (`Color(1.2, 0.8, 1.6)`) to make the helmet's glimmers shine with a lila touch.
- **Architecture & Bugfixes:**
  - Resolved a bug where WebGPU bloom downsample (`BloomDownsample.frag.wgsl`) and upsample (`BloomUpsample.frag.wgsl`) shaders manually computed UV coordinates from `coord.xy` divided by the source texture size. Since downsampling viewports are half the size of the source texture, this restricted UV coordinates to `[0.0, 0.5]`, shifting the glowing highlights towards the bottom-right and accumulating a ghostly double image.
  - Refactored `PostProcess.vert.wgsl` to output correctly interpolated screen-space UV coordinates at `@location(0) uv: vec2f`.
  - Updated `BloomDownsample.frag.wgsl`, `BloomUpsample.frag.wgsl`, and `PostProcess.frag.wgsl` to accept and use the interpolated UV coordinates directly, eliminating offset distortions and resolving the helmet doubling artifact in Showcase 13.
  - Refactored equality comparisons in the modified WGSL shaders to use Yoda-style syntax (`1u == u.bloomEnabled`, etc.) in compliance with project guidelines.

## [0.29.0] - 2026-06-19

### "The best thing about a boolean is even if you are wrong, you are only off by a bit." - Anonymous

- **Architectural Overhaul: High-Performance Culling, WebGPU Bind Groups & Bloom**:
  - **CPU Frustum Culling Integration (Zero-Duplicate Math)**:
    - Resolved a major scene graph bottleneck where culling was performed twice per frame (first in `FrustumCuller` and then recalculated inside `Scene.getVisibleObjectsSorted`).
    - The rendering traversal in `Scene._collectVisible` now directly reads the pre-calculated `inFrustum` state computed during the spatial/octree query phase.
    - Eliminates $N$ redundant frustum-box intersection checks and hierarchy descents per frame, cutting CPU rendering loop overhead by up to 50%.
  - **WebGPU Frequency-of-Change Bind Group Split (Driver Overhead Reduction)**:
    - Completely redesigned the bind group layouts in `WebGPURenderer` to adhere to graphics API best practices (separating bindings by update frequency).
    - Shuffled bindings in `structs.wgsl` and layouts in the renderer to isolate material texture resources in `@group(1)` and object-specific transforms/properties in `@group(2)`.
    - The heavy Material Bind Group (containing 14 bindings for sampler, diffuse, specular, normal, terrain maps, etc.) is now bound **only once per material group**, while the lightweight Object Bind Group is bound per object. This drastically reduces the number of descriptor sets bound per frame, saving valuable CPU validation time in the WebGPU browser thread.
  - **Zero-Allocation Bind Group Caching & GC Stabilization**:
    - Introduced a dual-caching strategy for WebGPU bind groups: Material Bind Groups are cached on the renderer keyed by UUID (with dirty checks on texture views), and Object Bind Groups are cached directly on the uniform buffer metadata.
    - Removed hot-path array allocations (e.g. `resources` array comparisons inside `_getTexBindGroup`), eliminating GC pressure.
    - Replaced the hot-path `delete` operator on reuse objects with static assignment to `undefined`, preventing V8 JIT from dropping objects into dictionary mode and maintaining optimized monomorphic shapes.
  - **WebGPU Dual Kawase Bloom Pass**:
    - Ported the high-quality Dual Kawase Bloom pass from WebGL2 to WebGPU using native render passes and WGSL shaders.
    - Implemented a 13-tap prefiltered downsample shader (`BloomDownsample.frag.wgsl`) with quadratic threshold mapping to isolate highlights, and a 9-tap bilinear upsample shader (`BloomUpsample.frag.wgsl`) with hardware-accelerated additive blending.
    - Generates a 5-level downscaled mip-chain of the HDR render target. Uses render pass attachments and mipmap texture views, guaranteeing 100% cross-device compatibility without requiring experimental storage texture features.

## [0.28.0] - 2026-06-17

### "Ready, fire, aim: the fast approach to software development. Ready, aim, aim, aim, aim: the slow approach." - Anonymous

- **Architecture & Bugfixes:**
  - Added `defaultValue: 0` to `u_useEnvMap`, `_padObj0`, `_padObj1`, and `_padObj2` in `StandardWebGPULayout`. These fields had no value and no fallback, causing repeated `[UniformPacker] Property '...' has no value and no default.` console warnings for every material that does not explicitly supply them (e.g. `SpriteMaterial`, `WireframeMaterial`, `BasicMaterial`, etc.).
  - Replaced the exact pixel-perfect ratio comparisons in `CubeTexture.loadFrom` (e.g. `w * 3 === 4 * h`) with rounded integer checks (`Math.round(w / 4) === Math.round(h / 3)`). Images whose dimensions don't divide evenly — such as `skybox.png` at 245×184 px, which is a horizontal cross layout off by a single pixel — are now correctly identified instead of silently falling back to the "use same image 6 times" path.
  - All face-size calculations during slicing (`STRIP_HORIZONTAL`, `STRIP_VERTICAL`, `GRID_3X2`, `CROSS_HORIZONTAL`, `CROSS_VERTICAL`) now use `Math.round` to produce integer pixel coordinates, preventing sub-pixel boundary errors in `createImageBitmap`.
  - Resolves the WebGPU validation error `texture width (245) and height (184) are not equal` that caused an `[Invalid TextureView]` → `[Invalid BindGroup]` → `[Invalid CommandBuffer]` cascade and prevented the skybox from rendering in Showcase 7 and Showcase 13.
  - Both Showcase 7 and Showcase 13 now load their skybox from `/resources/showcases/13/skybox.png` instead of the previously referenced `/resources/showcases/7/skybox-1.jpg`.

## [0.27.0] - 2026-06-16

### "The function of good software is to make the complex appear to be simple." - Grady Booch

- **PBR & Image-Based Lighting (IBL)**:
  - **Environment Map Reflections**: Resolved missing PBR reflections by ensuring `u_useEnvMap` is correctly included in the `StandardWebGPULayout` and evaluated by the `WebGL2Renderer`.
  - **GLTF Spec Compliance**: Fixed incorrect texture channel sampling in `Standard.frag.glsl`. The engine now correctly reads the Blue channel (`.b`) for metallic and Green channel (`.g`) for roughness, strictly adhering to the glTF 2.0 `metallicRoughnessTexture` standard.
  - **Skybox Architecture**: Updated the legacy `Skybox.vert.glsl` and `Skybox.frag.glsl` shaders to seamlessly integrate with the modern Uniform Buffer Object (`GlobalUniforms`) architecture using `[BASE_VERTEX_HEADER]`.
  - **Texture Binding State**: Corrected `WebGL2Renderer` to properly evaluate and bind `CubeTexture` instances to `TEXTURE_CUBE_MAP` targets instead of blindly falling back to `TEXTURE_2D`, preventing silent `GL_INVALID_OPERATION` conflicts.

## [0.26.0] - 2026-06-15

### "I don't care if it works on your machine! We are not shipping your machine!" - Vidiu Platon

- **Inspector & UI Integration**:
  - **Gadget Inspector**: Introduced `GadgetInspector` (powered by `tweakpane`), a decoupled UI overlay module for real-time scene debugging and property tweaking.
  - **Raycaster & 3D Picking**: Implemented mathematical `Ray` and `Raycaster` classes leveraging slab-method AABB intersections. Converts 2D NDC mouse coordinates into 3D world rays for highly performant object selection.
  - **Dynamic Highlighting & Bounds**: Picked objects are visually marked with a neon-cyan wireframe `BoundingBox`. Bounding volumes are lazily computed on-the-fly during raycasting to guarantee selection works perfectly in minimal scenes (without Octrees).

## [0.25.0] - 2026-06-15

### "Software developers like to solve problems. If there are no problems handily available, they will create their own." - Anonymous

- **Post-Processing Architecture & Effects**:
  - **Modular Post-Processing Group**: Decoupled post-processing configuration from renderers. Introduced `PostProcessingGroup` containing modular elements (`ToneMappingElement`, `VignetteElement`, `GrainElement`) to dynamically assemble the final Uber-Shader pass.
  - **Advanced Vignette Math**: Completely rewrote the Vignette shader math to decouple the radius (`offset`) from the intensity (`darkness`).
  - **Superellipse Vignette Shapes**: Added a new `roundness` parameter to the Vignette effect. Users can now seamlessly transition between perfect elliptical vignettes and rounded rectangular ("TV-screen") vignettes.
  - **Film Grain**: Implemented hardware-accelerated animated Film Grain. Utilizes a time-seeded Hash12 generator directly within the fragment shader to avoid floating-point precision loss (`sin()` breakdown) during long sessions.
  - **WebGPU Transparent Capture Fix**: Resolved "Invalid CommandBuffer" errors in WebGPU by ensuring the HDR render target explicitly requests `GPUTextureUsage.COPY_SRC` so transparent passes can correctly capture the opaque scene behind them.

## [0.24.1] - 2026-06-15

### "A user interface is like a joke. If you have to explain it, it's not that good." - Martin LeBlanc

- **Mathematical Consistency & WebGPU Z-Clipping Fix**:
  - Validated `Matrix4`, `Quaternion`, and `Vector3D` against standard Right-Handed, Column-Major OpenGL conventions as referenced in the architecture guidelines (David Nadlinger).
  - Addressed a fundamental architectural mismatch where `Matrix4.perspective` natively returns `[-1, 1]` Z depth mapping (correct for OpenGL), causing WebGPU (which natively requires `[0, 1]`) to clip geometry in the near-half of the view frustum.
  - Implemented `Matrix4.ZO_CORRECTION`, a zero-to-one correction matrix, and applied it globally inside the `WebGPURenderer` to the view-projection matrix prior to shader upload.
  - Removed localized, incomplete `z`-correction hacks from `.wgsl` shaders, universally resolving frustum clipping issues for all materials, pipelines, and wireframes in WebGPU while maintaining math library independence.

## [0.24.0] - 2026-06-15

### "The first 90% of the code accounts for the first 90% of the development time. The remaining 10% accounts for the other 90%." - Tom Cargill

- **Core Performance & Memory Optimizations**:
  - **WebGPU BindGroup Caching**: Replaced per-frame, per-object `createBindGroup` calls with a sophisticated caching mechanism in `WebGPURenderer`, drastically reducing CPU overhead and memory leaks.
  - **Garbage Collection (GC) Elimination**: Replaced dynamic array allocations (`Object.entries`) in hot-paths (`_renderGroup`) with fast `for..in` loops across both WebGL and WebGPU renderers.
  - **Object Reuse in Scene Graph**: Prevented the allocation of thousands of `Frustum` and `Matrix4` objects per second by utilizing class-level scratch variables in `Scene.getVisibleObjectsSorted`.
  - **WebGL State Tracking**: Implemented a robust state caching system in `WebGL1Renderer` and `WebGL2Renderer` to prevent redundant API calls (`gl.enable`, `gl.cullFace`, `gl.blendFunc`, `gl.depthMask`), significantly lowering driver overhead.
- **Shader & Post-Processing Improvements**:
  - **WGSL Gamma Correction**: Shifted the `1.0 / gamma` division from the fragment shader (executed millions of times per frame) to the CPU, passing `inverseGamma` as a single uniform to the Uber-Shader.
  - **WebGPU Pipeline Reusability**: Prevented the Post-Process Pipeline (`PostProcessPass.ts`) from rebuilding its layouts, modules, and pipelines every frame. It now only rebuilds intelligently upon HDR texture resizing.
  - **WebGL1 Attribute Caching**: Extracted costly `gl.getAttribLocation("a_pos")` string lookups from the `execute()` render-loop in `PostProcessPassGL`, querying and caching it during initial build.

## [0.23.00] - 2026-06-15

### "To iterate is human, to recurse divine." - L. Peter Deutsch

- **Major Feature: Multi-Backend Opaque Texture Capture (Refraction Pipeline)**:
  - Implemented real-time Framebuffer/Color-buffer capturing in `WebGPURenderer`, `WebGL2Renderer`, and `WebGL1Renderer`.
  - Added dedicated pass isolation for transparent objects. Opaque objects are rendered first, the canvas/framebuffer is captured and copied into a read-only texture (`u_opaqueMap`), and then transparent objects are drawn.
  - Developed a cross-platform dummy-texture wrapping system to bypass standard binding limitations in WebGL/WebGPU while utilizing the existing `RenderManifest` and pipeline infrastructure.
- **Advanced Glass Material (PBR + Beer's Law)**:
  - Transformed `GlassMaterial` from a simple alpha-blended material into a fully physical refractive dielectric.
  - Implemented **Screen-Space Refraction** using exact IOR (Index of Refraction) math, perturbing UV coordinates based on View Vector and Surface Normals.
  - Implemented **Beer-Lambert Law** (Beer's Law) for volumetric light absorption. The color is now physically dictated by `thickness`, where thicker glass absorbs exponentially more light.
  - Added true PBR specular highlights (Cook-Torrance BRDF) on top of the glass surface across all lights (Directional, Point, Spot).
- **Shader Pipeline Improvements**:
  - Unified Gamma Correction and Tone Mapping across transparent shaders.
  - Solved the "Black Glass" issue caused by missing exposure multipliers and linear-to-sRGB conversions in custom fragment outputs.
- **Showcase 12 Polishing**:
  - Upgraded laboratory glassware (`ErlenmeyerFlask`, `ApothecaryBottle`) to use physically accurate material values (e.g., Borosilicate Glass with IOR 1.474 and Cobalt Glass with IOR 1.52).

## [0.22.0] - 2026-06-13

### "The computer was born to solve problems that did not exist before." - Bill Gates

- **Architecture & Bugfixes:**
  - Fixed a critical "disappearing light cone" bug in Showcase 12. Correctly identified and resolved a situation where 4 decorative Porthole-Spotlights entirely consumed the engine's internal WebGPU SpotLight limit (`sLights[4]`), forcing the main shadow-casting spotlight to be silently dropped by the forward renderer.
  - Adjusted Showcase 12 to rely on `emissiveIntensity` pulsation on the Portholes instead of spawning hidden Spotlights, recovering crucial light slots and saving performance.

## [0.21.00] - 2026-06-11

### "Hardware is the part of a computer that you can kick." - Anonymous

- **Core Architecture: Shadow Mapping (WebGL 2.0)**:
  - Introduced robust Shadow Mapping infrastructure for `SpotLight` sources in WebGL 2.0.
  - Implemented the `WebGL2DepthFrameBuffer` to handle off-screen depth rendering utilizing `DEPTH_COMPONENT32F` textures for high precision.
  - Added crucial shadow parameters directly to the engine's base classes (`Object3D.castShadow`, `Object3D.receiveShadow`, `AbstractLight.castShadow`, `AbstractLight.shadowBias`, `AbstractLight.shadowResolution`).
- **Rendering & Shader Enhancements**:
  - Integrated **Hardware Shadow Sampling (`sampler2DShadow`)** combined with `COMPARE_REF_TO_TEXTURE` to leverage free bilinear PCF hardware acceleration.
  - Deployed a **Percentage-Closer Filtering (PCF) Kernel** (3x3 footprint) working alongside the hardware sampler for exceptionally soft and smooth shadow edges.
  - Adopted the **Front-Face Culling Trick** during the shadow depth pass (`gl.cullFace(gl.FRONT)`) to physically eliminate self-shadowing artifacts (Shadow Acne) on lighted geometry.
  - Shader variables `u_spotShadowMap`, `u_spotShadowMatrix` and `u_spotShadowInfo` are dynamically parsed, bound and piped into both standard and PBR lighting models.
- **Engine Defaults & Showcases**:
  - `DEFAULT_RENDERER` was globally switched from `BEST` to `RendererType.WEB_GL2` to guarantee consistent out-of-the-box shadow support across all examples.
  - Redesigned **Showcase 12 (Abyssal Deco)** to heavily showcase the new shadow pipeline with multiple PBR materials, a flickering `SpotLight` casting high-resolution soft shadows, and various geometrical primitives utilizing `castShadow` and `receiveShadow`.

## [0.20.03] - 2026-06-01

### "I am not a great programmer; I am just a good programmer with great habits." - Kent Beck

- **Developer Experience (DX)**:
  - Added `.nvmrc` to specify and enforce the recommended Node.js version (v24.13.1).
  - Introduced **VS Code Dev Container** configuration for a seamless, isolated development setup with pre-installed extensions and dependencies.
  - Updated `README.md` with detailed instructions for local setup and optional Dev Container usage.
- **Dependency Updates**:
  - Upgraded **ESLint** and **@eslint/js** to **v10.x** for improved linting and modern JavaScript support.
  - Updated **Vite** to **v8.x** and **vite-plugin-dts** to **v5.x** to leverage the latest build performance and features.
  - Updated **Vitest**, **typescript-eslint**, and other development dependencies to their latest stable versions.
- **Code Quality & Maintenance**:
  - Resolved several linting errors in tests discovered by the new ESLint version (unused imports, `any`-casts, and unused variables).
  - Verified geometric integrity and movement logic with the updated toolchain.

## [0.20.02] - 2026-05-26

### "Always code as if the guy who ends up maintaining your code will be a violent psychopath who knows where you live." - John Woods

- **Housekeeping & Docs:**
  - Removed **Showcase 11: Baptismal Fonts (Fluid Simulation)** and **Showcase 12: Controls Verification** as requested.
  - Cleaned up entry points in `vite.config.ts` and updated the main example index.

## [0.20.01] - 2026-05-10

### "Give a man a program, frustrate him for a day. Teach a man to program, frustrate him for a lifetime." - Muhammad Waseem

- **Rendering & Shader Stability**:
  - Fixed a critical issue in **WebGL 2.0** where global uniforms (like `u_vp`) were incorrectly declared, causing depth calculation failures.
  - Implemented full **Uniform Buffer Object (UBO)** integration for `LiquidMaterial` and standard shader headers in WebGL 2.0.
  - Added support for `depthWrite`, `depthTest`, and `transparent` state management across all renderers (WebGL 1/2, WebGPU).
  - Resolved "lava leaking" artifacts in Showcase 10 by synchronizing UBO layouts and refining vertex displacement parameters.
- **Showcase 10 Improvements**:
  - Adjusted starting camera height to eye level (`y=2.0`) and set initial rotation to look straight ahead.
  - Optimized fire bowl rendering by refining lava radius and wave amplitude to prevent geometry clipping.
  - Cleaned up unreferenced imports and fixed missing `Input` references.
- **Workflow & Quality Standards**:
  - Introduced a new **Quality & Stability** section in `GEMINI.md`, mandating incremental changes and full library builds for interface updates.
  - Added regression test for `Tube` geometry (`tests/core/Tube.test.ts`) to ensure geometric integrity.
  - Performed safe dependency updates for TypeScript, Vite, and ESLint tools while maintaining linter compatibility.

## [0.20.00] - 2026-05-10

### "In software, the most beautiful code is the code that is not written." - Anonymous

- **Core Input & Control Logic**:
  - Fixed global forward/backward movement logic in `FPSController`. 'W' now correctly follows the look direction across all examples.
  - Refactored `Input` system to use a singleton pattern with `InputInterface`, enabling dependency injection and robust unit testing.
  - Implemented comprehensive regression tests for `FPSController` movement logic (`tests/core/FPSController.test.ts`).
- **Project Standards & Documentation**:
  - Consolidated all project instructions and mathematical standards into `AGENTS.md`.
  - Replaced `GEMINI.md` with a symbolic link to `AGENTS.md` to ensure a single source of truth for engine standards.
  - Added explicit documentation for the right-handed coordinate system and camera orientation standards.
- **Examples**:
  - Added **Showcase 12: Controls Verification** for visual validation of coordinate axes and movement directions.
  - Fixed various coordinate and assembly issues in **Showcase 11 (Baptismal Font)**, including incorrect torus rotations and component alignment.

## [0.19.09] - 2026-04-27

### "You might not think that programmers are artists, but programming is an extremely creative profession." - John Romero

- **Geometry & Visual Enhancements**:
  - Introduced `Disk` geometry with concentric rings, providing superior tessellation for circular surfaces that require vertex displacement.
  - Fixed "square lava" issue in Showcase 10 by replacing the rectangular plane with a high-fidelity `Disk` geometry, ensuring the lava fits perfectly within the circular fire bowls.
  - Refined `LavaMaterial` application to work seamlessly with the new disk tessellation.

## [0.19.08] - 2026-04-27

### "The cheapest, fastest, and most reliable components are those that aren't there." - Gordon Bell

- **Features:**
  - Introduced `inputMode` to `EngineConfig` to toggle between different control schemes.
  - Implemented **Tank-Mode** as the new default (`inputMode: "tank"`), where A/D keys rotate the object or camera.
  - Preserved **Strafe-Mode** (`inputMode: "strafe"`) for modern FPS-style lateral movement.
  - Updated `FPSController` and `WASDController` to dynamically switch logic based on the configured mode.
  - Added automatic `inputMode` injection into controllers via the `Application` base class.

## [0.19.07] - 2026-04-27

### "If we wish to count lines of code, we should not regard them as lines produced but as lines spent." - Edsger Dijkstra

- **Controller & Input Refinement**:
  - Unified **WASD control scheme** across all examples: **A/D** now consistently performs horizontal rotation (turning) instead of strafing.
  - Fixed movement vector calculation in `FPSController` to ensure forward movement (W) correctly follows the current look direction after rotation.
  - Standardized rotation directions for `Object3D` and `Camera`: **D** key now consistently rotates to the right across all controllers (`FPS`, `WASD`, `Orbit`, `Yad`).
  - Corrected mouse horizontal inversion in `FPSStrategy` to match the new keyboard rotation logic.
  - Added keyboard rotation support to `OrbitController`.

## [0.19.06] - 2026-04-27

### "Deleted code is debugged code." - Jeff Sickel

- **Mathematical Integrity & Regression Testing**:
  - Added a new **Mathematical Integrity** section to `AGENTS.md` to enforce the stability of core mathematical logic and coordinate system consistency.
  - Implemented a dedicated regression test suite (`tests/math/RegressionIntegrity.test.ts`) to verify orientation (lookAt), winding order (geometry), and Euler conventions (YXZ).
- **Developer Experience**:
  - Introduced a **Makefile** with "best practice" targets (`help`, `install`, `dev`, `build`, `test`, `lint`, `format`, `clean`) to streamline project management and automate dependency checks.

## [0.19.05] - 2026-04-24

### "Programming today is a race between software engineers striving to build bigger and better idiot-proof programs, and the Universe trying to produce bigger and better idiots. So far, the Universe is winning." - Rick Cook

- **Global Gamma & Exposure System**:
  - Implemented a unified system for color correction across WebGL 1, WebGL 2, and WebGPU.
  - Added `gamma` and `exposure` settings to `QualityConfig` and the global configuration JSON.
  - Migrated all lighting calculations (Phong, Lambert, Standard, Terrain, Liquid) to **Linear Space** for physically accurate color blending.
  - Added automatic sRGB conversion in all fragment shaders using a configurable global gamma factor.
- **Default Lighting**:
  - Added a default `AmbientLight` (0.15 intensity) to the `Application` base class to ensure unlit areas remain visible across all examples.
- **Liquid Shader Enhancements**:
  - Implemented **World-Space Coordinate Mapping** for all liquid shaders (WebGL 1/2 and WebGPU). This enables seamless tiling of lava and slime across multiple adjacent objects.
  - Synchronized vertex displacement and fragment noise calculation to use global world positions.
- **WebGPU Fixes**:
  - Fixed a critical bug in `WebGPURenderer` where `waveFrequency` and `waveAmplitude` were not being passed to the uniform buffer.
  - Corrected `Liquid.frag.wgsl` mapping and fixed missing math chunks in material definitions.
- **Visual Polishing**:
  - Reduced default `waveAmplitude` for `LavaMaterial` (0.05) and `SlimeMaterial` (0.015).

## [0.19.04] - 2026-04-21

### "Every great developer you know got there by solving problems they were unqualified to solve until they actually did it." - Patrick McKenzie

- **Architecture & Bugfixes:**
  - **Matrix Math**: Discovered and fixed a critical bug in `Matrix4.invert` through automated testing. The inversion logic is now 100% compliant with industry standards for column-major matrices.
  - **Vector Math**: Added `min()` and `max()` utility methods to `Vector3D`.

## [0.19.03] - 2026-04-21

### "We have to stop optimizing for programmers and start optimizing for users." - Jeff Atwood

- **Stability & Polishing**:
  - Validated world-space bounding volume transformations across all geometries.
  - Optimized Showcase 6 as a "Geometry Showcase" with optimized frustum culling.
  - Ensured all internal engine events and matrix updates are synchronized before spatial tree generation.

## [0.19.02] - 2026-04-21

### "It is easier to change the specification to fit the program than vice versa." - Alan Perlis

- **Frustum & Bounding Volume Overhaul**:
  - Implemented `BoundingVolume.transform(matrix)` to support world-space culling and octree placement.
  - Fixed "disappearing objects" bug by ensuring `Object3D.computeBounds()` correctly transforms local geometry bounds into world coordinates.
  - Corrected `Frustum` plane extraction logic for column-major matrices (Near/Far plane flip).
  - Renamed Showcase 6 to **"Geometry Showcase"** and removed collision test walls.
  - Fixed `FPSStrategy` vertical look direction (positive phi now looks up).
- **Critical Fixes**:
  - Resolved `TypeError: BoundingBox.fromVertices is not a function` by fixing cyclic/broken imports in `AbstractGeometry.ts`.
  - Added `min()` and `max()` utility methods to `Vector3D`.
  - Updated `Octree` to support all `BoundingVolume` types (Sphere, Box, etc.) via polymorphic tests.

## [0.19.01] - 2026-04-21

### "Lisp isn't a language, it's a building material." - Alan Kay

- **Stability & Code Quality Pass**:
  - Fixed critical `setInt` bug in `WebGL2UniformBuffer` causing corrupted lighting data.
  - Project-wide cleanup of `any` types and linting errors (missing return types, explicit interfaces).
  - Refactored `FPSController` constructor to use a configuration object (adhering to @AGENTS.md).
  - Standardized property naming (`wp`, `n`, `uv`) in all WebGPU shaders.

## [0.19.00] - 2026-04-21

### "Any code of your own that you haven't looked at for six or more months might as well have been written by someone else." - Eagleson's Law

- **Major Architectural Overhaul: Decentralized Shader System**:
  - Eliminated the central `ShaderBootstrap` "monster" (reduced from 700+ to ~50 lines).
  - Implemented the **Open/Closed Principle**: Materials are now self-contained units that provide their own shader DNA without core engine modifications.
  - **Self-Registering Materials**: Materials now automatically register as `ShaderProvider` instances upon instantiation, enabling true "Lazy Registration" (shaders are only loaded and compiled when used).
  - **Externalized Shader Assets**: Moved all shader code into dedicated `.glsl` and `.wgsl` files in `src/core/materials/shaders/` for better developer experience (syntax highlighting, linting).
  - **Vite Integration**: Utilized Vite `?raw` imports for zero-overhead, synchronous shader loading at runtime while maintaining source code separation.
  - **Refined WebGPU Pipeline**: Standardized the `Out` structure and property naming (`wp`, `n`, `uv`, etc.) across all backends to ensure seamless interoperability.
  - **Improved Type Safety**: Added global declarations for raw shader imports in `src/global.d.ts`.
  - **Bug Fixes**:
    - Fixed critical `setInt` bug in `WebGL2UniformBuffer` causing corrupted lighting data.
    - Resolved WebGPU shader redeclaration errors caused by redundant chunk inclusion.
    - Restored correct Phong and Lambert lighting logic in WebGPU shaders.

## [0.18.01] - 2026-04-20

### "The best error message is the one that never shows up." - Thomas Fuchs

- **New Feature: AAA-Style Lava System**:
  - Introduced `LavaMaterial`, a specialized material for high-performance, animated lava effects.
  - Implemented GPU-based Vertex Displacement in all shader backends (WebGL 1/2, WebGPU), moving vertex animation from CPU to GPU for massive performance gains.
  - Developed a multi-layered Fragment Shader featuring:
    - **Dual-Flow Maps**: Two noise-based flows moving in different directions to create chaotic, organic liquid patterns.
    - **Dynamic Crust Simulation**: Threshold-based logic for rendering cooled rock (crust) floating on top of molten magma.
    - **Customizable Viscosity**: Added `flowSpeed` and `noiseScale` parameters to control the sluggishness and scale of the lava flow.
  - Updated all renderers to generically handle new lava-specific uniforms (`u_time`, `u_flowSpeed`, `u_noiseScale`).
  - Refactored Showcase 10 to utilize the new `LavaMaterial`, eliminating all legacy CPU-based noise logic and improving visual quality significantly.

## [0.18.00] - 2026-04-20

### "Your code is your responsibility." - Anonymous

- **Major Architectural Overhaul: Polymorphic Core**:
  - **Open/Closed Principle Implementation**: Refactored major engine subsystems to eliminate "IF-monsters" and type-checking logic, allowing for seamless extension without modifying core classes.
  - **Robust TypedArray Handling**:
    - Replaced problematic `instanceof Uint32Array` checks with context-independent `BYTES_PER_ELEMENT` property access.
    - Migrated all generic array checks in renderers to `ArrayBuffer.isView()` for maximum stability across different execution contexts (e.g., Iframes).
    - Implemented polymorphic buffer creation in WebGPU using `data.constructor` to avoid manual type branching.
  - **Polymorphic Camera System**:
    - Shifting zoom and aspect ratio responsibility to `AbstractProjection` subclasses.
    - Introduced strategy-based zooming via `CameraStrategy.zoom()`, allowing radius-based zoom for Smooth/Stiff strategies and FOV/Bounds-based zoom for others.
    - Removed all `instanceof` checks and manual type casting from the `Camera` class.
  - **Polymorphic Lighting System**:
    - Introduced `AbstractLight.applyTo(LightDataInterface)`, allowing every light type to define how its data is extracted for the renderer.
    - Eliminated the large `switch(light.type)` block in `AbstractRenderer`.
  - **Data-Driven Material Rendering**:
    - Standardized `RenderManifest` to drive all renderer bindings generically.
    - Eliminated material-specific `instanceof` checks in all rendering backends (WebGL 1/2, WebGPU).
    - Introduced `state.isSprite` flag for generic billboarding and `state.transparent` for automated blend/depth-mask state management.
  - **Geometry & Physics Optimization**:
    - Added `getBoundingVolume()` to the `Geometry` interface, enabling $O(1)$ bounds calculation for primitives (Cube, Sphere, Plane).
    - Refactored `Frustum` and `Collision` systems to delegate intersection logic to polymorphic `BoundingVolume` implementations.
    - Updated `Object3D.computeBounds()` to utilize optimal geometric calculations instead of expensive vertex loops.

## [0.17.01] - 2026-04-20

### "We build our computer (systems) the way we build our cities: over time, without a plan, on top of ruins." - Ellen Ullman

- **Maintenance & Stability Round**:
  - **Core Regression Fixes**: Restored `camera.update()` and `camera.updateViewMatrix()` calls in the main application loop to fix visual errors where objects appeared too large (Identity Matrix issues).
  - **Type Safety Overhaul**: Performed a project-wide maintenance pass, eliminating unsafe `any` usages and fixing calls to non-existent methods/properties.
  - **GltfLoader Improvements**: Fixed a critical color scaling bug (removed redundant \*255 multiplication) and added robust safety checks for malformed glTF files.
  - **Robustness**: Added division-by-zero protection in tangent calculations for degenerate UV coordinates.
  - **Cross-Environment Compatibility**: Switched to `MathUtils.generateUUID()` for safer ID generation across various browser environments.
- **Architectural Refinement**:
  - **Showcase Restructuring**: Reorganized the project structure by moving example TypeScript files to `src/showcases/` and HTML files to `public/showcases/` for better build integration and cleaner separation of concerns.
  - **Smart Camera Updates**: Integrated `updateViewMatrix()` directly into `Camera.update()` to ensure every strategy or effect update is immediately reflected in the render.
- **Visual & Performance Tuning**:
  - **Showcase 10 Polish**: Mellowed the pointedness of bubbling lava animation by 50% and slowed down the light pulsing speed by 30% via a new `_lightPulseSpeed` constant for a more organic feel.
  - **Build System**: Added `showcase10` to the Vite production build configuration.

## [0.17.00] - 2026-04-19

### "What one programmer can do in one month, two programmers can do in two months." - Fred Brooks

- **WebGPU Backend Stability & Performance**:
  - **Dynamic Vertex Buffers**: Implemented efficient `GPUBuffer` updates for geometries with the `needsUpdate` flag, enabling real-time vertex displacement (e.g., bubbling lava).
  - **Sampler Caching System**: Introduced a dedicated cache for `GPUSampler` objects, correctly respecting `Texture.addressMode` (Repeat, Clamp, Mirror) and filtering settings.
  - **Optimized Attribute Handling**: Unified attribute buffer creation with dynamic dummy-buffer scaling to prevent crashes on geometries missing normals or UVs.
  - **Memory Management**: Implemented periodic pruning of unused object-specific uniform buffers to prevent memory leaks in large, dynamic scenes.
- **Engine Core & Mathematics**:
  - **Matrix4 Restoration**: Rebuilt the `Matrix4` class with a complete set of static and instance methods, including `lookAt`, `orthographic`, `decompose`, and `transformVector`.
  - **Visibility System Overhaul**: Introduced the `Object3D.inFrustum` flag to decouple culling state from user-defined visibility, ensuring `isVisible = false` is always respected.
  - **Native Material Features**: Added `cullMode` property to `AbstractMaterial`, allowing per-material control over GPU face culling (Front, Back, None).
- **Showcase 10 Evolution**:
  - **Organic Fire Bowls**: Replaced rigid cube-based structures with a high-poly `Tube` geometry for a realistic, rounded stone look.
  - **High-Resolution Bubbling Lava**: Implemented a 32x32 `Plane`-based lava surface with enhanced SimplexNoise displacement and circular edge damping.
  - **Enhanced Visuals**: Significantly boosted lava brightness and point light intensity for a more feury, atmospheric aesthetic.

## [0.16.00] - 2026-04-17

### "Prolific programmers contribute to certain disaster." - Niklaus Wirth

- **Major Feature: Cross-Renderer PBR System**:
  - **Physically Based Rendering (PBR)**: Implemented a modern PBR material system using the Metallic-Roughness workflow across all rendering backends (**WebGL 1**, **WebGL 2**, and **WebGPU**).
  - **StandardMaterial**: Introduced `StandardMaterial` with support for albedo, metallic, roughness, and ambient occlusion properties.
  - **Cook-Torrance BRDF**: Standardized lighting math using industry-standard GGX Normal Distribution, Smith-Schlick Geometry, and Fresnel-Schlick functions.
  - **Linear Lighting Workflow**: Migrated all lighting calculations to **Linear Space** with automatic sRGB gamma correction for more realistic color falloffs.
  - **Shader Architecture**: Modularized PBR math and lighting into reusable shader chunks (`pbr_math`, `light_calc_pbr`) for GLSL and WGSL.
- **Architectural Overhaul**:
  - **Centralized Zoom Logic**: Unified all camera zooming (radius, FOV, and bounds scaling) into a single `Camera.zoom()` method.
  - **Standalone ZoomController**: Extracted zoom functionality into a dedicated, configurable controller for enhanced modularity.
  - **Strategy Enhancements**: Improved `StiffStrategy` with radius constraints and refactored `IsometricStrategy` to respect unified projection bounds.
- **Code Hygiene & Stability**:
  - Fixed pre-existing WebGPU uniform alignment issues by optimizing struct layouts.
  - Resolved multiple linting and typing issues in core modules (`MathUtils.ts`, `Input.ts`).

## [0.15.08] - 2026-04-17

### "No matter how slick the demo is in rehearsal, when you do it in front of a live audience, the probability of a flawless presentation is inversely proportional to the number of people watching, raised to the power of the amount of money involved." - Mark Gibbs

- **Modular Zoom System**:
  - **Centralized Zoom Logic**: Centralized all camera zooming (radius, FOV, and bounds) into a unified `Camera.zoom()` method.
  - **Standalone ZoomController**: Extracted zoom functionality into a dedicated, configurable `ZoomController` for better modularity.
  - **Refactored Controllers**: Modularized `FPSController` and `OrbitController` by removing direct zoom logic.
- **Architectural Improvements**:
  - **Enhanced Strategies**: Added `minRadius`/`maxRadius` constraints to `StiffStrategy` and refactored `IsometricStrategy` to respect projection bounds.
  - **Unified Fallbacks**: Implemented robust fallback mechanisms for zooming across different projection types (Perspective, Orthographic, Oblique).
- **Code Hygiene & Type Safety**:
  - Refined internal zoom logic with improved type checking and safer casting.
  - Fixed multiple pre-existing linting and typing issues in `MathUtils.ts`, `Input.ts`, and `Camera.ts`.

## [0.15.07] - 2026-04-16

### "The bearing of a child takes nine months, no matter how many women are assigned." - Fred Brooks

- **Housekeeping & Docs:**
  - **Object Pooling**: Introduced `MathPool` for `Vector3D`, `Matrix4`, and `Quaternion` to drastically reduce GC pressure in hot paths.
  - **Inline Cache Stabilization**: Implemented `RenderManifest` caching in all materials to maintain stable hidden classes and avoid frequent allocations during rendering.
  - **Hot Path Refactoring**: Replaced `.forEach` with optimized `for` loops in all renderers, frustum culling, and spatial partitioning (Octree) logic.
  - **Scratch Buffer Usage**: Added pre-allocated scratch matrices and typed arrays in renderers to eliminate per-object allocations.
  - Standardized all value comparisons to **Yoda-style** (`value === variable`) for consistency and safety.
  - Improved JSDoc documentation for core interfaces (`Vector`, `Renderer`).
  - **PointerLock Fix**: Fixed an issue where the camera would still follow the mouse after exiting PointerLock via ESC.
  - **Collision Visualizer**: Added `CollisionVisualizer` utility to render wireframe bounding boxes and spheres for physics debugging.
  - **WebGL2 Support**: Added `WebGL2FrameBuffer` class to support future post-processing passes.
  - Enhanced Lava animation with multi-layered wandering noise for flowing wave effects.
  - Added organic pulsing for lava light intensity and color (heat glow effect).
  - Improved wave damping at geometry edges for a cleaner visual look.

## [0.15.06] - 2026-04-15

### "Computers are good at following instructions, but not at reading your mind." - Donald Knuth

- **Dynamic Geometry Support**:
  - Added `needsUpdate` flag to `GeometryDataInterface` to allow manual buffer re-uploads.
  - Implemented `Mesh.update()` (WebGL) and buffer write logic (WebGPU) to support real-time vertex displacement.
  - Updated all renderers (WebGL 1, WebGL 2, WebGPU) to check for geometry updates before each draw call.
- **Improved Lava Animation**: Refactored Showcase 10 with SimplexNoise-based bubbling lava and individual offsets per fire bowl.

## [0.15.05] - 2026-04-15

### "A language that doesn't affect the way you think about programming is not worth knowing." - Alan Perlis

- **TypeScript & Linting Fixes**:
  - Removed unused `TerrainMaterial` import in `WebGL2Renderer` to fix `TS6133` error during declaration file generation.
  - Standardized ESLint ecosystem on the latest stable versions within the v9/v8 range (`eslint` `^9.39.4`, `typescript-eslint` `^8.58.2`) to ensure compatibility with `eslint-plugin-import` while maximizing stability.
  - Updated all core development tools (`@microsoft/api-extractor`, `@types/node`, `globals`, `prettier`, `simplex-noise`, `terser`) to their latest stable versions.
- **Build Optimization**:
  - Improved `vite-plugin-dts` performance by disabling `rollupTypes`, significantly reducing build time.
  - Fixed Vite warning by removing the deprecated `compact` option from `rollupOptions.output` in `vite.lib.config.ts`.

## [0.15.04] - 2026-04-15

### "Good code is its own best documentation. As you're about to add a comment, ask yourself, 'How can I improve the code so that this comment isn't needed?'" - Steve McConnell

- **Unified Texture Flip Handling**: Centralized vertical flip logic in `AssetManager` via `createImageBitmap`, ensuring consistent orientation across WebGL and WebGPU while removing redundant renderer-level flips.
- **Enhanced Configuration Options**: Added optional `flipY` control to `TextureOptions` and `ImageLoader`, defaulting to `false` (web-standard top-down) to correctly support skydomes and other top-down textures.
- **Architectural Loader Overhaul**: Refactored all loaders (`ImageLoader`, `ObjLoader`, `MtlLoader`, `SkyboxLoader`, `TextLoader`) to use standardized Configuration Objects (`LoaderOptions`, `ImageLoaderOptions`) in their constructors, improving maintainability and adhering to `AGENTS.md` standards.
- **OBJ & MTL Path Consistency**: Improved path resolution in `ObjLoader` to automatically pass its base path to the internal `MtlLoader` for more reliable model loading.

## [0.15.03] - 2026-04-14

### "The most important property of a program is whether it accomplishes the intention of its user." - C.A.R. Hoare

- **Robust WebGPU Rendering**:
  - Major update to the **WebGPU Renderer** to implement defensive material property application, matching the reliability of the WebGL backends.
  - Improved WebGPU shader stability with fallback logic for missing normal/specular maps and minimum ambient visibility.
- **Model & Texture Fixes**:
  - **Kenney Car (Showcase 3/4)**: Fixed "black/gray car" issue by removing redundant UV flips in `ObjLoader` and enforcing `NEAREST` filtering in `MtlLoader` to prevent color bleeding on small texture atlases.
  - **Skydome (Showcase 9)**: Corrected upside-down texture by removing manual UV flipping in `Sphere` geometry, ensuring alignment with global renderer standards.
- **Renderer Property Handling**: Standardized the use of `Float32Array` for all material color properties (`u_color`, `u_specColor`) in manifests, improving performance and type safety across all rendering APIs.
- **Material Enhancements**: All core materials (`Basic`, `Phong`, `Lambert`, `Sprite`, `Terrain`, `World`, `Wireframe`, `Skybox`) now correctly expose UV transformation properties in their render manifests.

## [0.15.02] - 2026-04-14

### "The purpose of software engineering is to control complexity, not to create it." - Pamela Zave

- **Recursive Rendering Fix**: Corrected WebGL renderers to properly process nested object hierarchies even when parent objects lack a material (essential for complex model groups).
- **Matrix Calculation**: Fixed critical bug in `Matrix4.compose` by implementing direct matrix construction, ensuring correct transformation order (Translation _ Rotation _ Scale).
- **Large Geometry Support**: All geometry classes now dynamically select between 16-bit and 32-bit index arrays (`Uint16Array` vs `Uint32Array`) based on vertex count, preventing buffer overflows.
- **Improved Model Loading**:
  - `ObjLoader`: Added support for n-gon triangulation and automatic V-flip for UV coordinates.
  - `MtlLoader`: Improved error reporting for missing texture assets.
- **Enhanced Shader Stability**:
  - Implemented robust TBN matrix calculation with fallbacks for geometries without tangent vectors (prevents "black object" syndrome).
  - Fixed shader template placeholders and standardized variable naming across WebGL 1 & 2.
- **System Integrity & Security**:
  - Added `crypto.randomUUID` fallback in `MathUtils` to support insecure contexts (e.g., local network IP access without SSL).
  - Fixed `Mesh` class to explicitly disable unused vertex attributes, preventing state leakage between draw calls.
- **AssetManager Fixes**: Corrected image loading fallback logic to ensure failed fetch requests still attempt to load via the standard Image API.

## [0.15.01] - 2026-04-13

### "Controlling complexity is the essence of computer programming." - Brian Kernighan

- **Architecture & Bugfixes:**
  - Fixed 404 errors for shaders and config files when running examples from subdirectories.

## [0.14.0] - 2026-04-13

### "The trouble with programmers is that you can never tell what a programmer is doing until it's too late." - Seymour Cray

- **AssetManager**: Introduced a centralized manager for loading and caching assets (images, text) with global progress tracking, base URL support, and custom headers.
- **Normal & Specular Maps**: Added support for normal maps and specular maps in `PhongMaterial` and `LambertMaterial` across all renderers.
- **WorldMaterial**: New material type using triplanar mapping for seamless, world-space textures—ideal for terrain, rocks, and large structures.
- **Skydome**: Added `Skydome` implementation for immersive 360-degree backgrounds (see Showcase 9).
- **Major Renderer Rework**: Significant architectural updates to WebGL1, WebGL2, and WebGPU renderers for more modular and efficient shader handling.
- **Spatial Partitioning & Optimization**: Implemented `Octree` for efficient spatial querying and `FrustumCuller` to skip rendering objects outside the camera's view.
- **Enhanced Texture Quality**: Added support for anisotropic filtering and improved mipmap generation.
- **New Showcases**:
  - `Showcase 8`: A classic 2.5D Jump & Run showcasesnstrating physics, collision detection, and sprite-based player movement.
  - `Showcase 9`: Immersive environment with a Skydome and FPS-style camera.
  - `Showcase 10`: Advanced scene composition with fire bowls, point lights, and materials using normal/specular maps.
- **Physics**: Basic AABB collision detection and gravity implementation (showcased in Showcase 8).

## [0.14.00] - 2026-04-03

### "If you think your users are idiots, only idiots will use it." - Linus Torvalds

- Refactor and improve shader handling

## [0.13.04] - 2026-04-03

### "As a rule, software systems do not work well until they have been used, and have failed repeatedly, in real applications." - Dave Parnas

- Fix PointerLocked issues
- Fix Skybox (added support for 4x3/3x4 cross layouts in `CubeTexture`)
- Rename all Demos to Showcases
- Move AbstractDemo to `src/core/showcase/AbstractShowcase`
- Fix Showcase 7 canvas initialization error (ID mismatch)
- Add Showcase 7 with Skybox, infinite floor, and FPS controls
- Improve error handling in `Application.ts` when canvas element is missing
- Update Vite configuration and main index page
- Add support for single-image (tiled) skybox textures in `CubeTexture`

## [0.13.03] - 2026-04-03

### "Most software today is very much like an Egyptian pyramid with millions of bricks piled on top of each other, with no structural integrity, but just done by brute force and thousands of slaves." - Alan Kay

- Clean up log-messages

## [0.13.02] - 2026-04-02

### "The hardest part of design is keeping features out." - Donald Norman

- Add missing geometries: Cube, Plane, and a complete Circle
- Fix and improve WASD movement and pointer lock in Demo 6
- Add comprehensive set of standard web colors (CSS/X11) to Color class
- Add color space conversions: HSL to/from Color and HSV to/from Color
- Refactor RendererFactory and EngineConfig for robust renderer switching
- Fix WebGL context loss issue when switching renderers dynamically

## [0.12.04] - 2026-04-01

### "It is impossible to make anything foolproof because fools are so ingenious." - Arthur Bloch

- Implement renderer configuration in small-world-machine.json to support context attributes
- Update Renderer interface to accept optional attributes during initialization
- Pass renderer-specific attributes to WebGL1, WebGL2 and WebGPU contexts

## [0.12.03] - 2026-03-31

### "C makes it easy to shoot yourself in the foot; C++ makes it harder, but when you do, it blows away your whole leg." - Bjarne Stroustrup

- Centralize Input.init() in Application.ts
- Refine keyboard handling in AbstractDemo to use Input.isPressed(Keys.SHIFT_L)
- Fix: Add WebGL context check to prevent 'createTexture' of null error when switching renderers

## [0.12.02] - 2026-03-31

### "If you automate a mess, you get an automated mess." - Rod Michael

- Add keyboard event handling to AbstractDemo
- Implement renderer switching (WebGL1, WebGL2, WebGPU) via SHIFT+1/2/3 in all showcasess

## [0.12.01] - 2026-03-29

### "The sooner you start to code, the longer the program will take." - Roy Carlson

- Optimize it: Code hygiene

## [0.12.01] - 2026-03-29

### "There are only two kinds of programming languages: those people always bitch about and those nobody uses." - Bjarne Stroustrup

- Optimize it: Constructor options

## [0.12.00] - 2026-03-28

### "The only way to write good code is to write tons of shitty code first." - Anonymous

- Optimize it: Positional parameters vs config options
- Update README

## [0.11.14] - 2026-03-26

### "Design and programming are human activities; forget that and all is lost." - Bjarne Stroustrup

- Implement Camera Effects (Shake, Flash) with Factory and Enums
- Add effect support to Camera class and Application loop
- Refine Smooth Camera Strategy
- Apply AGENTS.md

## [0.11.13] - 2026-03-26

### "The most effective debugging tool is still careful thought, coupled with judiciously placed print statements." - Brian Kernighan

- Implement camera constraints

## [0.11.12] - 2026-03-26

### "A great lathe operator commands several times the wage of an average lathe operator, but a great writer of software code is worth 10,000 times the price of an average software writer." - Bill Gates

- Implement Sprite and SpriteMaterial
- Add billboard rendering logic to WebGL1, WebGL2 and WebGPURenderer
- Enable alpha blending for transparent sprites in all renderers

## [0.11.11] - 2026-03-25

### "One of my most productive days was throwing away 1000 lines of code." - Ken Thompson

- Apply AGENTS.md
- Start with nice 2D features
- Reorganize code

## [0.11.10] - 2025-03-25

### "A computer is a stupid machine with the ability to do incredibly smart things." - Bill Bryson

- AI-based rework III
- Extend AGENTS.md
- Extend terrain generation
- Code quality

## [0.10.16] - 2025-03-19

### "Programmers are in a race with the Universe." - Rick Cook

- AI-based rework II
- Code quality

## [0.10.15] - 2025-03-18

### "The problem with object-oriented languages is they’ve got all this implicit environment that they carry around with them. You wanted a banana but what you got was a gorilla holding the banana and the entire jungle." - Joe Armstrong

- AI-rework
- Code quality

## [0.10.14] - 2025-03-18

### "Code never lies, comments sometimes do." - Ron Jeffries

- Introduce AGENTS.md
- Code quality
- Introduce event management interface

## [0.10.13] - 2025-03-17

### "You can’t have great software without a great team." - Jim McCarthy

- Demo 4
- Add README.md

## [0.10.12] - 2025-03-16

### "No code is faster than no code." - Kevlin Henney

- Demo 3: Load and display \*.OBJ

## [0.10.11] - 2025-03-15

### "Don't comment bad code - rewrite it." - Brian Kernighan

- Demo 2: WASD and camera (pointer lock)

## [0.10.10] - 2025-03-15

### "Complexity is the enemy of reliability." - Thomas McCabe

- Prepare more than a single feature showcases

## [0.10.9] - 2025-03-15

### "In programming the hard part isn't solving problems, but deciding what problems to solve." - Paul Graham

- More code refactor and version bump
- Respect linting errors and warnings
- Some sort of reset. Start with Demo1

## [0.10.6] - 2025-03-13

### "Do not worry about your difficulties in Mathematics. I can assure you mine are still greater." - Albert Einstein

- Crush the code

## [0.10.5] - 2025-03-13

### "Imagination is more important than knowledge." - Albert Einstein

- Introduce terrain with heightmap

## [0.10.4] - 2025-03-13

### "God does not play dice with the universe." - Albert Einstein

- Improve Enums (replace by frozen JS objects)

## [0.10.3] - 2025-03-13

### "There is no royal road to geometry." - Euclid

- Implement AreaLight

## [0.10.2] - 2025-03-12

### "If I have seen further it is by standing on the shoulders of Giants." - Isaac Newton

- Renderer refactoring

## [0.10.1] - 2025-03-12

### "We must know, we will know." - David Hilbert

- Improve linting and formatting

## [0.10.0] - 2025-03-12

### "The book of nature is written in the language of mathematics." - Galileo Galilei

- Re-work /dist, TS bundling etc.

## [0.9.4] - 2025-03-12

### "Where there is matter, there is geometry." - Johannes Kepler

- Bug fixing due to the last refactorings

## [0.9.3] - 2025-03-12

### "Mathematics is the queen of the sciences." - Carl Friedrich Gauss

- Bug fixing; Fasten class type checks

## [0.9.2] - 2025-03-11

### "An equation for me has no meaning unless it expresses a thought of God." - Srinivasa Ramanujan

- Fix WebGPU texture bug

## [0.9.1] - 2025-03-11

### "As far as the laws of mathematics refer to reality, they are not certain, and as far as they are certain, they do not refer to reality." - Albert Einstein

- Add MTL loader; Rework material checks (speed improvements)

## [0.9.0] - 2025-03-11

### "I think, therefore I am." - Rene Descartes

- Even more refactoring; Event system; Asset loader pipelines

## [0.8.59] - 2025-03-11

### "Life is good for only two things, discovering mathematics and teaching mathematics." - Simeon Poisson

- Fix Sphere geometry generation

## [0.8.58] - 2025-03-11

### "Mathematics is the supreme judge; from its decisions there is no appeal." - Tobias Dantzig

- Reorganize loaders; Add .OBJ loader

## [0.8.57] - 2025-03-11

### "In mathematics the art of proposing a question must be held of higher value than solving it." - Georg Cantor

- Extend HUD data

## [0.8.56] - 2025-03-11

### "Obvious is the most dangerous word in mathematics." - Eric Temple Bell

- Add and use vector normalization
- Add code collection script

## [0.8.55] - 2025-03-11

### "What science can there be more noble, more excellent, more useful... than mathematics?" - Benjamin Franklin

- Improve vectors
- Implement SkyBox

## [0.8.54] - 2025-03-10

### "The essence of mathematics lies in its freedom." - Georg Cantor

- Implement basic texture and assessment management stuff
- Add new geometries (pyramid, torus and cylinder).
- Some code improvements
- Re-work light system

## [0.8.50] - 2025-03-10

### "There is geometry in the humming of the strings, there is music in the spacing of the spheres." - Pythagoras

- Re-work camera system (strategy pattern plus factor)
- Re-work showcases1.ts
- Add FPS camera strategy

## [0.8.47] - 2025-03-10

### "Pure mathematics is the world's best game. It is more absorbing than chess, more of a gamble than poker, and lasts longer than Monopoly. It's free. It can be played anywhere." - Richard J. Trudeau

- Changelog

## [0.8.46] - 2025-03-10

### "Mathematics compares the most diverse phenomena and discovers the secret analogies that unite them." - Joseph Fourier

- Add changelog generation script
- Add SpotLight and fix all ESLint any-types
- Add ESLint
- Refactoring HUD template
- Refactoring code
- Implementing rotation
- Implementing point light and ambient light
- Start implementing light
- Start implementing materials
- Implement frustrum calculation
- Implement geometry caching
- Dynamic version display
- Re-introduce /dist
- Major code and math base improvements
- Improve HUD
- Collision detection improvements
- Enrich Vector3D methods with essential methods for math, collision detection etc.
- Improve generation of geometry data
- Improve code style, types etc
- Improve parameter naming and types of the geometric classes
- Improve HUD
- Introduce HUD
- Introduce Vector3D and Vector2D
- Improve base color handling; Introduce the grid
- Add grid; Add world boundaries
- Integrate "prettier"
- Use constants instead of hard coded strings for input keys
- Remove node_modules
- Add camera follow strategies; Add some more debug information;
- Initial commits
- Initial commit from local project
- Initial commit
