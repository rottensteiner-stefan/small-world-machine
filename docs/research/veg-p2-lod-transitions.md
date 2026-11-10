# Vegetation LOD transitions & fast-flight pop — P2-4 verification note (ADR 0059 step 2, `veg-p2`)

- **Status:** Headless portion complete, 2026-11-09. Three invariant test files landed uncommitted on branch `veg-p2` (see §1): 39 tests, all deterministic and green, typecheck-clean. Live-only cells (real per-frame bucket counts, LIP spikes, GPU triangle counts) are marked **live browser verification pending at integration** — the lead protocol is §6.
- **Source of truth:** `docs/adr/0059-gpu-driven-vegetation-rendering.md` step 2 (LOD buckets + crossfade) + `.agents/collaborate/vegetation-rendering-requirements.md` §P2, WP P2-4: "Invariant test: LOD from main camera in all views; pop metric on fast flight (temporal FULP spikes), triangle count flat vs. instance count."
- **Purpose:** prove the ROUTING-level preconditions that bound fast-flight pops by construction (headless, deterministic), deliver the live-measurement protocol for the pop metric, and prep the blind A/B for the P2 decide spike (A = dither crossfade vs C = hard switch + hysteresis, §7).
- **Invariant anchors (ADR 0047 seed rows):** `IF-PROJECTED-SIZE`, `IF-LOD-MAIN-CAMERA`, `IF-BUDGET`, `IF-CULL-ROUTING`, `IF-LOD-CONTINUITY`, new seed rows requested for review: `IF-LOD-FLIP-LOCALITY`, `IF-LOD-MONOTONE-RECEDE`, `IF-LOD-RESIDUAL-JUMP`, `IF-LOD-CROSSFADE-CONTINUITY`, `IF-LOD-HYSTERESIS`.

## 1. What P2-4 verifies headless (pure-CPU reference, no browser)

- **`InstanceFieldLodInvariant.test.ts` — 16 tests.** LOD is a MAIN-camera-only function in all views (`IF-LOD-MAIN-CAMERA`): every view's bucket set must equal the main camera's metric band selection; the shadow lane's `shadowLodBias` freezes at `min(mainBucket + bias, coarsest)` **only when the main frustum kept the run** — main-frustum-culled runs fall back to the UNBIASED main-metric bucket (§3 finding). Frozen band semantics pinned (entry exclusive / exit inclusive, coarsest clamp, no sub-pixel floor in the lane picker).
- **`InstanceFieldCompactionSum.test.ts` — 9 tests.** COMPACTION-SUM: per-(view × bucket) counts sum exactly to the post-cull visible count, each kept instance in EXACTLY ONE segment (no dup, no loss within capacity), header-word/indices consistency, clamp-at-capacity overflow drop exact. TRIANGLE accounting: `tri = Σ count(b) × indexCount(b) / 3` exact; **triangle count flat vs `?n=`** (adding instances beyond the sub-pixel horizon adds ZERO triangles — harness-verified plus a GENUINE multi-band recede crossing, the old fixture was vacuous and was hardened). PENDING-DUAL-BUCKET §4: adjusted invariant (Σ == visible + band duplicates, ≤2 ADJACENT buckets) implemented and self-tested, degrades to strict invariant at bandWidth=0 — ready for Bob's P2-1 writes.
- **`InstanceFieldFastFlightPop.test.ts` — 14 tests.** Pop-proxy `|flips(t)|` on deterministic flights (exact doubles of the engine metric). FROZEN: flip locality (independent threshold detector — flips only at real metric crossings, no phantom events), exact triangle+flip accounting (recompute == incremental, tri changes ONLY via flips), monotone per-instance routing on recede (never back-finer), and the honest **frozen residual**: a fast crossing of a narrow 8-px band produces +≥2 hard-cut jumps (intermediate band never rendered). PENDING-C (candidate C): sticky hysteresis kills boundary oscillation (frozen jitter 9 flips → 0 at margin 0.1), margin=0 degenerates exactly to frozen, coarsening strictly deferred (never earlier, never reversed), and per-frame |Δbucket| ≤ 1 rate-limits even the +2 jumps. PENDING-DUAL-BUCKET (candidate A): direction-aware staging gives membership continuity on +1-only flights (consecutive frames share ≥1 bucket), contiguous dual staging (no flicker), **the honest limitation: +≥2 jumps stay hard cuts — the crossfade band cannot stage a skipped band** (breaks == frozen +2 residual, enumerated), and bandwidth-proportional triangle overdraw (both meshes drawn in the band).

