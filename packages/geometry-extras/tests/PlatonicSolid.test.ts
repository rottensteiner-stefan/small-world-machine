import { describe, it, expect } from "vitest";
import { PlatonicSolid } from "../src/PlatonicSolid.js";

function assertNoNaN(geom: PlatonicSolid, name: string): void {
  const data = geom.getGeometryData();
  expect(data.vertices.length).toBeGreaterThan(0);
  for (let i = 0; i < data.vertices.length; i++) {
    expect(Number.isNaN(data.vertices[i]), `${name} vertex[${i}] is NaN`).toBe(false);
  }
  for (let i = 0; i < data.indices!.length; i++) {
    expect(Number.isNaN(data.indices![i]), `${name} index[${i}] is NaN`).toBe(false);
  }
}

describe("PlatonicSolid", () => {
  it("generates an icosahedron with the expected triangle count", () => {
    const solid = new PlatonicSolid({ solid: "icosahedron" });
    const data = solid.getGeometryData();
    expect(data.indices!.length).toBe(20 * 3);
    assertNoNaN(solid, "PlatonicSolid(icosahedron)");
  });

  it("generates a dodecahedron from the dual construction (12 pentagonal faces)", () => {
    const solid = new PlatonicSolid({ solid: "dodecahedron" });
    const data = solid.getGeometryData();
    // 12 pentagons, each triangulated as a fan of 3 triangles.
    expect(data.indices!.length).toBe(12 * 3 * 3);
    assertNoNaN(solid, "PlatonicSolid(dodecahedron)");
  });

  it("normalizes dodecahedron vertices onto the circumscribed sphere", () => {
    const radius = 2.5;
    const solid = new PlatonicSolid({ solid: "dodecahedron", radius });
    const data = solid.getGeometryData();
    for (let i = 0; i < data.vertices.length; i += 3) {
      const len = Math.hypot(data.vertices[i]!, data.vertices[i + 1]!, data.vertices[i + 2]!);
      expect(len).toBeCloseTo(radius, 4);
    }
  });

  it("refines a tetrahedron into a geodetic sphere via subdivision", () => {
    const solid = new PlatonicSolid({ solid: "tetrahedron", detail: 2 });
    const data = solid.getGeometryData();
    // 4 faces * 4^2 after two subdivision rounds.
    expect(data.indices!.length).toBe(4 * 4 * 4 * 3);
    expect(data.vertices.length).toBeGreaterThan(0);
    assertNoNaN(solid, "PlatonicSolid(tetrahedron, detail 2)");
  });

  it("falls back to sensible defaults for an empty options object", () => {
    const solid = new PlatonicSolid();
    expect(solid.solid).toBe("icosahedron");
    assertNoNaN(solid, "PlatonicSolid(defaults)");
  });

  it("guards against degenerate radii", () => {
    const solid = new PlatonicSolid({ solid: "octahedron", radius: 0, detail: 0 });
    assertNoNaN(solid, "PlatonicSolid(octahedron, radius 0)");
  });
});
