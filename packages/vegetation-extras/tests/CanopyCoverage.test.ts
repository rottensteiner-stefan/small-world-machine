import { describe, expect, it } from "vitest";
import { packInstancePose } from "@small-world-machine/engine/core/InstanceField.js";
import { buildCanopyCoverage } from "../src/canopy/CanopyCoverage.js";

function records(trees: readonly [number, number, number][]): Float32Array {
  const out = new Float32Array(trees.length * 4);
  const bits = new Uint32Array(out.buffer);
  trees.forEach(([x, z, scale], i) => {
    out[i * 4] = x;
    out[i * 4 + 2] = z;
    bits[i * 4 + 3] = packInstancePose(0, scale);
  });
  return out;
}

function at(map: ReturnType<typeof buildCanopyCoverage>, x: number, z: number): number {
  const cx = Math.floor((x - map.originX) / map.cellSize);
  const cz = Math.floor((z - map.originZ) / map.cellSize);
  if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) return 0;
  return map.data[cz * map.width + cx]! / 255;
}

describe("buildCanopyCoverage", () => {
  it("covers a crown centre with its opacity and leaves open ground at zero", () => {
    const map = buildCanopyCoverage(records([[0, 0, 1]]), 1, { crownRadius: 4, crownOpacity: 0.8 });
    expect(at(map, 0.2, 0.2)).toBeCloseTo(0.8, 1);
    expect(at(map, 4.5, 0)).toBe(0);
    // Soft rim: inside the radius but past 70 % the coverage falls off.
    expect(at(map, 3.5, 0)).toBeLessThan(at(map, 0.2, 0.2));
    expect(map.width).toBeGreaterThanOrEqual(8);
  });

  it("saturates overlapping crowns (1 - prod(1 - a)) without exceeding 1", () => {
    const one = buildCanopyCoverage(records([[0, 0, 1]]), 1, { crownRadius: 4, crownOpacity: 0.6 });
    const two = buildCanopyCoverage(
      records([
        [0, 0, 1],
        [0.5, 0, 1],
      ]),
      2,
      { crownRadius: 4, crownOpacity: 0.6 },
    );
    expect(at(two, 0.2, 0.2)).toBeGreaterThan(at(one, 0.2, 0.2));
    expect(at(two, 0.2, 0.2)).toBeCloseTo(1 - 0.4 * 0.4, 1);
  });

  it("scales the crown with the instance pose scale (bits read like the GPU)", () => {
    const small = buildCanopyCoverage(records([[0, 0, 0.5]]), 1, { crownRadius: 4 });
    const big = buildCanopyCoverage(records([[0, 0, 2]]), 1, { crownRadius: 4 });
    expect(at(small, 3, 0)).toBe(0);
    expect(at(big, 3, 0)).toBeGreaterThan(0.5);
  });

  it("rejects a non-positive crown radius", () => {
    expect(() => buildCanopyCoverage(records([[0, 0, 1]]), 1, { crownRadius: 0 })).toThrow();
  });
});
