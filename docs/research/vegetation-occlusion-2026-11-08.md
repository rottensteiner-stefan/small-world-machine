# Vegetation occlusion & culling — P1 verification note (ADR 0059 step 1, `veg-p1`)

- **Status:** Skeleton, 2026-11-08. P1-4 pure-core test suite landed (frozen-contract-bound, gates green: 42 passing / 6 skipped in `packages/engine/tests/renderers/InstanceFieldCull.test.ts`). Numeric VERIFY cells land at S2 (Bob P1-2 readback probe + Frank P1-3 GL lane on the real system), filled by the lead + `veg-bench.mjs` per §4. TODO markers = fill-ins at S2.
- **Source of truth:** `docs/adr/0059-gpu-driven-vegetation-rendering.md` step 1 + `.agents/collaborate/vegetation-rendering-requirements.md` §4 P1 + P1-4 test plan `.agents/scratches/veg-p1/charly-test-plan.md`. Contract: `packages/engine/src/core/InstanceField.ts` (S1 freeze, binding).
- **Purpose:** reproducible correctness+overdraw verification of the GPU instance culling lane (P1-4 pure-core) before the P1 entrance gate. The CPU-side FP/no-FN guarantees are PROVEN by the test suite (deterministic, seeded); this note records where those guarantees are re-verified against the REAL GPU lane at S2, and the head-to-head vs the pre-optimisation baseline `vegetation-baseline-2026-11-07.md`.
- **Invariant anchors (ADR 0047 seed rows, added 2026-11-09):** `IF-CULL-NO-FALSE-NEGATIVE`, `IF-CULL-FP-BOUND`, `IF-CULL-ROUTING`, `IF-CULL-DETERMINISM`, `IF-CAMERA-CUT-HZB-SKIP`, `IF-BUDGET`, `IF-PROJECTED-SIZE`.

## 1. What P1-4 verifies (frozen contract, no renderer code)

- **Pure-core suite (`InstanceFieldCull.test.ts`, THIS sprint):**
  - `IF-CULL-NO-FALSE-NEGATIVE`: exact geometric oracles (`sphereIntersectsFrustumExact`, 45-axis SAT box oracle, boundary sampler cross-guard) ⇒ conservative tests never drop oracle-visible instances, any view, 5 fixed seeds × 4 000 spheres / 2 500 boxes.
  - `IF-CULL-FP-BOUND`: conservative over-draw on the FIXED corpus measured **fp=199/tp=8131 (2.45 %)** sphere, **fp=109/tp=3599 (3.0 %)** box; bound `fp ≤ ceil(0.04·tp)+60` resp. `≤ ceil(0.05·tp)+40` calibrated with ≈2× headroom (2026-11-09) — thresholds live in the test file (ADR 0047 dead-knob), not the engine.
  - `IF-CAMERA-CUT-HZB-SKIP` G1–G6: transition harness proven against a structural mock (G1 superset, G2 single-skip, G4 no-stacking, G5 GL no-op, G6 fail-closed-without-HZB); S2 wires Bob's runtime through the same probe surface.
  - `IF-CULL-DETERMINISM` / `IF-BUDGET` / `IF-PROJECTED-SIZE`: 16-byte record layout, bit-exact pose packing, projected-diameter metric = analytic pinhole form, LOD band semantics (entry exclusive / exit inclusive, sub-pixel drop, coarsest clamp).
  - **Orientation mediation:** test-side frustum generator proven plane-for-plane identical to the engine `Frustum.setFromMatrix` extraction (INWARD, `FRUSTUM_CULL_CONVENTION`; far-plane D relaxed to fp32-conditioned 1.2e-5 relative, all other components pinned to 2e-4).
- **Not covered here (S2/lead scope):** GPU compute-lane survivor readback (`FieldVisibleSets`), routing to (view×bucket), real dispatching, showcase 51 `?mode=field` integration. Scaffolded in the test file's S2 `describe.skip` section.
- **Contract deviations found + flagged (P1-4 deviation list → ADR 0059 §7 amendment):**
  1. `packInstancePose` doc claims return `[0, 0xFFFFFFFF]`, but `(scaleWord << 16) | yawWord` is int32 → **negative JS numbers for uniformScale ≥ 128** (bit pattern valid via `>>> 0`; doc mismatch only, pinned by a regression test).
  2. LOD selection **function** is not part of the frozen contract (only the band table) — `selectBucketByProjectedSize` semantics pinned test-side as an S2 review point.

## 2. Core vs GPU-lane honesty rules

- **Single source of truth:** the ENGINE is the source (`aabbVisibleConservative`, `sphereVisibleConservative`, `sphereOcclusionSkipConservative`, `projectedDiameterPixels`, `packInstancePose`/`unpackInstancePose`, `cellLinearId`, `fillCellWorldBounds`) — the GPU lane (`instance_cull.wgsl`) MUST be at least as conservative; tests never duplicate the math.
- **Oracle discipline (P1-4):** brute-force oracles derive their geometry ONLY from the same 6 planes the engine functions receive — a plane-convention drift cannot hide inside fixtures. No-bias direction (`oracle-visible ⇒ conservative-visible`) is mathematically sound by exact closest-point enumeration.
- **S2 verdict rule:** a real-GPU deviation from the CPU reference is a LANE bug (fail the cell), never a test-calibration excuse; the only sanctioned relaxations are the documented tolerance eps.

