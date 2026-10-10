import { describe, it, expect } from "vitest";
import { Lathe } from "../src/Lathe.js";
import { Vector3D } from "@small-world-machine/engine";

function assertNoNaN(geom: Lathe, name: string): void {
  const data = geom.getGeometryData();
  for (let i = 0; i < data.vertices.length; i++) {
    expect(Number.isNaN(data.vertices[i]), `${name} vertex[${i}] is NaN`).toBe(false);
  }
  if (data.indices) {
    for (let i = 0; i < data.indices.length; i++) {
      expect(Number.isNaN(data.indices[i]), `${name} index[${i}] is NaN`).toBe(false);
    }
  }
}

describe("Lathe", () => {
  it("revolves a profile into an indexed cylinder-like grid", () => {
    const profile = [new Vector3D(1, 0, 0), new Vector3D(1, 1, 0)];
    const lathe = new Lathe({ profile, segments: 24 });
    const data = lathe.getGeometryData();
    expect(data.vertices.length).toBe((24 + 1) * 2 * 3);
    expect(data.indices?.length).toBe(24 * 1 * 6);
    assertNoNaN(lathe, "Lathe(cylinder)");
  });

  it("falls back to the default hourglass profile for an empty options object", () => {
    const lathe = new Lathe();
    assertNoNaN(lathe, "Lathe(defaults)");
  });

  it("does not create wrap-around edges for a partial arc", () => {
    const profile = [new Vector3D(1, 0, 0), new Vector3D(1, 1, 0)];
    const lathe = new Lathe({ profile, segments: 8, arcAngle: Math.PI });
    const data = lathe.getGeometryData();
    expect(data.vertices.length).toBe((8 + 1) * 2 * 3);
    expect(data.indices?.length).toBe(8 * 1 * 6);
    assertNoNaN(lathe, "Lathe(partial arc)");
  });

  it("handles degenerate profiles without NaN", () => {
    const lathe = new Lathe({ profile: [], segments: 0 });
    const data = lathe.getGeometryData();
    expect(data.vertices.length).toBe(0);
    assertNoNaN(lathe, "Lathe(empty profile)");
  });

  it("clamps segment counts to valid ranges", () => {
    const profile = [new Vector3D(0.5, 0, 0), new Vector3D(0.4, 1, 0)];
    const lathe = new Lathe({ profile, segments: 0 });
    expect(lathe.segments).toBe(3);
    assertNoNaN(lathe, "Lathe(clamped segments)");
  });
});
