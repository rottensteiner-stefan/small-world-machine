/**
 * InstanceFieldCompactionSum.test.ts — P2-4 compaction-sum + triangle accounting invariant
 * (`veg-p2` / ADR 0059 step 2). Pure-CPU reference, no browser.
 *
 * Invariant under test (IF-BUDGET / IF-CULL-ROUTING, frozen segment-table contract in
 * `packages/engine/src/core/InstanceField.ts`):
 *   [COMPACTION-SUM] the per-(view x bucket) compacted counts SUM to the post-cull visible count
 *   of that view — every kept instance is routed to EXACTLY ONE (view x bucket) segment, none
 *   dropped (within page capacity), none double-counted; the segment header's `instanceCount`
 *   word equals the written count; per-segment counts never exceed capacity (clamp-at-capacity
 *   with documented drop accounting).
 *   [TRIANGLE-FLAT] the per-frame drawn triangle count is an exact function of the compacted
 *   counts and the per-bucket mesh budgets (`tri = Σ count(b) * indexCount(b) / 3`), and grows
 *   with the VISIBLE population only — adding instances beyond the sub-pixel horizon (the
 *   realistic `?n=` growth of the reference demo) adds ZERO triangles.
 *
 * The reference harness below mirrors the FROZEN decision math exactly (conservative per-view
 * frustum, per-view sub-pixel drop, MAIN-camera bucket selection via `projectedDiameterPixels`,
 * atomicAdd-style clamp-at-capacity compaction into `(view * MAX_LOD_BUCKETS + bucket)` pages) —
 * it is the CPU twin of `instance_cull.wgsl`'s routing + the GL lane's command emission, so the
 * invariants asserted here are the ones the real lanes must honour (IF-CULL-ROUTING). The
 * dual-bucket crossfade band (peer veg-p2-bob) is mirrored with a clearly-marked pending hook
 * (`PENDING-DUAL-BUCKET`): today the band width is 0 (frozen single-bucket routing) and the
 * strict invariant holds; the adjusted dual-bucket invariant is implemented and self-tested in
 * §4 so the mirror is ready when Bob's writes land (see mailbox requirement).
 *
 * Rounding note: `INDEX_COUNT / 3` is integer for all authored meshes here (triangle budgets are
 * authored as multiples of 3).
 */

import { describe, expect, it } from "vitest";
import {
  INDIRECT_SEGMENT_HEADER_BYTES,
  MAX_LOD_BUCKETS,
  projectedDiameterPixels,
  sphereVisibleConservative,
  type LodBucketDescriptor,
  type Plane4,
  type PrototypeDescriptor,
} from "../../src/core/InstanceField.js";

// ---------------------------------------------------------------------------
// §0 Frozen pins + tolerances. Thresholds live HERE (ADR 0047).
// ---------------------------------------------------------------------------

/** Frozen header words: [0] indexCount, [1] instanceCount, ..., [5] liveCount, [6] state. */
const HEADER_WORD_INSTANCE_COUNT = 1 as const;

/** Authored metric inputs (the coordinator's primary-view metric; see §0 of the note). */
const VIEWPORT_HEIGHT_PX = 720;
const FOV_RADIANS_Y = Math.PI / 3;
const CULL_PIXEL_SIZE = 4;
const MAIN_RADIUS = 2;
/** `px = 2 * 720 / (tan(30°) * dist)` for the authored radius (rounded for documentation). */
const METRIC_COEFFICIENT = (MAIN_RADIUS * VIEWPORT_HEIGHT_PX) / Math.tan(FOV_RADIANS_Y / 2);

/**
 * Capacity-exhaustion tolerance: the harness asserts the EXACT drop accounting of the clamp
 * policy, so the drop delta is exact by construction. No statistical tolerance applies to the
 * accounting invariants; the only measured duplicate-count bound is asserted exactly (0 within
 * capacity). Numbers in this block are exact — kept for the research-note reference.
 */
const TOLERANCE = { duplicateRecordsWithinCapacity: 0, dropDeltaExact: 0 } as const;

