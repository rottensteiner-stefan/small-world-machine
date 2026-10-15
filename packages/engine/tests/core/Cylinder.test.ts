import { describe, it, expect } from "vitest";
import { Cylinder } from "../../src/index.js";

describe("Cylinder Geometry", () => {
  it("generates caps by default when openEnded is false", () => {
    const closed = new Cylinder({
      radiusTop: 1,
      radiusBottom: 1,
      height: 2,
      radialSegments: 8,
      heightSegments: 1,
      openEnded: false,
    });
    const geo = closed.getGeometryData();

    expect(closed.openEnded).toBe(false);
    expect(geo.indices).toBeDefined();
    expect(geo.indices!.length).toBeGreaterThan(8 * 2 * 3);
  });

  it("skips top and bottom caps when openEnded is true", () => {
    const closed = new Cylinder({
      radiusTop: 1,
      radiusBottom: 1,
      height: 2,
      radialSegments: 8,
      heightSegments: 1,
      openEnded: false,
    });
    const open = new Cylinder({
      radiusTop: 1,
      radiusBottom: 1,
      height: 2,
      radialSegments: 8,
      heightSegments: 1,
      openEnded: true,
    });

    const closedGeo = closed.getGeometryData();
    const openGeo = open.getGeometryData();

    expect(open.openEnded).toBe(true);
    expect(openGeo.vertices.length).toBeLessThan(closedGeo.vertices.length);
    expect(openGeo.indices!.length).toBeLessThan(closedGeo.indices!.length);
    expect(openGeo.indices!.length).toBe(8 * 2 * 3);
  });

  it("scales side UV coordinates when sideUvRepeat is provided", () => {
    const cyl = new Cylinder({
      radiusTop: 1,
      radiusBottom: 1,
      height: 2,
      radialSegments: 4,
      heightSegments: 1,
      sideUvRepeat: [4, 2],
    });
    const geo = cyl.getGeometryData();
    expect(geo.uvs).toBeDefined();

    // Max U on side surface should match uRepeat (4), max V should match vRepeat (2)
    let maxU = 0;
    let maxV = 0;
    // Side surface has (heightSegments + 1) * (radialSegments + 1) = 2 * 5 = 10 vertices
    const sideVertexCount = 10;
    for (let i = 0; i < sideVertexCount; i++) {
      const u = geo.uvs![i * 2]!;
      const v = geo.uvs![i * 2 + 1]!;
      if (u > maxU) maxU = u;
      if (v > maxV) maxV = v;
    }

    expect(maxU).toBeCloseTo(4.0, 5);
    expect(maxV).toBeCloseTo(2.0, 5);
  });
});
