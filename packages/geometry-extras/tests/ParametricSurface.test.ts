import { describe, it, expect } from "vitest";
import { ParametricSurface } from "../src/ParametricSurface.js";
import { Vector3D } from "@small-world-machine/engine";

function assertNoNaN(geom: ParametricSurface, name: string): void {
  const data = geom.getGeometryData();
  expect(data.vertices.length).toBeGreaterThan(0);
  for (let i = 0; i < data.vertices.length; i++) {
    expect(Number.isNaN(data.vertices[i]), `${name} vertex[${i}] is NaN`).toBe(false);
  }
  for (let i = 0; i < data.indices!.length; i++) {
    expect(Number.isNaN(data.indices![i]), `${name} index[${i}] is NaN`).toBe(false);
  }
}

describe("ParametricSurface", () => {
  it("builds a grid mesh over the parameter domain", () => {
    const surface = new ParametricSurface({
      uMin: 0,
      uMax: 1,
      vMin: 0,
      vMax: 1,
      uSegments: 8,
      vSegments: 4,
      surface: (u, v): Vector3D => new Vector3D(u, v, 0),
    });
    const data = surface.getGeometryData();
    expect(data.vertices.length).toBe(9 * 5 * 3);
    expect(data.indices!.length).toBe(8 * 4 * 6);
    assertNoNaN(surface, "ParametricSurface(grid)");
  });

  it("wraps the grid when the surface is periodic in both directions", () => {
    const surface = new ParametricSurface({
      uMin: 0,
      uMax: Math.PI * 2,
      vMin: 0,
      vMax: Math.PI,
      uSegments: 8,
      vSegments: 4,
      closedU: true,
      closedV: true,
      surface: (u, v): Vector3D => new Vector3D(Math.cos(u), Math.sin(u), v),
    });
    const data = surface.getGeometryData();
    expect(data.vertices.length).toBe(8 * 4 * 3);
    expect(data.indices!.length).toBe(8 * 4 * 6);
    assertNoNaN(surface, "ParametricSurface(closed)");
  });

  it("handles a constant surface without NaN", () => {
    const surface = new ParametricSurface({
      uSegments: 2,
      vSegments: 2,
      surface: (): Vector3D => new Vector3D(1, 2, 3),
    });
    assertNoNaN(surface, "ParametricSurface(constant)");
  });
});
