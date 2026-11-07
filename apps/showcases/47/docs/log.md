# Showcase 47 – PBR Reference Lab – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-11-02 — Khronos MetalRoughSpheres on a neutral studio IBL

Milestone A of the Khronos showcase program: the official `MetalRoughSpheres.glb`
(`@small-world-machine` renderer tiers A/B comparison, pure core glTF 2.0 — no extensions).

### Asset audit (from GLB binary, all author-distributed)

- `extensionsUsed` / `extensionsRequired`: **undefined** — pure core glTF 2.0, no engine gap.
- 1 material (shared), 5 meshes × 1 primitive, 6 nodes (root + 5 mesh nodes), 2 textures
  (baseColor + metallic-roughness), 2 images, 1 sampler; no `doubleSided`, no alpha.
- Attribute sets: `POSITION` / `NORMAL` / `TEXCOORD_0` only — no TANGENT (no normal map), no skinning.
- Authoritative world bounds (declared accessor min/max — naive byte parsing misread these earlier):
  `x ∈ [-12.19, 11.87]`, `y ∈ [-1, 9]`, `z ∈ [-12.36, 10.97]` ≈ **24 × 10 × 23 units**, center ≈ `(0, 4, -0.5)`.
  The five meshes are depth-separated x-bands, so the display has **real depth along Z** (not a flat wall).
  Uint16 indices, ~501 776 triangles total, ~700k vertices across 5 draw calls.
- License note: CC-BY 4.0 (Khronos glTF-Sample-Assets).

### Scene design (reference-faithful, engine-neutral)

- **Environment:** all repo `ibl/` sets are cosmic/outdoor (verified via vision bridge: 13/15/16/28/30/36/37
  are space or sky). Generated an own **neutral lightbox equirect** (`gen-ibl-pano.mjs`, scratch:
  soft overhead white softbox + faint back fill on mid-grey walls, darker floor; pure smooth
  functions, deterministic) and baked it through the **real engine WebGL2 pipeline** with
  `ibl-bake --input` → `ibl-neut/` (`brdf_lut`, `irradiance`, `prefilter/mip0..4`, PNG output
  converted to the `.webp` names `loadIbl` requires via `cwebp -lossless`).
- **No skybox**: neutral `renderer.setClearColor` backdrop instead. **No per-material `envMap`**:
  metals receive the scene-level `prefilterMap`/`irradianceMap` from `loadIbl` (renderer binds
  `u_prefilterMap`/`u_irradianceMap` per frame when `scene.irradianceMap || scene.prefilterMap`).
  The glTF material itself is never mutated — reference values stay byte-authoritative.
- **Studio lights** (HUD-controlled): key directional (warm, default 3.2), ambient fill (0.12),
  cool rim point light behind the display (default 1.6).
- **Post chain:** tone mapping stays ON (engine ACES default — HDR PBR specular clamps into
  blotches without it; this was the root cause of the first dark-noisy renders). Bloom OFF by
  default, both HUD-togglable.
- **Camera:** classic **3/4-elevated reference framing** `(13, 11.3, -32) → (0, 4, -0.5)`, FOV 40°.
  A dead-fronto-parallel view aligns the sphere columns along Z and collapses them into stacked
  pillars (observed in capture); the angled yaw separates rows. `R` / HUD button resets to it.
- **Floor:** oversized 280×280 plane (edges outside view cone) **plus linear scene fog** in the
  backdrop color with `near 52 / far 85` — begins past the display (far side ≈ 46 units) and fades
  the lit floor before its termination. Without fog the lit-floor vs. unlit-backdrop contrast drew
  a hard horizon seam across the frame (vision-verified fix).

### HUD / panel

- `ShowcaseDrawer` panel `#pbr-lab-hud` (Showcase 42 pattern, 13/20/43/44/45/46 lab precedent):
  view reset, studio light sliders (Key/Ambient/Rim), tone-mapping + bloom switches, **live
  reference readout** (backend, load status, object/mesh/triangle counts, frustum-visible count,
  post state), attribution note, and the shared **perf footer** as the last bottom element
  (`engine: this` telemetry → FPS/CPU/reserve).
- Keyboard: drawer `I`/`H`; renderer A/B swap `Alt/Option + 1/2/3` (engine base); `R` = reset view.

### QA tooling & gate

- `check-showcases.js` gained a generic **`SHOWCASE_WAIT_READY` hook** (opt-in per showcase):
  the checker arms `window.__swmGateReady` via `evaluateOnNewDocument` and waits for the engine's
  `small-world-machine:scene-ready` event (fires after setup **and** a stable painted frame) before
  the screenshot — heavy-asset showcases must not be judged against a fixed 1 s sleep (a blank
  screenshot would be a false failure). Benefits the upcoming skinning/unlit showcases equally.
- QA hook `window.__qaSwm47` (sample: renderer, frames, loadOk, object/mesh/triangle counts,
  frustum-visible count) drives the high-res capture harness `.agents/scratches/capture47.mjs`
  (1600×1000, WEB_GL2). Final capture: `loadOk: true`, 12 objects / 5 meshes / 501 776 triangles,
  ##### 0 console errors.
- Vision-bridge final QA: display fully visible, all rows readable, roughness→gloss gradient
  smooth, no black patches/fireflies/aliasing, floor fades without a hard seam, backdrop is a
  visible grey studio tone (not black), nothing clipped. Iterations: cosmic env → neutral IBL,
  post OFF → tone ON, elevated-fronto → 3/4-yaw, black backdrop → grey + fog.
- Production gate `SHOWCASE_SKIP_WEBGPU=1 node .agents/scripts/check-showcases.js 47`:
  **GREEN** on WEB_GL2 + WEB_GL1 (software renderer). ShowcaseWiring suite 13/13, `tsc`/`eslint`
  clean for the showcase.

### Wiring

- Curated tour re-pointed: `46.next → 47`, `47.next → 24` (tail-wing slot after 46; 48/49 to follow).
- Launcher gallery entry `47 PBR Reference Lab` + section counter `46 Demos`.

### Caveats / follow-ups

- SwiftShader gate captures show luminance noise/dither — software-renderer artifact, not an
  engine defect; real GPUs render clean.
- The wide-but-flat display can never fill a 16:10 frame vertically without clipping horizontally
  (geometry constraint); the "reference-sheet" composition with margins is intentional.
- `ibl-neut` generation artifacts (`gen-ibl-pano.mjs`, bake inputs) live in `.agents/scratches/`
  (gitignored); the committed set is the baked `.webp` outputs only.

## 2026-11-07 · Tone Curve Selector

- The "Tone Mapping (ACES)" switch became a curve selector: one preset button per `ToneMappingMode` (derived from the enum, `DEFAULT` alias skipped), `T` / `Shift+T` cycles. Readout shows the active curve. Default is the engine default `PBR_NEUTRAL` (was ACES Narkowicz) -- the Khronos reference is now judged under the Khronos tone mapper, like the glTF Sample Viewer.
- Verification: all nine curves cycled on WebGL2, WebGPU and WebGL1 without console errors; WebGPU differs from WebGL2 by a constant ~2 % RMSE for every curve (tier baseline, not curve-dependent).
