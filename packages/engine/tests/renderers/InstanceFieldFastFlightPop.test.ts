/**
 * InstanceFieldFastFlightPop.test.ts — P2-4 headless pop-metric proxy on fast flight
 * (`veg-p2` / ADR 0059 step 2, WP P2-4). Pure-CPU reference, no browser.
 *
 * Scope: the temporal FULP ("pop") on fast flight has ROUTING-level preconditions that are
 * testable headless. The visual LIP itself is live-only and is measured by the protocol in
 * `docs/research/veg-p2-lod-transitions.md` §6 (TAA on/off, fast flight, per-frame bucket
 * counts; "live browser verification pending at integration"). This file pins what the routes
 * MUST guarantee so that pops are bounded by construction, plus the honest residual that no
 * routing candidate removes headlessly.
 *
 * Pop-proxy definition (this file): `popProxy(t) = |flips(t)|` where a flip is a change of an
 * instance's LOD bucket (or drop/revive at the sub-pixel horizon) between frame t−1 and t on a
 * camera path. Every sim is deterministic (exact doubles of the engine metric
 * `projectedDiameterPixels`), so every asserted count is EXACT — no statistical tolerance applies
 * to routing invariants. The live LIP measurement is the only deferred quantity.
 *
 * Mirrors in this file (same discipline as `InstanceFieldCompactionSum.test.ts`):
 *   - FROZEN (today): hard band switch, single bucket per instance per frame. Pins: presence
 *     continuity (exactly one bucket per kept instance), flip locality (flips ONLY at real metric
 *     crossings — detector independent of the selector), exact triangle accounting (tris change
 *     ONLY via flips, recompute == incremental), monotone routing on a receding camera, and the
 *     honest RESIDUAL: a fast crossing of a NARROW band produces a +≥2 hard-cut jump (the
 *     intermediate band is never rendered).
 *   - PENDING-C (candidate C mirror): hard switch + sticky hysteresis. Every property below is a
 *     contractual proposal pinned for the P2 review (engine semantics are P2-1/P2-2 authored).
 *     Pins: kills boundary oscillation, margin=0 degenerates to frozen exactly, coarsening is
 *     strictly deferred (never earlier, never reversed), and per-frame |Δbucket| is rate-limited
 *     to ≤1 even where frozen jumps +2 (candidate C bounds the fast-flight pop by construction).
 *   - PENDING-DUAL-BUCKET (candidate A mirror): dual write in the crossfade band, direction-aware
 *     staging (destination bucket already present BEFORE the source bucket ends). Pins: membership
 *     continuity (consecutive frames always share ≥1 bucket on +1-only flights), contiguous dual
 *     staging (no dual/sole flicker), the honest limitation (+≥2 jumps stay hard cuts — enumerated
 *     residual), bandwidth-proportional triangle overdraw (crossfade cost), and bandWidth=0
 *     degeneration to frozen.
 *
 * Prototype finding (validated in `.agents/scratches/pop-proxy-prototype.mjs`, also in note §5):
 * an ±Infinity lane-bound framing of the hysteresis margin yields `0 * Infinity = NaN` and
 * silently disables one side of the dead zone — the mirror pins the finite-lane formulation.
 */

import { describe, expect, it } from "vitest";
import { MAX_LOD_BUCKETS, projectedDiameterPixels } from "../../src/core/InstanceField.js";

// ---------------------------------------------------------------------------
// §0 Frozen pins + authored thresholds (ADR 0047: thresholds live HERE, not in the engine).
// ---------------------------------------------------------------------------

const VIEWPORT_HEIGHT_PX = 720;
const FOV_RADIANS_Y = Math.PI / 3;
const CULL_PIXEL_SIZE = 8;
const PROTOTYPE_RADIUS = 2;
const CAM_Y = 6;

/** Pending-candidate knob mirrors. */
const CROSSFADE_BAND = 0.08 as const;
const HYSTERESIS_MARGIN = 0.1 as const;

/**
 * Authored band chains. Selection semantics are the frozen first-match rule (entry exclusive /
 * exit inclusive; the cull floor is a keep/drop gate, the coarsest top edge is a clamp). Bucket
 * index 0 = FARTHEST band = CHEAPEST mesh (realistic LOD orientation — nearest band never cheaper;
 * the per-bucket mesh order itself is P2-authored but the invariant direction is not).
 */
