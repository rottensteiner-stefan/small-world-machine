import { describe, it, expect } from "vitest";
import { MarchingCubes, metaballField } from "../src/MarchingCubes.js";

function assertNoNaN(geom: MarchingCubes, name: string): void {
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

describe("MarchingCubes", () => {
  it("falls back to a non-empty default metaball mesh", () => {
    const mc = new MarchingCubes();
    const data = mc.getGeometryData();
    expect(data.vertices.length).toBeGreaterThan(0);
    expect(data.indices?.length ?? 0).toBeGreaterThan(0);
    expect((data.indices?.length ?? 0) % 3).toBe(0);
    assertNoNaN(mc, "MarchingCubes(defaults)");
  });

  it("guards against NaN on a degenerate single-cell grid", () => {
    const mc = new MarchingCubes({ resolution: 0 });
    assertNoNaN(mc, "MarchingCubes(resolution=0)");
  });

  it("produces an empty (but valid) mesh when the isoLevel is unreachable", () => {
    const mc = new MarchingCubes({ sample: (): number => 0, isoLevel: 100, resolution: 4 });
    const data = mc.getGeometryData();
    expect(data.vertices.length).toBe(0);
    expect(data.indices?.length ?? 0).toBe(0);
  });

  it("reconstructs a unit sphere from its signed distance field within grid tolerance", () => {
    const mc = new MarchingCubes({
      sample: (x: number, y: number, z: number): number => 1 - (x * x + y * y + z * z),
      isoLevel: 0,
      min: { x: -1.2, y: -1.2, z: -1.2 },
      max: { x: 1.2, y: 1.2, z: 1.2 },
      resolution: 20,
    });
    const data = mc.getGeometryData();
    expect(data.vertices.length).toBeGreaterThan(0);

    for (let i = 0; i < data.vertices.length; i += 3) {
      const x = data.vertices[i]!;
      const y = data.vertices[i + 1]!;
      const z = data.vertices[i + 2]!;
      const radius = Math.sqrt(x * x + y * y + z * z);
      expect(radius).toBeGreaterThan(0.85);
      expect(radius).toBeLessThan(1.15);
    }

    // Every triangle's outward normal should agree with its own position vector
    // (pointing away from the sphere's center at the origin).
    const indices = data.indices!;
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i]! * 3;
      const ib = indices[i + 1]! * 3;
      const ic = indices[i + 2]! * 3;
      const ax = data.vertices[ia]!,
        ay = data.vertices[ia + 1]!,
        az = data.vertices[ia + 2]!;
      const bx = data.vertices[ib]!,
        by = data.vertices[ib + 1]!,
        bz = data.vertices[ib + 2]!;
      const cx = data.vertices[ic]!,
        cy = data.vertices[ic + 1]!,
        cz = data.vertices[ic + 2]!;

      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

      const centerX = (ax + bx + cx) / 3;
      const centerY = (ay + by + cy) / 3;
      const centerZ = (az + bz + cz) / 3;

      const outwardDot = nx * centerX + ny * centerY + nz * centerZ;
      expect(outwardDot).toBeGreaterThan(0);
    }
  });

  it("metaballField blends multiple balls and equals strength at a single ball's own surface", () => {
    const field = metaballField([{ x: 0, y: 0, z: 0, radius: 1, strength: 1 }]);
    expect(field(1, 0, 0)).toBeCloseTo(1, 5);
    expect(field(0, 0, 0)).toBeGreaterThan(1);
  });
});