## 3. Device matrix (reference devices, ADR 0059)

| Device | API tier | Lane | Verified? |
| :--- | :--- | :--- | :--- |
| **MacBook Pro M4 Pro (2024-11), macOS 26.7.2, Chrome 157.0.8103.39 — PRIMARY TARGET** (moderator re-anchor 2026-11-08) | WebGPU | real-GPU cull lane (S2 readback probe; baseline session precedent 2026-11-08) | ⬜ (S2) |
| macOS (this repo host), headless Chrome SwiftShader | WebGPU (Dawn soft) | automated correctness lane (`?cullref=1`, `?popcount=1`, `?mode=field`) | ⬜ |
| macOS (this repo host), headless Chrome SwiftShader | WebGL2 | Frank's CPU-cell fallback lane (`InstanceFieldGL`) | ⬜ |
| (Windows dGPU) / (Redmi 13C WebGL2) | WebGPU / WebGL2 | waiting on host | ⬜ |

## 4. Culling correctness cells (filled at S2 — `?mode=field`, `?cullref=1`, `?popcount=1`, `?occlusion=`)

**URL contract (ADR 0059 notepad):** `?mode=field`, `?occlusion=a|b|c` (default `a`), `?popcount=1`, `?cullref=1`, `?cut=` (drives `notifyCameraTeleport` cells), `?seed=` (fixed), `?frames=`; VERIFY emission for `veg-bench.mjs --verify`. **Env footnote (baseline precedent 2026-11-08):** user closed browser tabs 19:45 → GPU/RAM freed; real-GPU sessions run after such cleanup. Host numbers as §3 row 1.

**CPU reference checksum (2026-11-09, pure-core suite):** sphere FP 2.45 % / box FP 3.0 % on the fixed 5-seed corpus; no-FN 0/58 000; 42 tests passing. These are the CPU-side anchors S2 cells must not exceed.

| cell | lane | n (placed) | occlusion mode | popCount=cullRef | FP | no-FN | Δ vs CPU ref | Δ vs baseline (autoinst 2026-11-08) | notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| WF1 | WebGPU | 18 363 / 20 000 | a | TODO | TODO | TODO | n/a (CPU-anchored) | TODO (vs WG1 44.1 ms) | S2 |
| WF2 | WebGPU | 18 363 / 20 000 | b | TODO | TODO | TODO | TODO | TODO | S2, occlusion on |
| WF3 | WebGPU | 91 464 / 100 000 | a | TODO | TODO | TODO | TODO | TODO (vs WG7 290.1 ms) | S2 |
| WF4 | WebGPU | 18 363 / 20 000 | a + `?cut=` | TODO | TODO | TODO | TODO | TODO | S2, camera-cut cell |
| GL1 | WebGL2 | 18 363 / 20 000 | a | TODO | TODO | TODO | n/a (CPU-cell path) | TODO (vs 1264 ms SwiftShader) | S2, Frank |
| GL2 | WebGL2 | 18 363 / 20 000 | b | TODO | TODO | TODO | TODO | TODO | S2 |

**READING (placeholder — filled at S2):** TODO verdict after the real-GPU cull cells; expected: GPU visible set ⊇ CPU reference (no-FN) per §2 rule, FP within test-documented bounds, camera-cut skip exactly one frame with no wrong-cull, routing exact. Any violation = lane bug + P1 gate block.

## 5. Camera-cut transition (G2/G4/G5/G6) — verification cells

| cell | action | hzbSkip frames | wrong-cull? (V_gpu ⊇ V_ref) | verdict |
| :--- | :--- | :--- | :--- | :--- |
| C1 | teleport (WebGPU) | exactly 1 (TODO assert) | no (TODO) | ⬜ S2 |
| C2 | 3× teleport same frame | exactly 1 (no stacking, TODO) | no (TODO) | ⬜ S2 |
| C3 | teleport, HZB-less GL lane | 0 (documented no-op, TODO) | no, CPU-cell list unchanged (TODO) | ⬜ S2 |

## 6. Verdict vs ADR targets (PLACEHOLDER — filled at S2)

- TODO: P1 (GPU culling) correctness gate — no-FN holds, FP within documented bound on the real GPU, routing/determinism byte-exact, camera-cut behaviour per G2/G4. Verdict cell by lead after the §4 run; a red cell has precedence over the CPU anchor until resolved.

## 7. ADR amendment records

- 2026-11-09: P1-4 pure-core deviation list → ADR 0059 step-1 section (as per notepad line 73): (1) `packInstancePose` int32 doc mismatch; (2) LOD selection function absent from contract (test-side pin + S2 review point). ADR 0047 seed table: +7 rows `IF-CULL-*`/`IF-CAMERA-CUT-HZB-SKIP`/`IF-BUDGET`/`IF-PROJECTED-SIZE` (2026-11-09). Oracle bug found by self-test (face.vertices/edgeOutward misalignment → false negatives) fixed in the test suite — the cross-guard worked as designed.
- TODO (S2): record any real-GPU-only deviations + the §4 verdict here.

## 8. Links

- Contract: `packages/engine/src/core/InstanceField.ts` · Tests: `packages/engine/tests/renderers/InstanceFieldCull.test.ts` · Plan: `.agents/scratches/veg-p1/charly-test-plan.md` · Baseline: `docs/research/vegetation-baseline-2026-11-07.md` · ADR: `docs/adr/0059-gpu-driven-vegetation-rendering.md`.
