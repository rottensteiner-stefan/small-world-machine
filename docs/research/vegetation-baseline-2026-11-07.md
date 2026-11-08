# Vegetation baseline — Showcase 51 measurement protocol (ADR 0059 step 0, `veg-p0`)

- **Status:** Skeleton, 2026-11-07. Numbers land here at S2 (after T1/T3/T4 integration), filled by the lead + `veg-bench.mjs`. **Update 2026-11-08:** S1 integration complete + runtime-verified (see `apps/showcases/51/docs/log.md` S1 entry); S2 grid running on the WebGL2 SwiftShader lane. **Update 2026-11-08 (evening):** real-GPU operator session EXECUTED — 8 WebGPU cells on the M4 Pro Metal adapter with valid ring `gpuMs` (§4). **Update 2026-11-08 (night, ERRATUM):** the session's `gpuMs` were wall-clock tautologies (`GpuTimer` spec-name typo, §8); root cause fixed and all cells **re-measured** with the corrected ring — verdict **CPU-bound** (real GPU work 1.3–6.0 ms/cell; autoinst scene-object traversal is the dominant cost), P1 (GPU culling + indirect draw) priority **confirmed and strengthened** (§8).
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
| **MacBook Pro M4 Pro (2024-11), macOS 26.7.2, Chrome 157.0.8103.39 — PRIMARY TARGET** (moderator re-anchor 2026-11-08) | WebGPU | 1080p 60 fps ≥ 250 k ambition; operator session (real GPU, §8) + automated Dawn/SwiftShader software lane | ✅ 2026-11-08 (real-GPU session, §4; Android spot n/a) |
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

**Lane: WebGPU real GPU (M4 Pro Metal), operator session 2026-11-08** — MacBook Pro M4 Pro (2024-11), macOS 26.7.2, Chrome 157.0.8103.39; `veg-bench.mjs --real-gpu` (headed system Chrome on the Metal adapter, `--keep-server` vs the 4174 preview). `frames=240`. `P50`/`P95` from page `frameTimesMs[]`; `gpuMs` from the ring (`timestamp-query`). **CORRECTION 2026-11-08 (§8):** the first session's `gpuMs` were tautological wall-clock values (spec-name typo in `GpuTimer`); after the fix the cells were **re-measured** — the numbers below are the corrected real-GPU absolutes (frameMs P50/P95 + real `gpuMs` per cell). **Env footnote:** user closed browser tabs 19:45 → GPU/RAM freed; sessions ran after.

| cell | mode | n (placed) | path | P50 ms | P95 ms | gpuMs | fps | scene objects | notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WG1 | autoinst | 18 363 / 20 000 | walk | 43.5 | 46.6 | 3.3 | 23.0 | 36 726 | re-measured (corrected `gpuMs`) |
| WG2 | autoinst | 18 363 / 20 000 | flight | 44.2 | 46.7 | 4.0 | 22.6 | 36 726 | re-measured (corrected `gpuMs`) |
| WG3 | autoinst | 18 363 / 20 000 | aerial | 44.5 | 49.4 | 2.2 | 22.4 | 36 726 | re-measured (corrected `gpuMs`) |
| WG4 | instanced | 18 363 / 20 000 | walk | 8.3 | 9.1 | 1.6 | 120.0 | 2 | re-measured (corrected `gpuMs`) |
| WG5 | instanced | 18 363 / 20 000 | flight | 8.3 | 9.1 | 1.3 | 120.0 | 2 | re-measured (corrected `gpuMs`) |
| WG6 | instanced | 18 363 / 20 000 | aerial | 8.3 | 9.1 | 1.5 | 120.0 | 2 | re-measured (corrected `gpuMs`) |
| WG7 | autoinst | 91 464 / 100 000 | flight | 281.1 | 302.8 | 6.0 | 3.5 | 182 928 | re-measured (corrected `gpuMs`) |
| WG8 | instanced | 91 464 / 100 000 | flight | 10.8 | 11.6 | 3.7 | 91.5 | 2 | re-measured (corrected `gpuMs`) |

