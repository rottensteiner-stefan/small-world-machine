# Changelog

> Active releases (`0.100.0+`). For earlier releases (`0.8.46 – 0.99.0`), see [docs/CHANGELOG-ARCHIVE.md](docs/CHANGELOG-ARCHIVE.md).

## [0.129.0] - 2026-11-24

### "The laws of nature are but the mathematical thoughts of God." - Euclid

- **Features:**
  - _WebGPU single-flush ring buffers (`GPUObjectRingBuffer`, `GPUInstanceRingBuffer`, `WebGPURenderer`):_ staged all per-draw object uniforms and auto-instanced world matrices into persistent CPU TypedArrays, executing exactly two bulk uploads immediately before `queue.submit()` to drop render-loop driver IPC from O(N) to O(1).
  - _Implicit gyroscopic dynamics (`EulerIntegrator.integrateAngular`):_ implemented Erin Catto implicit 1-step Newton solver with Cramer rule on a 3x3 Jacobian in local body space to stably integrate asymmetric rigid bodies without runaway energy growth or heap allocations.
  - _Affine 4x4 matrix multiplication & rigid normal fast-path (`Matrix4.multiplyAffine`, `Matrix3.getNormalMatrix`):_ added 36-multiply affine composition cutting 44% of matrix float operations in scene cascades, plus O(1) direct normal matrix assignment on unit-scale rotations.
  - _Branchless center-extent bounding volumes (`BoundingBox.ts`, `SkinnedMesh.ts`):_ implemented Jim Arvo center-extent transform eliminating 8-corner loops, sign-branches, and array allocations (8x faster skinned mesh bounds updates).

- **Architecture & Bugfixes:**
  - _Camera TAA jitter & physical scaling (`Camera.ts`, `SmallWorldMachine.ts`):_ corrected TAA jitter accumulation to row3 clip translation and scaled jitter by physical render-target pixels (`canvas.width * renderScale`) rather than client CSS pixels.
  - _Local-axis camera shake (`Camera.ts`):_ rotated view direction around camera local right axis preventing vertical shake collapse when facing +/-X.
  - _PBR multi-scattering & un-clamped anisotropic visibility (`lighting_pbr.wgsl`, `light_calc_pbr.frag.glsl`):_ grounded Fdez-Aguera multi-scattering on F0, removed unphysical 1.0 clamp on Heitz anisotropic visibility V, and guarded shadow sampling at N.L > 0.0.
  - _Workgroup-shared cluster light culling (`cluster_cull.wgsl`):_ loaded lights in 64-element shared-memory batches to cut light evaluations by up to 64x across all 8,192 cells, with native orthographic projection support.
  - _Froxel loop hoisting & depth simplification (`froxel_integrate.wgsl`):_ hoisted camera ray reconstruction and phase evaluation outside the Z-loop, eliminating 192 matrix multiplies per column, and simplified depth to single-pow progression.
  - _Water quadtree 2:1 balancing & crack fix (`WaterQuadtree.ts`):_ added 8-point edge probing and 2:1 split propagation across neighbor boundaries to eliminate T-junction cracks.
  - _Rigid-body cached world inverse inertia (`RigidBody.ts`, `RigidBodyMath.ts`):_ cached 6-element symmetric tensor updated once per step, eliminating repeated trigonometric transformations during PGS contact solving.

- **Housekeeping & Docs:**
  - _Documentation & References refresh (`README.md`, `CONTEXT.md`, `REFERENCES.md`, `MEMORY.md`, `BACKLOG.md`):_ added Jim Arvo (1990), Erin Catto (2015), Single-Flush Ring Buffer, and Affine Matrix Multiplication references, updated ubiquitous vocabulary, and recorded full thermo-nuclear audit ledger.

## [0.128.0] - 2026-11-22

### "The real voyage of discovery consists not in seeking new landscapes, but in having new eyes." - Marcel Proust

- **Features:**
  - _Screen-space contact shadows & 3D LUT grading (`ContactShadowsElement`, `LutGradingElement`, `CubeLutParser`, `Lut3D`):_ added ray-marched screen-space contact shadows (`ContactShadowPassGPU`/`ContactShadowPassGL`) across WebGPU and WebGL2, plus `.cube` 3D LUT color grading across WebGPU and WebGL2.
  - _Morph target animation & GPU blending (`MorphTargetBlender`, `GPUMorphTargetSystem`, `WebGL2MorphTargetManager`):_ added CPU morph-target evaluation (`morph_blend.wgsl` compute blending on WebGPU, WebGL2 texture-backed morph buffers, and WebGL1 vertex fallback) wired into `GltfGeometryParser` and `GltfAnimationParser`.
  - _Two-phase HZB occlusion culling (`InstanceFieldSystem`, `HzbOcclusionSystem`, ADR 0059 Step 3):_ added WebGPU two-phase HZB culling (`cullMode == 2`) rescuing disoccluded instances against the rebuilt current-frame pyramid with zero CPU readback.
  - _Far-field vegetation impostors & canopy shells (`OctahedralImpostor`, `CanopyShell`, ADR 0059 Steps 3–4):_ added multi-view hemi/full-octahedral atlas baking and parallax shaders (`OctahedralImpostorMaterial`) plus terrain-following `CanopyShellMaterial` envelopes in `@small-world-machine/vegetation-extras`.
  - _SPH fluid particles & CDLOD water quadtree (`SphFluidAffector`, `WaterQuadtree`):_ added zero-GC 3D SPH simulation in `@small-world-machine/vfx-extras` (`Showcase 46` `fluid` variant) alongside a 2:1-balanced, `Uint16`-safe CDLOD `WaterQuadtree` generator in core geometry.
  - _Binary GLB exporter & runtime resolution governor (`GlbWriter`, `swm glb`, `PerformanceGovernor`):_ added spec-compliant binary `.glb` packing (`WorldWriter.writeGlb()`, `swm glb`) and zero-GC EMA frame-time `PerformanceGovernor` dynamic `renderScale` scaling (ADR 0035 Phase 4).
  - _Hemisphere ambient light & volumetric sky/ground fill (`HemisphereLight`, `LightType.HEMISPHERE`, `ambientGround`):_ added additive sky-to-ground gradient illumination (`mix(ground, sky, N.y * 0.5 + 0.5)`) across WebGPU, WebGL2, and WebGL1 (PBR, Phong/Lambert, `field_pull.wgsl`), plus spherical average fog scattering (`froxel_inject.wgsl`, `VolumetricFogPassGL`).
  - _Multi-scattering IBL & Frostbite specular AO (`lighting_pbr.wgsl`, `light_calc_pbr.frag.glsl`, `pbr_math.*`):_ implemented Fdez-Aguera (2019) multi-scattering IBL energy compensation across WebGPU/WebGL2 and Lagarde & de Rousiers (2014) `computeSpecularOcclusion` for base specular and clearcoat across all tiers.
  - _Per-slot `KHR_texture_transform` & `TEXCOORD_1` (`TextureTransform`, `u_uvTransforms`, `AlphaCutoutGroups`, ADR 0064):_ added material-owned 19-slot UV transforms (`offset`, `scale`, `rotation`, `texCoord` `0 | 1`) with `uvs1`/`a_uv1` vertex streams and `swmTransformTbn` across WebGPU/WebGL2/WebGL1 without cloning shared textures, plus cutout depth/shadow/EVSM splitting.

- **Architecture & Bugfixes:**
  - _Additive `AmbientLight` accumulation & `u_envIntensity` fallback (`AmbientLight`, `base_fragment_header.frag.glsl`, Showcase `13`):_ made `AmbientLight.applyTo()` accumulate additively alongside `HemisphereLight`, exposed `u_envIntensity` in WebGL2 `USE_ENV_MAP` fallback, and fixed WGSL/GL2 `AmbientLight + IBL` irradiance & Showcase 13 `environmentIntensity` state.
  - _Single-slot `DirectionalLight` showcase discipline (Showcases `6/13/24/36/presentation`):_ replaced extra secondary `DirectionalLight` fill lights that overwrote the single directional light slot with non-decaying `PointLight` instances.
  - _`ShadertoyImporter` WebGL2 UBO block parity (Showcase `24`):_ declared the full `GlobalUniforms` std140 interface block inside `SHADERTOY_GAMMA_DEFS` so GLSL ES 3.00 / ANGLE links vertex and fragment stages cleanly without UBO layout mismatch.
  - _Early-Z `USE_ALPHA_TEST` shader split & frostglass parity (`ShaderFlag.ALPHA_TEST`, `FrostglassMaterial`):_ separated alpha-test cutout discards (`alphaTest > 0`) from opaque PBR/Standard/Phong/Lambert programs for full hardware early-Z, aligned `FrostglassMaterial` across all tiers, and wired a `FluidSurfaceMaterial` coolant pool in Showcase `32`.
  - _Loader cancellation, GL field cleanup & `OilSlickMaterial` parity (`AssetManager`, `GltfLoader`, `InstanceFieldGL`, `OilSlickMaterial`):_ extended `AbortSignal` cleanup across loaders/textures, released `InstanceFieldGL` texture holdings on unregistration, and unified `oilHash(p)` across GLSL and WGSL (`<= 0.36%` GPU/GL2 parity).

- **Housekeeping & Docs:**
  - _Documentation & CLI catch-up (`ShaderFlag.ts`, `ADR 0055`, `ADR 0064`, `swm-cli.md`, `tier-parity.json`, `13/24/51/docs/log.md`, `MEMORY.md`, `BACKLOG.md`):_ updated `swm-cli.md` for `swm lod`/`swm glb`, recorded ADR 0064 (`khr_texture_transform` & `texcoord_1` in `tier-parity.json`), reconciled `ShaderFlag`/ADR 0055 map status, and updated `REFERENCES.md`/`CONTEXT.md` entries.

## [0.127.5] - 2026-11-21

### "Well done is better than well said." - Benjamin Franklin

- **Architecture & Bugfixes:**
  - _Async init/dispose races & context-loss handling (`SmallWorldMachine.ts`, `WebGPURenderer.ts`, `AbstractShowcase.ts`):_ deduplicated concurrent `start()` via `_initPromise`, aborted zombie loops and leaked `GPUDevice` instances when `destroy()` runs during init, paused/stopped the loop on WebGL/WebGPU context loss, and cancelled pending `AbstractShowcase` ready timers on teardown.
  - _AssetManager epoch & abortable loaders (`AssetManager.ts`, `AbstractLoader.ts`, `ImageLoader.ts`, `TextLoader.ts`, `BinaryStreamLoader.ts`):_ added an epoch counter in `AssetManager.clear()` (wired to `SmallWorldMachine.destroy()`) to prevent stale loads from polluting fresh caches, and threaded optional `AbortSignal` through `LoaderOptions` to `fetch()`.
  - _Audio lifecycle & spatial orientation (`AudioSystem.ts`, `SynthSFX.ts`):_ disconnected one-shot playback nodes on `onended`, tracked `_ownsContext` so `dispose()` disconnects mixer nodes without closing injected contexts, deduplicated concurrent `load()` calls, cleared buffers on `dispose()`, and used `camera.up` with an orthogonal fallback when looking straight up/down.
  - _Multi-engine input isolation & controllers (`Input.ts`, `UniversalGamepadController.ts`, `OrbitController.ts`, `FPSController.ts`, `FirstPersonController.ts`, `DeviceOrientationController.ts`):_ scoped pointer/wheel/contextmenu to canvas, kept `keyup` on `<input>`, cached gamepads per frame, cleaned up Joy-Con listeners, normalized wheel/diagonal/deadzone/sensitivity, and guarded async attach.
  - _WebGL1 extension-map warning & tier parity (`WebGLProgramCache.ts`, `tier-parity.json`):_ logged a per-renderer one-time warning when WebGL1 materials request unsupported anisotropy or iridescence maps, and classified GL1/GL2 `instance_field_depth_equal_color` and GL1 `anisotropy_map`/`iridescence_maps` as `deliberate`.

- **Housekeeping & Docs:**
  - _Dependency audit & TypeDoc minimatch shim (`package.json`, `package-lock.json`, `.agents/scripts/typedoc-shim.mjs`):_ resolved remaining `minimatch` vulnerabilities via targeted npm overrides for `@microsoft/api-extractor` and `typedoc` to `^11.0.9`, paired with a TypeDoc glob shim restoring `Minimatch.prototype.matchOne` to achieve 0 audit vulnerabilities.
  - _Full extras release packaging (`packages/*/package.json`, `docs/guides/consuming-the-engine.md`):_ enabled `"swm": { "release": true }` on `vegetation-extras`, `physics-extras`, `geometry-extras`, `artistic-extras`, and `gltf-extensions` so all nine workspace packages ship in GitHub releases.
  - _Preview & canary port isolation (`preview-utils.js`, `goldens/capture.js`, `check-showcases.js`):_ allocated free ephemeral ports via `findFreePort()`, failed fast on premature preview server exit, guaranteed page teardown in `finally`, and added Showcase 30 to `SHOWCASE_WAIT_READY`.

