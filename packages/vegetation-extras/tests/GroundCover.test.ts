// Ground-cover ring tests: pin the P1b source-B guarantees the showcase relies on — a blade's
// world position/yaw/scale is a pure function of (tile, slot), NOT of the camera position (no
// swimming under the camera), and the generator is deterministic + capacity-bounded + zero-GC.
//
// WP-D1 addition (audit-remediation): density-falloff, per-tile-per-blade occupancy and
// camera-clear invariants the showcase's ring fade and personal-space cut depend on:
//   @invariant IF-DENSITY-FALLOFF: blade density is monotonically non-increasing with distance —
//     full density holds inside `fullDensityRadius` (plus a smoothstep shoulder), and the outer
//     ring edge decays to `minDensity`, never back to full density. The pre-fix code INVERTED the
//     smoothstep (density dropped to `minDensity` at `fullDensityRadius + ε` and returned to 1.0
//     at the edge) and over-spawned non-square tiles by accepting ~100% of `slotsPerTile`.
//   @invariant IF-PER-BLADE-CLEAR: `cameraClearRadius` drops INDIVIDUAL blades inside the clear
//     disc, even when the camera sits on a tile corner — never a whole-tile pop (pre-fix code
//     only culled tiles whose CENTER lay in the disc, so blades within 2 m of a corner survived).
import { describe, expect, it } from "vitest";
import {
  unpackInstancePose,
  type InstancePose,
} from "@small-world-machine/engine/core/InstanceField.js";
import { GroundCover } from "../src/groundcover/GroundCover.js";

function tileRecords(
  records: Float32Array,
  count: number,
  tileX: number,
  tileZ: number,
  cell: number,
): { x: number; y: number; z: number; pose: number }[] {
  const loX = tileX * cell;
  const loZ = tileZ * cell;
  const out: { x: number; y: number; z: number; pose: number }[] = [];
  for (let i = 0; i < count; i++) {
    const x = records[i * 4]!;
    const z = records[i * 4 + 2]!;
    if (x >= loX && x < loX + cell && z >= loZ && z < loZ + cell) {
      out.push({ x, y: records[i * 4 + 1]!, z, pose: records[i * 4 + 3]! });
    }
  }
  return out;
}

describe("GroundCover", () => {
  it("is deterministic: identical ring centres yield byte-identical records", () => {
    const cover = new GroundCover({ radius: 40, cellSize: 5, bladesPerTile: 8, seed: 7 });
    const n1 = cover.update(0, 0);
    const first = new Float32Array(cover.records);
    const n2 = cover.update(0, 0);
    expect(n2).toBe(n1);
    expect(Array.from(cover.records.subarray(0, n1 * 4))).toEqual(
      Array.from(first.subarray(0, n1 * 4)),
    );
  });

  it("keeps blade positions glued to the world: same tiles, different ring centres, same blades", () => {
    const cell = 5;
    const cover = new GroundCover({ radius: 60, cellSize: cell, bladesPerTile: 8, seed: 13 });
    // Tile (1, -2) is well inside both rings (within full density) from centres (0,0) and (10,8).
    const n1 = cover.update(0, 0);
    const a = tileRecords(cover.records, n1, 1, -2, cell);
    const n2 = cover.update(10, 8);
    const b = tileRecords(cover.records, n2, 1, -2, cell);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    const sortKey = (e: { x: number; z: number }): string => `${e.x.toFixed(6)},${e.z.toFixed(6)}`;
    const aSorted = [...a].sort((p, q) => (sortKey(p) < sortKey(q) ? -1 : 1));
    const bSorted = [...b].sort((p, q) => (sortKey(p) < sortKey(q) ? -1 : 1));
    for (let i = 0; i < aSorted.length; i++) {
      expect(aSorted[i]!.x).toBeCloseTo(bSorted[i]!.x, 6);
      expect(aSorted[i]!.z).toBeCloseTo(bSorted[i]!.z, 6);
      expect(aSorted[i]!.pose).toBe(bSorted[i]!.pose);
    }
  });

  it("packs valid poses (yaw in [0, 2π), scale within the authored range)", () => {
    const cover = new GroundCover({
      radius: 20,
      cellSize: 4,
      bladesPerTile: 8,
      seed: 3,
      scaleRange: [0.7, 1.8],
    });
    const n = cover.update(0, 0);
    const poseOut: InstancePose = { yawRadians: 0, uniformScale: 0 };
    // Decode exactly like the GPU: `bitcast<u32>(record.w)` -> read the BITS of the f32 slot.
    const bits = new Uint32Array(cover.records.buffer);
    for (let i = 0; i < n; i++) {
      const packed = bits[i * 4 + 3]!;
      unpackInstancePose(packed, poseOut);
      expect(poseOut.yawRadians).toBeGreaterThanOrEqual(0);
      expect(poseOut.yawRadians).toBeLessThan(Math.PI * 2);
      // The frozen packing quantizes scale to 1/256 LSBs — allow the representable band.
      expect(poseOut.uniformScale).toBeGreaterThanOrEqual(0.7 - 0.001);
      expect(poseOut.uniformScale).toBeLessThanOrEqual(1.8 + 0.001);
    }
  });

  it("never exceeds capacity and honours the camera-clear disc", () => {
    const cover = new GroundCover({
      radius: 30,
      cellSize: 5,
      bladesPerTile: 20,
      seed: 5,
      cameraClearRadius: 4,
    });
    const n = cover.update(0, 0);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(cover.capacity);
    for (let i = 0; i < n; i++) {
      const x = cover.records[i * 4]!;
      const z = cover.records[i * 4 + 2]!;
      const d2 = x * x + z * z;
      expect(d2).toBeGreaterThanOrEqual(4 * 4);
    }
  });
});