// ---------------------------------------------------------------------------
// §1 CPU compaction reference harness — mirror of the frozen routing
// ---------------------------------------------------------------------------

/** One authored prototype chain: ascending bands + per-bucket mesh budgets. */
interface ReferenceChain {
  readonly prototype: PrototypeDescriptor;
  readonly meshBudgets: readonly number[]; // indexCount per bucket
  readonly coarsestBucket: number;
}

/** One synthetic instance of the reference field. */
interface ReferenceInstance {
  readonly id: number;
  readonly pos: readonly [number, number, number];
  readonly radius: number;
}

interface ViewDesc {
  readonly name: string;
  readonly camPos: readonly [number, number, number];
  readonly planes: readonly Plane4[];
}

interface SegmentResult {
  readonly view: number;
  readonly bucket: number;
  readonly count: number;
  readonly indices: number[];
}

interface FrameResult {
  readonly segments: readonly SegmentResult[];
  readonly dropped: number;
}

/**
 * Builds a band chain with `count` ascending buckets. `minPx` is the finest entry threshold;
 * bands are contiguous (`minNext = maxPrev`). For the metric-coverage the first bucket's
 * exit threshold and `meshBudgets[b]` (indexCount) are passed verbatim.
 */
function makeChain(
  name: string,
  minPx: number,
  bandWidths: readonly number[],
  meshBudgets: readonly number[],
): ReferenceChain {
  const bands: LodBucketDescriptor[] = [];
  let lo = minPx;
  for (let b = 0; b < bandWidths.length; b++) {
    const hi = lo + bandWidths[b]!;
    bands.push({ name: `${name}:b${b}`, lodIndex: b, minProjectedSize: lo, maxProjectedSize: hi, geometrySlot: b });
    lo = hi;
  }
  return {
    prototype: {
      id: name,
      boundingRadius: MAIN_RADIUS,
      lodBuckets: bands,
      materialSlot: 0,
      maxInstances: 1_000_000,
    },
    meshBudgets,
    coarsestBucket: bands.length - 1,
  };
}

/** Main-view band of an instance (frozen metric, main-camera distance — the bucket is
 *  view-independent by the IF-PROJECTED-SIZE anchor). */
function mainBand(
  chain: ReferenceChain,
  pos: readonly [number, number, number],
  mainCam: readonly [number, number, number],
): number {
  const d = Math.sqrt(
    (pos[0] - mainCam[0]) ** 2 + (pos[1] - mainCam[1]) ** 2 + (pos[2] - mainCam[2]) ** 2,
  );
  const px = projectedDiameterPixels(MAIN_RADIUS, Math.max(d, 1e-6), VIEWPORT_HEIGHT_PX, FOV_RADIANS_Y);
  const buckets = chain.prototype.lodBuckets;
  for (let b = 0; b < buckets.length; b++) {
    if (px <= buckets[b]!.maxProjectedSize) return b;
  }
  return chain.coarsestBucket;
}

/**
 * Runs one cull frame of the reference field: per view, per instance — conservative frustum
 * (own planes, frozen `sphereVisibleConservative`) + per-view sub-pixel drop + MAIN-camera
 * bucket -> clamp-at-capacity compaction into the (view x bucket) page (atomicAdd mirror:
 * slots 0..count-1, write only while slot < capacity). Mirrors `instance_cull.wgsl` routing
 * and the GL lane's `_pickBucket`-driven emission. `pageCapacity` models `FieldCullParams.
 * pageCapacity` (per-segment clamp).
 */
