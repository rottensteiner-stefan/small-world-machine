import { describe, expect, it } from "vitest";
import { Matrix4, Vector3D, Cube } from "../../src/index.js";

describe("Regression Integrity Tests", () => {
  /**
   * Tests that Matrix4.lookAt produces a view matrix that doesn't flip the Y-axis.
   * If an object is at (0, 0, -10) and we look at it from (0, 0, 0) with up (0, 1, 0),
   * a point above it (0, 1, -10) should have a positive Y in view space (before projection).
   */
  it("Matrix4.lookAt should maintain correct Y-orientation", () => {
    const eye = new Vector3D(0, 0, 0);
    const target = new Vector3D(0, 0, -1);
    const up = new Vector3D(0, 1, 0);
    const viewMatrix = new Matrix4();

    Matrix4.lookAt(eye, target, up, viewMatrix);

    // A point 1 unit "up" in world space
    const worldPoint = new Vector3D(0, 1, -1);
    const viewPoint = new Vector3D();
    viewMatrix.transformVector(worldPoint, viewPoint);

    // In view space, looking down -Z, UP should still be +Y
    expect(viewPoint.y).toBeGreaterThan(0);
    expect(viewPoint.y).toBeCloseTo(1);
  });

  /**
   * Tests that Cube geometry indices result in correct winding order (Counter-Clockwise).
   * We check the front face normals.
   */
  it("Cube geometry should have consistent winding order and normals", () => {
    const cube = new Cube({ size: 1, widthSegments: 2, heightSegments: 2, depthSegments: 2 });
    const data = cube.getGeometryData();
    const vertices = data.vertices;
    const normals = data.normals!;

    // Check the front face center (x=0, y=0, z=0.5)
    let foundCenter = false;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const y = vertices[i + 1];
      const z = vertices[i + 2];

      // Look for the center of the front face
      if (Math.abs(x!) < 0.001 && Math.abs(y!) < 0.001 && Math.abs(z! - 0.5) < 0.001) {
        expect(normals[i]).toBeCloseTo(0);
        expect(normals[i + 1]).toBeCloseTo(0);
        expect(normals[i + 2]).toBeCloseTo(1);
        foundCenter = true;
      }
    }
    expect(foundCenter).toBe(true);
  });

  /**
   * Tests Matrix4.compose with rotation.
   * Rotating 90 degrees around X should move Y to Z.
   */
  it("Matrix4.compose should maintain expected Euler YXZ orientation", () => {
    const pos = new Vector3D(0, 0, 0);
    const rot = new Vector3D(Math.PI / 2, 0, 0); // 90 deg around X
    const scale = new Vector3D(1, 1, 1);
    const m = new Matrix4();
    m.compose(pos, rot, scale);

    const v = new Vector3D(0, 1, 0); // Point at Y=1
    const result = new Vector3D();
    m.transformVector(v, result);

    // After 90 deg X rotation, (0, 1, 0) should become (0, 0, 1)
    // depending on the implementation of YXZ.
    // In Matrix4.ts:
    // te[8] = sY * cX * scZ;
    // te[9] = -sX * scZ;
    // te[10] = cY * cX * scZ;
    // For X rotation only (sY=0, cY=1):
    // te[5] = cX * cZ (for z=0, cZ=1) => cX
    // te[6] = sX * cZ => sX
    // So Y' = Y * cX - Z * sX, Z' = Y * sX + Z * cX
    // (0, 1, 0) => Y' = cos(90)=0, Z' = sin(90)=1 => (0, 0, 1)

    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(1);
  });
});
