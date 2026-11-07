import { describe, expect, it } from "vitest";
import { PolygonFan } from "../../src/geometry/PolygonFan.js";
import { Vector3D } from "../../src/math/index.js";

const square = (): Vector3D[] => [
  new Vector3D(0, 0, 0),
  new Vector3D(1, 0, 0),
  new Vector3D(1, 0, 1),
  new Vector3D(0, 0, 1),
];

describe("PolygonFan", () => {
  it("fans from the first point by default", () => {
    const data = new PolygonFan({ points: square() }).getGeometryData();
    expect(Array.from(data.indices!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(data.vertices.length).toBe(12);
  });

  it("uses explicit triangulation indices when given", () => {
    const data = new PolygonFan({ points: square(), indices: [1, 2, 3] }).getGeometryData();
    expect(Array.from(data.indices!)).toEqual([1, 2, 3]);
  });

  it("treats an empty indices array as unspecified (fan)", () => {
    const data = new PolygonFan({ points: square(), indices: [] }).getGeometryData();
    expect(Array.from(data.indices!)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("fails fast on indices >= point count, negative or fractional", () => {
    expect(() => new PolygonFan({ points: square(), indices: [0, 1, 4] })).toThrow(/out of range/);
    expect(() => new PolygonFan({ points: square(), indices: [0, 1, -1] })).toThrow(/out of range/);
    expect(() => new PolygonFan({ points: square(), indices: [0, 1, 1.5] })).toThrow(
      /out of range/,
    );
  });

  it("fails fast on index counts that are not a multiple of 3 (incl. 1-2 indices)", () => {
    expect(() => new PolygonFan({ points: square(), indices: [0, 1] })).toThrow(/multiple of 3/);
    expect(() => new PolygonFan({ points: square(), indices: [0, 1, 2, 3] })).toThrow(
      /multiple of 3/,
    );
  });
});