## [0.127.4] - 2026-11-20

### "Well-typed programs cannot go wrong." - Robin Milner

- **Architecture & Bugfixes:**
  - _Readonly scene-graph & behavior encapsulation (`Object3D.ts`, `Scene.ts`, `Camera.ts`, `CameraInterfaceData.ts`):_ encapsulated `_parent`, `_children`, and `_behaviors` behind `readonly` getters (`Scene.objects`, `Object3D.children`, `Object3D.behaviors`, `Camera.behaviors`) so direct array mutation bypasses fail at compile time with zero runtime overhead.
  - _Maker behavior registration & non-mutating world export (`MakerApp.ts`, `ProjectBinding.ts`, `WorldWriter.ts`):_ routed Maker attach/detach through `Object3D.addBehavior()`/`removeBehavior()` so behaviors register in `Scene._behaviorNodes`, added `WorldWriter.write(root, { exclude })` to skip editor nodes without mutating `root.children`, and used `root.remove()` on load.

## [0.127.3] - 2026-11-20

### "Nature does nothing uselessly." - Aristotle

- **Architecture & Bugfixes:**
  - _Scene-graph lifecycle registration (`Object3D.ts`, `Scene.ts`, `PhysicsSystem.ts`, `AbstractRenderer.ts`):_ replaced per-frame whole-tree scans and `is*` prototype getters with attach/detach-maintained lists (`lights`, `directionalLights`, `fogVolumes`, `skinnedMeshes`, `behaviorNodes`, `physicsNodes`), eliminating `O(N)` tree walks and manual type casts.
  - _Hot-path batching, program-key & flag-mask optimization (`Scene.ts`, `AbstractMaterial.ts`, `WebGL1Renderer.ts`, `WebGL2Renderer.ts`):_ flattened `opaqueLookup` to a single `Map` with material batch caching (`_fastBatchByMat`), cached `WebGLProgramCacheEntry.key`, added `RenderManifest.flagMask` for `O(1)` flag checks, and cached `PostProcessingGroup` TAA/Flash elements.
  - _Type guards (`TextureArray.ts`, `InstancedMesh.ts`):_ replaced `"isTextureArray" in tex` checks with `isTextureArray()` across materials and WebGL/WebGPU texture managers, and unified remaining `instanceof InstancedMesh` checks in `WebGL2Renderer`/`WebGL2PointShadows` on `isInstancedMesh()`.

## [0.127.2] - 2026-11-20

### "Efficiency is doing things right; effectiveness is doing the right things." - Peter Drucker

- **Architecture & Bugfixes:**
  - _Zero-GC render-list & subgroup hot paths (`Scene.ts`, `WebGL1Renderer.ts`, `WebGL2Renderer.ts`):_ replaced `.length = 0` backing-store drops with fill cursors (`_transparentFill`, `_decalsFill`), hoisted transparent sorting to a Schwartzian index sort, adopted `splitByInstancing` in WebGL1, and eliminated per-subgroup `shaderFlags` spreads and `Object.values(manifest.textures)` allocations.
  - _WebGPU anisotropy & iridescence maps (`GPUPipelineCache.ts`, `structs.wgsl`, `lighting_pbr.wgsl`):_ wired bindings 32–34 (`u_anisotropyMap`, `u_iridescenceMap`, `u_iridescenceThicknessMap`) with `IRIDESCENCE_MAPS_SHARED` and budget-drop ordering so WebGPU matches WebGL2 PBR extension map parity.
  - _WebGPU `device.lost` fail-closed & EVSM cleanup (`WebGPURenderer.ts`, `CascadedShadowPassGPU.ts`):_ added idempotent `_isDestroyed` cleanup on unexpected `device.lost`, deferred EVSM texture destruction on light removal, and added a one-time warning when glTF assets contain unsupported morph targets.
  - _IEC sRGB transfer, cofactor normals & planar cascades:_ aligned shader `sRGBToLinear`/`linearToSRGB` with IEC transfer curves, switched WGSL/GLSL2 vertex normals to cofactor transforms, added planar cascade selection with per-cascade normal offsets, and fixed `swm lod` Meshoptimizer WASM readiness.

- **Housekeeping & Docs:**
  - _Audit sweep & CI tour wiring (`docs/research/audit-sweep-2026-11-20.md`, `tier-parity.json`):_ wired Showcase 53 into the prev/next tour (`52 <-> 53 <-> 50`), updated showcase counts to 52, resolved docs/ADR drift, added READMEs to all extras packages, and documented cross-tier parity rows.

## [0.127.1] - 2026-11-19

### "Fast is fine, but accuracy is everything." - Wyatt Earp

- **Architecture & Bugfixes:**
  - _Showcase 53 — laptop GPU 60 FPS optimization (`showcase.ts`):_ set default `quality.maxPixelRatio` to `1.15` (`1987×1284`), disabled default screen-space HBAO in favor of 4K Cycles-baked `armor_ao`/`rock_ao`, reduced `PlanarReflectionNode` to `512×512`, `OceanGridGeometry` to `128×160`, `RainStreaks` to `4500`, and `vfog.samples` to `12` — lifting close-ups on Apple Silicon WebGPU from `28.2–30.4` to locked `60.0 FPS` and WebGL2 from `10.1–20.3` to `44.8–60.0 FPS`.

- **Housekeeping & Docs:**
  - _Showcase 53 — opt-in quality toggles & dev log (`Hud.ts`, `docs/log.md`):_ added live **`HBAO AO`** and **`HiDPI 1.5×`** controls inside the inspector drawer (`#btnHbao`, `#btnHiDpi`, `window.__qaSwm53.{setHbao,setHiDpi}`) so desktop GPUs can opt back into full SSAO/Retina scaling, and documented Metal GPU profiling measurements in `apps/showcases/53/docs/log.md`.
  - _Showcase 53 — CC0 Space Trooper & ship rename (`deck_props.glb`, `showcase.ts`, `REFERENCES.md`):_ replaced the deck-guard placeholder with Iar's posed BlendSwap CC0 trooper + Quaternius CC0 carbine (`12,820` tris, `1.82 m`, `minY = 0.000`) plus a `1.95 m` mirror-chrome Commander with red-trimmed shoulder cape (`1,424` tris), and renamed ships/code/GLBs to _Tri-Wing Shuttle_ (`tri_wing_shuttle*.glb`) and _Hex-Wing Fighter_ (`hex_wing_fighter.glb`).

## [0.127.0] - 2026-11-19

### "Great things are done when men and mountains meet." - William Blake

- **Features:**
  - _Showcase 53 — 1:1 `485 m` basalt monolith & detailed hangar deck:_ scaled Dark Fortress to canonical _Obi-Wan Kenobi_ proportions (`fortress.glb`, `36,918` tris, `y = -45..485 m`), adding `20.0 m` Tri-Wing shuttles, 16 ceiling-racked Hex-Wing fighters, 28 `1.82 m` Space Trooper figures, sweeping wing `SpotLight` beams, `Digit5` _Basalt Trench_ camera, and live _Ocean & Surf_ HUD sliders.
  - _Showcase 53 — 4K Cycles-baked WebP PBR materials:_ upgraded all 13 primary fortress maps (`armor_*`, `trim_*`, `rock_*`) to `4096×4096` WebP (`-lossless` data maps, `-q 92` albedo), pairing asymmetric Imperial durasteel plates, recessed hex grates, and rain puddles with non-periodic Mustafar obsidian-slate photogrammetry.
  - _Showcase 53 — curved preset camera fly-throughs:_ replaced instant jumps on `1`–`5`, HUD preset buttons, and `R` with smooth Catmull-Rom polar arcs (`CameraFlyToBehavior`, `Easing.easeInOutCubic`, `1.65–3.15 s`) maintaining `y >= 16 m` wave clearance and tapered fortress hull clearance, with instant `WASD`/pointer interrupt.

- **Architecture & Bugfixes:**
  - _Showcase 53 — planar outer basalt flanks:_ removed Geometry-Nodes periodic sine strata (`strata_amp = 0.0`, `sharp_deg = 44°`) and `8×`/`16×` horizontal rock texture bands to eliminate distant Nyquist washboard ribbing across the outer obelisk walls.

- **Housekeeping & Docs:**
  - _Showcase 53 — concept dossier, ADR 0058 backups & provenance:_ added `apps/showcases/53/docs/concept-dossier.html`, recorded external Poly Haven/ambientCG CC0 sources and generator hashes in `REFERENCES.md` and Google Drive `MANIFEST.txt` (ADR 0058), and updated `apps/showcases/53/docs/log.md`.

## [0.126.0] - 2026-11-18

### "The sea is everything. It covers seven tenths of the terrestrial globe. Its breath is pure and healthy." - Jules Verne

- **Features:**
  - _Open ocean subsystem (`OceanGridGeometry`, `OceanMaterial` & `OceanFftSystem`, ADR 0062):_ 3-tier ocean mesh (`2400 m` radius, `30,721` `Uint16` verts, `snapToTarget`) and `OceanMaterial` (`MaterialType.OCEAN`) with 5-octave Gerstner swells, WebGPU `256x256` JONSWAP IFFT (`ShaderFlag.OCEAN_FFT`), 3-layer normal cascade (`OceanWaveNormalGenerator`), Tokuyoshi Specular AA, Fresnel IBL + planar reflection, crest SSS, Worley foam/caustics, downwash, and CPU `sampleWaveAt`.
  - _`RainStreaks` — camera-Y tracking:_ added `RainStreaksOptions.followCameraY` so precipitation boxes wrap vertically around `[cameraY - height / 2, cameraY + height / 2)` for elevated and flying cameras.
  - _Showcase 53 — Dark Fortress (Wassermond):_ added the canonical 76 m split-blade Imperial fortress showcase featuring 2K CC0 PBR durasteel/basalt materials with `boreSurge` + `drainFilm` waterline wetness, camera-tracked JONSWAP FFT storm ocean, `PlanarReflectionNode`, buoyant perimeter signal buoys, shuttle rotor downwash, shallow-water caustics, storm lightning flashes (`F`), `RainStreaks`, and `SmokeSpriteMaterial` sea-spray mist.

- **Architecture & Bugfixes:**
  - _Opaque-ocean render sub-phase (`"main:ocean"`, ADR 0062):_ `MainRenderPass` (WebGPU) and `WebGLMainPass` (WebGL2/WebGL1) capture pre-ocean solid color and depth immediately before drawing `MaterialType.OCEAN` batches and preserve ocean depth and `g_shadingNormal` writes for downstream decals, transparents, HBAO, and Volumetric Fog; `WebGPURenderer` also selects `REPEAT` samplers when a material binds `u_normalMap` without `u_diffuseMap`.

- **Housekeeping & Docs:**
  - _ADR 0062, domain glossary & mathematical references:_ recorded ADR 0062 (Phases 1–3), added **Open Ocean** to `CONTEXT.md`, and documented Tessendorf/JONSWAP FFT, Cooley-Tukey Radix-2 IFFT, Worley cellular foam/caustics, and Tokuyoshi Specular AA in `REFERENCES.md`.

## [0.125.0] - 2026-11-13

### "Simplicity is about subtracting the obvious and adding the meaningful." - John Maeda

- **Architecture & Bugfixes:**
  - _`WebGL2Renderer` manager decomposition:_ extracted six cohesive manager classes under `packages/engine/src/renderers/WebGL2/managers/` (`WebGL2ClusterManager`, `WebGL2GlobalUniformWriter`, `WebGL2InstanceManager`, `WebGL2OpaqueCapture`, `WebGL2RenderTargetManager`, `WebGL2ShadowManager`).
  - _`gltf-extensions` vendor WASM assets:_ restored tracked Basis Universal and Draco WASM decoder binaries and wrappers under `packages/gltf-extensions/vendor/`.

- **Housekeeping & Docs:**
  - _Honest test doctrine — WAS & WANN (ADR 0044, `AGENTS.md`, `coding-guide` §5):_ codified what gets unit-tested (pure math/invariants, layouts, parsers, state transitions, bug reproductions; zero trivial getter/setter, delegation, `_field` white-box, or GPU-mock tests) and when tests are written (at milestone completion, never mid-flight).
  - _Multi-tier showcase verification (`test:canary`, `test:spectrum`):_ added `npm run test:canary` (`10,28,30,37,40,48,52`) and `npm run test:spectrum` (`4,6,10,13,14,23,26,28,30,34,37,40,41,42,48,50,51,52`) running sequentially across all three renderer tiers (`WEB_GL1`, `WEB_GL2`, `WEB_GPU`), asserting crash-free honest fallback on lower tiers.
  - _Test suite audit & purge:_ audited all 562 test files against ADR 0044 — removed 63 pure-noise files and pruned 102 mixed files (`-14,933` lines across 167 files; 511 Vitest suites / 4,231 tests retained).
  - _Instruction consolidation:_ merged `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` and reduced `CLAUDE.md` and `GEMINI.md` to concise `@AGENTS.md` pointers.