// ---------------------------------------------------------------------------
// WP-D1: density-falloff + per-blade camera-clear invariants (audit-remediation).
// Calibrated on the POST-FIX math via an independent simulation (seed 42, radius 140,
// fullDensityRadius 70): fixed-code means are deterministic; the thresholds below separate
// fixed (pass) from pre-fix (fail) by wide margins — see the failure annotations.
// ---------------------------------------------------------------------------

/** Groups emitted blades by their AUTHORING tile (axis-aligned half-open cells). */
function perTileCounts(
  cover: GroundCover,
  count: number,
): Map<string, { tx: number; tz: number; blades: number }> {
  const cell = cover.cellSize;
  const out = new Map<string, { tx: number; tz: number; blades: number }>();
  for (let i = 0; i < count; i++) {
    const px = cover.records[i * 4]!;
    const pz = cover.records[i * 4 + 2]!;
    const tx = Math.floor(px / cell);
    const tz = Math.floor(pz / cell);
    const key = `${tx},${tz}`;
    const entry = out.get(key);
    if (entry) {
      entry.blades++;
    } else {
      out.set(key, { tx, tz, blades: 1 });
    }
  }
  return out;
}

function tileCenterDist(
  tile: { tx: number; tz: number },
  cell: number,
  camX: number,
  camZ: number,
): number {
  const cx = (tile.tx + 0.5) * cell - camX;
  const cz = (tile.tz + 0.5) * cell - camZ;
  return Math.sqrt(cx * cx + cz * cz);
}

function meanCounts(entries: { blades: number }[]): number {
  if (entries.length === 0) return Number.NaN;
  let sum = 0;
  for (const e of entries) sum += e.blades;
  return sum / entries.length;
}

describe("WP-D1 GroundCover density falloff + non-square occupancy (IF-DENSITY-FALLOFF)", () => {
  it("keeps near-full density across the fullDensityRadius boundary (no 70% drop), fixed configuration", () => {
    // Fixture (calibrated): bladesPerTile=12 → slotsPerTile=16 (non-square), fullDensity=70,
    // radius=140. Camera at the ring centre (0,0), cameraClearRadius=0.
    const cover = new GroundCover({
      radius: 140,
      cellSize: 5,
      bladesPerTile: 12,
      seed: 42,
      fullDensityRadius: 70,
      cameraClearRadius: 0,
    });
    const n = cover.update(0, 0);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(cover.capacity);
    const tiles = [...perTileCounts(cover, n).values()];
    // Bands by TILE-CENTRE distance (thinning is evaluated per tile, never per blade).
    const inner = tiles.filter((t) => tileCenterDist(t, cover.cellSize, 0, 0) <= 60);
    const boundary = tiles.filter((t) => {
      const d = tileCenterDist(t, cover.cellSize, 0, 0);
      return d > 70 && d <= 73;
    });
    const edge = tiles.filter((t) => tileCenterDist(t, cover.cellSize, 0, 0) >= 135);
    // Honesty guards: each band must actually be exercised, else the assertion is vacuous.
    expect(inner.length, "inner band populated").toBeGreaterThan(100);
    expect(boundary.length, "post-fullDensity band populated").toBeGreaterThan(0);
    expect(edge.length, "outer-edge band populated").toBeGreaterThan(0);

    const innerMean = meanCounts(inner);
    const boundaryMean = meanCounts(boundary);
    const edgeMean = meanCounts(edge);

    // Non-square bladesPerTile=12: inner (full-density) ring mean per tile in [11, 13].
    // Pre-fix code accepted ~100% of the 16 slots → mean ≈ 14.86 (fails below).
    // @invariant IF-DENSITY-FALLOFF: occupancy honours bladesPerTile, never slotsPerTile.
    expect(
      innerMean,
      `inner-ring mean per tile in [11,13] (pre-fix ≈ 14.86, got ${innerMean})`,
    ).toBeGreaterThanOrEqual(11.0);
    expect(innerMean).toBeLessThanOrEqual(13.0);

    // Just past the full-density radius the density must still be ≥ 95% of the inner density.
    // Pre-fix code dropped to minDensity=0.3 here (ratio ≈ 0.34, fails below).
    // @invariant IF-DENSITY-FALLOFF: smoothstep thins AWAY from the boundary, not at it.
    expect(
      boundaryMean,
      `boundary band ≥ 95% of inner density (pre-fix ≈ 0.34·inner, got ${boundaryMean})`,
    ).toBeGreaterThanOrEqual(0.95 * innerMean);

    // The outer ring edge must approach minDensity (≈0.3), not return to full density 1.0.
    // Pre-fix code re-approached 1.0 here (ratio ≈ 1.0, fails below).
    // @invariant IF-DENSITY-FALLOFF: edge decays to the authored thinning floor.
    expect(
      edgeMean,
      `edge band ≤ 60% of inner density (pre-fix ≈ 1.0·inner, got ${edgeMean})`,
    ).toBeLessThanOrEqual(0.6 * innerMean);
    expect(
      edgeMean,
      "edge band keeps a non-degenerate density floor (≥ 15% of inner)",
    ).toBeGreaterThanOrEqual(0.15 * innerMean);
  });
});

