import { describe, expect, it } from "vitest";
import { Object3D, OceanGridGeometry } from "../../src/index.js";

describe("OceanGridGeometry (ADR 0062)", () => {
  it("keeps default vertex count within WebGL1 Uint16 limits and produces upward normals", () => {
    const geo = new OceanGridGeometry();
    const data = geo.getGeometryData();
    const vertCount = data.vertices.length / 3;

    expect(vertCount).toBe(1 + geo.radialSegments * geo.angularSegments);
    expect(vertCount).toBeLessThanOrEqual(65_535);
    expect(data.indices).toBeInstanceOf(Uint16Array);
    const normals = data.normals!;
    const uvs = data.uvs!;
    const tangents = data.tangents!;
    expect(normals).toBeDefined();
    expect(uvs).toBeDefined();
    expect(tangents).toBeDefined();
    expect(tangents.length).toBe(vertCount * 4);

    for (let i = 0; i < vertCount; i++) {
      expect(normals[i * 3]).toBe(0);
      expect(normals[i * 3 + 1]).toBe(1);
      expect(normals[i * 3 + 2]).toBe(0);
      expect(Number.isFinite(uvs[i * 2]!)).toBe(true);
      expect(Number.isFinite(uvs[i * 2 + 1]!)).toBe(true);
    }
  });

  it("maps ring radii strictly monotonically from center to outer horizon radius", () => {
    const geo = new OceanGridGeometry({
      radius: 2400,
      radialSegments: 160,
      angularSegments: 192,
      radialExponent: 3.4,
      detailRadius: 380,
    });
    expect(geo.evaluateRingRadius(0)).toBe(0);
    expect(geo.evaluateRingRadius(1)).toBeCloseTo(2400, 6);

    let prev = 0;
    for (let r = 1; r <= geo.radialSegments; r++) {
      const next = geo.evaluateRingRadius(r / geo.radialSegments);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }

    // Inner step near center must stay much finer than the outer horizon step
    const innerStep = geo.evaluateRingRadius(1 / geo.radialSegments);
    const outerStep =
      geo.evaluateRingRadius(1) - geo.evaluateRingRadius(1 - 1 / geo.radialSegments);
    expect(innerStep).toBeLessThan(outerStep * 0.25);
  });

  it("throws when requested segment counts exceed Uint16 vertex capacity", () => {
    expect(() => new OceanGridGeometry({ radialSegments: 400, angularSegments: 256 })).toThrow(
      RangeError,
    );
  });

  it("snaps ocean mesh XZ coordinates cleanly onto fixed steps without mutating Y", () => {
    const mesh = new Object3D("OceanTest");
    mesh.position.set(0, 1.5, 0);
    OceanGridGeometry.snapToTarget(mesh, 19.4, -33.2, 8);
    expect(mesh.position.x).toBe(16);
    expect(mesh.position.y).toBe(1.5);
    expect(mesh.position.z).toBe(-32);
  });
});
