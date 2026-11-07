import { describe, it, expect } from "vitest";
import { Tube } from "../../src/geometry/Tube.js";

describe("Tube Geometry", () => {
  it("should generate the correct number of vertices and indices", () => {
    const radialSegments = 8;
    const heightSegments = 1;
    const tube = new Tube({ radialSegments, heightSegments });
    const data = tube.getGeometryData();

    // Vertices: (radialSegments + 1) * (heightSegments + 1) * 2 (inner/outer) + (radialSegments + 1) * 4 (unshared caps)
    const expectedVertices =
      (radialSegments + 1) * (heightSegments + 1) * 2 + (radialSegments + 1) * 4;
    expect(data.vertices.length / 3).toBe(expectedVertices);
    // Indices:
    // Outer surface: radialSegments * heightSegments * 6
    // Inner surface: radialSegments * heightSegments * 6
    // Caps (top & bottom): radialSegments * 6 * 2
    const expectedIndices = radialSegments * heightSegments * 6 * 2 + radialSegments * 6 * 2;
    expect(data.indices!.length).toBe(expectedIndices);
  });

  it("should have valid UV coordinates", () => {
    const tube = new Tube({ radialSegments: 4, heightSegments: 1 });
    const data = tube.getGeometryData();

    for (let i = 0; i < data.uvs!.length; i++) {
      expect(data.uvs![i]).toBeGreaterThanOrEqual(0);
      expect(data.uvs![i]).toBeLessThanOrEqual(1);
    }
  });
});
