import { describe, it, expect } from "vitest";
import { Ground, Cube } from "../../src/index.js";

describe("UV Coordinate Integrity", () => {
  it("Ground UVs should map left-to-right (U) and bottom-to-top (V)", () => {
    // Note: V maps 1 at the top (-z) to 0 at the bottom (+z) which means
    // it maps standard math V coordinates where v=0 is bottom and v=1 is top.
    const geo = new Ground({ width: 10, depth: 10 }).getGeometryData();
    const vertices = geo.vertices;
    const uvs = geo.uvs!;

    // Find top-left vertex (-width/2, 0, -depth/2)
    let topLeftU = -1;
    let topLeftV = -1;

    // Find bottom-right vertex (+width/2, 0, +depth/2)
    let bottomRightU = -1;
    let bottomRightV = -1;

    for (let i = 0; i < vertices.length / 3; i++) {
      const x = vertices[i * 3];
      const z = vertices[i * 3 + 2];

      const u = uvs[i * 2]!;
      const v = uvs[i * 2 + 1]!;

      if (x === -5 && z === -5) {
        topLeftU = u;
        topLeftV = v;
      }
      if (x === 5 && z === 5) {
        bottomRightU = u;
        bottomRightV = v;
      }
    }

    // Top-Left (-x, -z) should have U=0, V=1
    expect(topLeftU).toBe(0);
    expect(topLeftV).toBe(1);

    // Bottom-Right (+x, +z) should have U=1, V=0
    expect(bottomRightU).toBe(1);
    expect(bottomRightV).toBe(0);
  });

  it("Cube Front Face (+Z) UVs should match Ground mapping logic", () => {
    const geo = new Cube({ size: 10 }).getGeometryData();
    const vertices = geo.vertices;
    const uvs = geo.uvs!;

    // Find top-left vertex of the Front face (+Z)
    // The front face (facing +Z) has x from -5 to +5, and y from -5 to +5.
    // Top-Left looking at +Z face means x=-5, y=5, z=5.
    let topLeftU = -1;
    let topLeftV = -1;

    // Bottom-Right looking at +Z face means x=5, y=-5, z=5.
    let bottomRightU = -1;
    let bottomRightV = -1;

    for (let i = 0; i < vertices.length / 3; i++) {
      const x = vertices[i * 3];
      const y = vertices[i * 3 + 1];
      const z = vertices[i * 3 + 2];

      if (z === 5) {
        const u = uvs[i * 2]!;
        const v = uvs[i * 2 + 1]!;

        if (x === -5 && y === 5) {
          topLeftU = u;
          topLeftV = v;
        }
        if (x === 5 && y === -5) {
          bottomRightU = u;
          bottomRightV = v;
        }
      }
    }

    // Since our Plane matches this exactly, the Top-Left must have U=0, V=1.
    expect(topLeftU).toBe(0);
    expect(topLeftV).toBe(1);

    // Bottom-Right must have U=1, V=0.
    expect(bottomRightU).toBe(1);
    expect(bottomRightV).toBe(0);
  });
});