## [0.124.0] - 2026-11-13

### "Tools should be invisible — the work is the point." - Small World Machine Doctrine

- **Features:**
  - _`SceneParams` class:_ new `ForgeTool` subclass providing live numeric sliders for runtime parameter tuning; integrated into `AbstractShowcase` as `this.sceneParams` for showcase debugging, lighting tweaks, and exploration.
  - _Showcase 27 — live ambient light control:_ ambient light intensity exposed via `SceneParams` slider for real-time lighting adjustments.
  - _Showcase 33 — `Hud` class for HZB occlusion culling:_ standalone drawer panel with sliders for lighting, occluder wall, ground, and hidden field material parameters; keyboard toggle `I` for open/close.
  - _DevTools auto-integration:_ `attachDevTools` automatically opens a "Scene Params" window when an app exposes registered `SceneParams`, eliminating manual setup.

- **Architecture & Bugfixes:**
  - _`AbstractShowcase` — `sceneParams` property:_ exposes the `SceneParams` instance on the base showcase class for derived classes to register parameters.
  - _`AbstractShowcase` barrel export:_ `SceneParams` added to `index.ts` export list.

## [0.123.0] - 2026-11-13

### "The universe is under no obligation to make sense to you." - Neil deGrasse Tyson

- **Features:**
  - _`vegetation-extras` — species loader, forest lighting & ground cover:_ extracted `loadVegetationSpecies`, `collectVegetationParts`, `mergeVegetationParts`, `canopyCoverageAt`, `canopyHeightFade`, `buildCanopyGroundAo`, `ForestLookBlender`, `GroundCoverSystem`, `GrassVariety`, `buildGrassClumpGeometry`, and `MEADOW_GRASS_VARIETIES` into `@small-world-machine/vegetation-extras`.
  - _Canopy ambient occlusion (ADR 0059 step 6a):_ added `buildCanopyCoverage` and `InstanceFieldSystemSetup.canopy` to darken ambient shading below tree crowns and on ground `aoMap` targets.
  - _Instance-field discard-free colour pass:_ WebGPU field colour pipelines test `depthCompare: "equal"` against the `@invariant` depth pre-pass, reducing colour-pass GPU time by 12–31% on Apple M4 Pro.
  - _Instance-field albedo texture arrays (ADR 0059, WebGPU):_ added `InstanceFieldSystemSetup.albedoArray` (`TextureArray`) and per-vertex `GeometryDataInterface.materialLayers` with mip-scaled alpha cutout (`FIELD_ALPHA_MIP_SCALE`).
  - _Showcase 51 — Jacaranda forest, ground cover & HUD upgrades:_ added 4-level Poly Haven Jacaranda LOD species assets, 7 grass/flower cover species, `?look=auto|meadow|forest|off` presets, free-fly handoff (`0`), simplified `?lodMode` controls, and CPU `PressureObserver` + wrapping HUD readouts.
  - _Ground cover V2 — curved grass clumps & hash fixes (ADR 0059 step 1b):_ fixed packed pose `Uint32Array` decoding and murmur3 `fmix32` per-tile jitter; renders 14-blade curved clumps with 0.5 m travel-gated ring rebuilds.
  - _`swm lod` — offline glTF LOD generator CLI (`packages/tools`, ADR 0059 P2-3):_ added headless `meshoptimizer` pipeline (`core/lod.ts`, `cli/lodCommand.ts`) emitting deterministic `<stem>_LOD0..N.glb` chains with `--verify`; opt-in `?reallod=1` in showcase 51.
  - _LOD buckets, `LodTransitionMode` & dithered crossfade (ADR 0059 step 2):_ added cull-side LOD-bucket selection, optional 8×8 Bayer crossfade band, main-camera bucket reuse for shadows, and declarative `LodTransitionMode` presets (`LOD_TRANSITION_MODES`; `hysteresis` default).
  - _Procedural ground-cover ring (ADR 0059 step 1b):_ added camera-centered `GroundCover` ring fed zero-allocation via `InstanceFieldSystem.uploadRecords()`, sharing wind and shadow reception (`maxViews: 1`).
  - _Field-lane wind & live toggle (ADR 0059 step 1b):_ wired `WindField` / `SwmWind` uniforms (`windUniforms`, `windHeight`) into `field_pull.wgsl` across depth, shadow, and color passes, with runtime `InstanceFieldSystem.setWind()` toggling.
  - _Instance-field PBR shading & GPU cull lane (ADR 0059 step 1):_ added WebGPU compute cull + `drawIndexedIndirect` (`InstanceFieldSystem`) with GL CPU-cell fallback (`InstanceFieldGL`), Lambert sun + CSM shadows, IBL, and ADR 0060 leaf backlight.
  - _Render loop zero-GC & O(1) `TextureHoldings`:_ added versioned `textureSetVersion` diff skipping (19 → 0.6 ms/frame) and eliminated per-object/per-pass render-manifest and scratch-array allocations (13.1 MB → 69 KB JS alloc/frame).
  - _Auto exposure / eye adaptation (ADR 0061):_ added `AutoExposureElement` (`PostProcessingEffectType.AUTO_EXPOSURE`) for WebGPU and WebGL2 via GPU 16×16 log-luminance metering; WebGL1 stays static.
  - _`StandardMaterial.backlight` — thin-surface sun transmission (ADR 0060):_ added wrap + forward-lobe sun transmission (`ShaderFlag.BACKLIGHT`) with offset transmission shadows on WebGPU/WebGL2 (unshadowed on WebGL1).
  - _Foliage look presets & Showcase 52 (`Foliage Look Lab`):_ added `FOLIAGE_LOOKS` presets and `applyFoliageLook()` in `vegetation-extras` alongside Showcase 52 (`1–4`, `L`, `K`, `X`, spectator flight).
  - _`@small-world-machine/vegetation-extras` — shared wind field (ADR 0059 step 1b):_ new package providing periodic gust-wave `WindField` and parity `WIND_FIELD_WGSL` / `WIND_FIELD_GLSL` shader chunks.
  - _Tone curves — PBR Neutral default, AgX, ACES Hill & Extended Reinhard:_ unified operators in `TONE_OPERATORS` / `WGSL_TONE_OPERATORS` (`ToneMappingMode.PBR_NEUTRAL` default) and added `quality.toneMapping` forward selection, removing the dead `ToneMapping` string enum.
  - _Showcase 9 — Kenney CC0 textures, skeletal locomotion & crawl tunnel:_ upgraded block faces to Kenney CC0 pixel textures, added 5-state skeletal `AnimationMixer` clips (`jump`, `crouch`, `crawl`), and added low-ceiling crawl tunnels.
  - _Standalone release packaging (`pack-release.mjs`):_ added `.agents/scripts/release/pack-release.mjs` to pack `"swm": { "release": true }` packages (`engine`, `vfx-extras`, `liquid-extras`, `tools`) and exported `mulberry32`.
  - _Particle System Stages 3 & 4 (`@small-world-machine/vfx-extras`) & Showcase 46:_ added soft-depth smoke fade and closed-form 6-way volume light (`SmokeSpriteMaterial`), `ParticleLightPool`, `ParticleTrailRenderer`, WebGPU `GPUParticleSystem`, `WeatherHeightfieldCollider`, and `Particle Physics Lab` (Showcase 46).
  - _Khronos glTF reference labs — Showcases 47, 48, 49 & 50:_ added `PBR Reference Lab` (`MetalRoughSpheres` + neutral lightbox IBL), `Fox Skinning Lab`, `Unlit Reference Lab`, and `Interactive Chess Set` (`ABeautifulGame` streamed via `AssetManager.streamBinary` + `@small-world-machine/gltf-extensions`).
- **Architecture & Bugfixes:**
  - _WebGL1 `OES_element_index_uint` & GPU skinning:_ enabled `OES_element_index_uint` (with ADR-0043 fallback) for 32-bit Draco indices and ported `USE_SKINNING` (`u_boneMatrices[64]`) to `glsl100`.
  - _Transmission pass classification & KTX2 probe leak:_ routed `ShaderFlag.TRANSMISSION` materials to `renderList.transparent` (`Scene._collectVisible`) and memoized `detectBestBlockFormat()` with `WEBGL_lose_context` cleanup (`gltf-extensions`).
  - _Planar-reflection resolution scaling (ADR 0035):_ added `QualityConfig.reflectionResolutionScale` (`0.5` on `LOW` tier) and `PlanarReflectionNode.resolutionScale`.
  - _WebGPU extension texture maps & budget resolver (ADR 0054):_ enabled clearcoat, sheen, transmission, and specular maps (`@group(1)` bindings 21–29) behind WGSL conditionals and `GPUPipelineCache._fitFlagsToBudget`.
  - _`KHR_materials_unlit` support (all tiers):_ added `ShaderFlag.UNLIT` / `StandardMaterial.unlit` and `GltfMaterialParser` mapping across GLSL 100/300 and WGSL.
  - _Overlay cache, renderer imports & `RemoteChessSmoke` fix:_ extracted `editorOverlayViewChanged` (`tunnel-stage`), aligned `WebGPURenderer` WGSL particle imports, and removed a dead `BasisTranscoderFormat` import.
- **Housekeeping & Docs:**
  - _ADR 0058 — Originals stay out of git:_ standardized external SHA-256 origin backups (`raw/`, `tripo-*`, `.blend`, `.fbx`) and `.gitignore` rules; updated ADR 0009 and `CONTEXT.md`.
  - _ADR 0047 & ADR 0059 documentation:_ registered 10 canonical S34 particle invariants, fixed `PrototypeDescriptor.lodBuckets` JSDoc (`bucket 0 = coarsest`), documented `swm lod` in `docs/guides/asset-pipeline.md`, and thawed `InstanceFieldCull.test.ts` S2 tests.
  - _Engine asset cleanup & showcase gate hooks:_ removed 1.4 GB of game-world kits (`kits/index.json` keeps `industrial` only) and added `SHOWCASE_WAIT_READY` (`check-showcases.js`), `ParticleTrailRenderer.dispose()`, and showcase 46–50 tour wiring.

## [0.122.0] - 2026-11-01

### "Knowing is not enough; we must apply. Willing is not enough; we must do." - Johann Wolfgang von Goethe

