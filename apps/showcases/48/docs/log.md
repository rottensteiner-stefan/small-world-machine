# Showcase 48 – Fox Skinning Lab – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-11-02 — Khronos Fox + engine-new WebGL1 joint-matrix path

Milestone B of the Khronos showcase program: the official `Fox.glb` runs its 24-joint rig through
the engine's `AnimationMixer` on every renderer tier, including the **newly implemented WebGL1
GPU-skinning path** (the WebGL1 tier previously had no joint/weight/bone-matrix support at all).

### Asset audit (from GLB binary)

- `extensionsUsed` / `extensionsRequired`: **undefined** — pure core glTF 2.0, no engine gap.
- 1 skin, 24 joints, `inverseBindMatrices` + `skeleton` root present (24 ≤ `MAX_SKINNED_BONES` 64).
- 3 animation clips (`Survey`, `Walk`, `Run`), 21 channels each, targeting rotation channels.
- 1 mesh (`fox1`): `POSITION`, `TEXCOORD_0`, `JOINTS_0`, `WEIGHTS_0` — **non-indexed** (an empty,
  not-undefined, index array is what the parser emits for non-indexed primitives).
- 1 material (`fox_material`): opaque, no extensions, no double-sided.
- Bind pose is a FLAT splayed pose (limbs along ±z, `body x ±12.6 / y 78.9 / z -88..66`); the
  animations stand the fox up. License: CC-BY 4.0 (Khronos glTF-Sample-Assets, Google).

### Engine work — WebGL1 GPU skinning (engine-new)

The WebGL1 tier had skinning gaps across the whole chain (verified by grep: no joint attributes,
no bone-matrix uniform, no skin shader code, no `USE_SKINNING` flag handling). Ported the existing
WebGL2/WebGPU path to `glsl100`:

- `web_gl1/base.vert.glsl`: `USE_SKINNING`-guarded `attribute vec4 a_joints / a_weights` +
  `uniform mat4 u_boneMatrices[64]`, and in main the identical 4-bone linear blend
  (`localPos / localNormal / localTangent` = `skinMat` applied to bind-pose attributes, then the
  regular model matrix + TBN path on the deformed attributes). Non-skinned programs compile
  byte-identical to before (guarded).
- `WebGLProgramCache` (glsl100 branch): `a_joints` / `a_weights` added to the queried attribute
  names — fixed locations 4/5 via the shared `bindAttribLocation` list (already present for both
  dialects), `getAttribLocation` yields -1 for non-skinned programs which `mesh.bind` treats as
  "attribute absent". `u_boneMatrices[0…63]` was already discovered/expanded by the generic active-
  uniform walk (arrays), so `cache.uniforms.get("u_boneMatrices[0]")` works like on WebGL2.
- `WebGL1Renderer`: the subgroup flag collector now pushes `ShaderFlag.SKINNING` under the same
  trigger rule as WebGL2 (`isSkinnedMesh(first) && skeleton` OR raw geometry joints); the standard-
  object draw path uploads `u_boneMatrices` (clamped to `MAX_SKINNED_BONES * 16` floats, mirror of
  WebGL2) and passes `a_joints`/`a_weights` locations into `mesh.bind` (whose `jbo`/`wbo` joint and
  weight buffers already existed and were populated from `GeometryDataInterface.joints/weights`).
- Cache/skin refresh and drive order were already correct and are reused: `Scene.update()`
  refreshes `Skeleton.update(worldMatrix)` after the matrix pass (Scene.ts:162-170), and
  `SmallWorldMachine._onFrame` runs the app `update()` (animation) BEFORE `scene.update()` (skin
  matrices), so the mixer drive in the showcase feeds the same frame's GPU matrices (Scene.ts
  order verified). WebGPU (`u_boneOffset` skin buffer path) and WebGL2 (`u_boneMatrices` uniform)
  skin paths were pre-existing and unchanged.

### Showcase design

- Loads `Fox.glb`, binds every authored clip into one `AnimationMixer`, auto-plays `Survey` (loop).
  HUD switches clips (Survey/Walk/Run/Bind-pose), scales playback tempo (0–3×, `timeScale`), reset
  view; live skinning readout (backend, load state, skinned meshes / bones, playing clip + time,
  clip durations). `ShowcaseDrawer` lab pattern with the shared perf footer as last element.
- Neutral studio sweep: no skybox, no floor — the character stands in the neutral backdrop
  (clear color + LINEAR fog in backdrop color, near 260 / far 400, past the character) with the
  baked neutral lightbox IBL (`ibl-neut`, scene-level, environmentIntensity 1.2). Soft key +
  ambient fill + cool rim light. Tone mapping stays on (engine default), bloom off.
- Camera: hero 3/4 framing of the standing fox `(55, 100, 235) → (0, 42, 0)`, FOV 42, orbit, R reset.
- QA hook `window.__qaSwm48` (renderer, frames, loadOk, meshes/triangles, frustum-visible,
  skinned meshes / bones, playing clip + time, clips) drives `.agents/scratches/capture48.mjs`.

### QA results

- Production gate `SHOWCASE_SKIP_WEBGPU=1 node .agents/scripts/check-showcases.js 48`:
  **GREEN** on WEB_GL2 + WEB_GL1, 0 console errors (ShaderFlag flus: no program/link errors on the
  new `glsl100` skin variant).
- High-res captures (1600×1000, SwiftShader): WEB_GL2 `{skinnedMeshes:1, skinBones:24,
  playing:"Survey", clipTime advancing}` and WEB_GL1 `{same, clipTime 2.9s}`, 0 console errors.
- Vision-bridge QA (both tiers): fox renders as a **standing, articulated quadruped in the Survey
  pose** — explicitly NOT a flat bind pose, not a rigid block; no inverted/black/missing faces, no
  detached limbs, no clipping; warm orange + white bib texture intact in the body's canonical
  colour zoning. WebGL1 shading is flatter than WebGL2 (no IBL specular on that tier — expected,
  tier-authentic; the geometry integrity and deformation are correct).
- `triangles` readout fix: non-indexed glTF primitives carry an empty (not undefined) index
  buffer — the honest fallback counts `vertices/9` per triangle.

### Wiring

- Curated tour re-pointed: `47.next → 48`, `48.next → 24` (tail-wing slot after 47; 49 to follow).
- Launcher gallery entry `48 Fox Skinning Lab` + section counter `47 Demos`.
- `check-showcases.js` `SHOWCASE_WAIT_READY` now includes 48.

### Caveats / follow-ups

- WebGL1 skinning uses the 64-bone fixed uniform array like the other tiers; vertex-shader uniform
  vector pressure on very weak devices is the only tier risk (SwiftShader and desktop ANGLE meet
  it; a future device-cap gate could lower the WebGL1 budget).
- WebGPU skin path unexercised here (no headless SwiftShader WebGPU in this gate) — pre-existing,
  unchanged by this milestone.