## 2. Headless-bound vs live-pending (honesty boundary)

| Guarantee | Bound here? | Live gate it feeds |
| :--- | :--- | :--- |
| Bucket sets == main-camera function, all 16 views enumerable layout | YES (File 1) | shadows stable across transitions (exit gate) |
| Compaction sums + triangle flat vs `?n=` | YES (File 2) | **triangle count flat vs `?n=`** (exit gate) |
| Pop-metric ROUTING preconditions + residual enumeration | YES (File 3) | **no visible pops at TAA on/off in fast flight** (exit gate) |
| Visual LIP (temporal FULP spikes) under TAA on/off | NO — requires real pixels | live measure, §6 |
| Real per-frame bucket counts + GPU triangle counting | NO — requires real GPU | live measure, §6 |

## 3. Findings for the P2 review (headless-proven, engine/pin relevant)

1. **GL `shadowLodBias` asymmetry (File 1, pinned as mirror, candidate finding):** shadow bucket applies the bias ONLY when the main frustum kept the run; main-frustum-culled runs recompute the main metric WITHOUT bias. Both lanes keep LOD main-camera-anchored (never shadow-camera), but the bias silently drops on the fallback path. WebGPU lane bias application is Bob's P2-1 (pending) — the review should decide whether the fallback must bias too.
2. **Crossfade (candidate A) cannot stage +≥2 jumps** (File 3 §4): a single-frame crossing of a skipped band stays a hard cut under dual-bucket staging; narrow bands + fast flight are the pop-source geometry. Options for the decide: wide band tables (no narrow lanes), hysteresis rate-limiting (candidate C bounds per-frame index change to ±1), or accepted residual measured live.
3. **Candidate C rate-limits per-frame routing to ±1 by construction** (File 3 §3) — a structural pop bound candidate A lacks (A bounds only the +1 crossings it can stage).
4. **NaN-fragility of ±Infinity lane bounds in sticky hysteresis** (File 3 §3 doc + prototype): `0 * Infinity = NaN` silently disables one side of the dead zone; the mirror pins the finite-lane formulation (finest lane starts at 0 px, coarsest edge authoritative).
5. **Hardened the File 2 recede fixture**: the original multi-band monotonicity test was vacuous (all instances in one band); replaced with a genuine 2-boundary coarsening per tree.

## 4. Predicted numbers + tolerance table (headless anchors for live verification)

Deterministic, exact (no statistical tolerance on routing invariants). Live cells compare against these.

| Quantity | Headless pin (exact) | Live @ `?n=182728&path=aerial` | Tolerance |
| :--- | :--- | :--- | :--- |
| Bucket-band equality across LOD-enumerable views | all views == main metric bands | per-frame bucket-set diff main vs shadow | diff 0 |
| Triangle curve vs `?n=` (sub-pixel growth) | +4000 far instances → Δtri = 0 | triangle count at `?n=182728` vs `?n=k` | 0 (flat) |
| Frozen jitter oscillation (b0/b1, 40 frames @ px≈96) | 9 flips | n/a (sim) | exact |
| Hysteresis margin 0.1 jitter | 0 flips | n/a (sim) | exact |
| Narrow-band +2 residual (fast flight) | 2 hard cuts | LIP spikes per frame, fast flight | ≥ residual when band layout matches |
| Crossfade triangle overdraw (bw 0.05, full recede) | +0.9 % vs frozen | GPU tri count delta in band | band-width-proportional |

## 5. Prototype record