interface BandTable {
  readonly maxProjectedSizes: readonly number[];
  readonly budgets: readonly number[];
}

const MAIN_CHAIN: BandTable = {
  // (8,96] (96,384] (384,1536]; far cheap -> near expensive.
  maxProjectedSizes: [96, 384, 1536],
  budgets: [1200, 4000, 10_000],
};

const NARROW_CHAIN: BandTable = {
  // Band 1 (88,96] is only 8 px wide (~2 m of world distance around d = 26..28 m). A fast flight
  // crossing it in one frame SKIPS it -> hard-cut +2 jump (the frozen residual pop source).
  maxProjectedSizes: [88, 96, 1536],
  budgets: [1200, 2000, 10_000],
};

/** Metric coefficient for radius 2 / 720 px / fov 60°: px = C / d with C = r·vp/tan(fov/2) ≈ 2494. */
const METRIC_C = (PROTOTYPE_RADIUS * VIEWPORT_HEIGHT_PX) / Math.tan(FOV_RADIANS_Y / 2);

// ---------------------------------------------------------------------------
// §1 Fast-flight reference harness (CPU twin of the validated prototype).
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Engine metric verbatim (IF-PROJECTED-SIZE). */
function metricPx(pos: Vec3, cam: Vec3): number {
  return projectedDiameterPixels(PROTOTYPE_RADIUS, Math.max(dist(pos, cam), 1e-6), VIEWPORT_HEIGHT_PX, FOV_RADIANS_Y);
}

/** Frozen first-match band routing (semantic twin of the canonical pin in `InstanceFieldCull.test.ts`). */
function bucketFor(table: BandTable, px: number): number {
  if (!Number.isFinite(px)) return -1;
  if (px < CULL_PIXEL_SIZE) return -1;
  for (let b = 0; b < table.maxProjectedSizes.length; b++) {
    if (px <= table.maxProjectedSizes[b]!) return b;
  }
  return table.maxProjectedSizes.length - 1;
}

/** Routing thresholds under the frozen rule: the cull floor + every INTERNAL band boundary.
 *  The coarsest band's top edge is a clamp (no reroute), so it is NOT a flip threshold. */
function effectiveThresholds(table: BandTable): readonly number[] {
  return [CULL_PIXEL_SIZE, ...table.maxProjectedSizes.slice(0, -1)];
}

/** Independent crossing detector (does NOT use bucketFor — guards against phantom/stateful
 *  flip accounting by construction). */
function crossedThreshold(prevPx: number, px: number, threshold: number): boolean {
  return (prevPx - threshold) * (px - threshold) < 0;
}

interface Flight {
  readonly table: BandTable;
  readonly trees: readonly Vec3[];
  readonly camPath: readonly Vec3[];
  /** px[frame][tree] — the SINGLE input source; every invariant derives from it. */
  readonly px: readonly (readonly number[])[];
  /** Frozen routing trace: buckets[frame][tree] = bucketFor(px). */
  readonly buckets: readonly (readonly number[])[];
}

function buildFlight(trees: readonly Vec3[], table: BandTable, camPath: readonly Vec3[]): Flight {
  const px: number[][] = [];
  const buckets: number[][] = [];
  for (const cam of camPath) {
    const rowPx: number[] = [];
    const rowBucket: number[] = [];
    for (const t of trees) {
      const p = metricPx(t, cam);
      rowPx.push(p);
      rowBucket.push(bucketFor(table, p));
    }
    px.push(rowPx);
    buckets.push(rowBucket);
  }
  return { table, trees, camPath, px, buckets };
}

function isKept(bucket: number): boolean {
  return bucket >= 0;
}

function treesRecedeCorridor(): Vec3[] {
  const trees: Vec3[] = [];
  for (const z of [-2, -4, -12, -18, -24, -30]) {
    for (const x of [-6, 0, 6]) trees.push([x, 0, z]);
  }
  return trees;
}

function treesOnLine(zs: readonly number[]): Vec3[] {
  return zs.map((z): Vec3 => [0, 0, z]);
}

/** Recede flight: camera backs away +Z from z = 0..260 (1 m/frame). Distance only grows -> pure
 *  coarsening profile (the cleanest monotone pop-proxy trace). */
function camPathRecede(): Vec3[] {
  const path: Vec3[] = [];
  for (let z = 0; z <= 260; z++) path.push([0, CAM_Y, z]);
  return path;
}

