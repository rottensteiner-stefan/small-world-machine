import { describe, it, expect } from "vitest";
import { Matrix3, Matrix4, Vector3D } from "../../src/math/index.js";

describe("Matrix3", () => {
  it("computes the identity normal matrix for identity Matrix4", () => {
    const m4 = new Matrix4();
    const normalMatrix = new Matrix3().getNormalMatrix(m4);

    expect(normalMatrix.data[0]).toBeCloseTo(1);
    expect(normalMatrix.data[4]).toBeCloseTo(1);
    expect(normalMatrix.data[8]).toBeCloseTo(1);
    expect(normalMatrix.data[1]).toBeCloseTo(0);
    expect(normalMatrix.data[3]).toBeCloseTo(0);
  });

  it("computes correct normal matrix (inverse transpose) for non-uniform scaling", () => {
    // Model matrix with non-uniform scale: (2, 4, 8)
    const m4 = new Matrix4().compose(
      new Vector3D(10, 20, 30),
      new Vector3D(0, 0, 0),
      new Vector3D(2, 4, 8),
    );

    const normalMatrix = new Matrix3().getNormalMatrix(m4);

    // (M^-1)^T for scale (2, 4, 8) has diagonal (1/2, 1/4, 1/8)
    expect(normalMatrix.data[0]).toBeCloseTo(0.5);
    expect(normalMatrix.data[4]).toBeCloseTo(0.25);
    expect(normalMatrix.data[8]).toBeCloseTo(0.125);
    expect(normalMatrix.data[1]).toBeCloseTo(0);
    expect(normalMatrix.data[3]).toBeCloseTo(0);
  });

  it("preserves orthogonality between transformed tangent and normal vectors", () => {
    // Arbitrary rotation + non-uniform scale
    const m4 = new Matrix4().compose(
      new Vector3D(5, -3, 2),
      new Vector3D(0.4, 0.7, -0.3),
      new Vector3D(2, 0.5, 3),
    );

    const normalMatrix = new Matrix3().getNormalMatrix(m4);

    // Tangent vector on surface and normal perpendicular to it in local space
    const localTangent = new Vector3D(1, 1, 0).normalize();
    const localNormal = new Vector3D(-1, 1, 0).normalize();
    expect(localTangent.dot(localNormal)).toBeCloseTo(0);

    // Transform tangent with model matrix (upper 3x3)
    const worldTangent = new Vector3D(
      m4.data[0]! * localTangent.x + m4.data[4]! * localTangent.y + m4.data[8]! * localTangent.z,
      m4.data[1]! * localTangent.x + m4.data[5]! * localTangent.y + m4.data[9]! * localTangent.z,
      m4.data[2]! * localTangent.x + m4.data[6]! * localTangent.y + m4.data[10]! * localTangent.z,
    ).normalize();

    // Transform normal with normal matrix (M^-1)^T
    const nd = normalMatrix.data;
    const worldNormal = new Vector3D(
      nd[0]! * localNormal.x + nd[3]! * localNormal.y + nd[6]! * localNormal.z,
      nd[1]! * localNormal.x + nd[4]! * localNormal.y + nd[7]! * localNormal.z,
      nd[2]! * localNormal.x + nd[5]! * localNormal.y + nd[8]! * localNormal.z,
    ).normalize();

    // World normal and world tangent MUST be orthogonal: dot product = 0
    expect(worldTangent.dot(worldNormal)).toBeCloseTo(0, 5);
  });
});