describe("WP-D1 GroundCover per-blade camera-clear at a tile corner (IF-PER-BLADE-CLEAR)", () => {
  it("drops individual blades inside cameraClearRadius even when the camera sits on tile corner (0,0)", () => {
    const base = { radius: 40, cellSize: 5, bladesPerTile: 12, seed: 7, fullDensityRadius: 20 };
    // Baseline WITHOUT clear: proves blades really DO land inside the 2 m disc around the
    // camera-at-corner (0,0) — otherwise the clear assertion would be vacuous.
    const uncut = new GroundCover({ ...base, cameraClearRadius: 0 });
    const uncutN = uncut.update(0, 0);
    let insideBaseline = 0;
    for (let i = 0; i < uncutN; i++) {
      const x = uncut.records[i * 4]!;
      const z = uncut.records[i * 4 + 2]!;
      if (x * x + z * z < 4) insideBaseline++;
    }
    expect(
      insideBaseline,
      "fixture must spawn blades within 2 m of the corner camera",
    ).toBeGreaterThan(0);

    // With the clear active, NOT ONE blade may remain inside the 2 m disc (per-blade drop).
    const clear = new GroundCover({ ...base, cameraClearRadius: 2 });
    const n = clear.update(0, 0);
    expect(n).toBeGreaterThan(0);
    let commitsInside = 0;
    let survivorsNear = 0;
    for (let i = 0; i < n; i++) {
      const x = clear.records[i * 4]!;
      const z = clear.records[i * 4 + 2]!;
      const d2 = x * x + z * z;
      if (d2 < 4) commitsInside++;
      if (d2 >= 4 && d2 < 9) survivorsNear++;
    }
    // @invariant IF-PER-BLADE-CLEAR: every blade within the clear disc is dropped (a whole-tile
    // pop at the corner fails this; pre-fix code emitted 6 blades inside 2 m here).
    expect(commitsInside, "no blade survives inside the 2 m clear disc").toBe(0);
    // Individual-blade semantics: blades just outside the disc must SURVIVE (per-blade drop,
    // not a conservative whole-tile wipe of the corner tile).
    expect(
      survivorsNear,
      "blades in the [2,3) m annulus survive (per-blade, not per-tile)",
    ).toBeGreaterThan(0);
  });
  it("spreads blades over the whole tile (no collinear jitter channels)", () => {
    // Regression: a single-multiply hash finalizer made the x/z jitter LINEAR in the slot key, so
    // every blade of a tile sat on one diagonal (streaks). A 4x4 sub-grid of a dense tile must be
    // fully occupied and the x/z offsets must not be (near-)perfectly correlated.
    const cell = 8;
    const cover = new GroundCover({
      radius: 60,
      cellSize: cell,
      bladesPerTile: 200,
      seed: 11,
      cameraClearRadius: 0,
    });
    const n = cover.update(0, 0);
    const blades = tileRecords(cover.records, n, 2, 2, cell);
    expect(blades.length).toBeGreaterThan(100);
    const occupied = new Set<number>();
    let sx = 0,
      sz = 0,
      sxx = 0,
      szz = 0,
      sxz = 0;
    for (const b of blades) {
      const u = (b.x - 2 * cell) / cell;
      const v = (b.z - 2 * cell) / cell;
      occupied.add(Math.min(3, Math.floor(u * 4)) * 4 + Math.min(3, Math.floor(v * 4)));
      sx += u;
      sz += v;
      sxx += u * u;
      szz += v * v;
      sxz += u * v;
    }
    expect(occupied.size).toBe(16);
    const k = blades.length;
    const cov = sxz / k - (sx / k) * (sz / k);
    const corr = cov / Math.sqrt((sxx / k - (sx / k) ** 2) * (szz / k - (sz / k) ** 2));
    expect(Math.abs(corr)).toBeLessThan(0.3);
  });
});
