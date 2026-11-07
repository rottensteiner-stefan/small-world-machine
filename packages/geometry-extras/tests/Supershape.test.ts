import { describe, it, expect } from "vitest";
import { Supershape } from "../src/Supershape.js";

function assertNoNaN(geom: Supershape, name: string): void {
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

describe("Supershape", () => {
  it("generates a watertight grid with the expected vertex/index counts", () => {
    const shape = new Supershape({ longitudeSegments: 8, latitudeSegments: 4 });
    const data = shape.getGeometryData();
    expect(data.vertices.length).toBe((8 + 1) * (4 + 1) * 3);
    expect(data.indices?.length).toBe(8 * 4 * 6);
  });

  it("falls back to defaults for an empty options object", () => {
    const shape = new Supershape();
    assertNoNaN(shape, "Supershape(defaults)");
  });

  it("guards against NaN on degenerate exponents and zero segments", () => {
    const shape = new Supershape({
      radius: 0,
      longitudeSegments: 0,
      latitudeSegments: 0,
      longitude: { m: 0, n1: 0, n2: 0, n3: 0, a: 0, b: 0 },
      latitude: { m: 0, n1: 0, n2: 0, n3: 0, a: 0, b: 0 },
    });
    assertNoNaN(shape, "Supershape(degenerate)");
  });

  it("produces a finite bounding volume", () => {
    const shape = new Supershape({ radius: 2 });
    const bounds = shape.getBoundingVolume();
    expect(bounds).toBeDefined();
  });
});
