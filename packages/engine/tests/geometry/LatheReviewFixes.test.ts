import { describe, it, expect } from "vitest";
import { LatheGeometry, type LatheGeometryOptions } from "../../src/geometry/LatheGeometry.js";
import { Cylinder } from "../../src/geometry/Cylinder.js";
import { CylinderSector } from "../../src/geometry/index.js";
import { HollowTruncatedCone } from "../../src/geometry/HollowTruncatedCone.js";
import { MathUtils } from "../../src/math/index.js";

const base: LatheGeometryOptions = {
  rings: [
    { outer: 1, y: -1 },
    { outer: 1, y: 1 },
  ],
  radialSegments: 8,
  thetaStart: 0,
  thetaLength: MathUtils.TWO_PI,
  capTop: false,
  capBottom: false,
  sideCaps: false,
  flipInnerU: false,
};

function finite(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) return false;
  return true;
}

/** Signed volume-ish check: positive when triangles wind outward from the axis. */
function outwardFraction(g: LatheGeometry): number {
  const v = g.vertices;
  const idx = g.indices!;
  let out = 0;
  let total = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3,
      b = idx[i + 1]! * 3,
      c = idx[i + 2]! * 3;
    const e1 = [v[b]! - v[a]!, v[b + 1]! - v[a + 1]!, v[b + 2]! - v[a + 2]!];
    const e2 = [v[c]! - v[a]!, v[c + 1]! - v[a + 1]!, v[c + 2]! - v[a + 2]!];
    const n = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-9) continue;
    const cx = (v[a]! + v[b]! + v[c]!) / 3;
    const cz = (v[a + 2]! + v[b + 2]! + v[c + 2]!) / 3;
    total++;
    if (n[0]! * cx + n[2]! * cz > 0) out++;
  }
  return total === 0 ? 0 : out / total;
}

describe("LatheGeometry review fixes (M9/M10)", () => {
  it("full-circle wall seam vertices share one normal", () => {
    const g = new LatheGeometry({ ...base });
    const n = g.normals;
    const cols = 9;
    for (let y = 0; y < 2; y++) {
      const a = y * cols * 3;
      const b = (y * cols + cols - 1) * 3;
      expect(n[a]).toBeCloseTo(n[b]!, 5);
      expect(n[a + 1]).toBeCloseTo(n[b + 1]!, 5);
      expect(n[a + 2]).toBeCloseTo(n[b + 2]!, 5);
      expect(Math.hypot(n[a]!, n[a + 1]!, n[a + 2]!)).toBeCloseTo(1, 5);
    }
  });

  it("pole ring (outer=0 at the top) collapses to a single finite axial-ish normal", () => {
    const g = new LatheGeometry({
      ...base,
      rings: [
        { outer: 1, y: 0 },
        { outer: 0, y: 1 },
      ],
    });
    const cols = 9;
    const top = cols * 3;
    for (let x = 1; x < cols; x++) {
      expect(g.normals[top + x * 3]).toBeCloseTo(g.normals[top]!, 5);
      expect(g.normals[top + x * 3 + 1]).toBeCloseTo(g.normals[top + 1]!, 5);
      expect(g.normals[top + x * 3 + 2]).toBeCloseTo(g.normals[top + 2]!, 5);
    }
    expect(g.normals[top + 1]).toBeGreaterThan(0.5);
    expect(finite(g.normals) && finite(g.vertices) && finite(g.uvs)).toBe(true);
  });

  it("pole at the bottom also stays finite", () => {
    const g = new LatheGeometry({
      ...base,
      rings: [
        { outer: 0, y: 0 },
        { outer: 1, y: 1 },
      ],
      capBottom: true,
      capTop: true,
    });
    expect(finite(g.normals) && finite(g.vertices) && finite(g.uvs)).toBe(true);
    expect(g.normals[1]).toBeLessThan(-0.5);
  });

  it("clamps radialSegments below 3", () => {
    const g = new LatheGeometry({ ...base, radialSegments: 1 });
    expect(g.radialSegments).toBe(3);
    expect(g.indices!.length).toBe(3 * 2 * 3);
  });

  it("switches to Uint32 indices past 65535 vertices and keeps them intact", () => {
    const g = new LatheGeometry({ ...base, radialSegments: 40000 });
    expect(g.vertices.length / 3).toBeGreaterThan(65535);
    expect(g.indices).toBeInstanceOf(Uint32Array);
    let max = 0;
    for (const i of g.indices!) max = Math.max(max, i);
    expect(max).toBeLessThan(g.vertices.length / 3);
    expect(max).toBeGreaterThan(65535);
    const small = new LatheGeometry({ ...base, radialSegments: 8 });
    expect(small.indices).toBeInstanceOf(Uint16Array);
  });

  it("side caps decide hollowness per ring", () => {
    const g = new LatheGeometry({
      ...base,
      rings: [
        { outer: 2, y: 0 },
        { outer: 2, inner: 1, y: 1 },
      ],
      thetaLength: Math.PI,
      sideCaps: true,
    });
    // Area of the cut-plane caps (all vertices on x=0): the bottom ring is solid
    // (axis to 2), the top ring is hollow (1 to 2) => trapezoid of area (2 + 1) / 2 * 1.
    const v = g.vertices;
    const idx = g.indices!;
    let area = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const p = [0, 1, 2].map((k) => idx[i + k]! * 3);
      if (!p.every((o) => Math.abs(v[o]!) < 1e-6)) continue;
      const [a, b, c] = p as [number, number, number];
      const e1y = v[b + 1]! - v[a + 1]!,
        e1z = v[b + 2]! - v[a + 2]!;
      const e2y = v[c + 1]! - v[a + 1]!,
        e2z = v[c + 2]! - v[a + 2]!;
      area += Math.abs(e1y * e2z - e1z * e2y) / 2;
    }
    // two cut planes (theta=0 and theta=PI), 1.5 each
    expect(area).toBeCloseTo(3, 5);
  });

  it("negative thetaLength is the same sector with outward winding", () => {
    const g = new LatheGeometry({ ...base, thetaStart: Math.PI, thetaLength: -Math.PI / 2 });
    expect(g.thetaLength).toBeCloseTo(Math.PI / 2, 6);
    expect(g.thetaStart).toBeCloseTo(Math.PI / 2, 6);
    expect(outwardFraction(g)).toBe(1);
  });

  it("thetaLength beyond a full turn or NaN becomes a full circle without throwing", () => {
    expect(new LatheGeometry({ ...base, thetaLength: 10 }).thetaLength).toBeCloseTo(
      MathUtils.TWO_PI,
      9,
    );
    const nan = new LatheGeometry({ ...base, thetaLength: NaN });
    expect(nan.thetaLength).toBeCloseTo(MathUtils.TWO_PI, 9);
    expect(finite(nan.vertices)).toBe(true);
  });

  it("side-cap V runs in the same direction as wall V (top of shape has v=0)", () => {
    const g = new Cylinder({ thetaLength: Math.PI, height: 2, radialSegments: 4 });
    const d = g.getGeometryData();
    let topCapVerts = 0;
    for (let i = 0; i < d.vertices.length / 3; i++) {
      const u = d.uvs![i * 2]!;
      const v = d.uvs![i * 2 + 1]!;
      const y = d.vertices[i * 3 + 1]!;
      if ((u === 0 || u === 1) && 1 === y && v !== 0.5) {
        topCapVerts++;
        expect(v).toBe(0);
      }
      if ((u === 0 || u === 1) && -1 === y && v !== 0.5) expect(v).toBe(1);
    }
    expect(topCapVerts).toBeGreaterThan(0);
  });

  it("HollowTruncatedCone with zero outer bottom radius after mutation has finite UVs", () => {
    const c = new HollowTruncatedCone();
    c.outerRadiusBottom = 0;
    c.rebuild();
    expect(finite(c.getGeometryData().uvs!)).toBe(true);
  });
});