/** Slow pass-through (1 m/frame): every band crossing is a +1 step; used for continuity pins. */
function camPathSlowPass(): Vec3[] {
  const path: Vec3[] = [];
  for (let z = 60; z >= -80; z--) path.push([0, CAM_Y, z]);
  return path;
}

/** Narrow-fast pass-through (8 m/frame) through trees at d ≈ 26..28 m. The single-frame Δd (8 m)
 *  exceeds the width of band 1 (~2 m) -> guaranteed +2 skips (validated). */
function camPathNarrowFast(): Vec3[] {
  const path: Vec3[] = [];
  for (let z = 100; z >= -20; z -= 8) path.push([0, CAM_Y, z]);
  return path;
}

/** Camera z placing a tree at (0,0,homeZ) exactly at `targetD` distance (px == 96 for the
 *  authored metric). Used only to centre the jitter flight on the 96 px boundary. */
function camZAtDistance(homeZ: number, targetD: number): number {
  return homeZ + Math.sqrt(targetD * targetD - CAM_Y * CAM_Y);
}

/** Jitter flight: 40 frames oscillating ±0.9 m (±≈3.3 px) around px = 96 of the boundary tree.
 *  Frozen routing oscillates b0/b1 every crossing (pop probe for candidate C). */
function camPathJitterBoundary(): Vec3[] {
  const homeZ = -19.9;
  const base = camZAtDistance(homeZ, 25.98);
  const path: Vec3[] = [];
  for (let k = 0; k < 40; k++) path.push([0, CAM_Y, base + Math.sin(k * 0.7) * 0.9]);
  return path;
}

/** Frozen flight account: per-frame drawn-triangle sum (exact) + per-frame flip count.
 *  Frame 0 has no predecessor -> no flip counted there (no phantom revive event). */
function accountFrozen(flight: Flight): { perFrame: number[]; flips: number[] } {
  const perFrame: number[] = [];
  const flips: number[] = [];
  const prev = new Array<number>(flight.trees.length).fill(-1);
  for (let f = 0; f < flight.buckets.length; f++) {
    let tris = 0;
    let flipCount = 0;
    const row = flight.buckets[f]!;
    for (let i = 0; i < flight.trees.length; i++) {
      const b = row[i]!;
      if (isKept(b)) tris += flight.table.budgets[b]! / 3;
      if (f > 0 && b !== prev[i]) flipCount++;
      prev[i] = b;
    }
    perFrame.push(tris);
    flips.push(flipCount);
  }
  return { perFrame, flips };
}

// ---------------------------------------------------------------------------
// §2 FROZEN baseline — hard switch, single bucket. The routing preconditions that bound pops
// by construction today (before any PENDING candidate lands).
// ---------------------------------------------------------------------------

