# Showcase 49 – Unlit Reference Lab – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-11-02 — Khronos UnlitTest + engine-new KHR_materials_unlit support (all tiers)

Milestone C of the Khronos showcase program: the official `KHR_materials_unlit` test asset and the
**newly implemented engine support for the extension** (`StandardMaterial.unlit` +
`USE_UNLIT` shader variant on glsl300 / glsl100 / WGSL).

### Milestone premise fix (plan correction)

The original milestone plan named `BoomBox.glb`. The official `Models/BoomBox/glTF-Binary/BoomBox.glb`
is a pure **Core glTF 2.0 PBR** asset (`extensionsUsed: undefined`, baseColor + metallicRoughness +
emissive textures) — it does NOT use `KHR_materials_unlit`. The authentic Khronos sample for that
extension is `Models/UnlitTest` (`extensionsUsed/Required: ["KHR_materials_unlit"]`, CC0, 2 unlit
cubes `Orange` / `Blue`, baseColorFactor only, 2 × 12-triangle chamfered cubes at `x = ±1.2`).
User decision recorded: **showcase 49 = official `UnlitTest`** (authentic extension exercise), the
unused `BoomBox.glb` download was removed from the showcase assets.

### Engine work — KHR_materials_unlit on all three tiers (engine-new)

The extension was previously unsupported: no `GltfMaterialParser` handling, no material flag, no
shader path. Implemented:

- `ShaderFlag.UNLIT = "USE_UNLIT"` (sibling of the decal-only `DECAL_UNLIT`; this one is the
  StandardMaterial/glTF variant).
- `StandardMaterial` gains `unlit: boolean` (constructor option + inspector boolean field). The
  render-manifest flag collection pushes `ShaderFlag.UNLIT` when set. `getRenderManifest()` is
  re-packed per draw, so mutating `material.unlit` at runtime live re-links the shader variant (no
  extra plumbing — verified via the HUD mode toggle: program/pipeline cache keys shift with the
  flag set).
- `GltfMaterialParser.parseMaterial` maps `material.extensions.KHR_materials_unlit` (typed in
  `loaders/gltf/types.ts`) to `mat.unlit = true`. All other PBR slots keep parsing untouched.
- `GltfLoader` supported-extensions allowlist now includes `KHR_materials_unlit` (the asset
  declares it `extensionsRequired`, so the fail-fast gate required this).

### Shader variants (flat base color, strict output contract)

The unlit fragment branches mirror each tier's exact output transform so unlit output obeys the
same exposure/tonemapping/post-processing contracts as lit materials:

- **glsl300** (`Standard.frag.glsl`): `#ifdef USE_UNLIT` outputs `albedo * u_exposure`, the
  forward-path Reinhard guard (`u_gamma != 1.0`) and `linearToSRGB` — byte-mirror of the shared
  `LIGHT_CALC_PBR` tail. The `USE_REFLECTION_MAP` block (which references the chunk-local `V`/`F0`)
  is additionally `#ifndef USE_UNLIT`-guarded so an unlit + reflection-map combo cannot compile
  against missing chunk locals.
- **glsl100** (`Standard.frag.glsl100`): same branch with the tier's hardcoded forward contract
  (always Reinhard + sRGB encode; WebGL1 has no post-processing pass, so there is no
  `u_exposure`/`u_gamma` on this tier — the unlit branch writes `gl_FragColor` directly).
- **WGSL** (`Standard.frag.wgsl`): `#ifdef USE_UNLIT` declares `var color = albedo;` and the
  reflection + transmission blocks (which reference `[WGSL_PBR_LIGHTING]`-chunk locals such as
  `F0`) move into the lit `#else` — the unlit branch cannot reference non-existent chunk locals.
  `preprocessConditionals` (the WGSL compile gate in `GPUPipelineCache`) resolves both flag states
  with zero leftover directives (regression-tested).
- All non-unlit programs compile byte-identical to before (guarded, no shared-chunk edits — the
  `[LIGHT_CALC_PBR]`/`[WGSL_PBR_LIGHTING]` chunks themselves are untouched, so Decal and other
  chunk consumers are unaffected).

### Showcase design

- Loads `UnlitTest.glb`, keeps each material's imported `unlit` state, and exposes a live Material
  Mode (As Imported / Force Unlit / Force Lit). Force Lit demonstrates the contrast the extension
  removes: the same base color shaded by the studio setup. The mode toggle mutates
  `material.unlit` and re-links the variant next draw.
- Neutral studio backdrop (clear color), no skybox, no fog (no floor). Lights + neutral IBL exist
  solely for the Force-Lit contrast state — the unlit materials demonstrably ignore them (vision-
  verified: identical flat faces with lights present).
- Camera: canonical 3/4-elevated framing of the two reference cubes; the angled view proves that
  every visible face is flat color (a dead-front view would hide the flatness). FOV 40, orbit, R
  reset.
- HUD in the `ShowcaseDrawer` lab pattern: material-mode buttons, reset view, live readout
  (backend, load state, mode, unlit count, triangle count, per-material `unlit` + manifest flags),
  attribution note, shared perf footer as the last panel element.
- QA hook `window.__qaSwm49` (incl. `setMode`) drives `.agents/scratches/capture49.mjs`
  (1600×1000, WEB_GL1/WEB_GL2, per-mode).

### QA results

- Production gate `SHOWCASE_SKIP_WEBGPU=1 node .agents/scripts/check-showcases.js 49`:
  **GREEN** on WEB_GL2 + WEB_GL1, 0 console errors.
- High-res captures (SwiftShader): authored mode `{mode:"authored", unlitCount:2, meshes:2,
  triangles:88}`, 0 console errors on both tiers.
- Vision-bridge QA: **unlit is strictly flat** — every face of both cubes is an identical uniform
  color, no face shading, no specular, no reflections, with and without scene lights; no missing
  faces, no black patches, no clipping, depth sorting clean. **Force-Lit shows full PBR shading**
  (brighter tops, darker sides) on both tiers, confirming the live flag re-link and that the lit
  glsl100 variant still compiles after the shader edits (regression check).
- New regression suite `packages/engine/tests/renderers/shaders/UnlitShaderVariants.test.ts`
  (4 tests): WGSL directives resolve for both flag states, unlit excludes the transmission block
  (`refrDir`/`F0`), and the glsl300/glsl100 fragments keep their well-formed flat-color guards.
  Plus `GltfMaterialParser` tests for `KHR_materials_unlit` (unlit/not-unlit, manifest flag).

### Wiring

- Curated tour re-pointed: `48.next → 49`, `49.next → 24` (closing tail-wing slot of the Khronos
  program: `46 → 47 → 48 → 49 → 24`).
- Launcher gallery entry `49 Unlit Reference Lab` + section counter `48 Demos`.
- `check-showcases.js` `SHOWCASE_WAIT_READY` includes 49.

### Caveats / follow-ups

- WebGPU tier is not exercised by the production gate (no headless SwiftShader WebGPU). The WGSL
  unlit variant is compile-gated by the `preprocessConditionals` regression test and shares the
  same flag-driven pipeline-cache mechanism; a real WebGPU device run is a future manual check.
- Unlit + transmission/reflection combined on one material: glTF unlit ignores both; the shader
  branches exclude them under `USE_UNLIT`, so the combination is safe (compiles) and renders the
  flat base color.
- The milestone plan's BoomBox premise was wrong (PBR asset); documented above so the program
  history stays honest.