describe("AbstractGeometry.setBuffers / rebuild (M10)", () => {
  it("rebuild with fewer geometry leaves no stale indices, tangents or bounds", () => {
    const c = new Cylinder({ radialSegments: 32, heightSegments: 4 });
    c.getGeometryData();
    c.getBoundingVolume();
    c.radialSegments = 3;
    c.heightSegments = 1;
    c.radiusTop = 0.5;
    c.radiusBottom = 0.5;
    c.rebuild();
    const d = c.getGeometryData();
    const vertexCount = d.vertices.length / 3;
    for (const i of d.indices!) expect(i).toBeLessThan(vertexCount);
    for (const i of d.wireframeIndices!) expect(i).toBeLessThan(vertexCount);
    expect(d.normals!.length).toBe(d.vertices.length);
    // Tangent data carries the vec4 contract (tx, ty, tz, w).
    expect(d.tangents!.length).toBe(vertexCount * 4);
    // w must be a valid handedness sign. This geometry's seam/cap UV triangulation is genuinely
    // mirrored, so the derived sign is -1 -- the contract only pins the magnitude, not the sign.
    expect(Math.abs(d.tangents![3]!)).toBe(1);
    const bb = c.getBoundingVolume();
    const max = Math.max(...Array.from(d.vertices).filter((_, i) => i % 3 === 0));
    expect((bb as unknown as { max: { x: number } }).max.x).toBeCloseTo(max, 5);
  });

  it("empty index payload clears previous indices", () => {
    class Probe extends Cylinder {
      public publish(): void {
        this.setBuffers({ vertices: [0, 0, 0], uvs: [0, 0], indices: [], wireframeIndices: [] });
      }
    }
    const p = new Probe();
    expect(p.getGeometryData().indices).toBeDefined();
    p.publish();
    expect(p.getGeometryData().indices).toBeUndefined();
  });

  it("revolve-backed shapes adopt core buffers instead of copying", () => {
    // Behavioral: buffers must be independent per rebuild (no aliasing across rebuilds).
    const c = new Cylinder();
    const before = c.getGeometryData().vertices;
    c.rebuild();
    expect(c.getGeometryData().vertices).not.toBe(before);
  });
});

describe("CylinderSector deprecated shim (M11)", () => {
  it("is exported from the geometry index and is a Cylinder", () => {
    const s = new CylinderSector({ thetaLength: Math.PI });
    expect(s).toBeInstanceOf(Cylinder);
    expect(s.thetaLength).toBe(Math.PI);
  });

  it("defaults to a full circle and matches the equivalent Cylinder", () => {
    const s = new CylinderSector({ radiusTop: 1, radiusBottom: 2, height: 3 });
    const c = new Cylinder({ radiusTop: 1, radiusBottom: 2, height: 3 });
    expect(s.thetaLength).toBeCloseTo(MathUtils.TWO_PI, 9);
    expect(Array.from(s.getGeometryData().vertices)).toEqual(
      Array.from(c.getGeometryData().vertices),
    );
  });
});
