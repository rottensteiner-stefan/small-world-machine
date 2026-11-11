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

## 2026-11-09 — Field lane wind (ADR 0059 step 1b)

- Field lane now moves with the shared wind field (`vegetation-extras` `WindField`): per-instance
  lean from the root position hash + travelling gust waves + calm phases + vertical profile,
  applied in the pulled vertex (`field_pull.wgsl` inlines the `swmWind*` functions verbatim;
  `WindShaders.test.ts` pins engine/extras parity). `FieldInfo` carries the per-frame `SwmWind`
  block (`windUniforms` borrowed reference, forwarded once per frame at the main-view prepare).
- `?wind=0` disables the lane for cost isolation (`MEASURE.wind` reports the state); default on.
- V1 approximations (documented in ADR 0059): position-only bend (normal not tilted), shelter 0,
  one field-wide windHeight, autoinst/instanced lanes static.
- Gates: tsc, eslint, `lint:wgsl` 116/116, doctrine clean. Tests green (engine `InstanceFieldSystemDevice`
  +4, extras `WindShaders` parity). Golden `veg51` unaffected (GL2 autoinst lane, no wind).
- Open/measure on device: wind vertex cost on 182 728 trees via `?gputimings=1` (per-instance
  lean cache in the cull is the documented mitigation if the ring shows a budget blow-up).
- Committed on `main` @ `05c68ec` ("Storms make trees take deeper roots."), pushed. Pending
  device verification above, then follow-ups from ADR 0059 step 1b.

## 2026-11-09 — Interactive free-fly camera + wind HUD toggle (device-verification UX)

- Device check showed the old interactive vantage was unusable for wind/quality inspection: far
  elevated 3/4 orbit (60,32,60) shrinks trees to pixels, and the wind A/B (`?wind=0`) was
  invisible from there (the isolation knob itself verified sound — `/apps/showcases/51/` is
  served directly, query survives).
