import { describe, it, expect } from "vitest";
import { TorusKnot } from "../src/TorusKnot.js";

function assertNoNaN(geom: TorusKnot, name: string): void {
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

describe("TorusKnot", () => {
  it("generates a tube grid with the expected vertex/index counts", () => {
    const knot = new TorusKnot({ tubularSegments: 16, radialSegments: 6 });
    const data = knot.getGeometryData();
    expect(data.vertices.length).toBe((16 + 1) * (6 + 1) * 3);
    expect(data.indices?.length).toBe(16 * 6 * 6);
  });

  it("falls back to defaults for an empty options object", () => {
    const knot = new TorusKnot();
    assertNoNaN(knot, "TorusKnot(defaults)");
  });

  it("guards against NaN on degenerate radii and zero segments", () => {
    const knot = new TorusKnot({
      radius: 0,
      tube: 0,
      p: 0,
      q: 0,
      tubularSegments: 0,
      radialSegments: 0,
    });
    assertNoNaN(knot, "TorusKnot(degenerate)");
  });

  it("closes an unknotted loop when p=1, q=1", () => {
    const knot = new TorusKnot({ p: 1, q: 1, tubularSegments: 32, radialSegments: 8 });
    assertNoNaN(knot, "TorusKnot(1,1)");
  });
});
