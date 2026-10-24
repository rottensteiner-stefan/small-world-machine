import { describe, expect, it } from "vitest";
import { ModelGeometry } from "../../src/geometry/ModelGeometry.js";

describe("Tangential data contract: vec4 (tx, ty, tz, w) with w = ±1 (EP-1 / F1-A)", () => {
  it("derives w = +1 for a non-mirrored UV island and w = -1 for a mirrored UV island", () => {
    const vertices = new Float32Array([
      // island A (UV winding matches the geometry winding)
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      // island B (same geometry winding, mirrored UVs)
      2, 0, 0, 3, 0, 0, 2, 1, 0,
    ]);
    const normals = new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, // island A
      0, 0, 1, 0, 0, 1, 0, 0, 1, // island B
    ]);
    const uvs = new Float32Array([
      0, 0, 1, 0, 0, 1, // island A
      1, 0, 0, 0, 0, 1, // island B: u-winding swapped relative to A
    ]);
    const indices = new Uint16Array([0, 1, 2, 3, 4, 5]);

    const geo = new ModelGeometry(vertices, uvs, normals, indices).getGeometryData();

    const tangents = geo.tangents as Float32Array;
    // 4 floats per vertex (vec4 contract), not 3.
    expect(tangents.length).toBe(6 * 4);

    for (let i = 0; i < 6; i++) {
      const x = tangents[i * 4]!;
      const y = tangents[i * 4 + 1]!;
      const z = tangents[i * 4 + 2]!;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }

    // Island A (verts 0..2): handedness agrees -> w = +1.
    for (let i = 0; i < 3; i++) {
      expect(tangents[i * 4 + 3]).toBe(1);
    }
    // Island B (verts 3..5): mirrored UV island -> w = -1 (B = cross(N, T) * w flips).
    for (let i = 3; i < 6; i++) {
      expect(tangents[i * 4 + 3]).toBe(-1);
    }
  });

  it("writes w = +1 for a single regular (non-mirrored) forward-facing triangle", () => {
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);

    const geo = new ModelGeometry(vertices, uvs, normals, indices).getGeometryData();

    const tangents = geo.tangents as Float32Array;
    expect(tangents.length).toBe(3 * 4);
    expect(tangents[3]).toBe(1);
    expect(tangents[7]).toBe(1);
    expect(tangents[11]).toBe(1);
  });
});