- **Features:**
  - _Showcase 9 — 2.5D side-scroller camera, rigged character & zero-GC collision:_ switched to deterministic 2.5D tracking via `CameraStrategyType.MANUAL` (5° elevation, fixed Z offset, horizontal lead, `_expDecay` jump damping), added a rigged 3D hero (`AnimationMixer` Idle/Run, lime-cube fallback), and precomputed `_staticBlockBounds` (>14,400 GC allocs/s eliminated).
  - _Showcase telemetry footer (`ShowcaseDrawer`):_ added a zero-GC status footer displaying FPS, smoothed CPU frametime, and `% Headroom` against display refresh (auto 60 Hz / 120 Hz ProMotion) with a 3-tier traffic-light indicator (>40% / 15–40% / <15%) and ~4 Hz updates (0 DOM cost when closed).
  - _Showcase 13 — Damaged Helmet PBR Inspector Lab:_ interactive `ShowcaseDrawer` HUD with 4 lighting moods (`studio`, `cyberpunk`, `highnoon`, `noir`), live spotlight/sun/ambient/roughness/metallic/clearcoat/bloom sliders, and camera presets.
  - _glTF `KHR_draco_mesh_compression` (`@small-world-machine/gltf-extensions`):_ replaced the throwing stub with `DracoWasmDecoder` wrapping vendored Apache-2.0 Draco WASM (`vendor/draco/`, lazy init); decodes triangle attributes (`POSITION`, `NORMAL`, `TANGENT`, `TEXCOORD_0`, `JOINTS_0`, `WEIGHTS_0`) and Uint16/Uint32 indices, removes dead `decoderPath`/`workerLimit` options from `DracoDecoderConfig`, and rejects point clouds.
  - _glTF `KHR_texture_transform` & `KHR_materials_specular`:_ added vertex UV rotation `u_texRotation` across all tiers and `StandardMaterial.specularFactor` / `specularColor` (`u_matParam12`/`13`, `F_Schlick90` / `F_SchlickRoughness90`); `specularMap` / `specularColorMap` sample on WebGL2 only (`USE_SPECULAR_WEIGHT_MAP` / `USE_SPECULAR_COLOR_MAP`, ADR 0054).
  - _Iridescence performance-tier switch (`quality.cheapIridescence`, ADR 0055 / ADR 0035):_ defaults to `false` (`true` on `LOW` tier, explicit author values override); injects `USE_IRIDESCENCE_CHEAP` on WebGPU/WebGL2 to evaluate `iridescenceFresnelCheap` while `lint-wgsl.ts` still validates the spectral path.
  - _WebGL2 packed specular & anisotropy/iridescence textures (ADR 0054 / 0055):_ added `USE_SPECULAR_MAPS_SHARED`, `USE_METALLIC_ROUGHNESS_SHARED`, `USE_IRIDESCENCE_MAPS_SHARED`, and WebGL2-only `anisotropyMap` / `iridescenceMap` / `iridescenceThicknessMap`, plus `preprocessConditionals` compile-time gating in `GPUPipelineCache`.
  - _WebGL2 sampler-budget resolver (ADR 0056):_ `SamplerBudget.ts` (`countMaterialSamplers`) counts assembled fragment samplers before linking and drops extension-map groups lowest-priority first (iridescence, specular, anisotropy, sheen, clearcoat, transmission/thickness) with a once-per-group warning when exceeding `MAX_TEXTURE_IMAGE_UNITS`.
  - _glTF `KHR_materials_iridescence` & `KHR_materials_anisotropy` factors (ADR 0055):_ wired `u_matParam14` (Belcour & Barla thin film on WebGPU/WebGL2, two-beam film on WebGL1, `schlickToF0`) and `u_matParam15` (Burley anisotropic GGX + `anisotropyBentNormal` specular IBL) across all three tiers behind `USE_IRIDESCENCE` / `USE_ANISOTROPY`.
  - _Particle System Stage 1 (`Curve1D`, `ColorRamp`, `EmitterShapes`, `ParticleMeshRenderer`, `@small-world-machine/vfx-extras`):_ added baked 64-sample LUTs (`@invariant LIFETIME-CURVE-KEY-EXACTNESS`), `ColorRampAffector`, `CurveOverLifeAffector`, `postIntegrate(system, dt)`, `mulberry32` emitters, and trig-free `velocityStretched` / `OctagonBillboardGeometry` modes (~29% less corner overdraw).
  - _Particle System Stage 2 (`SdfColliderAffector`, `CurlNoiseAffector`, `SubEmitter`, `@small-world-machine/vfx-extras`):_ added zero-GC 16-primitive SDF collisions with `smin` + Newton projection (`@invariant SDF-NON-PENETRATION`), Bridson 3D curl-noise turbulence (`@invariant CURL-DIVERGENCE-FREE`), and `SubEmitter` ring-buffered bursts (21 test files / 165 tests).
  - _Application Persistence Step 5 Part 2 (`SavegameStore` & tombstone IDs, ADR 0041):_ added `OpfsSavegameStore`, `IndexedDbSavegameStore`, `FileSavegameStore`, and `createSavegameStore` (`opfs -> indexeddb -> file`) with pre-migration backups, plus strict `retiredIds` / unique-entity enforcement (`assertNoRetiredIdReuse`, `assertUniqueLevelEntityIds`, 59 tests).
  - _Maker Content-Drawer handoff from Material Studio:_ added `ContentAssetType "material"`, `StudioPbrMaterialData`, `ContentDrawer.addMaterial()`, undoable `applyMaterial`, and `onSendToDrawer` with live ID lookup for drag-and-drop.
  - _Application Persistence Step 4 Part 2 (Localized Runtime Wiring, ADR 0041):_ migrated `ViennaMapModal`, `TerminalModal`, and `room1/2.level.json` hotspots in _Game App_ to `TextResolver` / `ContentPackage.t(id)` (198 keys in `de.json`/`en.json`, 100% parity).
  - _Showcase 40 — Interactive "Decal Probe Lab" HUD:_ added `ShowcaseDrawer` controls for sun/ambient, floor bump presets (`1–3`), normal-probe opacity/edge fade, unlit toggle (`U`), HBAO toggle, and reset (`0`), keeping QA query modes (`?pool=1`, `?wet=1`, `?orm=1`, `?mip=1`) HUD-free.

- **Architecture & Bugfixes:**
  - _Hot-path & zero-GC audit cleanup:_ removed per-frame allocations in Showcases 39 (`_tempMotePos`), 34 (`_orbitCenter`), and 31 (`_dustMatrix`/`_dustPos`/`_dustRot`/`_dustScale`), and replaced `.forEach()` closures in Showcases 14 and 12 with indexed `for` loops.
  - _`GltfLoader` required-extension handling (`packages/engine/src/loaders/GltfLoader.ts`):_ added `KHR_materials_specular` and `KHR_texture_transform` to supported extensions, added an actionable `gltf-extensions/register` error for unbacked Draco/KTX2 streams, and documented policy in `docs/extensions/gltf-extensions.md`.
  - _Showcases 17 & 18 multithreading & `ModelGeometryOptions.wireframeIndices`:_ moved terrain normal/UV/tangent/wireframe/`headerBounds` computation into worker tasks for $O(1)$ main-thread setup, yielded a `requestAnimationFrame` before CPU benchmarks, and added `ThreadPool.destroy()` cleanup.
  - _`InstancedMesh` partial upload & zero-count skip:_ `WebGPURenderer` skips `instanceCount === 0` draws and uploads only `instanceCount * stride` floats; WebGL2/1 allocate capacity once and stream active `0..instanceCount` slices via `gl.bufferSubData` (resetting `_instanceMatrixBuffers` on `onContextRestored`).
  - _`ParticleMeshRenderer` compaction & trig-free billboarding (`@small-world-machine/vfx-extras`):_ `sync()` compacts live slots (`0..liveCount`), zeroes only the shrunk tail, and builds `yaw`/`spherical`/identity matrices in-place without trig or `Matrix4.compose`.
  - _Asset linter test stability (`tests/scripts/lintAssets.test.ts`):_ invoked `tsx` via `process.execPath` directly with explicit 20s timeouts to avoid parallel test runner shell timeouts.
  - _Build optimization & Showcase 42 script consolidation:_ switched production builds to esbuild + incremental public asset checks (~14x faster, 4.3s → ~300ms), consolidated soft-shadow/EVSM live gates into `.agents/scripts/check-swm42.mjs`, and removed 3 obsolete one-off scripts.

- **Housekeeping & Docs:**
  - _Showcase living logs:_ added `apps/showcases/9/docs/log.md`, `apps/showcases/13/docs/log.md`, and `apps/showcases/40/docs/log.md` Lab entry; updated `.agents/MEMORY.md` §4-H / §5.
  - _`ShaderFlag` enum (`src/enums/ShaderFlag.ts`):_ replaced magic `"USE_*"` strings across all materials, renderers, and `GPUPipelineCache` (`declareWgslFlag`) with 37 typed constants guarded by `ShaderFlag.test.ts`.
  - _ADRs & material parity tests:_ added `docs/adr/0054-gltf-specular-textures-webgl2-only.md`, `docs/adr/0055-iridescence-and-anisotropy-on-standardmaterial.md`, and `MaterialSpecularLane.test.ts`.
  - _Particle architecture & SDF collision research:_ added `docs/research/particle-architecture-and-sdf-collision-2026-10-30.md` and indexed it in `docs/research/index.md`.
  - _Repo documentation & memory cleanup:_ codified the compact technical English standard in `AGENTS.md` and compressed `.agents/MEMORY.md` (~80% token reduction) and `.agents/BACKLOG.md`.

## [0.121.0] - 2026-10-30

### "Fire is catching! If we suffer arson, we shall have to die." - Emily Dickinson

- **Features:**
  - _`Fire` composition prefab (`@small-world-machine/vfx-extras`):_ composes flame, glow, practical light, embers, smoke, ember bed, and soot from `candle`/`torch`/`campfire` presets in one call with optional `light:` injection (`preserveLightColor: true`) and single-driver `update(dt, camera?, wind?, lean?)`.
  - _`game-app` held torch (`BunkerKit.createHeldTorch`):_ renamed `lantern*` APIs to `torch*`, built a wood/iron held torch with rig-relative velocity flame trailing, and maintained exact zero-GC `MathPool` balance over 1,000 frames.
  - _Showcases 37 & 38 fire prefab integration:_ migrated Showcase 37's hearth (`__qaSwm37`, smoke disabled inside sealed firebox) and Showcase 38's 10 wall torches + brazier (`FireLightBudget` maxActive 11, `__qaSwm38`) to `Fire`.
  - _Fire L3 smoke plume (`FireSmokeEmitter`, `SmokeSpriteMaterial`, `SizeGrowthAffector`):_ seeded world-anchored `ParticleSystem` plume rendered with noise-eroded textureless `SmokeSpriteMaterial` across GLSL300/GLSL100/WGSL and opt-in `ParticleMeshRenderer({ foldAlphaIntoScale: false })`.
  - _Fire L5 ember bed & soot decals (`EmberBed`, `createSootDecalTexture`):_ added seeded ~0.35 Hz breathing emissive ember beds and deterministic `Decal` scorch overlays following ADR 0029 (native box decals on WebGPU/WebGL2, `bakeSceneDecals` on WebGL1).
  - _Showcase 45 smoke/ember-bed/soot layers:_ enabled L3/L5 layers for all 16 fires with size-scaled budgets, HUD toggles `R`/`B`, wind-coupled smoke, and `dt = 0` determinism.

- **Architecture & Bugfixes:**
  - _WebGL1/2 `InstancedMesh` buffer initialization:_ initialized new `instanceMatrices`/`instanceData` WebGL buffers immediately on creation, marked `initInstanceData()` dirty, and skipped `instanceCount === 0` draws to eliminate `GL_INVALID_OPERATION` load warnings.
  - _Showcase 45 ADR 0029 soot decal compliance:_ fixed soot baking across all tiers so native box decals run on WebGPU/WebGL2 and `bakeSceneDecals` runs only on WebGL1.

- **Housekeeping & Docs:**
  - _Fire VFX docs & invariants:_ added `docs/guides/vfx-fire.md`, ADR 0053, `REFERENCES.md` entries (`mulberry32`, fire layer stack), `CONTEXT.md` updates, and Showcase 37/38/45 + `game-app` logs.
  - _`pbr38` golden regeneration & multi-tier acceptance:_ regenerated `pbr38` baselines (byte-identical repeatability confirmed), passed live gates for Showcases 37/38/45 on all tiers, `game-app` 42/42, and `vfx-extras` 115/115.

## [0.120.0] - 2026-10-29

### "He who would learn to fly one day must first learn to stand and walk." - Friedrich Nietzsche

- **Features:**
  - _Showcases 38 & 39 camera flight unification:_ Showcase 38 now flies smoothly via `camera.flyTo(...)` along collision-free portal/atrium waypoints with WASD cancel, `1–5` presets, `R` reset, and unified "Camera Viewpoint" HUD.
  - _Omnidirectional point-light shadows (ADR 0052):_ `PointLight.castShadow` renders 6 cubemap faces into spot-shadow array layers 4–15 on WebGPU and WebGL2 (`PointLightShadow.ts`, up to `quality.maxShadowedPointLights`, default 2 / LOW 0 / MEDIUM 1) with world-meter `shadowBias` (default `0.01` m + 1.5 texels).
  - _Showcase 45 point-light shadows & wind flame shear:_ added point-light shadow toggle (`X`) with shadowed props and sheared flame tips via `FireMaterial.lean`.
  - _Fire P3 embers (`FireEmberEmitter`, `EmberSpriteMaterial`, `@small-world-machine/vfx-extras`):_ deterministic world-anchored sparks using radial additive sprites, `GravityAffector`/`DragAffector`/`ColorOverLifeAffector`, and zero-GC `yaw`/`spherical` billboarding (`H` toggle in Showcase 45).

- **Architecture & Bugfixes:**
  - _WebGL2 clustered lighting overflow (Showcase 39):_ clamped RG32UI cluster index texture height to `MAX_TEXTURE_SIZE` (`clusterIndexCapacity`) instead of ~36,600 rows, eliminating `texImage2D` `INVALID_VALUE` and ~300 MB CPU buffers (`WebGLClusterCullPass.test.ts`).
  - _`GravityAffector` (`@small-world-machine/vfx-extras`):_ added generic constant-acceleration affector for stylized ember/particle buoyancy.

- **Housekeeping & Docs:**
  - _Showcase 20 & `REFERENCES.md`:_ removed duplicate `badge: "Showcase 20"` HUD header and added Catmull-Rom Spline and Exponential Dampening citations to `REFERENCES.md`.

## [0.119.0] - 2026-10-29

### "The first step binds one to the second." - French Proverb

