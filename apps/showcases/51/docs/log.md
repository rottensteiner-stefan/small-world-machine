# Showcase 51 – Forest Measurement Baseline – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-11-07 — P0-3: ADR 0059 step-0 measurement baseline (two instancing lanes, seeded scatter)

Showcase 51 is the reproducible MEASUREMENT baseline for GPU-driven vegetation (ADR 0059 step 0,
veg-p0 WP P0-3). It renders a deterministic forest-like scene with TODAY'S engine tools only and
quantifies the gap between the two current-generation instancing lanes before `InstanceField`
(step 1) exists. No new engine features were added; no assets are required to run.

### Scene & lighting

- Flat neutral `Ground` (240×240 m) with a single PBR `StandardMaterial` — reproducibility over art.
- Fake sky via clear color (`0.55, 0.68, 0.8`) matching the LINEAR fog color; `scene.fog` =
  LINEAR, near 260 / far 420 (trees inside the box stay readable, ground edge fades to horizon).
- One key `DirectionalLight` sun (2 cascades, 2048 shadow map, `?shadows=off` to isolate passes)
  - one `AmbientLight`. Post-processing untouched (engine defaults).
- No time-dependent motion anywhere → identical URLs yield identical output (QA/golden-compatible).

### Two baseline scatter modes (`?mode=`, default `autoinst`)

- `autoinst` — plain `Object3D` scene-graph nodes relying on engine automatic instancing
  (ADR 0046). Population tree = shared per-part geometry + material references, inserted
  part-major so identical parts are consecutive; the renderers' A2 geometry grouping additionally
  reorders per material subgroup on WebGPU AND WebGL2 (verified in `WebGPURenderer.ts` /
  `WebGL2Renderer.ts` call `groupByGeometryForInstancing`). Both tiers batch these runs.
- `instanced` — the IDENTICAL population (same positions/yaw/scale from the same seeded scatter)
  as one `InstancedMesh` per part via `instanceMatrices` → one draw per part, no scene-graph cost.
- Fairness invariant: both modes consume the exact same `ScatterInstance[]`; `MEASURE` reports
  the placed count and per-mode scene-object counts honestly.

### URL knobs

| Knob | Meaning | Default |
|---|---|---|
| `?mode=autoinst\|instanced` | scatter lane | `autoinst` |
| `?n=N` | tree budget, clamped to [0, 2 000 000]; `?n=0` = empty population | 20000 |
| `?seed=S` | scatter seed (engine `mulberry32`) | 51 |
| `?shadows=off` | disable sun shadow casting (bench pass isolation) | on |
| `?frames=N` | automated run: N sampled frames after 30 warm-up, then one `MEASURE` line | 240 |
| `?measure` | synonym for `?frames=240` | — |
| `?qa=1` | headless-capture mode: fixed camera, no overlay/chrome | off |

Scatter: deterministic jittered lattice inside a ±100 m box (200×200 m), central 60×60 m clearing
excluded (camera-safe; skips inside the clearing still consume RNG jitter, so streams are stable
per (n, seed)). Placed count may end below `?n=` — reported, not hidden. At very high `?n=` trees
overlap (throughput baseline, not placement art) — accepted.

### Tree source — parallel-worker protocol (Frank, P0-2)

- Expected CC0 asset names (contract, editable here): `pine_lod0.glb`, `oak_lod0.glb`,
  `birch_lod0.glb` in `apps/showcases/51/assets/`. The FIRST that loads becomes the population
  prototype; extracted per-mesh parts share their imported geometry/material references so ADR 0046
  runs keep batching.
- Asset authoring contract (please read, Frank): LOD0 only, upright, vertical-axis centered,
  base at y = 0, OPAQUE materials (no alphaTest — transparent parts leave the opaque auto-instancing
  lane), scale 1.0 = natural size.
- If no asset loads, the baseline falls back (with `console.info`) to a procedural placeholder:
  trunk cylinder + two stacked foliage cones, same prototype/part pipeline. Both "assets present"
  and "assets absent" are handled; nothing blocks on Frank's lane.

### MEASURE contract (Charly wiring at S1)

- Showcase-44 pattern: `?frames=N` runs a 30-frame warm-up, then N sampled frames, then emits
  exactly one `MEASURE {json}` to the `#__measure` overlay AND `console.info`, with `rendererType`,
  `mode`, `n` (placed), `seed`, `source`, `prototype`, `partsPerTree`, `sceneObjects`, `frames`,
  `wallMs`, `frameMs`, `avgFps`. No GL draw-call wrapper (WebGPU-primary lane; showcase 44's wrapper
  only works on WebGL2). Per-pass GPU ms comes later from Bob's `gpuTimings` (S1).