**READING (real-GPU, 2026-11-08, CORRECTED after re-measure):** the earlier "every cell GPU/rasterization-bound, `gpuMs` ≈ `frameMs`" verdict was a **measurement artifact** (§8: `GpuTimer` spec-name typo → `gpuMs` = wall clock). With real `gpuMs` every cell is **CPU-bound**: real GPU work is only 1.3–4.0 ms @20 k and 3.7–6.0 ms @100 k (2–34 % of the frame window). `autoinst` vs `instanced`: **5.2×** @20 k (43.5–44.5 ms vs 8.3 ms) and **26×** @100 k (281 ms vs 10.8 ms) — and on the real adapter the GPU rasterizes **100 k instances in <6 ms**, so the autoinst gap is dominated by **CPU-side scene-graph cost** (36 726 / 182 928 `Object3D`s), not by GPU work. The SwiftShader "instanced ≈ autoinst" reading was the software rasterizer masking the CPU difference; the old "per-draw overhead on the real adapter" explanation (first `READING`) is **void** — the cost is CPU object traversal, the very chain P1's `InstanceField` removes.

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
- [x] Target numbers calibrated with moderator (ADR step 0 targets, **re-anchored to MacBook Pro M4 Pro 2026-11-08**: WebGPU 1080p 60 fps ≥ 250 k field instances as P1/P2 ambition; WebGL2 same device ≥ 20 k). Real-GPU operator session **done 2026-11-08** (8 cells, absolutes + ring data, §4; ambition targets stay P1/P2 per §7).
- [x] Showcase 51 golden baseline captured once (`.agents/goldens/veg51/baseline/forest-baseline__base.png`, `sha256 ba3801…c527`, 2026-11-08, LFS; only intentional visual changes re-baseline).
- [x] Open follow-ups documented: WebGPU **real-GPU runs DONE** (2026-11-08, §4 + §8; corrected verdict after re-measure 2026-11-08: CPU-bound autoinst — real `gpuMs` ≪ `frameMs`, GPU rasterizes 100 k in <6 ms — P1 priority **confirmed**, CPU-chain removal is the lever); FLIP reference-bin validation pending; P1 entrance decision pending (BACKLOG).

## 6. Delta vs ADR targets (2026-11-08, lead reading)

- ADR step-0 ambition (**moderator re-anchor 2026-11-08**): WebGPU **MacBook Pro M4 Pro** (macOS 26, Chrome) 1080p 60 fps @ ≥ 250 k; WebGL2 same device ≥ 20 k; measured M4-Pro absolutes ARE the target evidence. On the ONLY automated lane available today (host SwiftShader, MacBook Pro M4 Pro) the scene reaches **0.8 fps @ 20 k and 0.2 fps @ 100 k** — these are software-rasterizer solids, NOT the transferable target numbers. The transferable P0 facts: (a) instancing lane choice is invisible on a GPU-bound rasterizer, (b) cost scales ≈ linear with instance count, (c) per-tree ~78–402 tris is far too heavy for the 250 k ambition (≈ 90 M raw tris worst case at 250 k before culling/occlusion) — GPU-side culling/LOD (P1+) is what reaches the target, not CPU-side scene-graph work alone.
- Real-GPU calibration (host Chrome WebGPU — **MacBook Pro M4 Pro**, macOS 26.7.2, Chrome 157.0.8103.39 — + a low-tier Android WebGL2) is the P0→P1 hand-off measurement and the decisive gate for the CPU-side numbers; the SwiftShader lane stays as CI-reproducible structure lane. The earlier M1↔M4 transfer caveat is **void** since the target class = the measured device (moderator re-anchor). **DONE 2026-11-08 (real-GPU session, re-measured after the `GpuTimer` spec-name fix):** no cell is GPU-bound — real GPU work is 5–34 % of the frame window; autoinst is **CPU-bound** (scene-object traversal: 36 726 / 182 928 `Object3D`s), with real `gpuMs` = 1.3–6.0 ms across all cells; autoinst-vs-instanced gap 5.2× (20k) / 26× (100k) is CPU-side. **P1 GPU-culling priority confirmed — `InstanceField` removes exactly this CPU chain** (the old "GPU/rasterization-bound" reading was a `gpuMs`-tautology artifact, §8 erratum). Android low-tier spot not available on this host (no device), left open. See §4 + §8.

## 7. Moderator calibration (2026-11-08, user decision)

