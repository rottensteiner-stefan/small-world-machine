# Liquid/Fluid System — Evidence-Based Inventory

> RESEARCH ONLY. Compiled 2026-10-05 from the actual repo state (HEAD). No files were modified.
> Claim sources (historical): `.agents/collaborate/liquid-improve.md` (P1 consensus + `[VERIFICATION_PASSED]` at line 323), `.agents/collaborate/liquid-architecture.md` (F3 "5 injection hooks"), `docs/adr/0025-stylized-liquid-looks-engine-vs-extension.md`, `docs/adr/0013-unified-liquid-surface-material.md`. Note: `liquid-improve.md` and `liquid-architecture.md` have since been removed from the repo; the claims now live in this inventory, `liquid-roadmap.md`, the boards, ADR 0013/0025 and CONTEXT.md.
> Marker legend: `## VERIFIED-PRESENT` / `## CLAIMED-BUT-ABSENT` / `## PARTIALLY-PRESENT`. Paths are repo-absolute.
>
> **T2 update (2026-10-06, Claims-Korrektur per `liquid-roadmap.md` §8.2/T2):** factually verified statements now carry `[VERIFIED: <rel-path>:<line>; test=<id>]` markers checked against HEAD by `scripts/check-verified-markers.js` (G4). The former "6 verification goals" of `liquid-improve.md` §11 get an honest coverage balance below: `[COVERAGE: 2/6 conform, 1 partial, 2 absent, 1 scope-reduced]`.

---

## 1. MATERIALS — ACTUAL CLASS INVENTORY

All paths under `P=<repo-root>`.

### Classes that EXIST in source (`packages/engine/src/core/materials/`)
| Class | File | Side | Backend shaders (glsl300/glsl100/wgsl) |
|---|---|---|---|
| `FluidSurfaceMaterial` | `P/packages/engine/src/core/materials/FluidSurfaceMaterial.ts` (284 ln) | "flow family" base | `FluidSurface.vert/frag.{glsl,glsl100,wgsl}` — all 3 |
| `LiquidWaveMaterial` | `P/.../LiquidWaveMaterial.ts` (194 ln) | abstract base, "wave family" | None of its own (subclasses supply sources) |
| `OpenWaterMaterial` | `P/.../OpenWaterMaterial.ts` (96 ln) | preset on LiquidWaveMaterial | `OpenWater.vert/frag.{glsl,glsl100,wgsl}` — all 3 |
| `StylizedWaterMaterial` | `P/.../StylizedWaterMaterial.ts` (308 ln) | preset on LiquidWaveMaterial | `StylizedWater.vert/frag.{glsl,glsl100,wgsl}` — all 3; exports `composeStylizedWaterSources()` |
| `LavaMaterial` | `P/.../LavaMaterial.ts` (60 ln) | preset on FluidSurfaceMaterial | **No own shader files** — compiles under FluidSurface shaders |
| `SlimeMaterial` | `P/.../SlimeMaterial.ts` (60 ln) | preset on FluidSurfaceMaterial | **No own shader files** — compiles under FluidSurface shaders |

### UniversalFluidMaterial
- **ABSENT in code and DE-CLAIMED in T2.** It was referenced only in `P/docs/adr/0025-...md` line 20 ("`UniversalFluidMaterial` / `StylizedWaterMaterial`") and `CONTEXT.md` — both corrected to `StylizedWaterMaterial` on 2026-10-06 (Claims-Korrektur), so no file claims `UniversalFluid*` anymore. No `UniversalFluid*.ts` and no export anywhere in `P/packages/engine/src/` — the modular-core role was implemented as `StylizedWaterMaterial`, not `UniversalFluidMaterial`.

### Exports (engine public index)
- `P/packages/engine/src/index.ts` lines 14–17 explicitly re-export `OpenWaterMaterial`, `StylizedWaterMaterial`, `LavaMaterial`, `SlimeMaterial`.
- `FluidSurfaceMaterial` + `LiquidWaveMaterial` reachable via `P/packages/engine/src/core/index.ts` line 34 → `core/materials/index.ts` lines 13 & 18.
- Type IDs: `P/packages/engine/src/enums/MaterialType.ts` — `OPEN_WATER` (6), `STYLIZED_WATER` (8), `FLUID_SURFACE` (28), `LAVA` (30), `SLIME` (32). No `LIQUID_WAVE` (it is abstract).

