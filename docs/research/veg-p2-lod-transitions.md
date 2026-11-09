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

- TODO: §6 cells 2–5 by lead/integration; verdict per exit gate. Any real-GPU deviation from the §4 anchors = lane bug (fail the cell), never a test-calibration excuse (P1 honesty rule, `vegetation-occlusion` note §2).
