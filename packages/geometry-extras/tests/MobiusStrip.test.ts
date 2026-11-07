import { describe, it, expect } from "vitest";
import { MobiusStrip } from "../src/MobiusStrip.js";

function assertNoNaN(geom: MobiusStrip, name: string): void {
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

describe("MobiusStrip", () => {
  it("generates an open strip grid with the expected vertex/index counts", () => {
    const strip = new MobiusStrip({ segments: 10, widthSegments: 3 });
    const data = strip.getGeometryData();
    expect(data.vertices.length).toBe((10 + 1) * (3 + 1) * 3);
    expect(data.indices?.length).toBe(10 * 3 * 6);
  });

  it("closes up in space: the last and first ring are the width-reversed mirror of each other", () => {
    const strip = new MobiusStrip({ segments: 12, widthSegments: 4 });
    const data = strip.getGeometryData();
    const cols = 4 + 1;
    const lastRowOffset = 12 * cols;
    for (let j = 0; j < cols; j++) {
      const firstIdx = j * 3;
      const lastIdx = (lastRowOffset + (cols - 1 - j)) * 3;
      expect(data.vertices[lastIdx]).toBeCloseTo(data.vertices[firstIdx]!, 5);
      expect(data.vertices[lastIdx + 1]).toBeCloseTo(-data.vertices[firstIdx + 1]!, 5);
      expect(data.vertices[lastIdx + 2]).toBeCloseTo(data.vertices[firstIdx + 2]!, 5);
    }
  });

  it("falls back to defaults for an empty options object", () => {
    const strip = new MobiusStrip();
    assertNoNaN(strip, "MobiusStrip(defaults)");
  });

  it("guards against NaN on degenerate dimensions and zero segments", () => {
    const strip = new MobiusStrip({
      radius: 0,
      width: 0,
      segments: 2,
      widthSegments: 1,
      twists: 0,
    });
    assertNoNaN(strip, "MobiusStrip(degenerate)");
  });
});