- **Features:**
  - _Showcase 20 "Behavior Lab":_ added interactive `ShowcaseDrawer` panel (`I` / `H` / `⚙`) for live tuning of Bobbing, Rotator, Rainbow, PathFollower, Flicker, TrailRenderer, SpringLerp, LookAt targets, and Bloom.
  - _Application Persistence Step 3 (`levels/`, ADR 0041):_ separated level descriptors into `apps/<app>/levels/` (`room1`, `room2` moved) with `LevelValidation.test.ts` scan enforcement.
  - _Application Persistence Step 4 (`content/<lang>.json`, ADR 0041):_ added `de.json`/`en.json` text catalogs (145 `map.*`/UI/terminal keys), manifest `content.languages` validation (`ContentPackageValidation.test.ts`), `TextResolver` injection in `HotspotManager`/`TerminalModal`, and `preferredLanguage()`.
  - _Application Persistence Step 5 (`savegame.schema.json`, ADR 0041):_ drafted Savegame v1 schema, `SavegameTypes`, `migrateSavegameDescriptor`, `backupSavegameDescriptor`, and `assertSavegameIdReferences` (`SavegameValidation.test.ts`).
  - _Fire P1 & P2 (`FireMaterial`, `FlameGlowMaterial`, `FireLightBehavior`, `FireLightBudget`, `@small-world-machine/vfx-extras`):_ added procedural crossed-card blackbody/palette flames (`SPECTRAL`, `WISP`, `CURSED`), seeded `FireFlickerProfile` point-light modulation (`flicker` 0..1), and camera `FireLightBudget` alongside Showcase 45 "Fire VFX Lab".

- **Architecture & Bugfixes:**
  - _Showcase 20 overhaul:_ fixed backward spaceship orientation (`-Math.PI / 2`), switched floor to lit `StandardMaterial` receiving shadows, replaced companion allocation with zero-GC `CompanionFollowBehavior`, removed canvas pointer-lock, and added clean behavior reset states.
  - _WebGPU mipmap blit pipeline per format (`GPUTextureResourceCache`):_ fixed per-frame invalid command buffers on `bgra8unorm` planar-reflection render targets in Showcase 30 (`WebGPUMipmapGeneration.test.ts`), and updated hover-car GLB image URIs to `colormap.webp`.
  - _Showcase tour navigation without ID lists:_ `◀/▶` controls now follow `index.html` `prev`/`next` attributes (`showcase-layout` plugin) and Vite/QA scripts scan showcase folders directly (`showcaseWiring.test.ts`).
  - _Showcase 45 & fire shader polish:_ attached `FireLightBudget` after `start()` so the fly controller installs properly, tapered `FireMaterial` flame tips below card top edges, and added `packages/vfx-extras/src/fire` to `lint:glsl` / `lint:wgsl`.

- **Housekeeping & Docs:**
  - _Unified `ShowcaseDrawer` & naming conventions:_ extracted `apps/showcases/shared/ShowcaseDrawer.ts` and migrated 11 showcase HUDs (~2,900 duplicated lines removed); standardized `Showcase`, `Hud`, `HudState`, and `HudActions` names without header badges.
  - _Docs & Showcase 45 tour wiring:_ added Showcase 20 `log.md` + `BehaviorLab.test.ts`, updated `CONTEXT.md` glossary and ADR 0041 status, and wired Showcase 45 into the 44-demo tour with `concept-dossier.html` and `log.md`.

## [0.118.0] - 2026-10-28

### "Man is a tool-using animal. Without tools he is nothing, with tools he is all." - Thomas Carlyle

- **Features:**
  - _Application Persistence Steps 1 & 2 (ADR 0041):_ added `public/schemas/app.schema.json` (`APP_SCHEMA_VERSION = 1`, `assertAppManifest`) and `app.json` manifests for sample apps (`AppManifestValidation.test.ts`), plus mandatory `schemaVersion: 1` and `migrateLevelDescriptor()` in `level.schema.json` and `KitRegistry.loadLevel()`.
  - _`swm material`, `swm ibl`, and `swm splatter` CLI (`@small-world-machine/tools`):_ added `derivePbrMaps` material derivation, headless Chrome IBL baking (`--panorama-only` for Node), seeded Canvas2D splatter decals, and `docs/guides/swm-cli.md`.
  - _Planar Reflection Stage 2 — frustum culling, roughness blur & `FluidSurfaceMaterial` parity:_ `PlanarReflectionNode.updateReflection()` skips out-of-frustum reflection passes (up to 50% GPU gain, zero-GC), WebGL2/WebGPU mipmaps drive `reflectionRoughness` (`u_matParam9.z`), and `FluidSurfaceMaterial` gains full 3-tier reflection support.
  - _Big Merge Maker Shell (`#kit`, `#ibl`, `#xtractor`, `#pixler`, `#map`):_ added `maker.html` hash modes, plain-text `KitManifestValidator` report copying (`validationReportText.ts`), preserved `Material` documents across mode switches, updated `index.html` deep links, and removed standalone `xtractor/pixler/map-gen.html` (ADR 0033 Amendment).
  - _`CustomShaderMaterial.flags` & `EXT_texture_webp`:_ custom shaders can request compile flags (with `TextureArray` auto-enabling `USE_TEXTURE_ARRAY` including WebGPU), and `GltfLoader` supports `EXT_texture_webp` via `extTextureWebp`.
  - _2.5D `StageZone` generalization (ADR 0016 / Maker):_ extended walk zones to arbitrary convex/concave $n$-gons via ear clipping (`StageZone.triangles`, `SWM_stage_zone`), added continuous `scaleGradient` (`vanishing-point`), fixed the 90° `getLocalAxes` rotation bug, and wired Maker triangulation (`PolygonFan`, `StageZoneGizmoManager`).
  - _Planar water reflections (`LiquidWaveMaterial.reflectionMap`):_ `OpenWaterMaterial` and `StylizedWaterMaterial` sample distorted planar reflections across all three tiers (`u_matParam9`, `clipBelowPlane`), wired to a shared node in Showcase 10 (`?reflection=0|1`, `docs/guides/liquid-wave-data-model.md` §5.2).
  - _Asset Linter CLI (`npm run lint:assets`) & Showcase 43:_ added 7-check kit model linter (`scripts/lint-assets.ts`, 10 tests in `tests/scripts/lintAssets.test.ts`) and deterministic 1 m studio Showcase 43 (`st43__*` golden baseline).

- **Architecture & Bugfixes:**
  - _Maker tools & WebP kit validation fixes:_ fixed `pbr-gen.html` 3D tab method calls, updated `KitManifestValidator` / `kit.schema.json` for `.webp` previews/textures/decals, and unified Material Studio onto `derivePbrMaps` (`maker.html#material`) with proper drop/paste listener cleanup.
  - _`StandardWebGPULayout` defaults & WebGL2 tonemap parity:_ neutral UBO defaults eliminated 28 ms/frame `UniformPacker` warnings (`StandardLayoutDefaults.test.ts`), and `FluidSurface`/`Glass`/`Frostglass`/`Terrain` aligned Reinhard clamping to the gamma lane (`TonemapGuardParity.test.ts`).
  - _Repo-wide WebP texture standardization (C9) & specular AA (ADR 0051):_ converted runtime textures to WebP (lossless for data maps, `q 90..92` for albedo), added `check:normal-maps` (61/61 clean), enabled WebGPU normal-map mipmaps, and implemented Geometric Specular Anti-Aliasing (Tokuyoshi & Kaplanyan + Toksvig).
  - _Rendering, culling, collision & loop-order fixes (S1/S3/S5/E10/R5):_ fixed visible children clipped by culled parents, froze cascade offset (`k = 1.2` `@fixed`), fixed WebGPU bitangent sign, ordered `Physics → Render → Camera → Lights → Cull → Draw` (`notifyCameraTeleport()`), unified `Scene.staticColliders` (`staticOctree`), fixed glTF `baseColorFactor`/skinning/quantized import, and added `domainScale` invariance.
  - _Unified sRGB `Color` & post-processing color space (ADR 0048 / 0049 / 0050):_ decoded IBL `irradiance`/`prefilter` as sRGB (`--linear` removed), separated asset 2.2 decoding from `displayToTarget` with active post-processing, made every `Color` sRGB with `Color.toLinear`/`toTarget`, and migrated shader/showcase color constants.
  - _WebGL2 16-unit overflow & audio/asset fixes:_ consolidated 4 spot shadow maps into one `sampler2DArrayShadow` and gated EVSM behind `USE_EVSM`, fixed Showcase 38 `audio.load` arg swap + HTTP diagnostics, and fixed Showcase 39 `.webp` masonry paths.

- **Housekeeping & Docs:**
  - _Golden tooling & deterministic verification:_ generalized golden scripts to showcases (`pbr38__`/`fog39__`, optional `--metric flip`), added chunking/fuzz/seed-pinned tests, and registered +15 invariants (ADR 0047).

## [0.117.0] - 2026-10-23

### "Structure is the essence of freedom." - Frank Lloyd Wright

- **Features:**
  - _`CameraFlyToBehavior` & spline flight:_ reusable Bézier and Catmull-Rom spline camera behavior with `easeInOutCubic` easing and `camera.flyTo(...)`, `camera.cancelFlight()`, and `camera.isFlying`.
  - _Showcase 39 — Mystic Leyline & archway flight:_ added archway flight into the chamber and a 6-point spline leyline orb with a dynamic point light and 24 double-helix particles.

- **Housekeeping & Docs:**
  - _Architectural doctrine (`VISION.md`, `AGENTS.md`):_ anchored the Godot & PlayCanvas north-star doctrine (modular simplicity, fast iteration, honest abstractions, browser-native zero-GC discipline).

## [0.116.0] - 2026-10-22

### "In God we trust; all others must bring data." - W. Edwards Deming

- **Features:**
  - _EVSM opt-in shadows (ADR 0043, `quality.shadowMode="evsm"`):_ added exponentially warped variance moments ($c = 40$) with Chebyshev bounds, dynamic variance floor, and light-bleed reduction on WebGPU (`textureLoad`) and WebGL2 (`RGBA32F` behind `EXT_color_buffer_float`); `pcss` stays byte-identical (`EvsmGlslGuards.test.ts`).
  - _Showcase 42 — EVSM probe & Soft Shadow Lab HUD:_ added `?shadowMode=<pcss|evsm>` reading `evsmParams` `[216..218]` and an interactive `ShowcaseDrawer` HUD (`Box`/`Pole`/`Step Rig`, caster lift, live `PCSS`/`EVSM`, penumbra/angle/bias sliders, UBO telemetry).
  - _Sprite scene fog & `bakeImposter.groundAtBottom`:_ `Sprite.frag.{wgsl,glsl,glsl100}` apply `scene.fog` matching lit PBR shaders (`SpriteFog.test.ts`), and `bakeImposter.groundAtBottom` anchors grounded tree/character sprites flush at the bottom edge (`ImposterBaker.test.ts`).

- **Architecture & Bugfixes:**
  - _WebGPU & WebGL2 EVSM runtime fixes:_ switched WebGPU `getEVSM()` to `textureLoad` on an `unfilterable-float` binding, gated `_bindEvsmShadowUniforms` outside EVSM mode, restored `gl.clearColor` after moment passes, exempted `u_dirEVSMMap` from material sampler loops, and resolved its unit collision with `CLUSTER_GRID_UNIT=14`.
  - _EVSM contact quality & anti-ghosting (`pcss`, HBAO, Froxel):_ added horizon clamping, 25-tap N-rooks lattice, `occluderDepth`, and GL2 front-face moments (`baseGapRows` 0.609/0.607), 16-tap IGN Vogel `spotLightPCSS` (`SpotLightPCSS.test.ts`), Bayer HBAO + Z-jump penalty (`AORadiusStructure.test.ts`), and unjittered 3-point WebGPU froxel quadrature.

- **Housekeeping & Docs:**
  - _EVSM gate, docs & Showcase 34 grounding:_ added `scripts/check-swm42-evsm.mjs` (`domcontentloaded` + `paintReady`), ADR 0043, `docs/guides/shadows.md` EVSM section, Showcase 42 log, and Showcase 34 grounded back-row imposters with subtle horizon haze.

## [0.115.7] - 2026-10-21

### "Shadow owes its birth to light." - John Gay

- **Features:**
  - _Showcase 42 — Contact hardening pole probe (`?probe=pole`):_ added a thin pole caster rig demonstrating PCSS contact hardening (WebGPU near-umbra contrast `0.61` vs. far `0.26`; WebGL2 negative control `0.60/0.60`).

- **Architecture & Bugfixes:**
  - _PCSS pole findings & parser fixes:_ confirmed fixed 16-tap sunflower blocker search already yields contact hardening on thin occluders (box blockers remain uniform by geometry) and fixed `softness=0` parsing, `this._params` initialization before `super()`, and `parseNum()` treating missing query params as `0`.

