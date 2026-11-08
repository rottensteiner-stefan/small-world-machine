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
- **Lane semantics (2026-11-08):** SwiftShader absolutes ARE the honest software-rasterizer numbers, NOT real-GPU numbers — the per-cell ratios (autoinst vs instanced) and the `?n=` slope are the transferable signal on this lane; the real-GPU WebGPU lane (manual/observer-AI, pending a device host) supplies the calibration absolutes per ADR targets.
- **Timing reality (2026-11-08, M1 SwiftShader):** n=20 000 autoinst ≈ **1.16 s/frame (0.9 fps)** at 18 363 placed trees (2 parts each → 36 726 scene objects). Grid sizing therefore uses `--frames 60` at 20k and `--frames 30` at 100k (P50/P95 statistical floor only on this lane; full 240-sample cells are for the real-GPU lane).
- **Measurement integrity notes (2026-11-08):** (1) `?pausedAt=`/`?qa=1`/`?truth=1` runs are HUD-free — the DOM HUD pollutes clipped screenshots and the FLIP compare (verified: with HUD the truth FLIP read 0.43 mean; without it 0.0 exactly). (2) All URL knobs guard absent params (`Number(null) === 0` bug class fixed) — a missing `?n=` must keep the documented default, never silently empty the population.

## 2. Device matrix (reference devices, ADR 0059)

| Device | API tier | Lane | Verified? |
| :--- | :--- | :--- | :--- |
| Apple M1-class Mac, Chrome | WebGPU | manual / observer-AI (no headless `navigator.gpu` in this workspace) | ⬜ |
| macOS (this repo host), headless Chrome SwiftShader | WebGL2 | automated `veg-bench.mjs` | ⬜ |
| (Windows dGPU WebGPU + WebGL2) | WebGPU / WebGL2 | waiting on host | ⬜ |
| Redmi 13C WebGL2 low tier | WebGL2 | waiting on host | ⬜ |

## 3. Recorded metrics (per mode × n × path)

- Per-run: `MEASURE` JSON (fps, frame-time ms), HUD logs `gpu ms` (pass-level via `renderer.gpuTimings`, T1) + `cpu ms` + `fps`.
- Aggregates per (mode, n, path): **P50 / P95** frame time from `veg-bench.mjs --out <json>`.
- Key acceptance curve (step-0 gate): **CPU ms vs `?n=` flat** once P1 lands; today's baseline records the slope as the gap to close.
- Ground truth: `?truth=1` supersampled still at fixed keyframes; perception diff vs measurement shots (Charly's harness, T4).

## 4. Baseline table (filled at S2)

**Lane:** WebGL2, headless Chrome SwiftShader (this host, M1-class Mac), `veg-bench.mjs` cells
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

**READING (2026-11-08, lead):** this lane is GPU/rasterization-bound (SwiftShader), so autoinst vs
instanced is identical within noise (CPU-side gap of 36 726 vs 2 scene objects is REAL but masked on
the software rasterizer); the `?n=` slope is ≈ linear in instance count (20k→100k = 5× n → ≈4.6×
frame time), i.e. rasterization dominates. `aerial` is consistently ~10–15 % slower than walk/flight
(more frustum coverage). **Lane transferability:** the CPU-side autoinst-vs-instanced contrast and
the absolute ADR targets must be measured on the real-GPU WebGPU lane (M1 Chrome, pending device
host); the SwiftShader lane supplies CI-reproducible relative structure + the n-slope.

## 5. Exit-gate checklist (P0)

- [x] All three paths reproducible on WebGL2 (automated) + WebGL1 spot; WebGPU lane awaits a device host (no headless `navigator.gpu` in this workspace). Zero console errors in every cell.
- [x] CPU ms vs `?n=` curve recorded (SwiftShader lane): ~linear in n (20k→100k = 5× n → ≈4.6× ms); autoinst ≈ instanced (GPU-bound lane).
- [ ] Target numbers calibrated with moderator (ADR step 0 targets: WebGPU M1 1080p 60 fps ≥ 250 k field instances as P1 ambition; WebGL2 ≥ 20 k). **Pending moderator session — see BACKLOG.**
- [x] Showcase 51 golden baseline captured once (`.agents/goldens/veg51/baseline/forest-baseline__base.png`, `sha256 ba3801…c527`, 2026-11-08, LFS; only intentional visual changes re-baseline).
- [ ] Open follow-ups documented (WebGPU real-GPU runs, FLIP reference-bin validation, P1 entrance decision). **See BACKLOG.**

## 6. Delta vs ADR targets (2026-11-08, lead reading)

- ADR step-0 ambition: WebGPU M1 1080p 60 fps @ ≥ 250 k; WebGL2 ≥ 20 k. On the ONLY automated lane available today (SwiftShader) the scene reaches **0.8 fps @ 20 k and 0.2 fps @ 100 k** — these are software-rasterizer solids, NOT the transferable target numbers. The transferable P0 facts: (a) instancing lane choice is invisible on a GPU-bound rasterizer, (b) cost scales ≈ linear with instance count, (c) per-tree ~78–402 tris is far too heavy for the 250 k ambition (≈ 90 M raw tris worst case at 250 k before culling/occlusion) — GPU-side culling/LOD (P1+) is what reaches the target, not CPU-side scene-graph work alone.
- Real-GPU calibration (M1 Chrome WebGPU + a low-tier Android WebGL2) is the P0→P1 hand-off measurement and the decisive gate for the CPU-side numbers; the SwiftShader lane stays as CI-reproducible structure lane.

## 7. Moderator calibration (2026-11-08, user decision)

- **ADR step-0 targets stay P1/P2 PHASE AMBITIONS, not step-0 gates** (moderator go): WebGPU M1 1080p 60 fps ≥ 250 k and WebGL2 ≥ 20 k remain goals AFTER GPU culling (P1) + LOD buckets (P2); the step-0 gate is the *recorded, reproducible baseline* (this note + showcase 51 + golden veg51), which is MET.
- **Real-GPU measurement is a standing BACKLOG task before the P1 decision** (this Mac's Chrome WebGPU + a low-tier Android WebGL2), because the automated SwiftShader lane is rasterization-bound and masks the CPU-side autoinst-vs-instanced contrast.
- P0 closes with commit `af6aee0` ("If you cannot measure it, you cannot improve it.", branch `veg-p0`, amended from `fc2bc92` to fold in this calibration section; ADR status accepted-in-shape). Merged to `main` + pushed 2026-11-08.