- Interactive sessions now run the engine's 6-DOF spectator camera (`defaultCameraController =
  "fly"`, WASD + mouse look + Space/C + Shift/Alt, `R` = reset), start pose moved to the forest
  edge at eye level (42,5,42) → (0,4,0). Automated/QA/path/golden runs keep `none` — golden
  `veg51`, benches and `?path=` captures byte-identical (unchanged camera).
- Wind now lives in the HUD, not only the URL: `F` / button toggles the field-lane wind at
  runtime via the new engine `InstanceFieldSystem.setWind(wind, windHeight)` (hard off = height
  0, pulled-shader gate static, no wind-pop on re-enable; the wind field keeps advancing while
  off). Live state mirrored in the readout + `MEASURE.wind`; the wind field is always built now
  (URL knob only sets the START state, `?wind=0` still valid for load-time isolation).
- tsc + eslint clean; `InstanceFieldSystemDevice` +2 live-toggle tests. Pending: user re-test
  of wind A/B from the new vantage.


## 2026-11-09 — Wind device gate CLOSED (no measurable cost, no mitigation)

- Reproducible A/B on a FROZEN vantage (`?path=aerial&pausedAt=0.3`, same statics, tab foreground,
  no throttle outliers): real M4 Pro / Chrome Metal, 166 784 records (182 728 minus clearing),
  `main:opaque` timestamp ring: **wind on = wind off = 5.833 ms → delta 0.000 ms**. The early
  18-k "1.1 ms delta" was camera-path + tab-throttle noise, not wind.
- Verdict recorded in ADR 0059 step 1b: pulled-vertex wind is FREE on the reference device; the
  documented per-instance lean cache in the cull stays dormant. Ground-cover ring remains the
  open step-1b remainder.
- Methodology learned (applies to all future field-lane cost gates on this rig): `pausedAt`
  frozen camera + foreground tab; `gpuMs` = LAST frame only, so a moving camera makes it random;
  discard runs with `frameTimesMs` 1000+ outliers.

## 2026-11-09 — Ground-cover ring LANDED (V1, source B)

- Second, camera-centred `InstanceFieldSystem` for grass (ADR 0059 step 1b source B): new
  `vegetation-extras/src/groundcover/GroundCover.ts` generates a tile ring around the camera with
  stable per-tile hash seeds (blades glued to the world — no swimming) and stochastic distance
  thinning toward the ring edge; records fed per frame through the NEW engine zero-GC
  `InstanceFieldSystem.uploadRecords()` (single-prototype O(1) range fast path, preallocated
  `maxInstances` — no buffer regrow; only the WRITTEN prefix is uploaded via a subarray view, a
  full-capacity upload would draw the zero tail as an origin blob).
- Grass geometry = real tapered two-crossed-pair blade card (no alpha-cutout texture in V1; the
  existing `card_grass.glb` cards are the documented material upgrade). `maxViews: 1` keeps grass
  out of all shadow-map passes (no casting); the pulled shading still RECEIVES shadows.
- Wind: shares the tree `WindField`'s `SwmWind` block at the grass height profile (0.5 m =
  scale-1 blade top); `_applyWindState` gates BOTH fields with the live `F` toggle.
- URL knobs: `?cover=0` off, `?coverDensity=` (blades/m²), `?coverRadius=` (m). `MEASURE` now
  carries `coverInstances` / `coverRadius` / `coverDensity`; HUD readout shows the cover count.
- Engine `uploadRecords()` verified by `InstanceFieldSystemDevice` (+1 live-feed test: bytes reach
  the preallocated buffer, `instanceCount` mirrored, no regrow) with a writeBuffer-mock fix for the
  raw-ArrayBuffer form; `GroundCover` pinned by 4 tests (determinism, world-glue under two ring
  centres, pose validity incl. the frozen 1/256 scale quantization, capacity + camera-clear disc).
- Headless SwiftShader self-test (frozen aerial vantage, n=4000): ring capacity 67 600, live
  population 37 913 records, `main:opaque` 0.92 ms (cover off) → 1.64 ms (cover on) — real
  cull + draw cost. Gates green: typecheck 0, eslint 0, check:doctrine 0, build:lib ok, full suite
  4635 tests. Headless Playwright screenshots do NOT capture the WebGPU surface (Dawn compositor
  blank) — pixel QA happens on the real device.
- PENDING: real-M4Pro frozen-vantage measurement of the ring's marginal GPU cost vs the ≤ 2 ms
  ring gate (user re-test, same methodology as the wind gate).

## 2026-11-09 — Step 2: LOD buckets + crossfade (ADR 0059, phase veg-p2, merged to main)

- Showcase 51 now exercises the full LOD path: three ascending stride-decimated proxy buckets
  (coarse / mid / merged fine) with URL knobs `?lodband=` / `?lodhyst=` / `?lodbias=` /
  `?shadowlod=` and a HUD LOD section (`L` toggle cycles crossfade ↔ hard). Bucket geometry is
  additive and separate from the `__swm51` QA surface.
- Engine (merged from the veg-p2 parallel phase): cull-side bucket selection via the frozen
  projected-px metric + per-tier bias; fork-A dual-bucket crossfade-band write (fine +p / coarse
  -p, shared |p| exact partition); shadow views reuse the main camera's bucket choice (optional
  coarser bias); per-bucket geometry binding; fragment-side complementary 8×8 Bayer dither in all
  four `field_pull` variants + candidate-C hard-switch config. Engine default
  `lodCrossfadeBand = 0` = fail-closed / P1-identical until configured.
- GL2/GL1 remain on the CPU cell-LOD hard switch (deliberate tier cap, no per-instance blend
  channel); `tier-parity.json` `instance_field_lod_crossfade` webgpu → `present`, GL rows →
  `deliberate`.
- Verification: full gates green (4694 tests; tsc/eslint/doctrine/lint:wgsl 116/116/build:lib).
  Real-browser compile found one WGSL-only defect escaped by all static gates (`select(<cmp>, …)`
  template-list ambiguity under strict tint) — fixed with parenthesised operands, zero semantic
  change (`b918a92`). Headless SwiftShader-Dawn compile + render re-verified on `?path=flight`
  and aerial with the band active: 0 shader errors, grass + field render.
- PENDING: live pop measurement under TAA on/off on the real device (protocol in
  `docs/research/veg-p2-lod-transitions.md` §6) and the moderator decide spike A/B/C (dither vs.
  hard+hysteresis); `?lodband` default stays 0 until then.

## 2026-11-10 — DECISIVE MODE SWITCH (ADR 0059 step 2, moderator decide-spike resolved)

- Moderator mandate ("optimal quality with calculable performance; multiple solutions behind ONE
  switch") resolved as the DECISIVE MODE SWITCH: `?lodMode=off|hysteresis|dither|dither-hysteresis`
  preselects one documented strategy; HUD `L` now CYCLES all four modes live (was: binary
  crossfade/hard). Each mode derives the raw knobs from the engine's authoritative
  `LOD_TRANSITION_MODES` table; its cost is bounded and documented (dither delta scales with the
  band population only; hysteresis = pure cull ALU; ±1/frame structural cap via jitter).
- MEASURE + HUD now report the applied mode (`lod.mode`) alongside the derived band/hyst/bias;
  the raw `?lodband=`/`?lodhyst=`/`?lodbias=`/`?shadowlod=` knobs remain as fine-tuning escape
  hatch (last call wins, mode mirror untouched). Engine default stays fail-closed `off`
  (P1-identical) until the §6 live pop measurement on the device picks a default band.
- Verification: full gates green (4707 tests; tsc/eslint/doctrine/lint:wgsl 116/116/build:lib).
  Headless SwiftShader-Dawn compile + render verified for ALL FOUR `?lodMode=` presets plus the
  flight/aerial band runs: 0 shader/validation errors, grass + field render.
- PENDING: live A/B pop measurement under TAA on/off (research note §6) + ring-gate A-B-B-A
  runs on the M4 Pro; B (geomorph) deferred for V1.

## 2026-11-10 — Ground-cover ring gate CLOSED (ADR 0059 step 1b, real M4 Pro) + protocol finding

- Ring gate measured on the real device (interleaved frozen-vantage A/B, `?path=aerial&pausedAt=0.3`,
  `occlusion=a` = constant tree draw set, `main:opaque` LAST frame, per-scenario minimum):
  A (cover off) 6.291 / 6.291 ms; B (cover on, 28 036 blades) 2.621 / 3.211 ms →
  `minB − minA = −3.67 ms ≤ 2.0 ms` → **gate PASSED**. The ring's NET frame impact is negative
  (it does not burden the frame budget); the standalone marginal cost is bounded by the headless
  SwiftShader anchor (+0.72 ms at 37 913 blades).
- **Protocol finding (documented in ADR 0059):** the frozen-vantage `main:opaque` A/B is
  CONFOUNDED on real silicon by a depth-pre-pass early-Z coupling — `DepthPrePassGPU` writes every
  registered field's depth before the color pass, so the grass depth runs ahead of the tree color
  pass and hardware early-Z discards tree fragments behind it (~2.4× `main:opaque` reduction).
  The inversion reproduces with `occlusion=b` too and is absent under SwiftShader (no such hardware
  path) — it is device-specific raster efficiency, not a culling/budget bug. An
  `?coverDensity=`-sweep protocol stays the documented option if a standalone marginal is later
  demanded.
- Remaining PENDING: live pop A/B sighting under the LOD mode switch (task 2, `?path=flight` + `L`).

## 2026-11-10 — LOD default DECIDED (ADR 0059 step 2, live sighting on the real M4 Pro)

- Live human sighting (real M4 Pro, aerial flyover, `cover=0`, `?lodMode=dither-hysteresis`):
  WITHOUT TAA the dither reads as a coarse moiré/screen-door flicker (unpleasant);
  WITH `?taa=1` it degrades to a residual fine grain ("leicht körnig") — TAA helps but does not
  eliminate the pattern. The `hysteresis` rail has no fragment pattern by construction.
- **DECISION:** engine zero-config default transition mode = `hysteresis` (band 0 / hyst 0.02 /
  hard gate). `off` = explicit P1-identical opt-in; `dither*` = documented TAA-pipeline opt-in.
  Demo defaults of THIS showcase aligned (band 0 / hyst 0.02) so the zero-config demo shows no
  moiré. `?lodband=`/`?lodhyst=` still expose the dither band on demand; `?taa=1` arms the
  engine `TaaElement` for the dither display condition.
- Recorded in ADR 0059 + research note §9.8 (supersedes §9.7's "keep hard-switch/off" stance).

## 2026-11-10 — P2-3 tooling LANDED: offline `swm lod` CLI (no showcase change)

- This showcase's field lane STILL uses the stride-decimated proxy buckets
  (`FIELD_LOD_PROXY_STRIDE` in `_buildFieldLane`); the real `_LOD<n>` consumption is the
  documented next step (asset process + LFS commit).
- Tooling available: `swm lod <input.glb> <out-dir>` (meshoptimizer, `packages/tools`) generates
  `<stem>_LOD0.glb` (verbatim) + `<stem>_LOD<n>.glb` (descending detail) from indexed GLBs. The
  naming contract is `<stem>_LOD0` = finest, mapping onto the engine's `lodIndex` semantics
  (`0 = finest`) — NOT the bucket array order (bucket 0 = farthest/coarsest; the
  `PrototypeDescriptor.lodBuckets` JSDoc was corrected to match).
- Verified on this showcase's `tree_detailed.glb` / `tree_oak.glb`: valid output, byte-deterministic,
  `--verify` clean. The sharp low-poly tree set honestly fails soft (196→192 tris at default
  `--error 0.02`); meaningful reduction appears at `--error` upscales or on larger meshes.
- Docs: ADR 0059 step-2 (P2-3 result bullet), `docs/guides/asset-pipeline.md` §6 (LOD contract),
  CHANGELOG, BACKLOG.

## 2026-11-10 — Real `_LOD<n>` consumption (`?reallod=1`, opt-in)

- `?reallod=1` (field lane only): `_tryLoadRealLodLevels()` preloads `<stem>_LOD3/2/1.glb`, merges
  each via `_collectAssetParts` + `_mergeTreeGeometry`; chain `[LOD3, LOD2, LOD1, merged]`, 4 buckets,
  bands `FIELD_LOD_MAXIMA_REAL_PX = [16, 32, 72, 1e6]`, `lodIndex` 3/2/1/0. Atomic fail-closed: any
  missing/empty level → proxy path. `LOD0` not shipped (byte-identical to base; prototype reused).
- Default (no knob) = stride-decimation proxy path, unchanged. MEASURE adds `lodSource`
  (`proxy`|`reallod`, field lane) and `lodTris` (len 4, reallod only).
- **Decision: stays opt-in.** The Kenney set barely simplifies (`tree_pineTallA` 78→74,
  `tree_oak` 196→192, `tree_detailed` 402→380 tris) vs. proxy far bucket −66 %. Real chains pay
  only with organic/high-poly sources (reference-gap analysis: assets are the main lever).
- QA (headless SwiftShader Dawn, n=1850, `cover=0`, frames=10): reallod → `lodSource=reallod`,
  `lodTris=[74,74,78,78]`; default → `lodSource=proxy`, no `lodTris`; `path=flight` +
  `lodMode=dither-hysteresis` + reallod OK; `autoinst` ignores the knob; 0 console errors/warnings
  in all runs (also n=18363 with cover: console proof + 0 errors, MEASURE not reached in 280 s —
  SwiftShader speed, not a defect). Real M4 Pro sighting not done.

## 2026-11-10 — Ground cover V2: two GroundCover defects fixed + grass clumps

- **Found via real M4 Pro screenshots** (system Chrome, Metal): the ring on `main` rendered
  screen-filling triangles. Root causes in `vegetation-extras` `GroundCover`:
  1. packed pose u32 written as a numeric value into the `Float32Array` (`bitcast<u32>` in the
     shader → scale 1.25 decoded as ~75). Fix: `Uint32Array` view (the tree records always did it).
  2. `hash4` single-multiply finalizer → x/z jitter collinear in the slot key → all blades of a
     tile on one diagonal. Fix: murmur3 `fmix32`.
  The earlier ring-gate A/B ("early-Z confound", net −3.67 ms) is void: giant blades occluded trees.
- Clumps: `_buildCoverGeometry(bladeCount)` builds 14 curved tapered blades (5 verts / 3 tris),
  far bucket (< 14 px) = 5-blade prefix of the same layout. Default `COVER_DEFAULT_DENSITY` 5
  clumps/m²; ring rebuild + upload only after `COVER_UPDATE_STEP` = 0.5 m camera travel (at
  density 8 the per-frame rebuild had dropped fps to 68).
- Real M4 Pro (1600×900): 120 fps (display cap) walk/flight/aerial, `main:opaque` 2.1–3.5 ms,
  0 console errors. Open: marginal-cost re-measurement of the fixed ring; ground albedo still dark
  (gaps read as soil), terrain material is the next cheap lever.

## 2026-11-10 — Textured species via the field albedo array (`?tree=<stem>`)

- Engine: field lane gained `albedoArray` (TextureArray, bindings 12/13) + per-vertex
  `materialLayers` (slot 4); layer alpha drives the cutout in every draw variant.
- Showcase: `?tree=<stem>` loads `<stem>.species.json` (albedo file, foliage mask, cutout flag per
  primitive, in primitive order), `<stem>_LOD0.glb` as prototype + `_LOD3/2/1` as the real chain,
  albedo layers as `TextureArray` (`flipY: false`); white vertex albedo, layer = part ordinal;
  `SPECIES_TREE_SCALE` 0.55, `SPECIES_ALPHA_TEST` 0.5. Fail-closed to the default assets.
- First asset: Poly Haven CC0 `jacaranda_tree` (3.86 M tris, 19 m) baked locally
  (`.agents/scripts/local/veg-tree-bake.ts`: leaf-island thinning + meshoptimizer, sloppy fallback
  for seam-locked wood, diffuse + separate leaf alpha merged to RGBA PNG). Real M4 Pro, n=1850:
  walk 4.3 ms / flight 4.6 ms / aerial 13.1 ms GPU, 0 console errors.
- Not accepted: canopy brown/thin, stray large wood triangles from the sloppy collapse, aerial
  cutout overdraw. Assets stay local (untracked) until the bake is tuned.
- Default path (no `?tree=`) regression-checked on WebGPU + WebGL2: unchanged, 0 errors.

## 2026-11-10 — Declutter (35 → 26 URL knobs)

- Removed: `?reallod` (real chain via `?tree=`), raw `?lodband/?lodhyst/?lodbias/?shadowlod`
  (`?lodMode` is the single switch, default `hysteresis`), `?measure` (use `?frames=`), the
  worktree-era `P2FieldOptions`/`P2FieldLodApi` shims. Consumers checked first: `veg-bench` uses
  `mode/n/frames/path/pausedAt/truth/gputimings`, goldens/QA `__golden/qa` — all kept.
- Kept on purpose: `?occlusion` + `?cutEvery` (S3 occlusion spike undecided), `?popcount`,
  `?cullref` (correctness probes), cover knobs, `?taa`.
- Bug fixed: `?lodMode=` went into `options`; the engine reads it at setup level → startup preset
  was silently ignored. Real M4 Pro check: engine `lodTransitionMode` == URL for off/hysteresis/
  dither, species path intact, 0 console errors.

## 2026-11-11 — Jacaranda bake v2: no more crown shards

- User sighting: crowns "komplett zersplittert". Causes: (1) simplified leaf-card islands became
  distorted textured shards, (2) thin twigs collapsed into slivers, (3) `simplifySloppy` wood
  fallback produced huge triangles, (4) box-filtered alpha mips erased distant leaves.
- Fixes: engine shader scales layer alpha by mip level (coverage-preserving cutout); local bake
  v2 only THINS leaf cards (scale `sqrt(0.2/keep)`, cap 8), thins small twig islands (< 150 tris)
  unscaled, keeps limbs and simplifies wood with meshoptimizer `Permissive` (no sloppy).
- Chain: LOD0 141 k / 41.6 k / 13.3 k / 4.0 k tris (12.4 MB GLBs total). Real M4 Pro, n=1850:
  walk 3.2 ms, aerial 6.8 ms GPU (was 13.1), 0 console errors. Assets still local, pending sign-off.

## 2026-11-11 — Free fly from any camera path (`0` / HUD "fly")

- HUD camera section: `0` or the "fly" button leaves the seeded path; `_enterFreeFly()` keeps the
  current pose, derives yaw/pitch from it (no snap) and adds the engine `FlyController` on demand
  (sessions started with `?path=` have no default controller). Without `?path=` the session
  starts in free fly as before (WASD + mouse look, Space/C, Shift boost, `R` reset).
- Real M4 Pro check: path pose advances, after `0` the camera holds still, `W` moves ~10 m in
  1.5 s, HUD shows `path=fly`, 0 console errors.

## 2026-11-11 — Ground cover species: 5 grasses + 2 flowers

- Draw segments are (view x bucket): one field draws one geometry per bucket, so species cannot
  share a field. Each species gets its own `GroundCover` ring + `InstanceFieldSystem`
  (`COVER_SPECIES`: fine, meadow, broad, straw, tuft, buttercup, daisy; own seed, density share,
  height, width, lean, colours; wind height = species height). Records stay one per clump.
- Flowers: stems + petal fan + centre; the disc is tilted 35–65° toward a random azimuth (a level
  disc is edge-on from eye height). Shares 5 % / 4 % of `?coverDensity=`.
- Real M4 Pro (n=1850 jacaranda, 1600×900): ~296 k clump records over 7 rings, walk 2.6 ms /
  flight 5.3 ms / aerial 7.1 ms GPU, 120 fps when no other showcase tab competes, 0 errors.

## 2026-11-11 — Jacaranda assets committed (user sign-off "sieht super aus")

- Runtime set via LFS: `jacaranda_LOD0..3.glb`, `jacaranda_albedo_0/1.jpg`, `_2.png`,
  `jacaranda.species.json` (~15 MB). Provenance in `REFERENCES.md`, checksums in `MANIFEST.json`.
- Originals (Poly Haven 1k glTF + bin + textures + leaf alpha) and the local bake tool backed up to
  Drive `Small-World-Machine/small-world-machine/` (new repo folder), 14/14 sha256 verified,
  `MANIFEST.txt` written; local `raw/` stays git-ignored staging.