- **Housekeeping & Docs:**
  - _Committed `check-swm42-pole.mjs` gate & shadow docs:_ added `scripts/check-swm42-pole.mjs` (`SWM42 POLE GATE: OK`, full suite 2,539/2,539) and aligned `docs/guides/shadows.md`, `docs/adr/0006`, and Showcase 42 `docs/log.md`.

## [0.115.6] - 2026-10-21

### "There is no sun without shadow, and it is essential to know the night." - Albert Camus

- **Architecture & Bugfixes:**
  - _PCSS hardening in `getShadowPCSS` (`pbr_math.wgsl`):_ replaced legacy `bias` division saturation with perspective-normalized receiver/blocker depth difference on a deterministic 16-tap sunflower disk, documenting uniform box-blocker penumbra limits in `shadows.md` and ADR 0006.

- **Housekeeping & Docs:**
  - _Deterministic gate verification & docs alignment:_ verified bit-identical `SWM42 GATE: OK` determinism (`directionNotNoise >= 0.55`, 0 WebGL2 delta) and updated `docs/guides/shadows.md`, ADR 0006, and Showcase 42 `docs/log.md`.

## [0.115.5] - 2026-10-21

### "To light a candle is to cast a shadow." - Ursula K. Le Guin

- **Features:**
  - _Showcase 42 — Soft Shadow Lab:_ added deterministic WebGPU shadow stage with `window.__qaSwm42` GPU uniform inspection (`[212,213]` `penumbraScale`/`pcfMaxRadius`), verifying localized WebGPU penumbra tuning (`5,362` changed pixels) and WebGL2 no-op parity.

- **Architecture & Bugfixes:**
  - _WGSL syntax fix & Showcase 42 wiring:_ restored missing comma after `shadowSoftness: vec4f` in `structs.wgsl` that broke all WebGPU compilation, and registered Showcase 42 in `vite.config.ts`, `AbstractShowcase`, and `scripts/check-showcases.js`.

- **Housekeeping & Docs:**
  - _Showcase 42 living log:_ documented live gate evidence and `--enable-unsafe-webgpu` headless Chromium findings in `apps/showcases/42/docs/log.md`.

## [0.115.4] - 2026-10-21

### "The darkest place is under the candlestick." - Proverb

- **Features:**
  - _WebGPU PCSS softness knobs (`quality.shadowSoftness`, `quality.shadowMaxPcfRadius`):_ added opt-in ADR-0035-locked quality controls (defaults `1` and `4` stay byte-identical; WebGL2 remains 3×3 PCF).

- **Architecture & Bugfixes:**
  - _`GlobalUniforms` layout extension (`848 -> 864 B` / `212 -> 216` floats):_ appended `shadowSoftness: vec4f` via `GlobalUniformLayout.ts` / `GlobalUniformWriter.ts` / `structs.wgsl` (`GlobalUniformLayout.test.ts`) and wired `penumbraScale` into `getShadowPCSS`.

- **Housekeeping & Docs:**
  - _Shadow softness guide:_ added "PCSS softness tuning (WebGPU)" in `docs/guides/shadows.md` and updated renderer test fakes to 216 floats.

## [0.115.3] - 2026-10-21

### "Clarity is the counterbalance of profound thought." - Luc de Clapiers, Marquis de Vauvenargues

- **Features:**
  - _Showcase 37 lighting, materials & IBL pass:_ added deterministic organic light flicker (`window.__qaSwm37`), tuned vignette/bloom/exposure, raised floor roughness (`0.48 -> 0.8`), baked warm procedural interior IBL (`loadIbl("./assets/ibl/", 0.4)`), softened the accent lamp, and upgraded key shadows (`1024 -> 2048`).
  - _Showcase 4 cinematic camera start:_ switched to an elevated 3/4 entry via `setInitialCamera` syncing position, target, and `Theta`/`Phi`.

- **Architecture & Bugfixes:**
  - _`GridLevelBuilder.build()` spawn resolution:_ added optional `isSpawn` legend flag returning the first matching tile center (`y = 0`) instead of always returning `(0, 0, 0)` (`GridLevelBuilder.test.ts`).

- **Housekeeping & Docs:**
  - _Repository guides audit (`docs/guides/`):_ audited all 33 guides against code (fixing `physics`, `configuration`, `scene-assembly`, `volumetric-fog`, etc.), marked ADR 0005 superseded, repaired dead links, added missing guides to VitePress sidebar, and noted particle-system need for real firebox flames.

## [0.115.2] - 2026-10-21

### "The creation of something new is not accomplished by the intellect but by the play instinct." - Carl Jung

- **Features:**
  - _Showcase 10 PBR grass & `BillboardInstancer` foliage:_ upgraded ground grass to lit `StandardMaterial` with multi-scale Sobel normal/roughness/AO maps and scattered 750 alpha-cutout grass tufts (`grass_tuft.webp`) along pool curbs.

- **Housekeeping & Docs:**
  - _Showcase 10 logs:_ updated `apps/showcases/10/docs/log.md` and `concept-dossier.html`.

## [0.115.1] - 2026-10-21

### "A line is a dot that went for a walk." - Paul Klee

- **Features:**
  - _Showcase 41 & `@small-world-machine/artistic-extras`:_ added `MetalReliefMaterial` (Voronoi impasto, grind streaks, beveling, HSV pop, oxide rust, wet reflections on all 3 tiers), `MetalReliefScreenMaterial`, `MetalReliefPostProcessor`, `camera.project()` wipe-slider split screen, photo drag-and-drop + 3 presets, and 2.5D diorama toggle.
  - _Showcase portal deep-linking & routing:_ `/apps/showcases` redirects via HTTP 302 to `/?filter=showcases`, and `public/index.html` syncs filter state with query/hash via `history.replaceState`.
  - _Showcase 1 geometry switcher & unified TuneHUD:_ added mesh/color pickers to Showcase 1 and rolled out the responsive bottom-sheet TuneHUD design across showcases (`14, 17, 18, 30, 38, 39, 41`).

- **Architecture & Bugfixes:**
  - _Vite clean directory URLs & `packages/artistic-extras`:_ added HTTP 302 directory-index resolution in `vite.config.ts` and created `packages/artistic-extras` (`MetalReliefMaterial`, `ImpastoStrokeMaterial`, `StrokeRaster`, post-processing).

- **Housekeeping & Docs:**
  - _Sample app concept dossiers:_ created `docs/concept-dossier.html` and `docs/log.md` for `yad` and `light-cycle-arena`.

## [0.115.0] - 2026-10-20

### "The most valuable of all talents is that of never using two words when one will do." - Thomas Jefferson

- **Features:**
  - _Thin-lens depth of field (`DepthOfFieldElement`, `PostProcessingEffectType.DEPTH_OF_FIELD`):_ physically based CoC bokeh (64-tap WebGPU, 32-tap WebGL2, tilt-shift fallback on WebGL1) running in linear HDR before bloom (`docs/guides/depth-of-field.md`).
  - _Physically based rain puddles & drop-impact system (`RainPuddleMaterial`, `DropImpactSystem`, ADR 0042a, `@small-world-machine/liquid-extras`):_ level-set puddles with capillary-gravity ring dispersion, dielectric Fresnel (`1.333`), planar ripples, data-driven fluid presets (water, seawater, blood, oils, acids via Weber/Ohnesorge/Reynolds `DropRegime`), Beer-Lambert absorption, and surface bubbles (`u_matParam8..13`).
  - _Showcase 30 rain street rework & Showcase 40 (`Decal Probe`) integration:_ upgraded Showcase 30 to `RainPuddleMaterial`, bare winter trees, `C`/`N`/`F` toggles, and 10,000 lit `RainStreaks` (Marshall-Palmer drops); promoted `apps/showcases/decal-probe` to Showcase 40 across Vite, portal, ring navigation, and `docs/guides/decals.md`.

- **Architecture & Bugfixes:**
  - _Texture standard `flipY: true` default ("Human Convention First"):_ flipped default in `TextureOptions`, `Texture.fromUrl()`, `TextureArray.fromUrls()`, `Texture.fromCanvas()`/`fromImage()`, and `AssetManager.loadImage()` so 2D images stand upright on geometry; explicit `flipY: false` kept for glTF, KTX2/BasisU, `CubeTexture`, BRDF LUT, and spherical skydomes.
  - _WebGPU transparent blending & startup DPR fixes:_ `GPUPipelineCache.resolveBlendingMode` enables alpha blending for `transparent` materials without explicit `blending` (towards WebGL parity), and `SmallWorldMachine.start()` passes CSS dimensions to avoid double-DPR sizing.

- **Housekeeping & Docs:**
  - _ADR 0033 ("Option 3") re-evaluation:_ scoped binding commitments to optional Maker shell mechanics (`ToolMode`, `ToolModeHost`, `ModeHashRouter`, `maker.html#<mode>`), withdrew the ADR 0010 §3 amendment, and kept standalone tool pages valid.

## [0.114.0] - 2026-10-19

### "The only way to go fast is to go well." - Robert C. Martin

- **Features:**
  - _`swm` CLI MVP (ADR 0034 G2, `@small-world-machine/tools`):_ exposed `swm` binary (`src/cli/swm.mjs`, `src/cli/index.ts`) wrapping `core/map.ts` (`swm map to-json|from-json`), `core/kit.ts` (`swm kit validate <dir>`), `--help`/`--version`, and CLI unit tests under `packages/tools/tests/cli/`.
  - _Per-instance particle color across all backends (`@small-world-machine/vfx-extras`):_ `InstancedMesh.useInstanceDataAsColor` opts meshes into `USE_INSTANCE_COLOR` (`ParticleMeshRenderer` sets it automatically), multiplying per-particle RGBA on WebGPU/WebGL2 and uploading instance data on WebGL1 without disturbing legacy `instanceData.x` texture indexing.

- **Architecture & Bugfixes:**
  - _Unified `PostEffectPass` orchestration (`WebGPURenderer` & `GLPostEffects`, ADR 0037 / 0038):_ replaced per-effect pass fields with a single `Map<PostProcessingEffectType, PostEffectPass>` (`execute(ctx)`/`destroy()`) and drove opaque-depth capture from `PostProcessingGroup.requiresOpaqueDepth` (**Behaviour change:** volumetric fog without transparents now captures depth).
  - _WebGL shared manager layer & `GlobalUniformLayout` / `PostProcessingElement` consolidation:_ moved `WebGLProgramCache`/`WebGLTextureManager`/`WebGLBufferManager`/`NormalOutputWrapperGL` into `renderers/gl/managers/`, centralized UBO offsets in `GlobalUniformLayout.ts` (2,112 B std140 / 848 B WGSL), and moved post uniform packing into `PostProcessingElement` (missing WGSL replacements now throw).
  - _Shared `PlayerRig` & automatic quality tiers (`QualityConfigResolver`, ADR 0035):_ deduplicated ~500 lines in `game-app` via `scenes/shared/PlayerRig.ts`, and replaced `quality.autoDowngrade` with unconditional once-resolved `DeviceCaps.getPerformanceTier()` policies where explicit author fields win (**Breaking (API):** `quality.autoDowngrade` removed).
  - _SoA `ParticleSystem` & index-based particle API (`@small-world-machine/vfx-extras`):_ migrated particles to parallel typed arrays (`ParticleSystem.arrays`) and index-returning `emit()`/`onParticleDied`; **Breaking (API):** removed `Particle` heap objects and `particles[]` (all 10 built-in affectors keep bit-identical `applyBatch`).
  - _Typed `MaterialLanes` & consolidated Glass/Frostglass PBR chunks (ADR 0039):_ replaced overloaded slots (`u_pad1`, `u_color.a` proxy) with semantic `MaterialLanes`/`writeLane` and `matParam3..7`, consolidated 6 identical copies into `GLASS_PBR_LOOPS` / `WGSL_GLASS_PBR_LOOPS`, and unlocked `MaterialLaneTableParity`/`GlassPbrLoopsParity` (byte-identical renders).
  - _Decoupled Sheen & Emissive (`u_matParam10`, ADR 0039):_ `u_specColor` is strictly emissive while sheen tint and enable move to `u_matParam10` across all 3 tiers (`SheenDecouplingParity`); **Behaviour change:** emissive materials no longer get unintended sheen on WebGL1/WebGPU and `sheenColor` tints on all backends.
  - _`Collision` kernel decomposition, typed `BoundingVolume` & `RevolveBuilder` (ADR 0040):_ split `Collision` (1,326 lines) into `CollisionSweep.ts`, `CollisionObb.ts`, and `CollisionHull.ts` (`CollisionKernelPin.test.ts`), eliminated all 15 `as unknown as OBB` casts (**Behaviour change:** `MakerPrefabPipeline._boundsToAabb` -> `getAabb`), and unified 9 revolve shapes onto `LatheGeometry`/`RevolveBuilder` (removed `CylinderSector.ts`).
  - _`OpenWater.frag.glsl100` named shader constants (H4):_ aligned `CREST_FOAM_*` and `CAUSTICS_*` constants with GLSL300/WGSL (`OpenWaterGlsl100ConstantParity.test.ts`; WebGL1 output byte-identical, documented WebGL1 omissions).

