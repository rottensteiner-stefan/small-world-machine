# Vegetation baseline — Showcase 51 measurement protocol (ADR 0059 step 0, `veg-p0`)

- **Status:** Skeleton, 2026-11-07. Numbers land here at S2 (after T1/T3/T4 integration), filled by the lead + `veg-bench.mjs`. **Update 2026-11-08:** S1 integration complete + runtime-verified (see `apps/showcases/51/docs/log.md` S1 entry); S2 grid running on the WebGL2 SwiftShader lane.
- **Source of truth:** `docs/adr/0059-gpu-driven-vegetation-rendering.md` step 0 + `.agents/collaborate/vegetation-rendering-requirements.md` §4 P0.
- **Purpose:** reproducible pre-optimisation numbers. No optimisation may land without a row here. Gate/decision criteria defined in ADR 0059 (§Decision protocol).

## 1. Scenario definition

- Showcase `apps/showcases/51` (baseline only, today's tools).
- Modes: `autoinst` (ADR 0046 auto-instancing, consecutive identical Object3D) vs `instanced` (`InstancedMesh`).
- URL contract: `?mode=`, `?n=`, `?seed=` (fixed default), `?rendererType=`, `?frames=` (bench), `?qa=1` (HUD-free, stable vantage).
- Camera paths (seeded, deterministic): `walk`, `flight` (fast flight = pop-sensitive), `aerial`. Same scene, same seeds → comparable runs.
- Scene seed pinned in the showcase; terrain y≈0 flat; scatter box bounded (documented in showcase log).
- **Lane semantics (2026-11-08):** SwiftShader absolutes ARE the honest software-rasterizer numbers, NOT real-GPU numbers — the per-cell ratios (autoinst vs instanced) and the `?n=` slope are the transferable signal on this lane; the real-GPU WebGPU lane (operator session, see §8) supplies the calibration absolutes per ADR targets.
- **Timing reality (2026-11-08, host SwiftShader — MacBook Pro M4 Pro / macOS 26; software rasterizer, CPU-bound):** n=20 000 autoinst ≈ **1.16 s/frame (0.9 fps)** at 18 363 placed trees (2 parts each → 36 726 scene objects). Grid sizing therefore uses `--frames 60` at 20k and `--frames 30` at 100k (P50/P95 statistical floor only on this lane; full 240-sample cells are for the real-GPU lane).
- **Measurement integrity notes (2026-11-08):** (1) `?pausedAt=`/`?qa=1`/`?truth=1` runs are HUD-free — the DOM HUD pollutes clipped screenshots and the FLIP compare (verified: with HUD the truth FLIP read 0.43 mean; without it 0.0 exactly). (2) All URL knobs guard absent params (`Number(null) === 0` bug class fixed) — a missing `?n=` must keep the documented default, never silently empty the population.

## 2. Device matrix (reference devices, ADR 0059)

| Device | API tier | Lane | Verified? |
| :--- | :--- | :--- | :--- |
| **MacBook Pro M4 Pro (2024-11), macOS 26.7.2, Chrome 157.0.8103.39 — PRIMARY TARGET** (moderator re-anchor 2026-11-08) | WebGPU | 1080p 60 fps ≥ 250 k ambition; operator session (real GPU, §8) + automated Dawn/SwiftShader software lane | ⬜ |
| macOS (this repo host: MacBook Pro M4 Pro), headless Chrome SwiftShader | WebGL2 | automated `veg-bench.mjs` | ⬜ |
| (Windows dGPU WebGPU + WebGL2) | WebGPU / WebGL2 | waiting on host | ⬜ |
| Redmi 13C WebGL2 low tier | WebGL2 | waiting on host | ⬜ |

## 3. Recorded metrics (per mode × n × path)

- Per-run: `MEASURE` JSON (fps, frame-time ms), HUD logs `gpu ms` (pass-level via `renderer.gpuTimings`, T1) + `cpu ms` + `fps`.
- Aggregates per (mode, n, path): **P50 / P95** frame time from `veg-bench.mjs --out <json>`.
- Key acceptance curve (step-0 gate): **CPU ms vs `?n=` flat** once P1 lands; today's baseline records the slope as the gap to close.
- Ground truth: `?truth=1` supersampled still at fixed keyframes; perception diff vs measurement shots (Charly's harness, T4).

## 4. Baseline table (filled at S2)

**Lane:** WebGL2, headless Chrome SwiftShader (this host — MacBook Pro M4 Pro, macOS 26.7.2), `veg-bench.mjs` cells
(`--frames 60` @20k, `--frames 30` @100k; warm-up 30; real CC0 asset `tree_pineTallA.glb`, 2 parts/tree;
shadows on). `P50`/`P95` from page `frameTimesMs[]` (CPU-observed); `wall` = MEASURE wall seconds.

| mode | n (placed) | path | P50 ms | P95 ms | fps | scene objects | notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| autoinst | 18 363 / 20 000 | walk | 1275 | 1305 | 0.8 | 36 726 | 2026-11-08 |
| autoinst | 18 363 / 20 000 | flight | 1216 | 1322 | 0.8 | 36 726 | 2026-11-08 |
| autoinst | 18 363 / 20 000 | aerial | 1427 | 1458 | 0.7 | 36 726 | 2026-11-08 |
| instanced | 18 363 / 20 000 | walk | 1268 | 1303 | 0.8 | 2 | 2026-11-08 |
| instanced | 18 363 / 20 000 | flight | 1219 | 1317 | 0.8 | 2 | 2026-11-08 |
| instanced | 18 363 / 20 000 | aerial | 1413 | 1442 | 0.7 | 2 | 2026-11-08 |
| autoinst | 91 464 / 100 000 | flight | 5651 | 6147 | 0.2 | 182 928 | 2026-11-08 |
| instanced | 91 464 / 100 000 | flight | 5552 | 5991 | 0.2 | 2 | 2026-11-08 |
| autoinst (GL1 spot) | 18 363 / 20 000 | flight | 601 | 657 | 1.7 | 36 726 | 2026-11-08, `--frames 40` |
| instanced (GL1 spot) | 18 363 / 20 000 | flight | 567 | 619 | 1.8 | 2 | 2026-11-08, `--frames 40` |
| autoinst (WGPU soft) | 18 363 / 20 000 | walk | 1314 | 1333 | 0.8 | 36 726 | 2026-11-08, Dawn/SwiftShader |
| autoinst (WGPU soft) | 18 363 / 20 000 | flight | 1264 | 1343 | 0.8 | 36 726 | 2026-11-08 |
| autoinst (WGPU soft) | 18 363 / 20 000 | aerial | 1417 | 1461 | 0.7 | 36 726 | 2026-11-08 |
| instanced (WGPU soft) | 18 363 / 20 000 | walk | 1286 | 1342 | 0.8 | 2 | 2026-11-08 |
| instanced (WGPU soft) | 18 363 / 20 000 | flight | 1264 | 1332 | 0.8 | 2 | 2026-11-08 |
| instanced (WGPU soft) | 18 363 / 20 000 | aerial | 1417 | 1634 | 0.7 | 2 | 2026-11-08 |
| autoinst (WGPU soft) | 91 464 / 100 000 | flight | 6201 | 9179 | 0.1 | 182 928 | 2026-11-08, `--frames 30` |
| instanced (WGPU soft) | 91 464 / 100 000 | flight | 8312 | 8773 | 0.1 | 2 | 2026-11-08, `--frames 30` |

**READING (2026-11-08, lead):** GL2 + GL1 + WebGPU software lanes all GPU/rasterization-bound: at 20 k
autoinst ≈ instanced within noise (CPU-side gap of 36 726 vs 2 scene objects masked on the software
rasterizers), the `?n=` slope is ≈ linear (20k→100k = 5× n → ≈4.6× ms), `aerial` ~10–15 % slower than
walk/flight (more frustum coverage). **NEW signal (WebGPU 100 k, 30 samples, low confidence):**
`instanced` read **P50 8312 ms vs autoinst 6201 ms (≈34 % slower)** while GL2 stayed equal — a
per-cell observation on the WebGPU lane only, plausibly a per-draw overhead on the WebGPU/Dawn path
(not visible on GL2's software GL). Not conclusive at 30 samples; **the real-GPU WebGPU run (§8) is
decisive for whether this is engine overhead worth P1 attention or a lane artifact.** The real-Metal
absolutes (and the `gpuMs` ring data) remain operator-session scope; SwiftShader lanes supply
CI-reproducible structure + the n-slope.

## 5. Exit-gate checklist (P0)

- [x] All three paths reproducible on WebGL2 (automated) + WebGL1 spot + WebGPU software lane (automated, §8; ring needs a `timestamp-query` device). Zero console errors in every cell.
- [x] CPU ms vs `?n=` curve recorded (SwiftShader lane): ~linear in n (20k→100k = 5× n → ≈4.6× ms); autoinst ≈ instanced (GPU-bound lane).
- [ ] Target numbers calibrated with moderator (ADR step 0 targets, **re-anchored to MacBook Pro M4 Pro 2026-11-08**: WebGPU 1080p 60 fps ≥ 250 k field instances as P1/P2 ambition; WebGL2 same device ≥ 20 k). **Pending operator session — see BACKLOG.**
- [x] Showcase 51 golden baseline captured once (`.agents/goldens/veg51/baseline/forest-baseline__base.png`, `sha256 ba3801…c527`, 2026-11-08, LFS; only intentional visual changes re-baseline).
- [ ] Open follow-ups documented (WebGPU real-GPU runs, FLIP reference-bin validation, P1 entrance decision). **See BACKLOG.**

## 6. Delta vs ADR targets (2026-11-08, lead reading)

- ADR step-0 ambition (**moderator re-anchor 2026-11-08**): WebGPU **MacBook Pro M4 Pro** (macOS 26, Chrome) 1080p 60 fps @ ≥ 250 k; WebGL2 same device ≥ 20 k; measured M4-Pro absolutes ARE the target evidence. On the ONLY automated lane available today (host SwiftShader, MacBook Pro M4 Pro) the scene reaches **0.8 fps @ 20 k and 0.2 fps @ 100 k** — these are software-rasterizer solids, NOT the transferable target numbers. The transferable P0 facts: (a) instancing lane choice is invisible on a GPU-bound rasterizer, (b) cost scales ≈ linear with instance count, (c) per-tree ~78–402 tris is far too heavy for the 250 k ambition (≈ 90 M raw tris worst case at 250 k before culling/occlusion) — GPU-side culling/LOD (P1+) is what reaches the target, not CPU-side scene-graph work alone.
- Real-GPU calibration (host Chrome WebGPU — **MacBook Pro M4 Pro**, macOS 26.7.2, Chrome 157.0.8103.39 — + a low-tier Android WebGL2) is the P0→P1 hand-off measurement and the decisive gate for the CPU-side numbers; the SwiftShader lane stays as CI-reproducible structure lane. The earlier M1↔M4 transfer caveat is **void** since the target class = the measured device (moderator re-anchor).

## 7. Moderator calibration (2026-11-08, user decision)

- **ADR step-0 targets stay P1/P2 PHASE AMBITIONS, not step-0 gates** (moderator go 2026-11-08): WebGPU **MacBook Pro M4 Pro** (macOS 26, Chrome) 1080p 60 fps ≥ 250 k and WebGL2 same device ≥ 20 k remain goals AFTER GPU culling (P1) + LOD buckets (P2); the step-0 gate is the *recorded, reproducible baseline* (this note + showcase 51 + golden veg51), which is MET. **2026-11-08 decision (moderator): target class re-anchored from "M1-class laptop" to this repo's device — MacBook Pro M4 Pro (2024-11), macOS 26.7.2, Chrome 157.0.8103.39.** The M1↔M4 transfer treatment is void; measured absolutes are direct target evidence.
- **Real-GPU measurement is a standing BACKLOG task before the P1 decision** (this Mac's Chrome WebGPU + a low-tier Android WebGL2), because the automated SwiftShader lane is rasterization-bound and masks the CPU-side autoinst-vs-instanced contrast.
- P0 closes with commit `af6aee0` ("If you cannot measure it, you cannot improve it.", branch `veg-p0`, amended from `fc2bc92` to fold in this calibration section; ADR status accepted-in-shape). Merged to `main` + pushed 2026-11-08.

## 8. WebGPU lane: headless automation WORKS (2026-11-08, corrected) + real-GPU runbook

### Corrected finding — do not let the earlier negative mislead you

- **`navigator.gpu` IS available in terminal-launched headless Chrome here** — but ONLY on a **secure context**. The earlier negative probes (2026-11-08, probes 1–5) tested on `about:blank` which is NOT a secure context → `navigator.gpu` is absent there. Probed against `https://localhost:4174` (secure) with the SwiftShader+Vulkan flags: adapter present, device + submit + `onSubmittedWorkDone` functional. **Verdict: WebGPU code-path validation IS automatable (Dawn/SwiftShader software adapter, `vendor: google`); the earlier "operator-bound by design" claim is void.**
- **Two REAL engine bugs found + fixed via this lane** (would have broken the ring on every real device that supports `timestamp-query`):
  1. `GpuTimer` resolve buffer lacked `GPUBufferUsage.QUERY_RESOLVE` → `resolveQuerySet` validation error, whole frame's command buffer invalid (false-fast P50 ~16.7 ms = dropped frames).
  2. Combined `MAP_READ` with `QUERY_RESOLVE`/`COPY_SRC` — per spec `MAP_READ` is only combinable with `COPY_DST` → `CreateBuffer` validation error. Fixed with the in-repo `HzbOcclusionSystem` two-buffer pattern (resolve dest `QUERY_RESOLVE|COPY_SRC` + separate `MAP_READ|COPY_DST` staging + `copyBufferToBuffer`).
  - Headless adapter does **not** support `timestamp-query` (1 feature only) → ring stays honestly `disabled`, `gpuMs`/`gpuPassesMs` stay absent on the automated lane; the REAL ring run + `gpuMs` split needs the operator session below.
- WebGL2 headed without SwiftShader flags is unavailable in this environment (only `gl1`) — irrelevant for the automated lane, which runs headless+SwiftShader.

### Automated lane (CI-reproducible, NOW RUNNABLE)

- `PREVIEW_PORT=4174 node .agents/scripts/veg-bench.mjs --renderer webgpu …` — full grid, same protocol as the GL2 lane; WebGPU cells automatically add `?gputimings=1` (ring encode path runs clean, fields honestly absent without the feature). Numbers land in §4 as the WebGPU-software lane.

### Real-GPU runbook (operator session, for ABSOLUTE numbers + `gpuMs` ring)

- Page emits `MEASURE {…}` into the DOM overlay `#__measure` (not in `?qa=1`) and `console.info("[Showcase MEASURE] {…}")` (always). `?gputimings=1` adds `gpuMs` + `gpuPassesMs` on a device with `timestamp-query`.
- **Host:** preview up (`npm run preview -- --port 4174 --strictPort`, dist built); open in the host's normal Chrome — **MacBook Pro M4 Pro (2024-11), macOS 26.7.2, Chrome 157.0.8103.39** — at `https://localhost:4174/apps/showcases/51/index.html?…` (accept self-signed cert once). Record the browser string in the §4 note column.
- **Cells** (`frames=60` @20 k, `frames=240` at real-GPU frame rates; identical URLs between rows): `rendererType=WEB_GPU&mode=autoinst&n=20000&path=walk|flight|aerial&frames=60&gputimings=1` (+ the `instanced` twins), plus the `n=100000&path=flight` autoinst/instanced pair.
- **Collection (2 s, per cell):** right-click the console message `[Showcase MEASURE]` → *Copy message contents*, or `copy(document.getElementById('__measure')?.textContent || '')`; paste into §4 (P50/P95 from `frameTimesMs[]`, `gpuMs`/`gpuPassesMs` from the ring). Keep raw JSON in `.agents/scratches/veg/rgpu/`.
- **Low-tier Android WebGL2 (spot):** same URLs with `rendererType=WEB_GL2` on Android Chrome; identical collection.
- **Decision value:** real-`gpuMs` vs `frameTimesMs` splits rasterization vs CPU cost — decisive for the P1 (GPU culling) go/no-go; `P50` absolutes calibrate the SwiftShader lanes (see §7). The 60 fps @ ≥ 250 k ambition is **M4-Pro-anchored** (moderator decision 2026-11-08) — session numbers ARE direct target evidence.