- `?qa=1` headless stability: fixed default vantage, no overlay — stable screenshots; GoldenCapture
  integration is Charly's scope.

### Camera hook contract (Charly, S1)

- `Showcase.setExternalCameraPose(position, target)` — once called, applies exactly that pose every
  frame before rendering and stops honoring the orbit controller. Camera-path sampler can drive
  reproducible runs without touching this file. Interactive mode = orbit around the clearing
  (vantage `(60, 32, 60)` → `(0, 4, 0)`).

### Wiring

- Curated tour: `49.next → 50`, `50.next → 51`, `51.next → 24`, `24.prev → 51` (closed ring;
  `showcaseWiring.test.ts` GREEN expected). `vite.config.ts` needs NO entry — showcases are
  auto-discovered by `showcaseInputs()`.
- Launcher gallery: entry `51 Forest Measurement Baseline` + section counter bumped `49 Demos` →
  `50 Demos`.

### Verified / not verified (honest)

- Verified: scoped eslint/prettier clean, `tsc --noEmit` on the showcase file compiles (repo-wide
  tsc shows unrelated red from parallel workers, esp. missing `Hud.ts`/`CameraPaths.ts` imports of
  Charly's lane — not mine, this file imports only existing modules). No dev server / browser run
  was performed (coordinator integrates; Charly owns runtime verification).
- Not verified in this session: actual browser rendering, auto-instancing batch counts on live
  WebGPU/WebGL2, `?n=` scaling at hundreds of thousands, asset lane with real Frank assets.
- Open points: `check-showcases.js` entry (SHOWCASE_WAIT_READY/SLOW_NAVIGATION contour for 51) is
  Charly/Alice scope, not touched here; multi-species population (only first-available prototype
  used) deferred to P1; `?camera=` path keys live in Charly's `CameraPaths.ts`.

## 2026-11-08 — S1 integration (lead Alice): camera-path rig, truth/measure contracts, HUD, gpu timings, gate fixes

### URL-parse bug fixed (critical, `Number(null) === 0`)

- Absent `?n=`/`?seed=`/`?pausedAt=` coerced to `0` via `Number(null)` → the DEFAULT URL rendered an
  EMPTY population (gate screenshot showed `?n=0` ground+sky only) and `?path=` without `?pausedAt=`
  froze at t=0. All three reads now guard with `params.has()`/`!== null` before coercion.
- Verified: gate re-run at default n=20000 renders the full forest (`?n=18,363`, 25 s first pass,
  355 KB screenshot, vision-verified). Live lesson for the whole repo: never `Number(params.get(...))`
  on an absent knob.

### Camera-path rig (Charly P0-4 → this file)

- `?path=walk|flight|aerial` seeds `getCameraPath()` and drives `setExternalCameraPose` every frame
  (real-time t: `t += deltaTime / durationSeconds`); `?pausedAt=<t>` freezes the loop at `sample(t)`.
  `?path=` forces `defaultCameraController = "none"`. Interactive path switch via HUD keys/buttons
  (1/2/3) restarts `t` at 0.
- `?truth=1`: identical scene, signals `window.__vegTruthReady` after the first frame (P0 has no
  LOD/culling optimizations to disable → truth == full baseline render; P1+ re-gates this flag).
- `?pausedAt=` is a HUD-free CAPTURE mode (like `?qa=1`): the DOM HUD would pollute clipped
  screenshots and the FLIP comparison. Verified: veg-bench truth flow now yields ref-vs-shot FLIP
  `0.0` (pixel-identical) at `?truth=1&pausedAt=t` vs `?pausedAt=t`.

### MEASURE contract extension (F6 resolution)

- `MEASURE` now carries `path` and `frameTimesMs[]` (per sampled frame, CPU-observed); P50/P95 is
  computed on the bench side (`veg-bench.mjs --out`). `?gputimings=1` additionally attaches
  `gpuMs` + `gpuPassesMs` from Bob's ring on WebGPU (guarded; other tiers omit the fields).
- One note: `sceneReady`/`__swmGateReady` fires after 2 rAF ticks (= first *requested* frame); on a
  saturated software rasterizer the first *completed* frame can lag that by tens of seconds — the
  gate therefore relies on `SHOWCASE_WAIT_READY[51]` + the heavy-scene navigation budget, not on the
  fixed 1 s sleep (see F4 resolution, board).

### HUD + GPU timing ring (Charly P0-4 / Bob P0-1 → this file)

- `Hud` constructed only outside `hudFreeMode` (golden/measure/frames/truth) AND outside
  `?qa=1`/`?pausedAt=` capture modes. Pushes `VegHudStats` at ~4 Hz (`getCpuTime` = engine
  `lastCpuTimeMs`, `instances`/`mode` live, fps from delta, gpu from ring).
- Engine ring access is guard-cast to the WebGPU renderer (`_resolveGpuTimer`); `GpuTimingsAdaptor`
  maps `GpuTimer` → `HudGpuTimings` live (available/lastFrameMs/passesMs, degrades to `--`, never
  throws). Auto-enable in interactive HUD mode on WebGPU; explicit `?gputimings=1` for automated.
- `onKeyDown` override hands the HUD its keys (1/2/3, I/H) then falls through to stock shortcuts;
  `destroy()` disposes the HUD.

### Gate (`check-showcases.js`)

- `SHOWCASE_WAIT_READY[51] = true` + `SLOW_SHOWCASE_NAVIGATION_MS[51] = 120000`. Verified on
  GL1+GL2 (default n=20000): passes with the full forest in the screenshot.

### Verified / not verified (honest)

- Verified: tsc 0 errors, eslint clean, `build:lib` + full suite 4481 pass, `check:doctrine`,
  `lint:wgsl`/`lint:glsl` clean. veg-bench smoke on WebGL2 (all cells OK, MEASURE parseable,
  P50/P95 computed, truth FLIP 0.0, shots not blank). Gate re-run content-verified per vision.
- Not verified in this room (no `navigator.gpu` headless): the WebGPU `gpuTimings` ring end-to-end
  (Bob's unit coverage 18/18 stands in for headless; real device lane next, see research note).
- Open: WebGL1 bench cells not yet run (SW lane exists); golden baseline capture for 51 pending
  S2 numbers; `instanced`/`autoinst` high-n (100k) grid running (S2).

## 2026-11-08 — CORRECTION + GpuTimer fix (headless WebGPU lane is real; ring was broken)

- **Correction:** the S1 "Not verified (no `navigator.gpu` headless)" claim is WRONG. `navigator.gpu`
  IS available in headless terminal-launched Chrome here — but only on a **secure context**
  (`https://localhost:*`). The P0-era negative probes ran on `about:blank`, which is not a secure
  context. Verified functionally on the Dawn/SwiftShader software adapter (`vendor: google`,
  device + submit + `onSubmittedWorkDone`). → WebGPU code-path + baseline runs ARE automated;
  only the real-Metal absolutes and the `gpuMs` ring data need the operator session (research note §8).
- **Critical fix (engine `GpuTimer.ts`, found via the now-runnable WebGPU lane):** the ring produced
  an **Invalid CommandBuffer** that silently dropped every frame at heavy n (P50 read ~16.7 ms =
  false-fast no-op frames VS ~53 ms once fixed). Two spec violations, both would have hit every real
  `timestamp-query` device:
  1. resolve buffer lacked `QUERY_RESOLVE` usage;
  2. `MAP_READ` combined with more than `COPY_DST` (spec: `MAP_READ` only pairs with `COPY_DST`).
  Fixed with the in-repo `HzbOcclusionSystem` two-buffer pattern (resolve dest + `copyBufferToBuffer`
  into a `MAP_READ` staging). Unit tests updated (18/18) to the two-buffer contract. The headless
  Dawn adapter exposes no `timestamp-query`, so `gpuMs` honestly stays absent on the automated lane.
- Verified post-fix: veg-bench WebGPU cells OK (0 console errors), forest renders (vision-confirmed),
  P50 ≈ 53 ms @ n=480 — real rendering restored.

## 2026-11-08 (evening) — Real-GPU operator session EXECUTED; gpuMs ring truthful on M4 Pro

- **Session:** 8/8 WebGPU cells on the real Metal adapter (MacBook Pro M4 Pro, Chrome 157.0.8103.39,
  headed system Chrome, `veg-bench.mjs --real-gpu`, `frames=240`, zero console errors). Raw JSON in
  `.agents/scratches/veg/rgpu/session-wg*.json` (gitignored). Numbers folded into
  `docs/research/vegetation-baseline-2026-11-07.md` §4 (+§8 verdict).
- **Showcase fix (P0-critical, `showcase.ts`):** `this._gpuTimer` was only kept on the interactive-HUD
  path, so explicit `?gputimings=1` runs (`?frames=`/`?measure=`, HUD-free) recorded the ring but
  NEVER attached `gpuMs`/`gpuPassesMs` to the MEASURE contract — the session would have had no ring
  evidence. Reference is now kept whenever the ring can be active (HUD OR explicit).
- **Engine quirk + fix (`GpuTimer.ts`):** Chrome 157 / Metal-3 grants `timestamp-query` but never
  writes the begin-of-pass slot (stays 0) while end-of-pass holds an ABSOLUTE monotonic counter
  (~7.9e14). `end - begin` therefore yielded the absolute counter (`gpuMs ≈ 788 639 077 ms` on an
  ~8 ms frame). `_publish` now detects `begin == 0` and derives the duration from the delta of
  successive end counters per segment name across CONTIGUOUS frames (baselines dropped on a gap →
  a published segment is always a clean single-frame measure or absent). Healthy adapters unchanged.
  `probeTimestampPeriodNs` additionally falls back to 1 for a present-but-invalid return.
  3 new unit tests (21/21 green), full suite 4484 pass.
- **Result (decisive for P1):** all 8 cells GPU/rasterization-bound (`gpuMs` = 0.86–0.98 × `frameMs`);
  autoinst vs instanced 5.4× (20 k) / 27× (100 k). P1 (GPU culling) priority confirmed; no CPU-limited
  cell. Android low-tier spot: not available on this host (no device) — open, does not block P1.
- Verified: typecheck clean, eslint clean, `build:lib` + full suite green, real-GPU cells 0 console
  errors, `gpuMs` ≈ `frameMs` post-fix on every cell.

## 2026-11-08 (late) — gpuMs truth correction: engine spec-name typo, not an adapter quirk

- **Finding (mailbox flag, review-agent; conclusive probe `probe-timestamp-name-conclusive.mjs`):** the
  "Chrome 157 never writes the begin slot" claim in the previous entry was an **engine typo**. `GpuTimer`
  spelled `beginOfPassWriteIndex`; the shipped W3C/WebIDL member is `beginningOfPassWriteIndex`.
  WebIDL silently ignores the unknown key → begin slot stayed 0 while end held an absolute counter.
  Probe result: spec-name writes begin (796 329 220 505 600), engine-name leaves it 0.
- **Fix (`GpuTimer.ts` + tests):** shipped member name used everywhere; the successive-end-delta
  fallback (`_segmentEndBaseline`) is **removed** — it measured **wall clock**, producing the
  tautological `gpuMs` ≈ `frameMs` that faked the "GPU-bound" narrative. `_publish` is back to clean
  `end-begin`; `probeTimestampPeriodNs` null-guard stays. GpuTimer suite 19/19 green, typecheck + eslint
  clean.
- **Re-measure (real Metal, corrected ring, `PREVIEW_PORT=4174`, `recorrect-*.json` local):** real GPU
  work is 1.3–4.0 ms @20 k and 3.7–6.0 ms @100 k — **2–34 % of each frame window; no cell is GPU-bound.**
  autoinst is **CPU-bound** (36 726 / 182 928 scene objects: ~40 ms CPU overhead @20 k, ~275 ms @100 k);
  the autoinst-vs-instanced gap (5.2× @20 k / 26× @100 k) is CPU-side, not rasterization.
- **Corrected P1 verdict:** the GPU rasterizes **100 k instances in <6 ms** — the dominant cost is
  CPU-side per-object work, exactly what P1 (`InstanceField` GPU culling + indirect draw) removes.
  Priority **confirmed and strengthened**; ADR 0059 step 1 scope unchanged. Baseline note
  `docs/research/vegetation-baseline-2026-11-07.md` §4/§6/§7/§8 corrected accordingly (credit: review-agent).

## 2026-11-09 — Field lane on real hardware (ADR 0059 step 1 accepted)

- `?mode=field` had never rendered on a device: black frame on Apple Metal (5 validation errors), then stripes + flicker. Fixed in `InstanceFieldSystem` / field WGSL (list in ADR 0059 "Step 1 result"); the decisive ones were the unaliased u32 param words (shadow culls landed in the main segment, HZB never on) and the 1024-entry page overflowing at 5.5 k visible trees.
- Audit (`cullref=1&popcount=1`): GPU == CPU reference in every probed frame, modes a and b.
- Gate: field 182 728 trees @ 58 fps, CPU 0.1 ms, GPU 6.8 ms vs. autoinst 18 363 trees @ 60 fps, CPU 20.9 ms.
- Open: placeholder shading (flat white); HZB culls nothing in this scene (sphere footprints reach past the front crowns) — S3 occlusion spike.

## 2026-11-09 — Field lane shading

- Field trees no longer white: merged tree carries per-part material colour (linear) + foliage mask (green-dominant part) as vertex colours; field backlight = showcase 52 leaf tint. `MEASURE.fieldShading` = `lambert-csm`.
- First version was ~2× too dark: showcase 51 runs without post-processing, so the material shaders tone-map + display-encode themselves; the field wrote linear values. Fixed by the Standard output stage (exposure, `forwardToneMap`, `linearToSRGB`, fog).
- Same view vs. autoinst: 3/255 mean abs diff per channel. 182 728 trees: GPU 10 ms, CPU 0 ms.