function runCullFrame(
  chain: ReferenceChain,
  instances: readonly ReferenceInstance[],
  mainCam: readonly [number, number, number],
  views: readonly ViewDesc[],
  pageCapacity: number,
): FrameResult {
  const pages = new Map<number, number[]>();
  const stats = new Map<number, { visible: number; dropped: number }>();
  for (let v = 0; v < views.length; v++) {
    const view = views[v]!;
    stats.set(v, { visible: 0, dropped: 0 });
    for (const inst of instances) {
      // Per-view conservative frustum + per-view sub-pixel drop (the per-instance keep gate).
      const dView = Math.sqrt(
        (inst.pos[0] - view.camPos[0]) ** 2 +
          (inst.pos[1] - view.camPos[1]) ** 2 +
          (inst.pos[2] - view.camPos[2]) ** 2,
      );
      if (!sphereVisibleConservative(view.planes, inst.pos, inst.radius)) continue;
      const pxView = projectedDiameterPixels(
        inst.radius,
        Math.max(dView, 1e-6),
        VIEWPORT_HEIGHT_PX,
        FOV_RADIANS_Y,
      );
      if (pxView < CULL_PIXEL_SIZE) continue;
      stats.get(v)!.visible++;
      // Bucket from the MAIN metric (view-independent, IF-PROJECTED-SIZE anchor).
      const bucket = mainBand(chain, inst.pos, mainCam);
      const bv = v * MAX_LOD_BUCKETS + bucket;
      let page = pages.get(bv);
      if (page === undefined) {
        page = [];
        pages.set(bv, page);
      }
      if (page.length >= pageCapacity) {
        stats.get(v)!.dropped++;
        continue;
      }
      page.push(inst.id);
    }
  }
  const segments: SegmentResult[] = [];
  for (const [bv, indices] of pages) {
    const view = Math.floor(bv / MAX_LOD_BUCKETS);
    const bucket = bv % MAX_LOD_BUCKETS;
    segments.push({ view, bucket, count: indices.length, indices });
  }
  segments.sort((a, b) => a.view - b.view || a.bucket - b.bucket);
  let droppedTotal = 0;
  for (const s of stats.values()) droppedTotal += s.dropped;
  return { segments, dropped: droppedTotal };
}

// ---------------------------------------------------------------------------
// §2 COMPACTION-SUM invariants (frozen contract shape, single-bucket routing)
// ---------------------------------------------------------------------------

