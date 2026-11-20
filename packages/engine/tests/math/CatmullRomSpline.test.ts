import { describe, expect, it } from "vitest";
import { CatmullRomSpline, Vector3D } from "../../src/index.js";

describe("CatmullRomSpline", () => {
  const points = [
    new Vector3D(0, 0, 0),
    new Vector3D(1, 2, 0),
    new Vector3D(3, 1, 0),
    new Vector3D(4, 0, 0),
  ];

  it("clamps out-of-range t on open splines without throwing (B7)", () => {
    const spline = new CatmullRomSpline(points, false);
    const start = spline.getPoint(-0.5);
    const end = spline.getPoint(1.5);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(4);
    expect(end.y).toBeCloseTo(0);
  });

  it("supports centripetal parameterization (alpha = 0.5) on unevenly spaced control points without loops (S5)", () => {
    const uneven = [
      new Vector3D(-100, 0, 0),
      new Vector3D(0, 0, 0),
      new Vector3D(1, 0, 0),
      new Vector3D(2, 0, 0),
    ];
    const uniformSpline = new CatmullRomSpline(uneven, false, 0);
    const centripetalSpline = new CatmullRomSpline(uneven, false, 0.5);

    // At segment 1 (t = 0.5, halfway along chord p1=[0,0,0] -> p2=[1,0,0]),
    // uniform overshoots wildly to x = 6.6875 due to the long p0->p1 chord, whereas centripetal stays bounded near [0, 1].
    const uMid = uniformSpline.getPoint(0.5);
    const cMid = centripetalSpline.getPoint(0.5);
    expect(uMid.x).toBeGreaterThan(5.0);
    expect(cMid.x).toBeGreaterThanOrEqual(0.0);
    expect(cMid.x).toBeLessThanOrEqual(1.1);

    // Endpoints of internal segment still interpolate p1 and p2 exactly
    const atP1 = centripetalSpline.getPoint(1 / 3);
    const atP2 = centripetalSpline.getPoint(2 / 3);
    expect(atP1.distanceTo(uneven[1]!)).toBeLessThan(1e-6);
    expect(atP2.distanceTo(uneven[2]!)).toBeLessThan(1e-6);
  });
});