### Usage (grep `-r` in src/, apps/, tests/)
- `P/apps/showcases/10/showcase.ts`: `OpenWaterMaterial` (269), `StylizedWaterMaterial` toon (306), bold (338), soft (370), sparkle (403), dredge (452), `LavaMaterial` (505), `SlimeMaterial` (546), plus extension `NoirWaterMaterial` (484).
- `P/apps/showcases/31/showcase.ts`: `OpenWaterMaterial` (291).
- `P/apps/sample-apps/yad/core/LevelBuilder.ts` (95, 285) + `P/apps/sample-apps/yad/App.ts`: `FluidSurfaceMaterial`.
- `P/apps/sample-apps/the-whisper/scenes/character-diorama/OilSlickMaterial.ts`: extends `StylizedWaterMaterial` via hooks (comment cites LiquidWaveMaterial's slot convention, line 171).
- Engine-internal references are only enum/comments (`MaterialType.ts`, `WebGL2Renderer.ts:458`, `WebGPURenderer.ts:1824`).
- Extension package `P/packages/liquid-extras/` uses the hook mechanism: `src/materials/NoirWaterMaterial.ts`, `src/materials/OilSlickMaterial.ts` both `extends StylizedWaterMaterial` and call `composeStylizedWaterSources` (see §6/7).

### Liquid shader file inventory (all under `P/packages/engine/src/core/materials/shaders/`)
- FluidSurface: `FluidSurface.vert.glsl`, `.vert.glsl100`, `.vert.wgsl`, `.frag.glsl`, `.frag.glsl100`, `.frag.wgsl` (6)
- OpenWater: `OpenWater.vert.glsl/.glsl100/.wgsl`, `OpenWater.frag.glsl/.glsl100/.wgsl` (6)
- StylizedWater: `StylizedWater.vert.glsl/.glsl100/.wgsl`, `StylizedWater.frag.glsl/.glsl100/.wgsl` (6)
- chunks/ (10 liquid files): `liquid_caustics.glsl/.wgsl`, `liquid_ext_default.glsl/.wgsl`, `liquid_gerstner_wave.glsl/.wgsl`, `liquid_glint.glsl/.wgsl`, `liquid_worley_noise.glsl/.wgsl`
- **No** `Lava.*` / `Slime.*` / `UniversalFluid.*` shader files. **No per-chunk `.glsl100` files** — GLSL100 reuses the ES-1.00-compatible `.glsl` files (stated at `chunks/liquid_gerstner_wave.glsl` lines 3–4).

---

## 2. CLAIM VERIFICATION

### (a) 6-wave cascade + deep-water dispersion `omega = sqrt(g k)` + bimodal 60° cross-swell
## PARTIALLY-PRESENT
- **VERIFIED-PRESENT (OpenWater):** `OpenWater.vert.glsl` defines six wave vectors w1..w6 (lines 91–96) and sums **six** `gerstnerWave()` calls in the displacement loop — lines 102–107 (`displacement += gerstnerWave(w1 … w6)`). w6 line 96: `vec4 w6 = vec4(w1.x*0.5 - w1.y*0.866, w1.x*0.866 + w1.y*0.5, w1.z*0.25, w1.w*0.22); // Bimodal 60-deg cross-swell`. Same 6-wave loop in `OpenWater.vert.glsl100` (lines 29–45) and `OpenWater.vert.wgsl` (lines 21–38). Deep-water dispersion is in the shared chunk `chunks/liquid_gerstner_wave.glsl` line 10 `float w = sqrt(9.81 * k);` (also `.wgsl` line 10; comment lines 1–2). `[VERIFIED: packages/engine/src/core/materials/shaders/OpenWater.vert.glsl:91; test=OpenWaterMaterial.test.ts]`
- **PARTIAL (StylizedWater):** also defines w1..w6 (`StylizedWater.vert.glsl` lines 86–91) but **w3 is gated**: lines 99–101 `if (w3.w > 0.001) { displacement += gerstnerWave(w3, …); }` — same gate in `.glsl100` (43–45) and `.wgsl` (34–36). So 5–6 waves execute depending on wavelength.
- **CLAIMED-BUT-ABSENT ("golden ratio directional spread"):** no golden ratio / phi / 1.618 anywhere in `P/packages/engine/src/core/materials/shaders/`. Actual construction differs from the claimed composition in `liquid-improve.md` line 229 ("2 dominant swells, 2 cross-swells 60°, 2 wind ripples"): real terms are 2 dominant (w1,w2) + 1 threshold wave (w3, gated) + 2 **90°-perpendicular** detail waves (w4,w5, comments "Detail wave (perpendicular)") + **one** 60° cross-swell (w6). The claim is **stripped in T2** (no doc states "golden ratio" anymore); the real composition is anchored: w4/w5/w6 `[VERIFIED: packages/engine/src/core/materials/shaders/OpenWater.vert.glsl:94; test=OpenWaterMaterial.test.ts]` (identical definitions mirrored in `OpenWater.vert.glsl100:32–34` and `OpenWater.vert.wgsl:29–31`).

### (b) Analytical Jacobian determinant in vertex shader for crest whitecaps
## VERIFIED-PRESENT (OpenWater only)
- `OpenWater.vert.glsl` lines 113–119: `float jacobian = t.x * b.z - t.z * b.x;` (comment lines 113–116: "horizontal Jacobian of the Gerstner displacement, J = Tx*Bz - Tz*Bx … J <= 0 means folding") then `v_crest = clamp((1.0 - jacobian) / max(steepSum, 0.001), -1.0, 1.0);`. The analytic partials are accumulated inside the shared `gerstnerWave()` chunk (`chunks/liquid_gerstner_wave.glsl` lines 16–26 update t/b). Identical in `OpenWater.vert.glsl100` lines 55–57 and `OpenWater.vert.wgsl` lines 50–52 (carried in `Out.original_uv.x`, with a warning not to use `Out.texIndex`, lines 44–49). `[VERIFIED: packages/engine/src/core/materials/shaders/OpenWater.vert.glsl:113; test=OpenWaterMaterial.test.ts]`
- Fragment consumption: `OpenWater.frag.glsl` lines 113–115 `float crestFoam = smoothstep(0.65, 0.95, v_crest) * foamPattern * 0.5;` (also `.glsl100` 104–110, `.wgsl` 86–88).
- **NOT in StylizedWater:** no Jacobian in any `StylizedWater.vert.*`. Instead `v_displacementY` is written (`StylizedWater.vert.glsl` lines 75, 108) but is **declared-and-unused** in the fragment (`StylizedWater.frag.glsl` line 7; no read in body). The foam block header "7. Advanced Procedural Foam (Intersection Foam + Crest Foam)" (`StylizedWater.frag.glsl` line 208) implements only **shoreline** foam (lines 215–230); no crest-foam term exists.

### (c) Clapotis / wall reflection (D_ref mirroring, double amplitude 2A)
## CLAIMED-BUT-ABSENT
- No `clapotis`, no wall-normal mirror of a wave vector, no `D_ref`, no `2A` standing-surf anywhere in `P/packages/engine/src/` or `P/docs/` (`grep -rni clapotis` yields zero matches repo-wide in packages/docs; the only `D_ref` hits are unrelated PBR `kD_refr` variables in Glass/Frostglass/Standard shaders). The `liquid-improve.md` plan (lines 203–205, Erin) was never implemented in any water shader.

### (d) Contact ripples / obstacle wakes (scene depth differential)
## PARTIALLY-PRESENT
- Mechanism exists as a **depth differential gate on painterly ripple strokes**, not obstacle wakes: `depthDiff = max(linBgDepth - linFragDepth, 0.0)` (`StylizedWater.frag.glsl` line 75; WebGL2/WebGPU only) is used at lines 193 & 196 to fade ripple lines near shallow water: `… * (1.0 - smoothstep(0.0, 5.0, depthDiff))`. `depthDiff` (aka `Δd`) originates from the same opaque-depth capture that drives refraction (comment refs: `liquid-improve.md` line 250 "reuses depthDiff register from refraction pass" — the register reuse claim holds).
- **CLAIMED-BUT-ABSENT:** the claimed behavior — "dynamic ring waves at barrels and posts via scene depth comparison" (`liquid-improve.md` line 208; `showcase-10` barrels/posts) — does not exist. No `wake` code anywhere in shaders or showcase (`grep -rn wake` → 0 hits). OpenWater has **no** ripple stroke system at all (only foam/caustics/crest). The StylizedWater ripple lines are decorative near-shore strokes, not contact-generated wakes.

### (e) Injection hooks (5 claimed) + chunk mechanism
## PARTIALLY-PRESENT
- **VERIFIED-PRESENT (mechanism):** `ShaderRegistry.registerChunk` at `P/packages/engine/src/core/renderers/shaders/ShaderRegistry.ts` line 101; token assembly `assemble()` replaces `/\[([A-Z][A-Z0-9_]+)\]/g` (lines 134–146). Registered liquid chunks in `P/packages/engine/src/core/renderers/shaders/CoreShaderChunks.ts`: `LIQUID_GERSTNER_WAVE` (glsl300:88, glsl100:105), `LIQUID_WORLEY_NOISE` (89/106), `LIQUID_CAUSTICS` (90/107), `LIQUID_GLINT` (91/108), `WATER_EXT_DECL` (92/109), `WATER_EXT_SURFACE` (93/110), and WGSL variants `WGSL_LIQUID_GERSTNER_WAVE/WORLEY_NOISE/CAUSTICS/GLINT/WATER_EXT_DECL/WATER_EXT_SURFACE` (120–125). Default expansions are the empty comment chunks `chunks/liquid_ext_default.glsl/.wgsl`.
- **VERIFIED-PRESENT (only 2 hooks, not 5):** only `[WATER_EXT_DECL]` and `[WATER_EXT_SURFACE]` tokens exist, in `StylizedWater.frag.glsl` (37, 236), `.glsl100` (34, 206), `.wgsl` (4, 197), substituted by `composeStylizedWaterSources()` (`StylizedWaterMaterial.ts` lines 17–40). ADR 0025 documents exactly these two (lines 24–26). `[VERIFIED: packages/engine/src/core/materials/StylizedWaterMaterial.ts:17; test=StylizedWaterMaterial.test.ts]` (hook token assembly `composeStylizedWaterSources` at `[VERIFIED: packages/engine/src/core/materials/StylizedWaterMaterial.ts:24; test=StylizedWaterMaterial.test.ts]`).
- **CLAIMED-BUT-ABSENT (5-hook variant):** the "5 injection hooks `#SW_INJECT_ABSORPTION/CAUSTIC/FOAM/GLINT/SURFACE_MOD`" from `liquid-architecture.md` (F3 / proposal lines, also "ready to implement in Phase B") were **never implemented**; superseded by the 2-token design. (ADR 0025 never promised 5; the "5" figure originates in the collaboration board, not the ADR.)
- Hooks are in **live production use** by `@small-world-machine/liquid-extras`: `NoirWaterMaterial.ts` (`composeStylizedWaterSources` at lines 123/126) and `OilSlickMaterial.ts` (164/168).

### (f) LavaMaterial / SlimeMaterial — exist as classes, backed by FluidSurface shaders
## VERIFIED-PRESENT (as presets) / physics claims PARTIALLY-PRESENT
- Classes exist: `LavaMaterial.ts` (16–59) and `SlimeMaterial.ts` (16–59), both `extends FluidSurfaceMaterial` with `MaterialType.LAVA` / `MaterialType.SLIME`. They are **thin option presets** — there are **no** `Lava.*`/`Slime.*` shader files; rendering uses the shared `FluidSurface.*` shader set (registered under the LAVA/SLIME type IDs so each gets its own compiled program — `FluidSurfaceMaterial.ts` lines 125–132 comment).
- Inherited features used: Lava = opaque + emissive pulse via repurposed `u_extraParams`/`u_liquidParams` lanes (`FluidSurfaceMaterial.ts` 187–232); Slime = transparent + Beer-Lambert absorption + rim (`FluidSurface.frag.glsl` 95–97).
- **CLAIMED-BUT-ABSENT (physics depth):** `liquid-improve.md` Frank/Grace claims — "Bingham plastic rheology", "dual-scale Voronoi crust fracturing (F2−F1)", "Planck blackbody emission" (Lava), "Stokes flow quadratic damping", "procedural bubble inflation/Taylor-Culick rupture", "chromatic Beer-Lambert SSS" (Slime) — none of these appear in the FluidSurface shaders or the preset classes. What exists is the simplified noise-flow + emissive/absorption look. (Note: `F2−F1` crust pattern also not used; `StylizedWater` uses `F1−SmoothF1` for caustics, a different technique.)

### (g) T2 coverage balance (Claims-Disziplin ab T2)
The former `liquid-improve.md` §11 listed six "implemented and verified" goals. That source doc is removed from the repo, so this inventory re-scopes the balance honestly where the claim actually lives:
`[COVERAGE: 2/6 conform, 1 partial, 2 absent, 1 scope-reduced]`
- **2 conform:** injection-hook mechanism (§2(e), anchors above) and uniform-slot/`u_styleA`/`u_styleB` budget (§6, anchors above).
- **1 partial:** the Gerstner cascade — fully present in OpenWater, gated to 5–6 waves in StylizedWater; the "golden ratio" composition claim was stripped (see §2(a)).
- **2 absent (0 code):** `Clapotis`/wall reflection and `obstacle wakes`/contact ripples — both S-deferred to Block S per `liquid-roadmap.md` §8.2, **not** open P1 bugs.
- **1 scope-reduced:** analytic Jacobian crest foam exists only in OpenWater; StylizedWater has no crest-foam term.
This T2 balance is an honest addendum — it does **not** revise the historic board `[VERIFICATION_PASSED]` labels F24/F28 in `docs/research/stylized-water/board-showcase-10-quality.md`, which remain valid for the T5–T11 post-fix standpoints.

---

## 3. GEOMETRY — NO DEDICATED FLUID GEOMETRY
- `P/packages/engine/src/geometry/` (41 files) contains **no** water/ocean/fluid generator, no tessellation control, no LOD water grid. No `class Ocean/WaterPlane/FluidField/WaterBody` exists.
- Water surfaces are built from the generic segmented `Plane` (showcases: `Plane` rotated flat, `widthSegments: 32, heightSegments: 32` at `apps/showcases/10/showcase.ts` ~1083) or `Ground`/`Plane`; `Ground` (`geometry/Ground.ts`) and `Grid` (`geometry/Grid.ts`) are the only grid-ish primitives. Wave fidelity therefore depends entirely on app-side segment density; no engine tessellation/LOD.

## 4. FLUID PHYSICS (`packages/engine/src/physix/`)
- `FluidVolume.ts` (29 ln): **pure data container** — `bounds: BoundingBox`, `density`, `drag`, `currentVelocity`. No wave heights, no pressure field, no fluid mass.
- `fluids/BuoyancySolver.ts` (129 ln): static `applyFluidForces()` — Archimedes buoyancy `F_buoy = -gravity.y * density * submergedVolume` (line 113), current-flow forces (116–121), linear/angular drag multipliers (123–124). Submergence computed from AABB overlap (76–92).
- Only consumer: `P/packages/engine/src/physix/PhysicsSystem.ts` (`addFluidVolume` line 120; `applyFluidForces` line 296). Exported via `physix/index.ts` lines 9 & 19.
- **No app usage** (showcases/31/10, yad, the-whisper do not use FluidVolume/BuoyancySolver). Water surface rendering is 100% shader-side and **disconnected** from the physix fluid system (no wave-height feedback from physics).
- Tests: `tests/physix/FluidVolume.test.ts` (3 it-blocks), `tests/physix/fluids/BuoyancySolver.test.ts` (3 it-blocks).

## 5. RENDER PIPELINE — NO WATER-SPECIFIC PASS
- No dedicated reflection/refraction/main water pass. Transparent liquids render in the **generic transparent pass** after opaque color+depth capture: `P/packages/engine/src/renderers/passes/MainRenderPass.ts` lines 72–98 (`captureOpaqueTexture` + `captureOpaqueDepth` then transparent loop); same in `WebGLMainPass.ts`.
- Screen-space refraction via captured `u_opaqueMap`/`u_opaqueDepthMap`: declared in `LiquidWaveMaterial.ts` (93–97) and GLSL/WGSL; bound in `WebGL2Renderer.ts` (1310–1312) and `WebGPURenderer.ts` (1861–1868). `OpenWater.frag.glsl100` uses a mesh-UV stand-in (comment lines 32–37) because WebGL1 lacks real depth.
- **Planar reflection exists but is NOT wired to water:** generic `P/packages/engine/src/core/PlanarReflectionNode.ts` (111 ln) renders a mirrored scene into a RenderTarget; but no water fragment shader samples `u_reflectionMap` (grep of water frags → zero hits), so water's "reflection" is the procedural `skyTint` lane (`StylizedWater.frag.glsl` ~line 166). No water-specific reflection/refraction pass.
- Uniform manifest: webgpu layout `...StandardWebGPULayout` + textures `u_diffuseMap/u_normalMap/u_opaqueDepthMap/u_opaqueMap` (`LiquidWaveMaterial.ts` 181–193; `FluidSurfaceMaterial.ts` 260–283).

## 6. UNIFORM LAYOUT / BUDGET
- `ObjectUniforms` struct: `P/packages/engine/src/core/renderers/shaders/source/web_gpu/chunks/structs.wgsl` lines 34–58 (styleA 56, styleB 57). `StandardWebGPULayout.ts` — `u_styleA` (line 30), `u_styleB` (line 31), uniformLayout sequence lines 33–57.
- Byte layout (verified by test `P/packages/engine/tests/renderers/WebGPUObjectUniformPacker.test.ts` lines 89–132): packs to **exactly 64 floats = 256 bytes**; `u_styleA` at float offset 56 (byte 224), `u_styleB` at float offset 60 (byte 240). Ring-buffer slot stride = 256 (payload ≤256) — `GPUObjectRingBuffer.ts` lines 36–39.
- **The "2 free vec4 `u_styleA`/`u_styleB`" (ADR 0025 line 10) EXIST in the layout but are now CONSUMED** by `StylizedWaterMaterial` (`StylizedWaterMaterial.ts` 288–300; shaders read both, e.g. `StylizedWater.frag.glsl` 26–27). Layout is **completely full** — confirmed by `LiquidWaveMaterial.ts` doc comment (lines 41–43 "zero spare float slots left") and by the pervasive repurposing of unrelated named slots: `u_texOffset/u_texRepeat/u_shininess/u_isSkinned/u_boneOffset/u_pad1..3/u_isTerrain/u_metallic/u_roughness/u_useEnvMap/u_useReflectionMap` (`LiquidWaveMaterial.ts` 98–130), and `u_extraParams/u_liquidParams/u_thresholds` for the fluid family (`FluidSurfaceMaterial.ts` 187–243). Packing of the consumed lane (`u_styleA` at float offset 56, `u_styleB` at 60, `styleId` in `u_styleB.w`) pinned by `[VERIFIED: packages/engine/src/core/materials/StylizedWaterMaterial.ts:293; test=WebGPUObjectUniformPacker.test.ts]` and the layout declaration `[VERIFIED: packages/engine/src/core/renderers/shaders/StandardWebGPULayout.ts:30; test=WebGPUObjectUniformPacker.test.ts]`.
- Practical consequence: adding a 3rd style vec4 would exceed the 256-byte slot (test comment + `liquid-extras` docs); the liquidity goal is reached via per-styleId constants + repurposed lanes, not new uniform room.

## 7. QUALITY / ROBUSTNESS NOTES (liquid stack)
- **Dead varying:** `v_displacementY` written (`StylizedWater.vert.glsl` 108) but never read in `StylizedWater.frag.glsl` (declaration only at line 7).
- **WebGL1 depth gap (documented):** no real depth capture on GL1 — `WebGL1Renderer.copyToOpaqueDepthTexture` binds the default far-depth texture (`WebGL1Renderer.ts` 688–690); consequence in shaders: Fresnel-proxy edge/fade and no caustics (`OpenWater.frag.glsl100` 32–37, 56, 82, 88; `StylizedWater.frag.glsl100` 37, 129, 164, 184). This is a stated, accepted degradation, not a TODO.
- **Depth pre-pass opt-out** for opaque displaced liquid (lava): `FluidSurfaceMaterial.ts` 248–254 (`skipDepthPrePass`), covered by `FluidSurfaceMaterial.test.ts`.
- **WebGPU crest transport:** `Out.original_uv.x` used for crest with an explicit warning that `Out.texIndex` must not be used (regex-injection collision), `OpenWater.vert.wgsl` 44–52.
- **Missing test coverage for 3 liquid materials:** `ShaderAssembly.test.ts` (uniform-dup lint) covers FluidSurface + OpenWater only (`tests/renderers/ShaderAssembly.test.ts` materials list lines ~76–87); `ShaderValidation.test.ts` chunk-completeness covers FluidSurface only (list lines 29–41). `StylizedWaterMaterial`, `LavaMaterial`, `SlimeMaterial` are absent from both.
- **No TODO/FIXME markers** anywhere in `P/packages/engine/src/core/materials/` or its `shaders/` (`grep` → 0 hits). Shader default hook chunk = empty comment (by design).
- Chunk GLSL100 portability relies on hand-maintaining "ES 1.00-compatible" wording in shared files (`liquid_gerstner_wave.glsl` lines 3–4) — no automated per-backend drift check for these.

## 8. TESTS (runable, NOT executed per instructions)
- `P/packages/engine/tests/core/StylizedWaterMaterial.test.ts` — 6 tests (style-ladder/presets, hook composition, style-id mapping).
- `P/packages/engine/tests/core/materials/FluidSurfaceMaterial.test.ts` — 3 tests (depth pre-pass opt-out).
- `P/packages/engine/tests/core/OpenWaterMaterial.test.ts` — 10 tests (defaults, absorption/foam/refraction uniform packing, opaque capture).
- `P/packages/engine/tests/physix/FluidVolume.test.ts` — 3 tests; `P/packages/engine/tests/physix/fluids/BuoyancySolver.test.ts` — 3 tests.
- `P/packages/engine/tests/renderers/ShaderAssembly.test.ts` — backend compile/lint for FluidSurface/OpenWater.
- `P/packages/engine/tests/core/renderers/shaders/ShaderValidation.test.ts` — chunk-completeness + UBO-parity + 16-sampler budget for core materials incl. FluidSurface.
- `P/packages/engine/tests/renderers/WebGPUObjectUniformPacker.test.ts` — 256-byte / styleA@56 / styleB@60 assertion (lines 89–133).
- Extension package `P/packages/liquid-extras/tests/` — `NoirWaterMaterial.test.ts` (5), `OilSlickMaterial.test.ts` (6) exercising the hook tokens across all 3 backends, plus `composeStylizedWaterSources` substitution.
- Suite is runnable: `npm run test` → `vitest run` (`P/package.json` line 26); vitest dependency present in `P/node_modules`. Not run for this inventory.

---

## EXECUTIVE STATE SUMMARY

The liquid system in the Small World Machine engine is real and substantially implemented, but several headline claims from the collaboration docs are only partially true or entirely absent on the current HEAD. Genuinely present (assets + code + tests): a two-family material architecture (`LiquidWaveMaterial` wave family with `OpenWaterMaterial` + `StylizedWaterMaterial`, and `FluidSurfaceMaterial` flow family with `LavaMaterial`/`SlimeMaterial` presets), a full 3-backend shader set (GLSL300/GLSL100/WGSL) for all six water-shader files plus ten `liquid_*` chunks, the `ShaderRegistry.registerChunk`/`[TOKEN]` mechanism, a 6-wave Gerstner cascade **only in OpenWater** with analytic deep-water dispersion and an analytic horizontal-Jacobian crest foam (consumed only by OpenWater), a screen-space refraction via captured opaque color/depth, and — importantly — a working, actively-used extension mechanism (`composeStylizedWaterSources` + `WATER_EXT_DECL`/`WATER_EXT_SURFACE` hooks) proven by the shipped `@small-world-machine/liquid-extras` package (Noir, OilSlick) and by uniform-budget tests pinning `u_styleA`/`u_styleB` into the fully-occupied 256-byte `ObjectUniforms` slot. Partially present or overstated: the StylizedWater "6-wave" cascade gates wave 3 (5–6 waves; the claimed golden-ratio directional spread is stripped in T2, real composition is 2+1+2+1 per §2(a)), no Jacobian/crest foam exists in StylizedWater (its `v_displacementY` varying is dead and its "Crest Foam" block only does shoreline foam), the "5 injection hooks" from the earlier collaboration premise were reduced to the two ADR 0025 hooks, and the "contact ripples/obstacle wakes" claim is only a near-shore depth-gated decorative stroke, not object wakes. Explicitly **absent** (claimed but zero code): `Clapotis`/wall reflection entirely, all Frank/Grace-style lava rheology (Bingham/Voronoi crust/Planck) and slime hydrodynamics (Stokes/bubbles) "physics", and any fluid geometry/tessellation/LOD — water planes are plain segmented `Plane`/`Ground` meshes. (`UniversalFluidMaterial` is likewise absent and has been de-claimed in T2.) The physix fluid system (`FluidVolume` + `BuoyancySolver`) is a real but independent rigid-body buoyancy feature with no coupling to the rendered liquid shaders and no app/user usage; 25 water/fluid-related engine tests plus 11 extension tests exist and the suite is runnable via `npm run test`, but three liquid materials (`StylizedWater`, `Lava`, `Slime`) are absent from the shader-assembly/validation test matrices. The `[VERIFICATION_PASSED]` marker in `liquid-improve.md` (line 323) therefore overstates parity for the styling/wave/foam claims while the hook mechanism and uniform budget claims hold up; the honest balance of the six former verification goals is stated in §2(g).