describe("IF-LOD-ROUTING (frozen hard switch) — fast-flight pop-metric preconditions", () => {
  it("pins section constants (MAX_LOD_BUCKETS, cull floor, metric coefficient)", () => {
    expect(MAX_LOD_BUCKETS).toBe(8);
    expect(CULL_PIXEL_SIZE).toBe(8);
    expect(METRIC_C).toBeGreaterThan(2400);
    expect(METRIC_C).toBeLessThan(2600);
  });

  it("flip locality: flips occur IFF the metric crossed a routing threshold (independent detector)", () => {
    const trees = treesOnLine([-22, -24, -26]);
    const flight = buildFlight(trees, MAIN_CHAIN, camPathSlowPass());
    for (let f = 1; f < flight.buckets.length; f++) {
      for (let i = 0; i < trees.length; i++) {
        const prevPx = flight.px[f - 1]![i]!;
        const px = flight.px[f]![i]!;
        const flipped = flight.buckets[f]![i] !== flight.buckets[f - 1]![i];
        const crossed = effectiveThresholds(MAIN_CHAIN).some((thr) => crossedThreshold(prevPx, px, thr));
        expect(flipped, `frame ${f} tree ${i}: flip must coincide with a threshold crossing`).toBe(crossed);
      }
    }
  });

  it("exact triangle + flip accounting: per-frame tris equal the recomputed sum; changes ONLY via flips", () => {
    const flight = buildFlight(treesRecedeCorridor(), MAIN_CHAIN, camPathRecede());
    const acct = accountFrozen(flight);
    let running = 0;
    for (let f = 0; f < flight.buckets.length; f++) {
      let scratch = 0;
      for (let i = 0; i < flight.trees.length; i++) {
        const b = flight.buckets[f]![i]!;
        if (isKept(b)) scratch += flight.table.budgets[b]! / 3;
      }
      expect(acct.perFrame[f], "self-consistency: no hidden state in the mirror").toBe(scratch);
      if (f > 0 && acct.flips[f] === 0) expect(acct.perFrame[f], "popProxy: no flips -> no tri change").toBe(running);
      running = scratch;
    }
    // Recede only coarsens -> monotone non-increasing triangle curve.
    for (let f = 1; f < acct.perFrame.length; f++) {
      expect(acct.perFrame[f]).toBeLessThanOrEqual(acct.perFrame[f - 1]!);
    }
    expect(acct.flips.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("recede flight: monotone per-instance bucket index; real multi-band traversal (non-vacuous)", () => {
    const flight = buildFlight(treesRecedeCorridor(), MAIN_CHAIN, camPathRecede());
    let crossings = 0;
    const flipsPerTree = new Map<string, number>();
    for (let f = 1; f < flight.buckets.length; f++) {
      for (let i = 0; i < flight.trees.length; i++) {
        const prev = flight.buckets[f - 1]![i]!;
        const cur = flight.buckets[f]![i]!;
        if (isKept(prev) && isKept(cur)) {
          // Receding camera: pixel size shrinks -> band index must never increase.
          expect(cur).toBeLessThanOrEqual(prev);
        }
        if (cur !== prev) {
          crossings++;
          const key = flight.trees[i]!.join();
          flipsPerTree.set(key, (flipsPerTree.get(key) ?? 0) + 1);
        }
      }
    }
    // Corridor spans the near expensive bands into the far cheap band; several trees traverse.
    expect(flipsPerTree.size).toBeGreaterThan(2);
    expect(crossings).toBeGreaterThan(10);
  });

  it("fast crossing of a narrow band yields +≥2 hard-cut jumps — the frozen residual pop source", () => {
    const trees = treesOnLine([-26, -27]);
    const flight = buildFlight(trees, NARROW_CHAIN, camPathNarrowFast());
    const residual: Array<{ tree: string; frame: number; from: number; to: number }> = [];
    for (let f = 1; f < flight.buckets.length; f++) {
      for (let i = 0; i < trees.length; i++) {
        const prev = flight.buckets[f - 1]![i]!;
        const cur = flight.buckets[f]![i]!;
        if (isKept(prev) && isKept(cur) && Math.abs(cur - prev) > 1) {
          residual.push({ tree: trees[i]!.join(), frame: f, from: prev, to: cur });
        }
      }
    }
    // Validated deterministic count = 2 (one per tree on this path); both jump b0 -> b2 in a
    // single frame; band 1 is NEVER rendered (neighbour frames carry only b0 or b2).
    expect(residual.length).toBe(2);
    for (const r of residual) {
      const i = trees.findIndex((t) => t.join() === r.tree);
      expect(r.from).toBe(0);
      expect(r.to).toBe(2);
      for (const f of [r.frame - 1, r.frame, Math.min(r.frame + 1, flight.buckets.length - 1)]) {
        const b = flight.buckets[f]![i]!;
        expect(b === r.from || b === r.to || !isKept(b)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §3 PENDING-C — hard switch + sticky hysteresis (candidate C mirror). Marker: PENDING-C.
// ---------------------------------------------------------------------------

/**
 * Strict sticky routing (candidate C mirror): while an instance is in bucket b it stays in b
 * until the metric leaves the margin-widened lane (margin scales with lane width). Finite lane
 * bounds only: the finest lane starts at 0 px (band-table floor is a keep/drop gate, not a
 * reroute), the coarsest band's max is its authoritative edge. A ±Infinity framing of the outer
 * lane bounds turns the margin into `0 * Infinity = NaN` and silently disables one side of the
 * dead zone (prototype finding — note §5).
 */
function hysteresisBucket(table: BandTable, px: number, margin: number, prevBucket: number): number {
  if (!Number.isFinite(px)) return -1;
  if (px < CULL_PIXEL_SIZE) return -1;
  if (prevBucket < 0) return bucketFor(table, px);
  const b = prevBucket;
  const lo = b > 0 ? table.maxProjectedSizes[b - 1]! : 0;
  const hi = table.maxProjectedSizes[b]!;
  const wl = hi - lo;
  const low = lo - margin * wl;
  const high = hi + margin * wl;
  if (px < low && b > 0) return b - 1;
  if (px > high && b < table.maxProjectedSizes.length - 1) return b + 1;
  return b;
}

function runHysteresisFlight(
  flight: Flight,
  margin: number,
): { buckets: readonly (readonly number[])[]; flips: number[] } {
  const buckets: number[][] = [];
  const flips: number[] = [];
  const state = new Map<string, number>();
  for (let f = 0; f < flight.buckets.length; f++) {
    const row: number[] = [];
    let flipCount = 0;
    for (let i = 0; i < flight.trees.length; i++) {
      const key = flight.trees[i]!.join();
      const prev = state.get(key) ?? -1;
      const b = hysteresisBucket(flight.table, flight.px[f]![i]!, margin, prev);
      if (prev !== -1 && b !== prev) flipCount++;
      row.push(b);
      state.set(key, b);
    }
    buckets.push(row);
    flips.push(flipCount);
  }
  return { buckets, flips };
}

describe("PENDING-C — hysteresis mirror: bounded fast-flight pop (candidate C)", () => {
  it("kills boundary oscillation under camera jitter (contrast: frozen oscillates)", () => {
    const trees = treesOnLine([-19.9]);
    const flight = buildFlight(trees, MAIN_CHAIN, camPathJitterBoundary());
    const frozenFlips = accountFrozen(flight).flips.reduce((a, b) => a + b, 0);
    expect(frozenFlips, "frozen hard switch must oscillate across the boundary").toBe(9);
    const loose = runHysteresisFlight(flight, 0);
    expect(loose.flips.reduce((a, b) => a + b, 0)).toBe(9); // margin=0 == frozen
    const sticky = runHysteresisFlight(flight, HYSTERESIS_MARGIN);
    expect(sticky.flips.reduce((a, b) => a + b, 0), "hysteresis must hold the bucket inside the dead zone").toBe(0);
  });

  it("margin=0 degenerates exactly to frozen routing on a recede flight", () => {
    const flight = buildFlight(treesRecedeCorridor(), MAIN_CHAIN, camPathRecede());
    const hys = runHysteresisFlight(flight, 0);
    for (let f = 0; f < flight.buckets.length; f++) {
      for (let i = 0; i < flight.trees.length; i++) {
        expect(hys.buckets[f]![i]).toBe(flight.buckets[f]![i]);
      }
    }
  });

  it("coarsening is strictly deferred (never earlier, never reversed) and per-frame C index >= F index", () => {
    const flight = buildFlight(treesRecedeCorridor(), MAIN_CHAIN, camPathRecede());
    const hys = runHysteresisFlight(flight, HYSTERESIS_MARGIN);
    const initFrozen = new Map<string, number>();
    const firstC = new Map<string, number>();
    const firstF = new Map<string, number>();
    for (let f = 0; f < flight.buckets.length; f++) {
      for (let i = 0; i < flight.trees.length; i++) {
        const key = flight.trees[i]!.join();
        const fb = flight.buckets[f]![i]!;
        const cb = hys.buckets[f]![i]!;
        if (isKept(fb) && isKept(cb)) {
          // C never routes to a cheaper band before frozen would (C stays at >= index).
          const expected = initFrozen.get(key) ?? fb;
          expect(cb).toBeGreaterThanOrEqual(fb);
          if (!firstF.has(key) && fb < expected) firstF.set(key, f);
          if (!firstC.has(key) && cb < expected) firstC.set(key, f);
        }
        if (!initFrozen.has(key)) initFrozen.set(key, fb);
      }
    }
    // Hysteresis defers every coarsening to a later (or same) frame — at least one STRICTLY later.
    let strict = 0;
    let violated = 0;
    for (const [key] of initFrozen) {
      const f0 = firstF.get(key);
      const c0 = firstC.get(key);
      if (f0 === undefined) continue; // tree never coarsened in frozen either
      if (c0 === undefined || c0 > f0) strict++;
      if (c0 !== undefined && c0 < f0) violated++;
    }
    expect(violated).toBe(0);
    expect(strict).toBeGreaterThan(0);
  });

  it("rate-limits per-frame |Δbucket| to ≤1 even where frozen jumps +2 (narrow band, fast flight)", () => {
    const trees = treesOnLine([-26, -27]);
    const flight = buildFlight(trees, NARROW_CHAIN, camPathNarrowFast());
    const hys = runHysteresisFlight(flight, HYSTERESIS_MARGIN);
    let frozenMax = 0;
    let hysMax = 0;
    for (let f = 1; f < flight.buckets.length; f++) {
      for (let i = 0; i < trees.length; i++) {
        const fp = flight.buckets[f - 1]![i]!;
        const fc = flight.buckets[f]![i]!;
        const hp = hys.buckets[f - 1]![i]!;
        const hc = hys.buckets[f]![i]!;
        if (isKept(fp) && isKept(fc)) frozenMax = Math.max(frozenMax, Math.abs(fc - fp));
        if (isKept(hp) && isKept(hc)) hysMax = Math.max(hysMax, Math.abs(hc - hp));
      }
    }
    // The frozen flight demonstrably contains a +2 jump in this scenario (see §2); hysteresis
    // steps at most one band per frame — the crossfade-less fast-flight pop is bounded by C.
    expect(frozenMax).toBe(2);
    expect(hysMax).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §4 PENDING-DUAL-BUCKET — direction-aware crossfade staging (candidate A mirror).
// Marker: PENDING-DUAL-BUCKET.
// ---------------------------------------------------------------------------

/**
 * Direction-aware dual write (candidate A mirror): while the metric passes through the top
 * `bandWidth` fraction of a lane, the instance is routed to the current bucket AND the adjacent
 * bucket in the direction of travel. During coarsening the COARSER (lower-index) destination is
 * pre-staged; during refinement the FINER (higher-index) destination is pre-staged — so the
 * destination bucket is always already present before the source bucket ends (+1 crossings only).
 * With `bandWidth = 0` this degenerates to frozen single-bucket routing.
 */
function crossfadeSet(table: BandTable, prevPx: number | undefined, px: number, bandWidth: number): readonly number[] {
  const b = bucketFor(table, px);
  if (b < 0) return [];
  if (prevPx === undefined) return [b];
  const out: number[] = [b];
  if (px < prevPx) {
    // Coarsening: stage the destination (b-1) while still near the lower boundary of lane b.
    if (b > 0) {
      const lo = table.maxProjectedSizes[b - 1]!;
      const wl = table.maxProjectedSizes[b]! - lo;
      if (px <= lo + bandWidth * wl) out.push(b - 1);
    }
  } else {
    // Refining: stage the incoming finer bucket (b+1) while still near the upper boundary.
    if (b < table.maxProjectedSizes.length - 1) {
      const hi = table.maxProjectedSizes[b]!;
      const wl = hi - (b > 0 ? table.maxProjectedSizes[b - 1]! : 0);
      if (px >= hi - bandWidth * wl) out.push(b + 1);
    }
  }
  return out.sort((x, y) => x - y);
}

function runCrossfadeFlight(
  flight: Flight,
  bandWidth: number,
): { sets: readonly (readonly (readonly number[])[])[]; continuityBreaks: Array<{ tree: string; frame: number }> } {
  const sets: (readonly (readonly number[])[])[] = [];
  const continuityBreaks: Array<{ tree: string; frame: number }> = [];
  const prevPx = new Map<string, number>();
  const prevSet = new Map<string, readonly number[]>();
  for (let f = 0; f < flight.buckets.length; f++) {
    const row: (readonly number[])[] = [];
    for (let i = 0; i < flight.trees.length; i++) {
      const key = flight.trees[i]!.join();
      const px = flight.px[f]![i]!;
      const set = crossfadeSet(flight.table, prevPx.get(key), px, bandWidth);
      row.push(set);
      const ps = prevSet.get(key);
      if (ps !== undefined && ps.length > 0 && set.length > 0 && !set.some((x) => ps.includes(x))) {
        continuityBreaks.push({ tree: key, frame: f });
      }
      prevPx.set(key, px);
      prevSet.set(key, set);
    }
    sets.push(row);
  }
  return { sets, continuityBreaks };
}

describe("PENDING-DUAL-BUCKET — crossfade staging mirror (candidate A)", () => {
  it("membership continuity: consecutive frames always share ≥1 bucket on a +1-only flight", () => {
    const trees = treesOnLine([-22, -24, -26]);
    const flight = buildFlight(trees, MAIN_CHAIN, camPathSlowPass());
    const { sets, continuityBreaks } = runCrossfadeFlight(flight, CROSSFADE_BAND);
    expect(continuityBreaks, "no hard cut on a slow passage when staging is active").toHaveLength(0);
    // Presence continuity + dual bound: kept instances are in 1..2 buckets, never 0, never >2.
    for (const row of sets) {
      for (const set of row) {
        expect(set.length).toBeGreaterThanOrEqual(1);
        expect(set.length).toBeLessThanOrEqual(2);
        for (let j = 1; j < set.length; j++) {
          expect(Math.abs(set[j]! - set[j - 1]!)).toBe(1);
        }
      }
    }
  });

  it("contiguous dual staging on a monotone recede (no dual/sole flicker inside the band)", () => {
    const trees = treesRecedeCorridor();
    const flight = buildFlight(trees, MAIN_CHAIN, camPathRecede());
    const { sets } = runCrossfadeFlight(flight, CROSSFADE_BAND);
    let dualTotal = 0;
    for (let i = 0; i < trees.length; i++) {
      let dualRuns = 0;
      let dual = false;
      for (let f = 0; f < sets.length; f++) {
        const set = sets[f]![i]!;
        if (set.length > 1) {
          dualTotal++;
          if (!dual) dualRuns++;
          dual = true;
        } else {
          dual = false;
        }
      }
      expect(dualRuns, `tree ${i}: dual staging must be one contiguous interval per monotone phase`).toBeLessThanOrEqual(1);
    }
    expect(dualTotal, "the band must actually be exercised (non-vacuous)").toBeGreaterThan(0);
  });

  it("direction-aware staging cannot catch +≥2 jumps — every frozen hard cut survives (honest limitation)", () => {
    const trees = treesOnLine([-26, -27]);
    const flight = buildFlight(trees, NARROW_CHAIN, camPathNarrowFast());
    // Frozen +2 residual (same enumeration as §2): the set of trees with an un-stageable jump.
    const frozenResidualTrees = new Set<string>();
    let frozenResidualEvents = 0;
    for (let f = 1; f < flight.buckets.length; f++) {
      for (let i = 0; i < trees.length; i++) {
        const prev = flight.buckets[f - 1]![i]!;
        const cur = flight.buckets[f]![i]!;
        if (isKept(prev) && isKept(cur) && Math.abs(cur - prev) > 1) {
          frozenResidualEvents++;
          frozenResidualTrees.add(trees[i]!.join());
        }
      }
    }
    // This path demonstrably contains +2 jumps (frozen baseline, §2).
    expect(frozenResidualEvents).toBeGreaterThan(0);
    const { continuityBreaks } = runCrossfadeFlight(flight, CROSSFADE_BAND);
    // Candidate A stages only +1 crossings; every +2 jump is a hard cut in the crossfade too:
    // the continuity-break set is exactly the frozen residual (breaking requires the destination
    // to have been pre-staged, which the band cannot do across a skipped band).
    expect(continuityBreaks.length).toBe(frozenResidualEvents);
    for (const brk of continuityBreaks) {
      expect(frozenResidualTrees.has(brk.tree), `hard cut on ${brk.tree} must stem from a frozen +2 residual`).toBe(true);
    }
  });

  it("bandWidth=0 degenerates exactly to frozen single-bucket routing", () => {
    const trees = treesOnLine([-22, -24, -26]);
    const flight = buildFlight(trees, MAIN_CHAIN, camPathSlowPass());
    const { sets } = runCrossfadeFlight(flight, 0);
    for (let f = 0; f < sets.length; f++) {
      for (let i = 0; i < trees.length; i++) {
        expect(sets[f]![i]!).toEqual([flight.buckets[f]![i]!]);
      }
    }
  });

  it("crossfade costs bandwidth-proportional triangle overdraw (both meshes drawn in the band)", () => {
    const trees = treesRecedeCorridor();
    const flight = buildFlight(trees, MAIN_CHAIN, camPathRecede());
    const { sets } = runCrossfadeFlight(flight, CROSSFADE_BAND);
    let frozenTris = 0;
    let cfTris = 0;
    for (let f = 0; f < flight.buckets.length; f++) {
      for (let i = 0; i < trees.length; i++) {
        const fb = flight.buckets[f]![i]!;
        if (isKept(fb)) frozenTris += flight.table.budgets[fb]! / 3;
        for (const b of sets[f]![i]!) cfTris += flight.table.budgets[b]! / 3;
      }
    }
    expect(cfTris).toBeGreaterThan(frozenTris);
  });
});
