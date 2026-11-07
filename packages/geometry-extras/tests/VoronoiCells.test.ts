import { describe, it, expect } from "vitest";
import { VoronoiCells, computeCellFaces } from "../src/VoronoiCells.js";

function assertNoNaN(geom: VoronoiCells, name: string): void {
  const data = geom.getGeometryData();
  for (let i = 0; i < data.vertices.length; i++) {
    expect(Number.isNaN(data.vertices[i]), `${name} vertex[${i}] is NaN`).toBe(false);
  }
  if (data.normals) {
    for (let i = 0; i < data.normals.length; i++) {
      expect(Number.isNaN(data.normals[i]), `${name} normal[${i}] is NaN`).toBe(false);
    }
  }
}

function extentX(vertices: Float32Array): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i]!;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return max - min;
}

describe("VoronoiCells", () => {
  it("generates a non-empty mesh with the default random cluster", () => {
    const cells = new VoronoiCells();
    const data = cells.getGeometryData();
    expect(data.vertices.length).toBeGreaterThan(0);
    expect((data.indices?.length ?? 0) % 3).toBe(0);
    assertNoNaN(cells, "VoronoiCells(defaults)");
  });

  it("is deterministic for a fixed seed", () => {
    const a = new VoronoiCells({ seed: 42, pointCount: 8 });
    const b = new VoronoiCells({ seed: 42, pointCount: 8 });
    expect(a.getGeometryData().vertices).toEqual(b.getGeometryData().vertices);
  });

  it("splits a box into two half-space cells for two symmetric points", () => {
    const cells = new VoronoiCells({
      points: [
        { x: -0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
      ],
      bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      cellPadding: 1,
    });
    const data = cells.getGeometryData();
    assertNoNaN(cells, "VoronoiCells(two points)");

    // Each cell is half of a 2x2x2 box clipped at x=0, so no vertex should cross
    // to the other seed's side of the bisector plane (x=0).
    for (let i = 0; i < data.vertices.length; i += 3) {
      expect(Math.abs(data.vertices[i]!)).toBeLessThan(1.001);
    }
  });

  it("shrinks cells towards their centroid as cellPadding decreases", () => {
    const points = [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ];
    const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    const full = new VoronoiCells({ points, bounds, cellPadding: 1 });
    const shrunk = new VoronoiCells({ points, bounds, cellPadding: 0.5 });

    const fullExtent = extentX(full.getGeometryData().vertices);
    const shrunkExtent = extentX(shrunk.getGeometryData().vertices);
    expect(shrunkExtent).toBeLessThan(fullExtent);
  });

  it("guards against NaN on degenerate/duplicate points", () => {
    const cells = new VoronoiCells({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
      ],
      cellPadding: 0.01,
    });
    assertNoNaN(cells, "VoronoiCells(duplicate points)");
  });

  it("gives a heavier point a larger cell in a power diagram", () => {
    const points = [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ];
    const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    const weights = [1.2, 1.0];

    const heavyFaces = computeCellFaces(points, 0, bounds, weights)!;
    const lightFaces = computeCellFaces(points, 1, bounds, weights)!;
    expect(heavyFaces).not.toBeNull();
    expect(lightFaces).not.toBeNull();

    const maxX = (faces: { x: number }[][]): number =>
      Math.max(...faces.flatMap((f) => f.map((p) => p.x)));
    const minX = (faces: { x: number }[][]): number =>
      Math.min(...faces.flatMap((f) => f.map((p) => p.x)));

    const heavyExtent = maxX(heavyFaces) - minX(heavyFaces);
    const lightExtent = maxX(lightFaces) - minX(lightFaces);
    expect(heavyExtent).toBeGreaterThan(lightExtent);

    // Both boundaries should sit at the same shifted plane (~x=0.22 for these weights).
    expect(maxX(heavyFaces)).toBeCloseTo(minX(lightFaces), 5);
  });

  it("is a no-op (fixed point) for Lloyd relaxation on an already-symmetric layout", () => {
    const points = [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ];
    const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    const cells = new VoronoiCells({ points, bounds, relaxationIterations: 3, cellPadding: 1 });

    expect(cells.points[0]!.x).toBeCloseTo(-0.5, 5);
    expect(cells.points[1]!.x).toBeCloseTo(0.5, 5);
    assertNoNaN(cells, "VoronoiCells(relaxed symmetric)");
  });

  it("moves seed points towards their centroid under Lloyd relaxation", () => {
    const points = [
      { x: -0.9, y: -0.9, z: -0.9 },
      { x: -0.8, y: -0.8, z: -0.8 },
      { x: 0.7, y: 0.7, z: 0.7 },
    ];
    const cells = new VoronoiCells({ points, relaxationIterations: 1, cellPadding: 1 });

    let moved = false;
    for (let i = 0; i < points.length; i++) {
      const dx = cells.points[i]!.x - points[i]!.x;
      const dy = cells.points[i]!.y - points[i]!.y;
      const dz = cells.points[i]!.z - points[i]!.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.001) moved = true;
    }
    expect(moved).toBe(true);
    assertNoNaN(cells, "VoronoiCells(relaxed clustered)");
  });

  it("guards against NaN when combining weights and relaxation on degenerate input", () => {
    const cells = new VoronoiCells({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0.05, y: 0, z: 0 },
      ],
      weights: [0, 5],
      relaxationIterations: 2,
      cellPadding: 0.05,
    });
    assertNoNaN(cells, "VoronoiCells(weights+relaxation degenerate)");
  });
});