- **Housekeeping & Docs:**
  - _Golden workflow optimization (M1/M2/M4/M5) & marker checks:_ added `scripts/goldens/skip-check.js` (`goldens:skip --emit-status` using `$GITHUB_OUTPUT` + `fetch-depth: 0`), removed broken `liquid-goldens-gpu` CI job, added `--report-html`, `--accept`, `goldens:adopt-ci`, and `goldens:gallery`, and wired `npm run check:markers` (`scripts/check-verified-markers.js`) into CI `verify`.

## [0.113.0] - 2026-10-18

### "Have no fear of perfection - you'll never reach it." - Salvador Dalí

- **Architecture & Bugfixes:**
  - _WebGPU volumetric fog compute shader & bind-group fixes:_ replaced forbidden compute `textureSample` with `textureSampleLevel(..., 0.0)` in `froxel_integrate.wgsl`/`froxel_inject.wgsl` and allocated up to 8 discrete 3D texture bindings for volume masks instead of rejected 3D texture arrays, unblocking Showcase 27 and volumetric fog on WebGPU.

- **Housekeeping & Docs:**
  - _Volumetric fog guide updated:_ documented the 8-slot per-volume density mask limit on WebGPU in `docs/guides/volumetric-fog.md`.

## [0.112.0] - 2026-10-18

### "Without data, you're just another person with an opinion." - W. Edwards Deming

- **Features:**
  - _Spot-light shadows in volumetric fog (`VolumetricFogElement.localLightShadows`, default on):_ shadowed spot lights (`max 4`) mask fog in-scattering on WebGPU (4-tap PCF in `froxel_inject.wgsl`) and WebGL2 (`sampler2DShadow`); **Look change:** scenes with shadowed spots show light shafts unless disabled.
  - _Volumetric fog density masks & per-cell albedo (`VolumetricTexture`):_ RGBA8 3D masks (`R` = density, `G` = albedo) bind globally or per `FogVolume` (up to 16 slots on WebGPU, 8 on WebGL2; no-mask output remains numerically identical).
  - _CI capture determinism check (`npm run test:fog-capture`):_ extended `scripts/check-fog-capture.js` (`--showcases 39,28`) and added the manual `capture-determinism` CI job verifying canvas hashes across frames 10/30/120 on WebGL1/WebGL2.

- **Architecture & Bugfixes:**
  - _Maker undo, keymap & texture resolution consolidation:_ unified Maker edits through `_commit`/`_snapshotCommand` (`MakerUndoCore`), moved keyboard handling to `MAKER_KEYMAP` (`dispatchMakerKey`), and shared `KitRegistry.resolveTextureMaps` across Maker/Content Drawer/Kit Inspector (**Behaviour change:** Maker now loads `metalness` maps too).
  - _Particle batching, free-list emit & showcase helpers:_ added `ParticleAffector.applyBatch` + O(1) dead-slot recycling in `@small-world-machine/vfx-extras` (**Behaviour change:** mid-tick dead particles skip later affectors), plus `AbstractShowcase.configureCamera()`, `loadIbl()`, `loadSkybox()`, and `apps/showcases/shared/prim.ts` (IBL/skybox load errors now throw).
  - _Shader & utility cleanup (ADR 0032, `compileProgram`, enums):_ **Breaking (API):** removed `ShaderRegistry.instance`, argless `CoreShaderChunks.init()`/`ShaderBootstrap.init()`, `registerMaterialShaderProvider`, controller `audio` options, and static `DeviceCaps`; added `ensureProvider`, `registry` on `PostProcessPassGL`, `compileProgram`/`tryCompileProgram`, `mulberry32`, and 4 typed enums.
  - _Fog IBL ambient, camera-bound skybox & GLSL ES 3.00 compilation:_ averaged 6 axis directions in `ambientInject` (~3% scene delta), bound `Skybox.vert` to `viewPos` across all 3 tiers (`SkyboxCameraBinding.test.ts`), and added `precision highp sampler3D;` + constant-indexed mask branches to `VolumetricFog.frag.glsl` (`VolumetricFogShaderCompileInvariants.test.ts`).
  - _Physics `PairTracker`, `RigidBodyMath` & `ContactSolver` refactor:_ consolidated `pairKey` / pooled `ContactPairState` into `physix/PairTracker.ts`, rotated inverse inertia into world space in `RigidBodyMath` (fixing off-center rotated body response, bug A4), and split `ContactSolver.solve` into named helpers.

- **Housekeeping & Docs:**
  - _Tooling, lint & dead-code cleanup:_ added `kill:vite` / `reset-vite` skill, enabled `@typescript-eslint/consistent-type-imports` (cutting import cycles 303 → 16), added `lint:wgsl` and `scripts/**/*.ts` typechecking to CI, removed unused `thresholdImage` / `_scratchTransparentMap` / `ForgeToolOptions.initialState`, and added capture/mask/skybox tests.
  - _Big Merge M1 & M2 + ADRs 0033 & 0034 (DRAFT):_ added `ToolMode` shell routing in `MakerApp`, extracted DOM-free `core/*` slices with `RasterIO`, tuned fog in Showcases 27/39, and updated `CONTEXT.md`.

## [0.111.0] - 2026-10-17

### "One accurate measurement is worth more than a thousand expert opinions." - Grace Hopper

- **Features:**
  - _Capture mode for showcases (`AbstractShowcase`, `getCaptureFrameRateFromQuery`):_ `?captureFps=N` locks `SmallWorldMachine.captureFrameRate` to `1 / N` s/frame, and Showcase 39 exposes `window.__showcase39`.
  - _Fog capture determinism check (`npm run test:fog-capture`, `scripts/check-fog-capture.js`):_ verifies identical frame 10/30/120 canvas hashes across two fresh pages on WebGL1/WebGL2/WebGPU and detects `captureFps` mismatches.
  - _WebGL2 local-light volumetric fog scattering (`VolumetricFogPassGL`, `VolumetricFog.frag.glsl`):_ evaluates up to 16 point and 16 spot lights along half-resolution raymarching scaled by `AbstractLight.volumetricIntensity`.

- **Architecture & Bugfixes:**
  - _Look change (WebGL2):_ fog near local lights renders brighter than in 0.110.0; retune `volumetricIntensity` or `density` if needed (no breaking API changes).

- **Housekeeping & Docs:**
  - _ADR 0031, `CONTEXT.md` & Showcase 39 log:_ aligned fog grid docs with the clustered light grid, clarified frozen-build requirements for determinism tests, and recorded the 0.110.0 retuning.

## [0.110.0] - 2026-10-17

### "Nothing is built on stone; all is built on sand, but we must build as if the sand were stone." - Jorge Luis Borges

- **Features:**
  - _Deterministic frame context & capture stepping (`FrameInfo`, `SmallWorldMachine.captureFrameRate`):_ replaced `performance.now()` reads in fog/post passes with `step()`-driven `FrameInfo` and fixed `1 / captureFrameRate` progression.
  - _Per-light fog intensity, ambient inject & scattering albedo:_ added `AbstractLight.volumetricIntensity`, 6-axis `VolumetricFogElement.ambientInject` from `Scene.irradianceMap`, and `scatteringAlbedo` separating scattering from dark-smoke absorption.

- **Architecture & Bugfixes:**
  - **Breaking (API):** `Renderer` now requires `frameInfo: FrameInfo`, and unused `froxelDepthSlices`, `clampFroxelMaxDistance`, and `froxelSliceFromViewDepth` were removed from `math/froxel.ts`.
  - **Breaking (look):** fixed `VolumetricFog` shading (density-scaled sun, single `intensity` weighting, transmittance attenuation, continuous slice lookup, order-independent carving, zero jitter history weight); retune `density`/`intensity` accordingly.
  - _WebGL fog height, skybox clip & security fixes:_ honoured `height`/`heightFalloff` on WebGL2, pinned WebGL skyboxes to the far plane, exposed irradiance cube bindings to compute, warned on >16 `FogVolume`s, and resolved 13/17 Dependabot alerts via `npm audit fix` + overrides.

- **Housekeeping & Docs:**
  - _Showcase 28/39 cleanup, dead-code purge & VitePress fix:_ modularized Showcase 28 (`showcase.ts` 2,421 → 661 lines), retuned Showcase 39 fog, fixed `docs/guides/volumetric-fog.md` and ADR 0022's dead `REFERENCES` link, and removed redundant math tests.

## [0.109.0] - 2026-10-17

### "The clearest way into the Universe is through a forest wilderness." - John Muir

- **Features:**
  - _Volumetric Froxel Fog (Stage 3, WebGPU & WebGL2 parity, ADR 0031):_ added `VolumetricFogElement`, WebGPU prefix-sum compute integration (`froxel_integrate.wgsl`, Decima powder, Beer-Lambert), and WebGL2 IGN-jittered raymarching with 2×2 cross-bilateral filtering.
  - _3D temporal reprojection & sub-voxel jitter (`froxel_reproject.wgsl`):_ Halton-jittered 3D-AABB 7-tap variance clamping ($\alpha = 0.95$ stable, $\alpha = 0.0$ on cuts) eliminating slice stepping.
  - _Dynamic `FogVolume` SDFs, 3D value noise & Showcase 39:_ added Box/Sphere/Cylinder volumes with negative density carving, wind-advected `noise3d`, and Showcase 39 "Atmospheric Sanctum" with live Tweakpane controls across all 3 backends.

- **Architecture & Bugfixes:**
  - _WebGPU 3D storage textures, bind-group limit & depth reconstruction:_ set `dimension: "3d"` in `VolumetricFogPassGPU.ts`, kept compute pipelines within `maxBindGroups = 4`, fixed NDC clip-Z unprojection in `froxel_reproject.wgsl`, and wired Showcase 39 across Vite and `check-showcases.js`.

- **Housekeeping & Docs:**
  - _ADR 0031 & living guides:_ promoted ADR 0031 to Accepted, published `docs/guides/volumetric-fog.md`, updated `CONTEXT.md` (`Cluster`, `FogVolume`, `Froxel`), and marked Stage 3 complete in `backlog.md`.

## [0.108.0] - 2026-10-16

### "The noblest pleasure is the joy of understanding." - Leonardo da Vinci

- **Features:**
  - _Showcase 28 — Lab Inspector & canvas picking:_ added collapsible dark-theme drawer (`I` / gear button) with Tweakpane Lab Knobs, live `HierarchyPanel` + `PropertyPanel`, Forge/Maker launchers, and 5 px-threshold raycast picking with cyan world-bounds highlight.
  - _Showcase 28 — 3-face prism refraction, movable splitter & AUX REF detector:_ generalized `computeSpectralRays()` across all equilateral faces with caustic bench wash, manual turntable + arrow-key dovetail 50:50 splitter carriage (`M` bypass, zero-GC beam segments), and luminous reference detector.
  - _Showcase 29 — Sponza Lighting Lab & `@small-world-machine/tools` exports:_ added unified `I`/gear inspector drawer reserving `FlyController` for the scene, and exported `PropertyPanel`, `HierarchyPanel`, and `UndoStack` publicly from `@small-world-machine/tools`.

- **Architecture & Bugfixes:**
  - _Input leak isolation for editor drawers:_ drawer/HUD containers stop pointer/wheel/touch/keyboard propagation, reset accumulated wheel deltas, dynamically disable `OrbitController` (28) / `FlyController` (29) during panel interaction, and suppress shortcuts while panel inputs hold focus.

- **Housekeeping & Docs:**
  - _Showcase 28 dossier & repo markdown audit:_ added Showcase 28 `concept-dossier.html`/dev log (keeping 29 log-less) and fixed all tracked markdown audit findings (README imports/count, `packages/tools`, ADR 0027 lane contracts, goldens README, ADR statuses, guides).

## [0.107.0] - 2026-10-15

### "I have loved the stars too fondly to be fearful of the night." - Sarah Williams

- **Features:**
  - _Showcase 27 — orbiting bronze octahedron:_ attached a shadow-casting `Octahedron` (tripled diameter) to the outermost armillary ring centerline so it glides along the ring, rotates gently, and drags a wandering shadow cell regardless of gimbal tumble.