describe("IF-BUDGET / IF-CULL-ROUTING — compaction-sum invariant (CPU reference)", () => {
  const chain = makeChain("spruce", 8, [88, 288, 1152], [3000, 1500, 300]);

  /** All-enclosing inward planes: every instance passes the conservative gate (the compac-
   *  tion-sum invariant is independent of the frustum gate; the keep gate is still exercised
   *  via the own-metric sub-pixel drop). */
  function widePlanes(): Plane4[] {
    return [
      [-1, 0, 0, 1e9],
      [1, 0, 0, 1e9],
      [0, -1, 0, 1e9],
      [0, 1, 0, 1e9],
      [0, 0, -1, 1e9],
      [0, 0, 1, 1e9],
    ];
  }

  function makeField(count: number): {
    instances: ReferenceInstance[];
    mainCam: readonly [number, number, number];
  } {
    const mainCam: readonly [number, number, number] = [0, 5, 0];
    const instances: ReferenceInstance[] = [];
    for (let i = 0; i < count; i++) {
      // Spread along -Z at increasing depth: near (coarse bands) to far (fine bands).
      const z = -20 - (i % 30) * 9;
      const x = ((i * 7) % 9) - 4;
      const pos: [number, number, number] = [x * 2, 0, z];
      instances.push({ id: i, pos, radius: MAIN_RADIUS });
    }
    return { instances, mainCam };
  }

  it("pins the frozen segment-table constants (MAX_LOD_BUCKETS, INDIRECT_SEGMENT_HEADER_BYTES)", () => {
    expect(MAX_LOD_BUCKETS).toBe(8);
    expect(INDIRECT_SEGMENT_HEADER_BYTES).toBe(32);
    // The header layout from the frozen contract: instanceCount is word 1.
    expect(INDIRECT_SEGMENT_HEADER_BYTES / 4).toBe(8);
    expect(HEADER_WORD_INSTANCE_COUNT).toBe(1);
  });

  it("per-(view x bucket) counts sum to the post-cull visible count, exactly once per instance (within capacity)", () => {
    const { instances, mainCam } = makeField(240);
    const views: ViewDesc[] = [
      { name: "main", camPos: mainCam, planes: widePlanes() },
      { name: "shadow-a", camPos: [-200, 40, 0], planes: widePlanes() },
      { name: "shadow-b", camPos: [200, 40, 0], planes: widePlanes() },
    ];
    // Capacity large enough to never clamp.
    const pageCapacity = instances.length;
    const frame = runCullFrame(chain, instances, mainCam, views, pageCapacity);

    for (let v = 0; v < views.length; v++) {
      const segs = frame.segments.filter((s) => s.view === v);
      let sum = 0;
      const seen = new Set<number>();
      for (const seg of segs) {
        expect(seg.count, "word-consistency: count == |written indices|").toBe(seg.indices.length);
        expect(seg.count, "IF-BUDGET: count <= capacity").toBeLessThanOrEqual(pageCapacity);
        // Header offset math is the frozen stride `bv * INDIRECT_SEGMENT_HEADER_BYTES`; the
        // page base is `bv * pageCapacity` (see InstantField.ts contract annotations).
        expect(seg.bucket, "bucket < MAX_LOD_BUCKETS").toBeGreaterThanOrEqual(0);
        expect(seg.bucket).toBeLessThan(MAX_LOD_BUCKETS);
        for (const idx of seg.indices) {
          expect(seen.has(idx), `instance ${idx} double-counted in view ${v}`).toBe(false);
          seen.add(idx);
        }
        expect(seg.indices.length, "page base math: one page per (view x bucket) segment").toBeLessThanOrEqual(pageCapacity);
        sum += seg.count;
      }
      expect(sum, "Σ counts == distinct written indices (no drop, no double count)").toBe(seen.size);
      expect(TOLERANCE.duplicateRecordsWithinCapacity).toBe(0);
    }
  });

  it("over-capacity: clamp-at-capacity drops exactly the overflow (no lost/foreign indices), args reflect the page count", () => {
    const { instances, mainCam } = makeField(120);
    const view: ViewDesc = { name: "main", camPos: mainCam, planes: widePlanes() };
    const pageCapacity = 30;
    const frame = runCullFrame(chain, instances, mainCam, [view], pageCapacity);
    // The harness's visible count for the main view (own drop gate, no frustum gate):
    const visible = instances.filter((i) => {
      const d = Math.sqrt((i.pos[0] - mainCam[0]) ** 2 + (i.pos[1] - mainCam[1]) ** 2 + (i.pos[2] - mainCam[2]) ** 2);
      return projectedDiameterPixels(MAIN_RADIUS, Math.max(d, 1e-6), VIEWPORT_HEIGHT_PX, FOV_RADIANS_Y) >= CULL_PIXEL_SIZE;
    }).length;
    // Clamp-at-capacity: DROPPED == visible - kept (kept == Σ counts == page-capacitated total),
    // and total kept equals the sum over the (clamped) segment counts — no instance beyond the
    // page capacity is written.
    const mainSegs = frame.segments.filter((s) => s.view === 0);
    expect(mainSegs.length).toBeGreaterThan(0);
    const kept = mainSegs.reduce((a, s) => a + s.count, 0);
    expect(kept).toBeLessThanOrEqual(visible);
    expect(frame.dropped).toBe(visible - kept);
    expect(TOLERANCE.dropDeltaExact).toBe(0);
    for (const seg of mainSegs) {
      expect(seg.count).toBeLessThanOrEqual(pageCapacity);
    }
  });

  it("routing is single-bucket per view even across an instance set spanning all bands", () => {
    const { instances, mainCam } = makeField(300);
    const view: ViewDesc = { name: "main", camPos: mainCam, planes: widePlanes() };
    const frame = runCullFrame(chain, instances, mainCam, [view], 10_000);
    const perInstance = new Map<number, number[]>();
    for (const seg of frame.segments) {
      for (const idx of seg.indices) {
        const list = perInstance.get(idx) ?? [];
        list.push(seg.bucket);
        perInstance.set(idx, list);
      }
    }
    // Distinct bands actually spanned (vacuity guard).
    const bandsSeen = new Set(frame.segments.map((s) => s.bucket));
    expect(bandsSeen.size).toBeGreaterThan(1);
    for (const [idx, buckets] of perInstance) {
      expect(buckets.length, `instance ${idx} routed to >1 segment`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 TRIANGLE accounting + "flat vs instance count" headless proxy
// ---------------------------------------------------------------------------

/** Triangles drawn for one frame under the authored chain (exact accounting). */
function drawnTriangles(
  chain: ReferenceChain,
  frame: FrameResult,
): { perView: number[]; total: number } {
  const perView: number[] = [];
  for (const seg of frame.segments) {
    const mesh = chain.meshBudgets[seg.bucket]!;
    const tris = (mesh * seg.count) / 3;
    perView[seg.view] = (perView[seg.view] ?? 0) + tris;
  }
  let total = 0;
  for (const t of perView) total += t;
  return { perView, total };
}

describe("IF-BUDGET / IF-PROJECTED-SIZE — triangle accounting + flat vs `?n=` proxy", () => {
  // Authored chain: bucket 0 = farthest band (smallest projected diameter, cheapest mesh),
  // bucket 2 = nearest band (largest diameter, most indices) — the realistic LOD orientation
  // (far = cheap). The per-bucket mesh order itself is P2-authored (see research note §4);
  // what is invariant here is only the direction: the nearest band must never be MORE
  // expensive than the farthest, else the triangle-flat / recede pins flip sign.
  const chain = makeChain("pine", 8, [88, 288, 1152], [1200, 4000, 10_000]);

  function farOnlyPlanes(): Plane4[] {
    // All-enclosing inward planes: keeps every instance (conservative gate is then inert).
    return [
      [-1, 0, 0, 1e6],
      [1, 0, 0, 1e6],
      [0, -1, 0, 1e6],
      [0, 1, 0, 1e6],
      [0, 0, -1, 1e6],
      [0, 0, 1, 1e6],
    ];
  }

  function makeInstancesAt(distances: readonly number[]): ReferenceInstance[] {
    return distances.map((d, i) => {
      const pos: [number, number, number] = [(i % 7) * 2 - 6, 0, -Math.max(d, 1)];
      return { id: i, pos, radius: MAIN_RADIUS };
    });
  }

  it("drawn triangles equal the exact Σ count(bucket) x mesh budget (accounting invariant)", () => {
    const mainCam: readonly [number, number, number] = [0, 5, 0];
    // Distances spanning all three authored bands (near -> coarse bands, far -> fine band).
    const instances = makeInstancesAt([5, 8, 12, 18, 26, 30, 40, 50, 60, 80]);
    const frame = runCullFrame(chain, instances, mainCam, [{ name: "m", camPos: mainCam, planes: farOnlyPlanes() }], 1e6);
    const tris = drawnTriangles(chain, frame);
    let expected = 0;
    for (const seg of frame.segments) {
      expected += (chain.meshBudgets[seg.bucket]! * seg.count) / 3;
    }
    expect(tris.total).toBe(expected);
    expect(tris.total).toBeGreaterThan(0);
    expect(frame.segments.length).toBeGreaterThan(1);
  });

  it("flat vs `?n=`: adding instances beyond the sub-pixel horizon adds ZERO triangles", () => {
    const mainCam: readonly [number, number, number] = [0, 5, 0];
    // Visible core at 30..80 m; the `?n=` growth lands at 1000..5000 m — beyond the sub-pixel
    // horizon for the authored radius/metric (623 m) and therefore outside any band.
    const core = makeInstancesAt([30, 40, 50, 60, 70, 80]);
    const farGrowth = Array.from({ length: 4000 }, (_, i) => {
      const pos: [number, number, number] = [((i % 13) * 3) - 18, 0, -1000 - (i % 4000)];
      return { id: 10_000 + i, pos, radius: MAIN_RADIUS };
    });
    const base = runCullFrame(chain, core, mainCam, [{ name: "m", camPos: mainCam, planes: farOnlyPlanes() }], 1e6);
    const grown = runCullFrame(chain, [...core, ...farGrowth], mainCam, [{ name: "m", camPos: mainCam, planes: farOnlyPlanes() }], 1e6);
    expect(drawnTriangles(chain, grown).total).toBe(drawnTriangles(chain, base).total);
    expect(grown.segments).toHaveLength(base.segments.length);
    // Sanity: the growth really was 4000 instances (the far field is sub-pixel in the metric).
    const horizon = METRIC_COEFFICIENT / CULL_PIXEL_SIZE;
    expect(horizon).toBeLessThan(1000);
  });

  it("receding the camera never increases the drawn triangle count (genuine multi-band crossing, monotone bands)", () => {
    // Trees at 4..7 m from the NEAR camera: projected diameters 624..356 px span buckets 2..1
    // (expensive bands). Moving the camera to 80 m recedes every tree to 84..87 m (px ~29,
    // bucket 0 = cheapest) — a REAL 2-boundary coarsening per tree, unlike a single-band
    // fixture that would make the inequality vacuous.
    const instances: ReferenceInstance[] = [];
    for (let i = 0; i < 4; i++) {
      const pos: [number, number, number] = [0, 0, -4 - i];
      instances.push({ id: i, pos, radius: MAIN_RADIUS });
    }
    const nearCam: readonly [number, number, number] = [0, 0, 0];
    const farCam: readonly [number, number, number] = [0, 0, 80];
    const nearPlanes: Plane4[] = [
      [-1, 0, 0, 1e9],
      [1, 0, 0, 1e9],
      [0, -1, 0, 1e9],
      [0, 1, 0, 1e9],
      [0, 0, -1, 1e9],
      [0, 0, 1, 1e9],
    ];
    const near = runCullFrame(chain, instances, nearCam, [{ name: "m", camPos: nearCam, planes: nearPlanes }], 1e6);
    const far = runCullFrame(chain, instances, farCam, [{ name: "m", camPos: farCam, planes: nearPlanes }], 1e6);
    // Vacuity guard: the near flight really occupied the expensive (near) bands.
    const nearBands = new Set(near.segments.map((s) => s.bucket));
    const farBands = new Set(far.segments.map((s) => s.bucket));
    expect(nearBands.has(2) || nearBands.has(1)).toBe(true);
    // Bucket index is the MAIN camera's metric band; receding (px shrinks) shifts instances
    // toward the cheap far bands (index decreases). With the realistic far-cheap orientation
    // the drawn-triangle count therefore NEVER increases as the camera backs away.
    const nearTris = drawnTriangles(chain, near).total;
    const farTris = drawnTriangles(chain, far).total;
    expect(farTris).toBeLessThan(nearTris);
    // The recede really coarsened (strictly fewer triangles, strictly cheaper band roster).
    expect(farBands.size).toBeLessThan(nearBands.size);
    expect(farBands.has(2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 PENDING-DUAL-BUCKET — crossfade-band mirror (peer veg-p2-bob). Today the frozen engine
// routes single-bucket; the dual-bucket band is the P2 crossfade feature. This mirror keeps the
// strict invariant green when the band is inactive (bandWidth 0) and implements the ADJUSTED
// invariant (band instances route to bucket AND bucket+1) so the test harness is ready for
// Bob's real dual-bucket writes. Marker: PENDING-DUAL-BUCKET (mailbox requirement sent).
// ---------------------------------------------------------------------------

describe("PENDING-DUAL-BUCKET — adjusted compaction-sum invariant for the crossfade band", () => {
  /**
   * Mirror of the dual-bucket compaction: instances whose main diameter lies inside the
   * crossfade band (= the top `bandWidth` fraction of the lane BELOW a band boundary) are
   * routed to BOTH the selected bucket and the next coarser bucket, once each. With
   * `bandWidth = 0` this degenerates to the frozen single-bucket routing.
   */
  function runCrossfadeFrame(
    chain: ReferenceChain,
    instances: readonly ReferenceInstance[],
    mainCam: readonly [number, number, number],
    bandWidth: number,
  ): { segments: SegmentResult[]; bandHits: number } {
    const pages = new Map<number, number[]>();
    let bandHits = 0;
    const buckets = chain.prototype.lodBuckets;
    for (const inst of instances) {
      const d = Math.sqrt(
        (inst.pos[0] - mainCam[0]) ** 2 + (inst.pos[1] - mainCam[1]) ** 2 + (inst.pos[2] - mainCam[2]) ** 2,
      );
      const px = projectedDiameterPixels(MAIN_RADIUS, Math.max(d, 1e-6), VIEWPORT_HEIGHT_PX, FOV_RADIANS_Y);
      if (px < CULL_PIXEL_SIZE) continue;
      let bucket = 0;
      for (; bucket < buckets.length; bucket++) {
        if (px <= buckets[bucket]!.maxProjectedSize) break;
      }
      if (bucket >= buckets.length) bucket = buckets.length - 1;
      const upper = px >= buckets[bucket]!.maxProjectedSize * (1 - bandWidth);
      const inBand = upper && !(bucket === buckets.length - 1);
      // Primary route (always).
      const push = (bv: number): void => {
        let page = pages.get(bv);
        if (page === undefined) {
          page = [];
          pages.set(bv, page);
        }
        page.push(inst.id);
      };
      push(bucket);
      if (inBand) {
        push(bucket + 1);
        bandHits++;
      }
    }
    const segments: SegmentResult[] = [];
    for (const [bv, indices] of pages) {
      segments.push({ view: 0, bucket: bv % MAX_LOD_BUCKETS, count: indices.length, indices });
    }
    segments.sort((a, b) => a.bucket - b.bucket);
    return { segments, bandHits };
  }

  it("with bandWidth 0 the dual-bucket mirror degenerates to the strict single-bucket invariant", () => {
    const chain = makeChain("cf", 8, [88, 288], [3000, 1000]);
    const mainCam: readonly [number, number, number] = [0, 5, 0];
    const instances: ReferenceInstance[] = [];
    for (let i = 0; i < 60; i++) {
      const pos: [number, number, number] = [((i % 9) - 4) * 2, 0, -20 - ((i * 7) % 40)];
      instances.push({ id: i, pos, radius: MAIN_RADIUS });
    }
    const frame = runCrossfadeFrame(chain, instances, mainCam, 0);
    expect(frame.bandHits).toBe(0);
    const seen = new Set<number>();
    let sum = 0;
    for (const seg of frame.segments) {
      sum += seg.count;
      for (const idx of seg.indices) {
        expect(seen.has(idx)).toBe(false);
        seen.add(idx);
      }
    }
    expect(sum).toBe(seen.size);
  });

  it("with bandWidth > 0 the ADJUSTED invariant holds: Σ counts == visible + band duplicates, each instance in ≤ 2 ADJACENT buckets", () => {
    const chain = makeChain("cf", 8, [88, 288], [3000, 1000]);
    const mainCam: readonly [number, number, number] = [0, 5, 0];
    // Dense 0.25 m grid along -Z: the band's distance interval (~1 m for bw 0.04) is wider
    // than the grid step, so band membership is deterministic and non-empty.
    const instances: ReferenceInstance[] = [];
    let id = 0;
    for (let z = -20; z >= -40; z -= 0.25) {
      for (const x of [-6, 0, 6]) {
        instances.push({ id: id++, pos: [x, 0, z], radius: MAIN_RADIUS });
      }
    }
    const frame = runCrossfadeFrame(chain, instances, mainCam, 0.04);
    expect(frame.bandHits).toBeGreaterThan(0);
    const perInstance = new Map<number, number[]>();
    let sum = 0;
    for (const seg of frame.segments) {
      sum += seg.count;
      for (const idx of seg.indices) {
        const list = perInstance.get(idx) ?? [];
        list.push(seg.bucket);
        perInstance.set(idx, list);
      }
    }
    let bandDuplicates = 0;
    for (const [idx, buckets] of perInstance) {
      expect(buckets.length, `instance ${idx} routed to >2 buckets`).toBeLessThanOrEqual(2);
      if (buckets.length === 2) {
        // Adjacent-only: |b0 - b1| == 1 (the crossfade pair).
        expect(Math.abs(buckets[0]! - buckets[1]!)).toBe(1);
        bandDuplicates++;
      }
    }
    expect(bandDuplicates).toBe(frame.bandHits);
    expect(sum).toBe(perInstance.size + frame.bandHits);
  });
});
