import { describe, expect, it } from "vitest";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Matrix4, Vector3D } from "../../src/math/index.js";

describe("BoundingBox.transform (Jim Arvo affine algorithm)", () => {
  it("correctly transforms an AABB with translation", () => {
    const box = new BoundingBox(new Vector3D(-1, -2, -3), new Vector3D(1, 2, 3));
    const mat = new Matrix4();
    Matrix4.translate(10, 20, 30, mat);

    box.transform(mat);

    expect(box.min.x).toBeCloseTo(9);
    expect(box.min.y).toBeCloseTo(18);
    expect(box.min.z).toBeCloseTo(27);
    expect(box.max.x).toBeCloseTo(11);
    expect(box.max.y).toBeCloseTo(22);
    expect(box.max.z).toBeCloseTo(33);
    expect(box.center.x).toBeCloseTo(10);
    expect(box.center.y).toBeCloseTo(20);
    expect(box.center.z).toBeCloseTo(30);
  });

  it("correctly transforms an AABB with 90-degree rotation around Y", () => {
    const box = new BoundingBox(new Vector3D(1, -1, 2), new Vector3D(3, 1, 4));
    const mat = new Matrix4();
    Matrix4.rotateY(Math.PI / 2, mat);

    box.transform(mat);

    // In a right-handed system with rotationY(+PI/2):
    // x' = z, z' = -x
    // z in [2, 4] -> x' in [2, 4]
    // x in [1, 3] -> z' in [-3, -1]
    expect(box.min.x).toBeCloseTo(2);
    expect(box.max.x).toBeCloseTo(4);
    expect(box.min.y).toBeCloseTo(-1);
    expect(box.max.y).toBeCloseTo(1);
    expect(box.min.z).toBeCloseTo(-3);
    expect(box.max.z).toBeCloseTo(-1);
  });

  it("correctly handles negative scaling and anisotropic scales", () => {
    const box = new BoundingBox(new Vector3D(1, 2, 3), new Vector3D(4, 5, 6));
    const mat = new Matrix4();
    Matrix4.scale(-2, 3, -1, mat);

    box.transform(mat);

    expect(box.min.x).toBeCloseTo(-8);
    expect(box.max.x).toBeCloseTo(-2);
    expect(box.min.y).toBeCloseTo(6);
    expect(box.max.y).toBeCloseTo(15);
    expect(box.min.z).toBeCloseTo(-6);
    expect(box.max.z).toBeCloseTo(-3);
  });
});
