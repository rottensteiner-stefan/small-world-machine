import { describe, expect, it } from "vitest";
import { packInstancePose, type GeometryDataInterface } from "@small-world-machine/engine";
import {
  buildPopulationCanopy,
  geometryBoundingRadius,
  geometryHeight,
  lodBucketsFromMaxima,
} from "../src/trees/TreeField.js";

const GEO = {
  vertices: new Float32Array([0, 0, 0, 3, 0, 0, 0, 10, 0]),
} as unknown as GeometryDataInterface;

describe("TreeField helpers", () => {
  it("derives contiguous LOD buckets, coarsest first, from ascending pixel bounds", () => {
    const b = lodBucketsFromMaxima([16, 32, 1e6], 2);
    expect(
      b.map((x) => [x.lodIndex, x.minProjectedSize, x.maxProjectedSize, x.geometrySlot]),
    ).toEqual([
      [2, 3, 16, 0],
      [1, 17, 32, 1],
      [0, 33, 1e6, 2],
    ]);
  });

  it("measures height and a conservative bounding radius", () => {
    expect(geometryHeight(GEO)).toBe(10);
    expect(geometryBoundingRadius(GEO)).toBeCloseTo(11, 5);
  });

  it("builds a population canopy with crown top = height x mean scale", () => {
    const rec = new Float32Array(8);
    const bits = new Uint32Array(rec.buffer);
    bits[3] = packInstancePose(0, 1);
    rec[4] = 20;
    bits[7] = packInstancePose(0, 2);
    const c = buildPopulationCanopy(rec, GEO, { ambientFloor: 0.3 });
    expect(c.canopyHeight).toBeCloseTo(15, 1);
    expect(c.ambientFloor).toBe(0.3);
    expect(c.data.some((v) => v > 0)).toBe(true);
  });
});