- **Housekeeping & Docs:**
  - _Workspace-local `.agents/` policy:_ moved `.agents/{notes,collaborate,skills}` out of git tracking (`.gitkeep` + `.gitignore`) and documented in `AGENTS.md` that local scratch/skill notes are non-canonical on fresh clones.

## [0.106.0] - 2026-10-14

### "All the variety, all the charm, all the beauty of life is made up of light and shadow." - Leo Tolstoy

- **Features:**
  - _Volumetric Light Shafts (`LightShaftsElement`, `LightShaftsPassGL`/`GPU`, ADR 0030):_ half-resolution CSM raymarching on WebGPU/WebGL2 using Schlick phase ($k \approx 1.55g - 0.55g^3$), IGN jittering, and 2×2 cross-bilateral upsampling, plus WebGL1 screen-space radial pull-blur (`clipW > 0` guard) compositing additively into HDR before tone mapping.

- **Architecture & Bugfixes:**
  - _`yad` `?rendererType=` override:_ exported `getRendererTypeFromQuery` from `AbstractShowcase.ts` and wired it into `yad` so `scripts/check-showcases.js` tests WebGL1, WebGL2, and WebGPU cleanly without GPU-less WebGPU defaults failing.
  - _Anisotropic texture filtering (`renderers/anisotropy.ts`):_ wired `applyAnisotropy` / `resolveAnisotropicLevel` (`clamp <= 16`, `0` disables) to WebGL1/2 `TEXTURE_MAX_ANISOTROPY_EXT` and WebGPU `GPUSamplerDescriptor.maxAnisotropy` across all 3 tiers with unit tests.

- **Housekeeping & Docs:**
  - _ADR 0030 & volumetric references:_ documented the 2-tier hybrid architecture in ADR 0030, added Schlick/IGN/bilateral citations in `REFERENCES.md`, updated `CONTEXT.md`, and marked Fog Roadmap Step 2 complete in `backlog.md`.

## [0.105.0] - 2026-10-12

### "The greatest enemy of knowledge is not ignorance, it is the illusion of knowledge." - Daniel J. Boorstin

- **Features:**
  - _Box-projected decals (`Decal`, `DecalMaterial`, WebGPU & WebGL2):_ opaque-depth-unprojected decal pass before transparents with clustered lighting, normal-buffer tangent blending, 3-tap silhouette/mip gradients (`unlit`, `mipBias: 0`), edge/angle fade, and `priority → volume → creation` stacking (no negative scale; ignored on WebGL1).
  - _Thin normal buffer (`quality.normalBuffer: boolean | "auto"`, ADR 0028):_ world-space octahedral `rg16float` MRT on WebGPU/WebGL2 (`"auto"` activates lazily once a decal becomes visible).
  - _Decals in levels & `SWM_decal` glTF extension (ADR 0029 phases 3–4a):_ added `LevelDescriptor.decals[]` (`level.schema.json`), `KitRegistry.hydrateDecal()`/`resolveLevelDecals()`, and `WorldWriter`/`GltfLoader` `SWM_decal` round-trips (fail-fast invalid size/parent/duplicate IDs).
  - _Maker decal stamp tool (ADR 0029 phase 4b):_ `D` toggles modal ghost stamping with `R`/`Shift+R` 15° spin, arrow nudge/scale, `Raycaster` `point`/`normal`, OBB selection outline, autosave on material edits, and a `Decal` property inspector.
  - _WebGL1 mesh-decal baker (`bakeDecalMesh`, `bakeSceneDecals`, ADR 0029 phase 5):_ explicit 6-plane Sutherland-Hodgman clip + 2 mm normal lift for static receivers (no edge/angle fade; skipped receivers warn); tested via `apps/showcases/decal-probe` and `npm run test:decals` (51 GPU assertions).

- **Architecture & Bugfixes:**
  - _HBAO high-resolution normal & world-radius fixes:_ switched depth-normal rejection to relative thresholds facing the camera (closest-depth neighbour per axis, never reading the normal buffer) and scaled march radius in world units (`clamp(radius * projScaleY * (H/2) / linearZ, 4, 128)`).
  - _Spot-light shadows, WebGPU pipeline cache & normal-wrapper fallback:_ updated moving/toggled spot shadow cameras on WebGL2, retained per-key pipeline ref-counts (`PipelineCacheRefCounting.test.ts`), and added fallback output masking for custom shaders plus compute uniform declarations.
  - _Maker lights, plane-fit stamping, `DecalPool`, sockets & mesh reload:_ preserved `DirectionalLight`/`SpotLight` (`KHR_lights_punctual` `extras`) and `AmbientLight` (`SWM_lights_ambient`), added `fitDecalPlane` (`Alt` skips), zero-GC `DecalPool` (`Decal.restack()`, `AttachTo`), `LevelDecalPlacement.socket`, wet puddle decal, and `WorldWriter` `NORMAL`/`TEXCOORD_0`/index serialization.

- **Housekeeping & Docs:**
  - _ADR 0028, `lint:wgsl` & verification:_ documented thin-MRT ADR 0028, validated material shaders through normal wrappers, noted nested-Vite `.vite/deps` pitfall, regenerated `v0.105.0` API docs, and verified 1,689 tests / 263 files + `test:decals`.

## [0.104.0] - 2026-10-10

### "Order is Heaven's first law." - Alexander Pope

- **Architecture & Bugfixes:**
  - _Engine source reorganization (public barrel unchanged):_ grouped `core/materials/` by family (`surface/`, `glass/`, `liquid/`) with co-located `shaders/`, dissolved `core/renderers/` and `engine/src/tools/` into `renderers/shaders/`, `renderers/post/shaders/`, `core/forge/`, and `geometry/procgen/`, and organized loose `core/` modules (`input/`, `culling/`, `reflection/`, `sky/`, `cameras/`, `sprites/`).
  - _Offline tool & presentation extraction:_ moved IBL generator to `@small-world-machine/tools` (`packages/tools/src/ibl-gen/`, ADR 0024 revised) and `presentation.ts` to `apps/showcases/presentation/`.

- **Housekeeping & Docs:**
  - _Docs, linters & verification:_ updated `scripts/lint-wgsl.ts`, `Glsl100LightCalc.test.ts`, ADR 0024/0015, `REFERENCES.md`, `docs/guides/adding-materials.md`, and `v0.104.0` API docs; verified typecheck, lint, `lint:wgsl`, builds, and 1,628 tests green.

## [0.103.0] - 2026-10-10

### "The name that can be named is not the eternal name." - Lao Tzu

- **Architecture & Bugfixes:**
  - _glTF vendor prefix `SW_*` -> `SWM_*`:_ migrated `SWM_stage_zone`, `SWM_stage_vanishing_point`, and `SWM_prefab_instance` plus `SwmStageZone`/`SwmPrefabInstance` classes across loaders, writers, tests, and docs (**Breaking:** legacy `SW_*` level files are no longer read).

- **Housekeeping & Docs:**
  - _Version alignment & re-brand audit:_ aligned all workspace packages (`engine`, `gltf-extensions`, `sample-apps`, `showcases`), `ENGINE_VERSION`, `package-lock.json`, and `docs/public/api` to `0.103.0`, updated `REFERENCES.md`/`docs/` paths, and verified library build + full test suite green.

## [0.102.0] - 2026-10-10

### "What's in a name? that which we call a rose / By any other name would smell as sweet" - William Shakespeare

- **Features:**
  - _`OilPuddleMaterial` (`@small-world-machine/liquid-extras`):_ Graphic-Noir petroleum shader across GLSL300, GLSL100, and WGSL with six looks (`mutedSheen`, `tar`, `chiaroscuro`, `tarSkin`, `whaleOil`, `posterRings`), three fluid tunings (`crude`, `petrol`, `diesel`), and canonical `shading/thinFilm/thinFilm.ts` (muted desaturated interference).

- **Architecture & Bugfixes:**
  - _Re-brand `Small World` -> `Small World Machine`:_ renamed entry point `SmallWorld` -> `SmallWorldMachine`, package scopes `@small-world/*` -> `@small-world-machine/*`, docs, ADRs, skills, CI, and Makefile (historical changelog/log entries preserved).
  - _Liquid material reorganization:_ moved `NoirWater` and `OilSlick` into dedicated folders under `packages/liquid-extras/src/materials/`, extracting `OilSlick` from `game-app`.

- **Housekeeping & Docs:**
  - _Skill, tooling & verification:_ canonicalized `.agents/skills/vision-image/SKILL.md`, added `scripts/forge-tools-e2e.mjs` + `scripts/lib/forge-page.mjs` and `package.json` author metadata; verified lint, library build, and full test suite green.

## [0.101.0] - 2026-10-10

### "Nothing endures but change." - Heraclitus

- **Features:**
  - _Stylized Lava lossless Unity port (`StylizedLavaMaterial`):_ aligned GLSL300, GLSL100, and WGSL to MinionsArt's "Simple Lava" (world-XZ `_MainTex`/`_DistortTex`, `_Time.x`/`_Time.z`, red vertex-color fade, two-color tint lerp, depth shore line on WebGL2/WebGPU, optional `RampLUT`).
  - _Vertex colors & Showcase 10 (`Geometry.colors`, `USE_VERTEX_COLOR`):_ uploaded per-vertex colors across all 3 renderers (WebGL attr 11, WebGPU slot 6; non-instanced), added `Texture.dispose()`, and upgraded Showcase 10 pools (`lava_main.webp`, `lava_distort.webp`).
  - _Xtractor upgrades:_ added `Cmd+D`/`Esc` deselect, arrow-key nudge (`Shift` 10 px), `Cmd+0`/`Cmd+1` zoom, undoable image removal, and `Shift+Enter` / `Esc` chat cancel.

- **Architecture & Bugfixes:**
  - _Lava, stylized water & `OpenWaterSurfaceProbe` fixes:_ fixed GLSL2 interface precision + WebGPU `USE_*` map guards on `StylizedLava`, replaced legacy uniform reads in `StylizedWater.frag.wgsl` (`LiquidUniformNameParity`), and added `OpenWaterMaterial.poolHalfExtent` + live lane probes.
  - _Renderer, tools security & capture script hardening:_ prevented WebGL1 HDR reallocation, object-ring leaks, and post-`destroy()` `step()`, aligned `World.frag.glsl100`, capped zip/gzip/undo budgets (`256 MB`), moved Gemini keys to headers, unified `HttpVisionProvider`, and hardened `goldens/compare.js` + `capture.js`.

- **Housekeeping & Docs:**
  - _Modularization, asset dedup & verification:_ trimmed `Xtractor.ts` (1,781 → 687 lines) and Showcase 10 (2,766 → 797 lines), deduped ~9.5 MB of showcase assets, replaced placebo tests, updated ADR 0027/docs, and verified 255 test files (1,611 tests) + 48/48 golden cells green.

## [0.100.1] - 2026-10-09

### "Geometry is the archetype of the beauty of the world." - Johannes Kepler

- **Architecture & Bugfixes:**
  - _Showcase 10 pool curb tile layout:_ matched geometry/UV unwrap to physical joint spacing (`WALL_THICKNESS = 2 * TILE_UNIT_SIZE`, `POOL_SIZE = POOL_TILES_OUTER * TILE_UNIT_SIZE`) and switched pool borders from triplanar `WorldMaterial` to `LambertMaterial` for faithful UV rendering.
  - _`CustomShaderMaterial` defines, DTS isolation & Noir ink transport:_ auto-derived `USE_*_MAP` compilation flags from bound slots, scoped `vite-plugin-dts` to `src/**`, and aligned `NoirWaterMaterial` posterization (`inkSteps = max(posterizeSteps - 1.0, 1.0)`).

- **Housekeeping & Docs:**
  - _Showcase cleanup & verification:_ set `defaultCameraController = "none"` in Showcases 9 and 23; verified 246 test suites (1,505 tests), lint, and core/showcase builds green.

## [0.100.0] - 2026-10-08

### "Drop it anywhere, and it finds its way." - Anonymous

- **Features:**
  - _Map Generator on universal ingest (`MapGenerator`):_ migrated `MapGenerator` to `UniversalIngestDropzone` (drag-and-drop, picker, URL, `Cmd+V`) handling ASCII, JSON, ZIP, and raster/SVG sprites via `loadFromImage()`, covered by `MapGenerator.test.ts`.

- **Housekeeping & Docs:**
  - _Showcase package imports, asset budgets & verification:_ standardized showcases onto `@small-world-machine/*` barrel imports, codified 4-tier polycount budgets in ADR 0011 §1.1 (clutter 800–1.5k, props 2.5–4.5k, furniture 6–10k, hero 10–16k), and verified `tsc`, 245 test files (1,499 tests), and showcase build green.

---

For earlier releases (`0.8.46 – 0.99.0`), see [docs/CHANGELOG-ARCHIVE.md](docs/CHANGELOG-ARCHIVE.md).