- `.agents/scratches/pop-proxy-prototype.mjs` (gitignored scratch) validated every File 3 scenario before the test was written: recede monotonicity, +2 residual at v=8 (v=4 does NOT skip the band — phase lands inside), hysteresis kill, crossfade continuity/contiguity/overdraw. Findings in §3(4) + §3(2) surfaced during this pass.
- The narrow-band +2 requires step 8 m/frame through a ~2 m band; at 1 m/frame every crossing is +1. Live fast flight must clear this geometry to reproduce the residual.

## 5a. Quantification for the A/B/C decide (lead request 2026-11-09 18:42 — document only, no code action)

**+2-jump threshold vs approach geometry.** Meter metric `px = C/d` with `C = r·vp/tan(fov/2) ≈ 2494 px·m` (radius 2, vp 720, fov 60°). A band of pixel width `Δpx` maps to world width `Δd ≈ (Δpx/C)·d²` at distance `d` (first-order in view-axis displacement, `d≫` lateral offset). Three speed regimes per band:

| per-frame view-axis displacement `s` | +2 risk on that band | note |
| :--- | :--- | :--- |
| `s < Δd` | impossible (every crossing lands inside the band) | ±1-only by construction |
| `Δd ≤ s < 2·Δd` | phase-dependent | prototype: `s=4 m` (Δd=2.36 m) → 0 skips, phase landed a sample inside |
| `s ≥ 2·Δd` | guaranteed | prototype: `s=8 m` (2Δd=4.72 m) → 2 skips |

Worked numbers (band 1, Δpx=8): at `d=27 m` → `Δd=2.36 m`, `2Δd=4.72 m` (= 283 m/s at 60 fps). At `d=6.5 m` → `Δd=0.135 m`, `2Δd=0.27 m` (= 16 m/s at 60 fps). **Narrow px-bands near the camera skip at jogging speed** — the reference aerial fast flight (≫ this) sits deep in the guaranteed-skip regime for any narrow band along its path.

**Band-width recommendation (derivable).** A px-constant band table is skip-free (§ +1-only) at max speed `v_max` only while `Δpx ≥ v_max·C/(2·d²)`: at `d=6.5 m`, `v_max=8 m/frame` ⇒ `Δpx ≥ 236 px`; at `d=27 m` ⇒ `Δpx ≥ 13.7 px`. Because the required width grows `∝ 1/d²` toward the camera, **no px-constant table can guarantee skip-free fast flight near the camera**. P2 decision options, quantitatively ranked: (a) candidate C's sticky rate-limit (±1/frame by construction, zero overdraw) — structurally immune at any speed; (b) logarithmic/world-aware band spacing (width ∝ d) sized against the reference speed profile — heavy retuning, still phase-fragile at the guarantee boundary; (c) accept the residual and size the dither band for it (File 3 §4 shows A cannot stage a +2; overdraw ~bandWidth-proportional, measured +0.9 % at bw 0.05).

**NaN / edge-input analysis (frozen math vs test mirror).** The frozen metric `projectedDiameterPixels` cannot produce NaN for finite authored inputs (`radius` is a per-prototype constant, `fov > 0`, `vp > 0`); the only sentinel is `+Infinity` when `viewDistance ≤ 0`. Frozen selection semantics (pinned File 1 `selectBucket`, File 1 line: non-finite ⇒ -1 ⇒ drop): **a camera exactly inside a tree (d=0) makes the instance drop for that frame** — a documented degenerate review point (fail-closed), not NaN. All `bucketFor`/`mainBand` mirrors guard `Number.isFinite`; the ±Infinity NaN hazard existed ONLY in the hysteresis margin arithmetic (finite-lane fix, §3 find 4) and is resolved in the test mirror. No engine change warranted from either analysis.

## 6. Live verification protocol (`veg-p2` lead / integration — **pending at integration**)

Dev server on the worktree `small-world-machine-veg-p2` (no dev server runs during headless delivery).