- **ADR step-0 targets stay P1/P2 PHASE AMBITIONS, not step-0 gates** (moderator go 2026-11-08): WebGPU **MacBook Pro M4 Pro** (macOS 26, Chrome) 1080p 60 fps ≥ 250 k and WebGL2 same device ≥ 20 k remain goals AFTER GPU culling (P1) + LOD buckets (P2); the step-0 gate is the *recorded, reproducible baseline* (this note + showcase 51 + golden veg51), which is MET. **2026-11-08 decision (moderator): target class re-anchored from "M1-class laptop" to this repo's device — MacBook Pro M4 Pro (2024-11), macOS 26.7.2, Chrome 157.0.8103.39.** The M1↔M4 transfer treatment is void; measured absolutes are direct target evidence.
- **Real-GPU measurement is a standing BACKLOG task before the P1 decision** (this Mac's Chrome WebGPU + a low-tier Android WebGL2), because the automated SwiftShader lane is rasterization-bound and masks the CPU-side autoinst-vs-instanced contrast. **COMPLETED 2026-11-08** for the WebGPU part (8 cells re-measured with the corrected ring `gpuMs`, §4/§8; corrected verdict: CPU-bound autoinst, GPU rasterizes 100 k in <6 ms; P1 confirmed). Android low-tier spot remains open (no device on this host).
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
- **Low-tier Android WebGL2 (spot):** same URLs with `rendererType=WEB_GL2` on Android Chrome; identical collection. **2026-11-08:** not available on this host (no `adb`, no device) — left open in BACKLOG, does not block P1 entrance.
- **Decision value:** real-`gpuMs` vs `frameTimesMs` splits rasterization vs CPU cost — decisive for the P1 (GPU culling) go/no-go; `P50` absolutes calibrate the SwiftShader lanes (see §7). The 60 fps @ ≥ 250 k ambition is **M4-Pro-anchored** (moderator decision 2026-11-08) — session numbers ARE direct target evidence.

### Real-GPU session EXECUTED + spec-name typo root cause (2026-11-08, with erratum)

- **Session status:** DONE. 8/8 WebGPU cells on the real Metal adapter (Chrome 157.0.8103.39, headed,
  `veg-bench.mjs --real-gpu`); zero console errors; raw JSON in
  `.agents/scratches/veg/rgpu/session-wg*.json` + re-measure files `recorrect-*.json` (gitignored, local).
- **ERRATUM (not an adapter quirk — an ENGINE spec-name typo):** the earlier "Chrome 157 / Metal-3
  never writes the begin-of-pass slot" claim was **wrong**. Conclusive probe
  `probe-timestamp-name-conclusive.mjs` (2026-11-08): the shipped W3C/WebIDL member is
  `beginningOfPassWriteIndex`; writing it records the begin slot (796 329 220 505 600). The engine
  (and the P0 probes) spelled `beginOfPassWriteIndex` — a key the WebIDL dictionary silently ignores,
  leaving the begin slot 0 while end-of-pass holds an absolute counter. **Credit: review-agent
  (mailbox, 2026-11-08)** — flagged the typo and the fallback's wall-clock semantics; empirically
  confirmed by the lead probe.
- **Fix (uncommitted → committed 2026-11-08):** `GpuTimer`/`GpuTimer.test.ts` use the shipped member
  name; the successive-end-delta fallback (`_segmentEndBaseline`) is **removed** — that fallback
  measured **wall clock** (segment = delta of absolute end counters ≈ whole frame) and produced the
  tautological `gpuMs` ≈ `frameMs` that faked a "GPU-bound" reading. `_publish` is back to the clean
  `end-begin` duration; `probeTimestampPeriodNs` null-guard stays (Chrome 157 lacks
  `getTimestampPeriod`; period fallback `1` ns/tick, plausibility-calibrated below).
- **Re-measure (2026-11-08, corrected `gpuMs`; raw: `recorrect-100k-flight.json`,
  `recorrect-20k-all.json`):** real GPU work is **1.3–4.0 ms @20 k** and **3.7–6.0 ms @100 k** =
  2–34 % of each frame window (`gpuMs` in §4). **No cell is GPU-bound.** `autoinst` is **CPU-bound**
  (scene-object traversal of 36 726 / 182 928 `Object3D`s): 43.5–44.5 ms @20 k and 281.1 ms @100 k
  with real GPU work of only 2.2–6.0 ms. Even `instanced` (2 scene objects) keeps 6.6–9.5 ms CPU
  overhead per frame (8.3–10.8 ms frame vs 1.3–3.7 ms GPU). The earlier 5.4×/27× autoinst-vs-instanced
  gap stands in size but is **CPU-side**, not GPU-side.
- **Provenance caveat (unchanged):** `getTimestampPeriod` null → period fallback `1` ns/tick.
  New plausibility calibration: real empty-pass end-counter deltas ≈ 65 μs for two empty passes, and
  corrected `gpuMs` (1–6 ms for 20–100 k instances @1080p on M4 Pro Metal) are physically consistent;
  relative effects are internally coherent. A future Chrome exposing `getTimestampPeriod` supersedes
  the fallback via the existing probe.
- **Corrected session verdict (decisive for P1, stronger than the old one):** the dominant cost is
  **CPU-side per-object overhead**, not rasterization — the GPU rasterizes **100 k instances in
  <6 ms**. `InstanceField` (P1, GPU culling + indirect draw) removes exactly this CPU chain;
  autoinst-vs-instanced parity on the SwiftShader lane remains a software-rasterizer mask. ADR 0059
  step 1 scope is unchanged; the old "GPU/rasterization-bound" wording everywhere in this note is
  **superseded** by the corrected reading in §4/§6/§7.
