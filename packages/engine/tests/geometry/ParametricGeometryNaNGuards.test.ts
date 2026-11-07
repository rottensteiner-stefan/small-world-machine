import { describe, it, expect } from "vitest";
import { Vector2D } from "../../src/math/index.js";
import { Sphere } from "../../src/geometry/Sphere.js";
import { Torus } from "../../src/geometry/Torus.js";
import { Cylinder } from "../../src/geometry/Cylinder.js";
import { Cone } from "../../src/geometry/Cone.js";
import { Capsule } from "../../src/geometry/Capsule.js";
import { Tube } from "../../src/geometry/Tube.js";
import { Plane } from "../../src/geometry/Plane.js";
import { Ground } from "../../src/geometry/Ground.js";
import { Pyramid } from "../../src/geometry/Pyramid.js";
import { Circle } from "../../src/geometry/Circle.js";
import { Disk } from "../../src/geometry/Disk.js";
import { Cube } from "../../src/geometry/Cube.js";
import { Gear } from "../../src/geometry/Gear.js";
import { Octahedron } from "../../src/geometry/Octahedron.js";
import { Terrain } from "../../src/geometry/Terrain.js";
import { ExtrudeGeometry } from "../../src/geometry/ExtrudeGeometry.js";
import type { AbstractGeometry } from "../../src/geometry/AbstractGeometry.js";

function assertNoNaN(geom: AbstractGeometry, name: string): void {
  const data = geom.getGeometryData();
  for (let i = 0; i < data.vertices.length; i++) {
    expect(Number.isNaN(data.vertices[i]), `${name} vertex[${i}] is NaN`).toBe(false);
  }
  if (data.normals) {
    for (let i = 0; i < data.normals.length; i++) {
      expect(Number.isNaN(data.normals[i]), `${name} normal[${i}] is NaN`).toBe(false);
    }
  }
  if (data.uvs) {
    for (let i = 0; i < data.uvs.length; i++) {
      expect(Number.isNaN(data.uvs[i]), `${name} uv[${i}] is NaN`).toBe(false);
    }
  }
}

describe("Parametric Geometries Boundary NaN Guards", () => {
  it("guards Sphere against NaN on zero radius and segments", () => {
    const s = new Sphere({ radius: 0, widthSegments: 0, heightSegments: 0 });
    assertNoNaN(s, "Sphere(0,0,0)");
  });

  it("guards Torus against NaN on zero segments and radii", () => {
    const t = new Torus({ radius: 0, tube: 0, radialSegments: 0, tubularSegments: 0 });
    assertNoNaN(t, "Torus(0,0,0,0)");
  });

  it("guards Cylinder and Cone against NaN on zero segments and dimensions", () => {
    const cyl = new Cylinder({
      radiusTop: 0,
      radiusBottom: 0,
      height: 0,
      radialSegments: 0,
      heightSegments: 0,
    });
    assertNoNaN(cyl, "Cylinder(0,0,0,0,0)");

    const cone = new Cone({ radius: 0, height: 0, radialSegments: 0 });
    assertNoNaN(cone, "Cone(0,0,0)");
  });

  it("guards Capsule against NaN on zero radius and segments", () => {
    const cap = new Capsule({ radius: 0, length: 0, radialSegments: 0, capSegments: 0 });
    assertNoNaN(cap, "Capsule(0,0,0,0)");
  });

  it("guards Tube against NaN on zero dimensions and segments", () => {
    const tube = new Tube({
      radius: 0,
      innerRadius: 0,
      height: 0,
      radialSegments: 0,
      heightSegments: 0,
    });
    assertNoNaN(tube, "Tube(0,0,0,0,0)");
  });

  it("guards Plane and Ground against NaN on zero segments", () => {
    const plane = new Plane({ width: 0, height: 0, widthSegments: 0, heightSegments: 0 });
    assertNoNaN(plane, "Plane(0,0,0,0)");

    const ground = new Ground({ width: 0, depth: 0, widthSegments: 0, depthSegments: 0 });
    assertNoNaN(ground, "Ground(0,0,0,0)");
  });

  it("guards Pyramid, Circle and Disk against NaN on zero segments and radii", () => {
    const pyr = new Pyramid({ base: 0, height: 0, radialSegments: 0 });
    assertNoNaN(pyr, "Pyramid(0,0,0)");

    const circ = new Circle({ radius: 0, segments: 0 });
    assertNoNaN(circ, "Circle(0,0)");

    const disk = new Disk({ radius: 0, segments: 0, rings: 0 });
    assertNoNaN(disk, "Disk(0,0,0)");
  });

  it("guards Cube, Gear and Octahedron against boundary values", () => {
    const cube = new Cube({
      size: 0,
      widthSegments: 0,
      heightSegments: 0,
      depthSegments: 0,
    });
    assertNoNaN(cube, "Cube(0,0,0,0)");

    const gear = new Gear({ teeth: 0, innerRadius: 0, toothHeight: 0, vRatio: 0, thickness: 0 });
    assertNoNaN(gear, "Gear(0,0,0,0,0)");

    const oct = new Octahedron({ radius: 0 });
    assertNoNaN(oct, "Octahedron(0)");
  });

  it("guards Terrain against NaN on degenerate mesh segments", () => {
    const terrain = Terrain.fromHeightData({
      heightData: new Float32Array([0.5]),
      heightmapResolution: 1,
      meshWidthSegments: 0,
      meshDepthSegments: 0,
    });
    assertNoNaN(terrain, "Terrain(1x1, 0 segments)");
  });

  it("guards ExtrudeGeometry against NaN on a zero-perimeter shape", () => {
    // A degenerate shape whose points all coincide has zero perimeter distance,
    // which would divide-by-zero in the side-wall UV computation without the guard.
    const point = new Vector2D(0, 0);
    const extrude = new ExtrudeGeometry({ shape: [point, point, point], depth: 0 });
    assertNoNaN(extrude, "ExtrudeGeometry(zero-perimeter shape)");
  });
});