1. **Setup:** showcase 51 `?mode=field&n=182728&path=aerial`, fixed `?seed=`, TAA **on** for run set 1, **off** for run set 2. Real Chrome on M4 Pro (per §3 of `vegetation-occlusion-2026-11-08.md` device matrix); env pre-clean (tabs closed) per baseline precedent.
2. **Per-frame bucket counts:** instrument the readback probe (Bob P2-1 surface) — record per-frame counts per LOD bucket for main + shadow views. Assert: shadow bucket sets ⊆ main bucket sets (`IF-LOD-MAIN-CAMERA` on real GPU); counts match the headless predictions on the same flight geometry within the §4 tolerance column.
3. **Pop metric (temporal FULP spikes):** capture video pair per TAA setting over the fixed fast flight; detect LIP spikes (frame-difference spikes) and correlate each spike with the per-frame flip set + the enumerated +2 residual (File 3). Verdict: zero visible pops at TAA on/off.
4. **Triangle flat:** record GPU triangle count at several `?n=` values on the same flight; flat line expected (exit gate), matching File 2's headless flat-vs-n pin.
5. **A/B prep per §7:** record the two blind A/B video pairs (bandwidth-matched: same flight, same seeds, recording parameters identical; A and C variants as config switches).
6. **Report back:** per-cell numbers + verdict into this note's §8 section (or a dedicated addendum) before the P2 exit gate.

## 7. Blind A/B for the decide spike

- Pair 1: **A = dither crossfade (top fraction of each lane, dual-bucket write, fragment alpha mask)** — implemented by P2-1 (routing) + P2-2 (dither material).
- Pair 2: **C = hard switch + sticky hysteresis margin** (candidate C as config switch, P2-2).
- Video per candidate on the fixed fast flight; order blinded; TAA off for the harshest cell (Pervez-style worst case), TAA on as the realistic cell. Headless side evidence ships with each pair: A's continuity guarantee + overdraw cost + +2 residual; C's oscillation kill + deferral + ±1 rate-limit + zero overdraw.
- Expectation (headless-informed, to be confirmed live): A shows no single-frame membership discontinuities but carries overdraw and the +2 residual; C removes oscillation entirely but shifts transitions to margin boundaries (later/earlier in space) — LOD-aware "switch fences" in the world.

## 8. Links

- Tests: `packages/engine/tests/renderers/InstanceFieldLodInvariant.test.ts` · `…/InstanceFieldCompactionSum.test.ts` · `…/InstanceFieldFastFlightPop.test.ts` (39 tests, WP P2-4, claim `mw9j28mip7x`).
- Contract: `packages/engine/src/core/InstanceField.ts` · Sibling note: `docs/research/vegetation-occlusion-2026-11-08.md` (P1, device matrix precedent) · ADR: `docs/adr/0059-gpu-driven-vegetation-rendering.md`.
- Scratch (gitignored): `.agents/scratches/pop-proxy-prototype.mjs`.

## 9. Addendum — live results (to be filled at integration)

