import { describe, it, expect } from "vitest";
import { LatheGeometry, RevolveBuilder } from "../../src/geometry/LatheGeometry.js";
import { MathUtils } from "../../src/math/index.js";

function countFlippedOutwardTriangles(geometry: LatheGeometry): number {
  const data = geometry.getGeometryData();
  const v = data.vertices;
  const n = data.normals!;
  const idx = data.indices!;

  let flipped = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const i0 = idx[i]! * 3,
      i1 = idx[i + 1]! * 3,
      i2 = idx[i + 2]! * 3;
    const ax = v[i0]!,
      ay = v[i0 + 1]!,
      az = v[i0 + 2]!;
    const bx = v[i1]!,
      by = v[i1 + 1]!,
      bz = v[i1 + 2]!;
    const cx = v[i2]!,
      cy = v[i2 + 1]!,
      cz = v[i2 + 2]!;
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;
    const faceArea = Math.hypot(fnx, fny, fnz);
    if (faceArea < 1e-9) continue;
    const vnx = (n[i0]! + n[i1]! + n[i2]!) / 3;
    const vny = (n[i0 + 1]! + n[i1 + 1]! + n[i2 + 1]!) / 3;
    const vnz = (n[i0 + 2]! + n[i1 + 2]! + n[i2 + 2]!) / 3;
    const dot = fnx * vnx + fny * vny + fnz * vnz;
    if (dot < -1e-6) flipped++;
  }
  return flipped;
}

function allFinite(array: Float32Array | undefined): boolean {
  if (!array) return false;
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i]!)) return false;
  }
  return true;
}

describe("LatheGeometry / RevolveBuilder", () => {
  it("rejects profiles with fewer than two rings", () => {
    expect(
      () =>
        new LatheGeometry({
          rings: [],
          radialSegments: 8,
          thetaStart: 0,
          thetaLength: 0,
          capTop: false,
          capBottom: false,
          sideCaps: false,
          flipInnerU: false,
        }),
    ).toThrow();
    expect(() =>
      new RevolveBuilder()
        .addRing(1, -1)
        .build({
          radialSegments: 8,
          thetaStart: 0,
          thetaLength: MathUtils.TWO_PI,
          capTop: false,
          capBottom: false,
          sideCaps: false,
          flipInnerU: false,
        }),
    ).toThrow();
  });

  it("builds a valid solid frustum with full outward-facing winding", () => {
    const geo = new RevolveBuilder().addSegments(-1, 1, 1, 0.5, 1.0).build({
      radialSegments: 12,
      thetaStart: 0,
      thetaLength: MathUtils.TWO_PI,
      capTop: true,
      capBottom: true,
      sideCaps: false,
      flipInnerU: false,
    });

    const data = geo.getGeometryData();
    // One wall grid row (12 quads) + top disk (12) + bottom disk (12) => 48 tris.
    expect(data.indices!.length).toBe(48 * 3);
    expect(data.vertices.length / 3).toBe(2 * 13 + 2 * 14);
    expect(allFinite(data.vertices)).toBe(true);
    expect(countFlippedOutwardTriangles(geo)).toBe(0);
  });

  it("builds a valid hollow tube with annular caps and inward inner wall", () => {
    const geo = new LatheGeometry({
      rings: [
        { outer: 1.0, inner: 0.5, y: -1 },
        { outer: 1.0, inner: 0.5, y: 1 },
      ],
      radialSegments: 12,
      thetaStart: 0,
      thetaLength: MathUtils.TWO_PI,
      capTop: true,
      capBottom: true,
      sideCaps: false,
      flipInnerU: false,
    });

    const data = geo.getGeometryData();
    // outer wall 12 + inner wall 12 + top annulus 12 + bottom annulus 12 quad-cells
    expect(data.indices!.length).toBe(12 * 4 * 6);
    expect(allFinite(data.vertices)).toBe(true);
    expect(allFinite(data.uvs)).toBe(true);
    expect(countFlippedOutwardTriangles(geo)).toBe(0);
  });

  it("emits outward-facing side caps for a partial solid sector", () => {
    const geo = new RevolveBuilder().addRing(1.0, -1).addRing(1.0, 1).build({
      radialSegments: 12,
      thetaStart: 0,
      thetaLength: Math.PI,
      capTop: true,
      capBottom: true,
      sideCaps: true,
      flipInnerU: false,
    });

    expect(allFinite(geo.getGeometryData().vertices)).toBe(true);
    expect(countFlippedOutwardTriangles(geo)).toBe(0);
  });

  it("emits outward-facing side caps for a partial hollow sector", () => {
    const geo = new LatheGeometry({
      rings: [
        { outer: 1.0, inner: 0.5, y: -1 },
        { outer: 1.0, inner: 0.5, y: 1 },
      ],
      radialSegments: 12,
      thetaStart: 0,
      thetaLength: Math.PI * 0.75,
      capTop: true,
      capBottom: true,
      sideCaps: true,
      flipInnerU: true,
    });

    expect(allFinite(geo.getGeometryData().vertices)).toBe(true);
    expect(countFlippedOutwardTriangles(geo)).toBe(0);
  });

  it("rebuilds the identical buffer payload after a no-op rebuild", () => {
    const geo = new LatheGeometry({
      rings: [
        { outer: 1.0, y: -1 },
        { outer: 1.0, y: 1 },
      ],
      radialSegments: 8,
      thetaStart: 0,
      thetaLength: MathUtils.TWO_PI,
      capTop: true,
      capBottom: true,
      sideCaps: false,
      flipInnerU: false,
    });
    const before = geo.getGeometryData();
    geo.rebuild();
    const after = geo.getGeometryData();

    expect(after.vertices.length).toBe(before.vertices.length);
    expect(after.indices!.length).toBe(before.indices!.length);
    expect(Array.from(after.vertices)).toEqual(Array.from(before.vertices));
    expect(Array.from(after.uvs!)).toEqual(Array.from(before.uvs!));
  });
});
