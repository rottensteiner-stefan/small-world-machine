// Ground-cover ring tests: pin the P1b source-B guarantees the showcase relies on — a blade's
// world position/yaw/scale is a pure function of (tile, slot), NOT of the camera position (no
// swimming under the camera), and the generator is deterministic + capacity-bounded + zero-GC.
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
    for (let i = 0; i < n; i++) {
      const packed = cover.records[i * 4 + 3]!;
      expect(Number.isFinite(packed)).toBe(true);
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