> **2026-11-10 addendum — headless WebGPU measurement** (worker #2 for audit open point #5; registration + commit by lead). All numbers below come from saved artifacts under `.agents/scratches/pop-tmp/` (gitignored scratch) — no fabrication. **Deviation from §6 protocol, mandatory disclosure:** §6 prescribes `?n=182728&path=aerial` on a real M4 Pro; the available headless device forced `path=flight` + `n=20000` (task-prescribed URL) at **480×270** (the field lane `main:opaque` pass is fill-bound on SwiftShader: ~12 s/frame @720p, ~2-5 s @480×270). The §6 cells at `n=182728/aerial` remain to be run on the M4 Pro (§9.6).

### 9.1 Device caveat (honest, binding for every number below)

- **Device:** headless Chrome + SwiftShader–Dawn with `--enable-unsafe-webgpu`; every cell verifies `navigator.gpu` = `google/swiftshader`, `meas:rendererType=WEB_GPU`, **0 page/console/validation errors**, `window.__vegTruthReady`/`scene-ready` sane (per §6 protocol step "setup").
- **Resolution-dependence (§5a `C = r·vp/tan(fov/2)`):** the LOD px metric is resolution-dependent by design. At `vp=270`, C ≈ 2·270/0.637 ≈ 848 px·m ⇒ bucket-1 effective threshold (24 px − bias 14 = 10 px) sits at **d ≈ 85 m**, bucket-2 (96 px − 14 = 82 px) at **d ≈ 10 m**. The `flight` path orbits at ground radius 20–70 m → close trees DO project past both thresholds every frame (see §9.4).
- **No TAA pair, no real GPU timings** headless. Frame times are **INFORMATIONAL-ONLY** (P50/P95 in 2.4–5.8 s range at 480×270), not comparable to the M4 Pro reference.
- **Wind:** Set A/B ran with default `?wind=1` (production path). Set C forced `?wind=0` to isolate LOD from wind (recorded in each cell URL). The `windHeight·maxLean` radius term explains the small GPU>CPU surplus in Set A (see below).

### 9.2 Set A — population audit per LOD mode (`flight`, n=20000, seed=51, frames=60, 480×270)

Both the prescribed URL (default `occlusion=b`, HZB on) and the HZB-free lane (`occlusion=a`) ran for **all four** modes `off` / `hysteresis` / `dither` / `dither-hysteresis` (8 cells). `cpuTotal` = pure-CPU frozen frustum+size reference (`?cullref=1`); `gpuMain` = GPU survivor count, main view, last resolved probe frame. **The superset/falseNeg gate is evaluated on the HZB-free lane only** — HZB legitimately drops occluded trees (`unexplained=…occlusion=on`), which is not a false negative (P1 doctrine).

| mode | occlusion | gpuMain | cpuTotal | engine verdict | superset | falseNeg | frameTimes p50/p95 (INFORMATIONAL) |
| :--- | :--- | ---: | ---: | :--- | :--- | :--- | :--- |
| off | b (HZB) | 421 | 9936 | `unexplained=9515(...,occlusion=on)` | — (HZB) | — (HZB) | 2482 / 3122 ms |
| off | a (free) | **10038** | **9901** | `ok(frustum=9901,size=0,cpu=9901,gpu=10038)` | **true** | **false** | 2694 / 3096 ms |
| hysteresis | b (HZB) | 421 | 9936 | `unexplained=9515(...,occlusion=on)` | — (HZB) | — (HZB) | 2494 / 3839 ms |
| hysteresis | a (free) | **10064** | **9937** | `ok(frustum=9937,size=0,cpu=9937,gpu=10064)` | **true** | **false** | 2677 / 5824 ms |
| dither | b (HZB) | 418 | 9978 | `unexplained=9560(...,occlusion=on)` | — (HZB) | — (HZB) | 2638 / 3466 ms |
| dither | a (free) | **10037** | **9901** | `ok(frustum=9901,size=0,cpu=9901,gpu=10037)` | **true** | **false** | 2630 / 3158 ms |
| dither-hysteresis | b (HZB) | 421 | 9936 | `unexplained=9515(...,occlusion=on)` | — (HZB) | — (HZB) | 2426 / 2733 ms |
| dither-hysteresis | a (free) | **10066** | **9921** | `ok(frustum=9921,size=0,cpu=9921,gpu=10066)` | **true** | **false** | 3459 / 3860 ms |

- **Result:** the occlusion-free superset gate **passes all four modes** (GPU ≥ CPU, zero unexplained drops ⇒ no false negatives on the audited lane; CPU-reference itself reports `size=0` — no sub-pixel drops at 480×270 because the 2 px gate maps to 467 m ≫ world ±200 m, §9.3).
- **Shadow/cascade views (`viewIndex` 1..2) bucket sets ⊆ main-view bucket set on EVERY captured per-frame probe snapshot of every cell** — `IF-LOD-MAIN-CAMERA` direction holds on the live lane (single-bucket variant, caveat §9.4).
- Small GPU>CPU surplus (≈ +0.9…+1.4 %: 10037–10066 vs 9901–9937) = the wind-bent radius term in the live cull (GPU tests a LARGER radius than the frozen CPU mirror) — conservatism, never a drop.
- **Honesty bound:** the engine `cullrefVerdict` compares against **bucket-0 only** (`_segmentCount(sets,0,0)`, P1-era reference). It therefore **cannot detect** whether survivors were mis-routed to bucket 0 instead of 1/2 — see §9.4.

### 9.3 Set B — triangle curve vs `?n=` (frozen pose, `pausedAt=0.55`, `occlusion=a`, 480×270, frames=3)

- **Protocol note (honest):** §4's `Δtri = 0` flat pin is a **geometry property of the File 2 harness** (additions beyond the sub-pixel horizon), not of any live scattered densification. At 480×270 the 2 px cull gate maps to **467 m** (1247 m @720p) while the world is **±200 m** ⇒ the gate never engages ⇒ scattered `?n=` densification **cannot** produce a flat live curve on this world. The strict harness-layout flat cell (`Δtri = 0` with additions beyond the horizon) remains a real-GPU cell (§9.6).
- Measured (field counts = actual records after the grid/clearing generator; `v0` = main-view bucket-0 survivors; tri = `v0 × 26` — every survivor routed to the coarsest proxy, 78/3 = 26 tris):

| `?n=` (requested) | field records | main v0 survivors | tri estimate | curve |
| :--- | ---: | ---: | ---: | :--- |
| 128 | 128 | 53 | 1378 | sanity: sparse population, ~41 % visible at pose |
| 20000 | 18363 | 7928 | 206128 | — |
| 80000 | 72864 | 31426 | 817076 | sublinear ↑ |
| 150000 | 137070 | 59158 | 1538108 | sublinear ↑ (still rising, not flat) |

- Reproducibility: n=20000 and n=150000 cells **rerun byte-identical** (7928 / 59158 survivors, same camera pose) — deterministic harness confirmed.
- `fieldInstances` ≈ requested (grid side caps + central clearing exclusion): 18363/20000, 72864/80000, 137070/150000 — recorded, not hidden.
- Gate-engagement sanity (the planned low-res 108-px cell) was **not captured** (capped budget) — deferred with §9.6; the n=128 sparse cell here plus the code-level gate mapping is the headless supplement.

### 9.4 Set C — pixel pop proxy (wind=0, frames=24, 480×270, in-page per-frame captures)

Method: in-page `canvas.toDataURL` per frame (INJECT_CAP; ~1.7 s/frame, clean canvas, per-frame aligned — replaces the CDP screenshot fallback), frame-to-frame mean-abs pixel delta, spike = delta > median + k·IQR, flip = frame-to-frame change in per-bucket GPU survivor counts (`?popcount=1`), `+2jump` = any frame pair where a record jumps ≥2 bucket indices. Modes × bias (= transition geometry forcing: at 480×270 the authored 24/96 px bands sit beyond the flight so `?lodbias=-8/-14` pulls the effective thresholds to ~16/10 px ⇒ closer to the flight cone).

| variant (URL knobs) | meanΔ | maxΔ | spikes k3/k6/k10 | flips | +2 jumps |
| :--- | ---: | ---: | :--- | ---: | ---: |
| off | 16.31 | 37.22 | 0 / 0 / 0 | 15 | 0 |
| off + bias −8 | 17.55 | 32.37 | 0 / 0 / 0 | 17 | 0 |
| off + bias −14 | 19.72 | 33.62 | 0 / 0 / 0 | 16 | 0 |
| dither + bias −8 | 17.56 | 32.39 | 0 / 0 / 0 | 16 | 0 |
| dither + bias −14 | 17.58 | 32.39 | 0 / 0 / 0 | 16 | 0 |
| dither band 0.33 + bias −14 (`?lodband=0.33`) | 17.78 | 37.63 | 0 / 0 / 0 | 17 | 0 |

- **Every "flip" is a bucket-0-only survivor-count change** (view-0 bucket-0 counts drifting ~200–600 as the camera sweeps; occlusion + frustum edge effects). No frame ever shows a bucket-1/2 count change ⇒ **zero LOD band crossings occurred live in any variant** (consistent with §9.4 routing observation).
- **+2 residual = 0 in all six variants** — expected: no band crossing ever engaged the routing, so the residual could not manifest. The §5a/File-3 frozen +2 geometry (fast crossing of a narrow band) was never exercised live.
- Proxy interpretation: mean/max deltas are **dominated by camera motion + fog/low-contrast scenes at flight altitude**, not LOD events. **off vs dither are statistically indistinguishable** (means 16.3–19.7, overlapping ranges). No spike structure (k3/k6/k10 = 0 everywhere) → no pop signal of any kind was detectable headless on this device.

### 9.5 Live multi-bucket routing observation — OPEN, must be re-verified (central honesty item)

- `gpuPerBucket` readback shows **`bucketIndex ≥ 1` = 0 on every captured frame of every cell** (all Set A/B/C variants, all modes, all bias values): the live lane emitted only bucket-0 survivors.
- **Code-level counter-evidence (what the deployed build *should* do):** the served bundle (`dist/js/core.js`, built 2026-11-10 10:14, before all measurements) contains the P2 multi-bucket cull verbatim — `fieldSelectBucket`/`fieldEffectiveMaxPx`, `MAX_LOD_BUCKETS = 8`, runtime mirrors `_lodBiasPx`/`_lodMaxima = [24, 96, 1e6]`, 3 authored buckets (`FIELD_LOD_MAXIMA_PX`), `cullPixelSize = 2`. The `flight` orbit (ground radius 20–70 m, height 6–20 m) over the full ±100 m square grid (spacing ~1.47 m) **geometrically guarantees** many in-frustum trees project ≫ 10/24 px every frame ⇒ a functioning live cull must emit bucket-1/2 survivors.
- **Conclusion:** the observed bucket-0-only routing is **not explained by configuration or authored data**; root cause not isolated within the capped measurement budget (candidate: live pick/layout path makes the compiled shader see a degenerate `fieldPrototypeRange.z` or metric input; or a buckets≥1 emit/readback defect on this device/build). **Consequence for every headless verdict above:** they hold for the **bucket-0 lane only** — **band transitions were never exercised live**, so the pop metric cells are **not falsified but also not proven** headless. This is the #1 item for the M4 Pro re-verification (§9.6).
- No engine source changes were made by this worker; this is a measurement report.

### 9.6 Verdict per §6 exit gate (headless-measurable subset) + deferred M4 Pro list

| §6 gate | Headless-verdict | Status |
| :--- | :--- | :--- |
| 2 (per-frame bucket counts, shadow ⊆ main) | shadow/cascade sets ⊆ main on every probe frame | PASSED on bucket-0 lane only; re-verify with multi-bucket routing live |
| 3 (no visible pops, TAA on/off, LIP) | zero pop signal measurable (no spikes; off≡dither); +2 residual unexercised | NOT FALSIFIED, NOT PROVEN → M4 Pro |
| 4 (triangle flat vs `?n=`) | not flat live — documented as harness-geometry + densification curve (§9.3) | requires strict harness-layout cell → M4 Pro |
| A/B per §7 (blind pair) | not run (needs video) | → M4 Pro |

**Deferred to real M4 Pro GPU (per §6/§7 — explicit confirmation list):**
1. **Live multi-bucket routing re-verification** after a real rebuild at target res (the §9.5 open item — the decisive blocker).
2. `n=182728 & path=aerial` per-frame bucket counts + shadow⊆main with real multi-bucket activity.
3. LIP video pair per TAA setting (fast flight) + correlation with the enumerated +2 residual geometry (§5a).
4. Blind A/B pairs per §7 (A dither vs C hysteresis, bandwidth/video matched).
5. Visual pop verdict (TAA on/off) — the actual exit criteria for gate 3.
6. Strict `Δtri = 0` flat harness-layout cell (far-population additions beyond the horizon) + the low-res gate-engagement sanity cell (192×108) that was capped out headless.
7. Real GPU timings for the overdraw/bandwidth proportionality check (§4 `+0.9 % bw 0.05`).

### 9.7 RECOMMENDATION (no engine code change) — LOD-transition default band/mode

- **Keep the production default at hard-switch (`off` = crossfade band 0, hysteresis 0) — the P1-identical, fail-closed mode.** Do **not** enable a dither crossfade band or hysteresis margin as default yet.
- Measured basis: on this device/res all four modes were **behaviorally identical** (bucket-0 lane, zero transitions, identical verdicts, overlapping pop-proxy deltas); dither offered **zero measurable benefit** headless (meanΔ off 16.3 vs dither 17.6, spike-free both), while its costs — dual-write overdraw (≈band-width-proportional, §4) and, per File 3, its inability to stage a +2 residual — stay unquantified live.
- The hard-switch default is additionally the **honest choice while §9.5's multi-bucket routing is unverified**: it reproduces the P1 semantics that ARE validated (bucket-0 superset gate passes, shadow⊆main), coupling the default to the least unverified machinery.
- **Condition to revisit:** enable candidate A/C only after M4 Pro gate-3 (LIP pair) demonstrates a visible pop to eliminate, and gate-2 confirms live multi-bucket routing works; then prefer candidate C (hysteresis, zero overdraw, ±1 rate-limit — §3 finding 3) over the dither crossfade band, per the §5a quantitative ranking.

### 9.8 ADDENDUM (2026-11-10) — live human sighting on the real M4 Pro → DEFAULT DECIDED (supersedes §9.7)

> **Method (live protocol §6, real device, human sighting):** `https://localhost:5173/apps/showcases/51/?mode=field&n=182728&path=aerial&cover=0&lodMode=dither-hysteresis` (+ `&taa=1` variant), interactive aerial flyover, trees in view at LOD-relevant distances. This is the display-condition pair the step-2 spec requires ("TAA resolves the dither") — the earlier `path=flight` sighting was confounded (ground-level grass vantage + no TAA).

- **Result / human verdict:**
  - `lodMode=dither-hysteresis` **WITHOUT TAA** (engine default display path): **coarse moiré / screen-door flicker, rated unpleasant** ("flimmert… sehr unangenehm für die Augen") — the dither pattern is visible without the temporal resolve.
  - `?taa=1` variant: the coarse moiré resolves to a **residual fine grain** ("leicht körnig" / "wie kleine Ameisen" on distant crowns) — TAA helps but does NOT eliminate the pattern; dither remains perceptible even under the intended TAA condition.
  - By contrast the `hysteresis` rail (hard gate, band 0) has **no fragment pattern by construction** — the per-instance threshold jitter is cull-side ALU only, invisible.
- **DECISION (human + lead, 2026-11-10):** engine zero-config default transition mode = **`hysteresis`** (band 0 / hyst 0.02 / hard gate). `off` = explicit P1-identical opt-in; `dither` / `dither-hysteresis` = documented **TAA-pipeline opt-in** modes (residual grain documented). Implemented as `DEFAULT_LOD_TRANSITION_MODE` in the WebGPU manager, applied at construction only for fields that author neither a mode nor raw transition knobs (raw-knob path unchanged). Showcase 51 demo defaults aligned (band 0 / hyst 0.02) so the zero-config demo shows no moiré.
- **§9.5 multi-bucket routing — live-resolved on the real build:** the headless bucket-0-only anomaly is NOT reproduced on the real device/dev build — the human observed the **screen-door dither pattern live**, which only renders when the crossfade band is active with real multi-bucket dual writes. Band transitions therefore DID engage live on the M4 Pro (transition geometry exercised; the pop-side question is now moot for the default because hysteresis needs no dither).
- **Cost note:** hysteresis is the cheapest non-zero mode (cull-side ALU only, 0 extra writes, 0 fragment change — §4 cost model), so the default has no measurable overhead beyond the P1 baseline.
- **Open (documented, non-blocking):** strict `Δtri = 0` flat harness cell + low-res gate-engagement cell remain deferred to an M4 Pro run (§9.6 items 6); they are unrelated to the default-mode decision.
