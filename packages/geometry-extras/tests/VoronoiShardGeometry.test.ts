import { describe, it, expect } from "vitest";
import { VoronoiShardGeometry } from "../src/VoronoiShardGeometry.js";
import { computeCellFaces } from "../src/VoronoiCells.js";

describe("VoronoiShardGeometry", () => {
  it("renders a single computed cell as its own standalone geometry", () => {
    const points = [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ];
    const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    const faces = computeCellFaces(points, 0, bounds)!;
    expect(faces).not.toBeNull();

    const shard = new VoronoiShardGeometry(faces);
    const data = shard.getGeometryData();
    expect(data.vertices.length).toBeGreaterThan(0);
    expect((data.indices?.length ?? 0) % 3).toBe(0);

    for (let i = 0; i < data.vertices.length; i++) {
      expect(Number.isNaN(data.vertices[i])).toBe(false);
    }

    // Half of a 2x2x2 box clipped at x=0: no vertex should cross the bisector.
    for (let i = 0; i < data.vertices.length; i += 3) {
      expect(data.vertices[i]!).toBeLessThanOrEqual(0.001);
    }
  });

  it("guards against NaN on an empty face list", () => {
    const shard = new VoronoiShardGeometry([]);
    const data = shard.getGeometryData();
    expect(data.vertices.length).toBe(0);
  });
});
