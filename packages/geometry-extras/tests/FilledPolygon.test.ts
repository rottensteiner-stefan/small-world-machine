import { describe, it, expect } from "vitest";
import { FilledPolygon } from "../src/FilledPolygon.js";
import { Vector3D } from "@small-world-machine/engine";

function assertNoNaN(poly: FilledPolygon, name: string): void {
  const data = poly.getGeometryData();
  expect(data.vertices.length).toBeGreaterThan(0);
  for (let i = 0; i < data.vertices.length; i++) {
    expect(Number.isNaN(data.vertices[i]), `${name} vertex[${i}] is NaN`).toBe(false);
  }
  for (let i = 0; i < data.indices!.length; i++) {
    expect(Number.isNaN(data.indices![i]), `${name} index[${i}] is NaN`).toBe(false);
  }
}

/** Absolute area of a triangle in the XY plane. */
function triArea(data: { vertices: ArrayLike<number> }, a: number, b: number, c: number): number {
  const ax = data.vertices[a * 3]!;
  const ay = data.vertices[a * 3 + 1]!;
  const bx = data.vertices[b * 3]!;
  const by = data.vertices[b * 3 + 1]!;
  const cx = data.vertices[c * 3]!;
  const cy = data.vertices[c * 3 + 1]!;
  return Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}

function polygonArea(outer: Vector3D[], holes: Vector3D[][]): number {
  const ring = (pts: Vector3D[]): number => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      s += p.x * q.y - q.x * p.y;
    }
    return Math.abs(s) / 2;
  };
  let area = ring(outer);
  for (const h of holes) area -= ring(h);
  return area;
}

function filledArea(poly: FilledPolygon): number {
  const data = poly.getGeometryData();
  let area = 0;
  for (let i = 0; i < data.indices!.length; i += 3) {
    area += triArea(data, data.indices![i]!, data.indices![i + 1]!, data.indices![i + 2]!);
  }
  return area;
}

describe("FilledPolygon", () => {
  it("triangulates a simple convex quad", () => {
    const poly = new FilledPolygon({
      outer: [
        new Vector3D(-1, -1, 0),
        new Vector3D(1, -1, 0),
        new Vector3D(1, 1, 0),
        new Vector3D(-1, 1, 0),
      ],
    });
    const data = poly.getGeometryData();
    expect(data.indices!.length).toBe(2 * 3);
    expect(filledArea(poly)).toBeCloseTo(polygonArea(poly.outer, []), 4);
    assertNoNaN(poly, "FilledPolygon(quad)");
  });

  it("triangulates a concave (L-shaped) polygon preserving area", () => {
    const outer = [
      new Vector3D(0, 0, 0),
      new Vector3D(2, 0, 0),
      new Vector3D(2, 1, 0),
      new Vector3D(1, 1, 0),
      new Vector3D(1, 2, 0),
      new Vector3D(0, 2, 0),
    ];
    const poly = new FilledPolygon({ outer });
    expect(filledArea(poly)).toBeCloseTo(polygonArea(outer, []), 4);
    assertNoNaN(poly, "FilledPolygon(L-shape)");
  });

  it("subtracts a hole from the outer ring preserving area", () => {
    const outer = [
      new Vector3D(0, 0, 0),
      new Vector3D(4, 0, 0),
      new Vector3D(4, 4, 0),
      new Vector3D(0, 4, 0),
    ];
    const hole = [
      new Vector3D(1, 1, 0),
      new Vector3D(3, 1, 0),
      new Vector3D(3, 3, 0),
      new Vector3D(1, 3, 0),
    ];
    const poly = new FilledPolygon({ outer, holes: [hole] });
    expect(filledArea(poly)).toBeCloseTo(polygonArea(outer, [hole]), 4);
    assertNoNaN(poly, "FilledPolygon(hole)");
  });

  it("handles multiple holes", () => {
    const outer = [
      new Vector3D(0, 0, 0),
      new Vector3D(10, 0, 0),
      new Vector3D(10, 10, 0),
      new Vector3D(0, 10, 0),
    ];
    const holeA = [
      new Vector3D(1, 1, 0),
      new Vector3D(3, 1, 0),
      new Vector3D(3, 3, 0),
      new Vector3D(1, 3, 0),
    ];
    const holeB = [
      new Vector3D(6, 6, 0),
      new Vector3D(8, 6, 0),
      new Vector3D(8, 8, 0),
      new Vector3D(6, 8, 0),
    ];
    const poly = new FilledPolygon({ outer, holes: [holeA, holeB] });
    expect(filledArea(poly)).toBeCloseTo(polygonArea(outer, [holeA, holeB]), 4);
    assertNoNaN(poly, "FilledPolygon(multi-hole)");
  });

  it("guards against degenerate outer rings", () => {
    const poly = new FilledPolygon({ outer: [new Vector3D(0, 0, 0), new Vector3D(1, 1, 0)] });
    const data = poly.getGeometryData();
    expect(data.vertices.length).toBe(0);
  });
});
