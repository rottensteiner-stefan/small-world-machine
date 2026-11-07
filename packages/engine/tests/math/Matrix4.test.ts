import { describe, expect, it } from "vitest";
import { Matrix4, Vector3D } from "../../src/index.js";

describe("Matrix4", () => {
  it("should initialize as identity matrix", () => {
    const m = new Matrix4();
    const d = m.data;
    expect(d[0]).toBe(1);
    expect(d[5]).toBe(1);
    expect(d[10]).toBe(1);
    expect(d[15]).toBe(1);
    expect(d[1]).toBe(0);
    expect(d[12]).toBe(0);
  });

  it("should multiply two matrices correctly", () => {
    const m1 = new Matrix4();
    const m2 = new Matrix4();

    // Translation matrix
    m2.data[12] = 10;
    m2.data[13] = 20;
    m2.data[14] = 30;

    m1.multiply(m2);
    expect(m1.data[12]).toBe(10);
    expect(m1.data[13]).toBe(20);
    expect(m1.data[14]).toBe(30);
  });

  it("should invert a translation matrix correctly", () => {
    const m = new Matrix4();
    m.data[12] = 10;
    m.data[13] = 20;
    m.data[14] = 30;

    const inv = new Matrix4();
    const success = m.invert(inv);

    expect(success).toBe(true);
    expect(inv.data[12]).toBe(-10);
    expect(inv.data[13]).toBe(-20);
    expect(inv.data[14]).toBe(-30);
  });

  it("should transform a vector correctly", () => {
    const m = new Matrix4();
    // Translate by 5, 0, 0
    m.data[12] = 5;

    const v = new Vector3D(1, 1, 1);
    m.transformVector(v);

    expect(v.x).toBe(6);
    expect(v.y).toBe(1);
    expect(v.z).toBe(1);
  });

  it("should correctly compose and decompose", () => {
    const m = new Matrix4();
    const pos = new Vector3D(10, 20, 30);
    const rot = new Vector3D(0.5, 0.5, 0.5);
    const scale = new Vector3D(2, 2, 2);

    m.compose(pos, rot, scale);

    const outPos = new Vector3D();
    const outRot = new Vector3D();
    const outScale = new Vector3D();

    m.decompose(outPos, outRot, outScale);

    expect(outPos.x).toBeCloseTo(pos.x);
    expect(outPos.y).toBeCloseTo(pos.y);
    expect(outPos.z).toBeCloseTo(pos.z);

    expect(outScale.x).toBeCloseTo(scale.x);
    expect(outScale.y).toBeCloseTo(scale.y);
    expect(outScale.z).toBeCloseTo(scale.z);

    expect(outRot.x).toBeCloseTo(rot.x);
    expect(outRot.y).toBeCloseTo(rot.y);
    expect(outRot.z).toBeCloseTo(rot.z);
  });

  it("should enforce strictly Right-Handed rotations (X-axis +90 degrees)", () => {
    const m = new Matrix4();
    // Rotate +90 degrees around X-axis
    m.compose(new Vector3D(0, 0, 0), new Vector3D(Math.PI / 2, 0, 0), new Vector3D(1, 1, 1));

    // A forward vector points down -Z
    const forward = new Vector3D(0, 0, -1);
    m.transformVector(forward);

    // If right-handed, rotating +90 around X pitches the forward vector UP (+Y)
    expect(forward.x).toBeCloseTo(0);
    expect(forward.y).toBeCloseTo(1);
    expect(forward.z).toBeCloseTo(0);

    // An up vector points up +Y
    const up = new Vector3D(0, 1, 0);
    m.transformVector(up);

    // If right-handed, rotating +90 around X pitches the up vector BACK (+Z)
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(1);
  });

  describe("scale static method [BLK-C3]", () => {
    it("should handle uniform scale with target", () => {
      const target = new Matrix4();
      const res = Matrix4.scale(3, target);
      expect(res).toBe(target);
      expect(target.data[0]).toBe(3);
      expect(target.data[5]).toBe(3);
      expect(target.data[10]).toBe(3);
      expect(target.data[15]).toBe(1);
    });

    it("should handle uniform scale without target", () => {
      const res = Matrix4.scale(4);
      expect(res).toBeInstanceOf(Matrix4);
      expect(res.data[0]).toBe(4);
      expect(res.data[5]).toBe(4);
      expect(res.data[10]).toBe(4);
      expect(res.data[15]).toBe(1);
    });

    it("should handle 3-number non-uniform scale without target [BLK-C3]", () => {
      const res = Matrix4.scale(2, 3, 4);
      expect(res).toBeInstanceOf(Matrix4);
      expect(res.data[0]).toBe(2);
      expect(res.data[5]).toBe(3);
      expect(res.data[10]).toBe(4);
      expect(res.data[15]).toBe(1);
    });

    it("should handle 3-number non-uniform scale with target", () => {
      const target = new Matrix4();
      const res = Matrix4.scale(5, 6, 7, target);
      expect(res).toBe(target);
      expect(target.data[0]).toBe(5);
      expect(target.data[5]).toBe(6);
      expect(target.data[10]).toBe(7);
      expect(target.data[15]).toBe(1);
    });
  });

  describe("algebraic identities", () => {
    it("M * M^-1 == I for a non-trivial TRS (translation + rotation + non-uniform scale)", () => {
      const m = new Matrix4();
      m.compose(new Vector3D(3, -2, 5), new Vector3D(0.4, -0.3, 0.8), new Vector3D(2, 3, 4));
      const inv = new Matrix4();
      const ok = m.invert(inv);
      expect(ok).toBe(true);

      const prod = new Matrix4().multiply(m).multiply(inv);
      for (let i = 0; i < 16; i++) {
        const expected = i % 5 === 0 ? 1 : 0;
        expect(prod.data[i], `identity violated at data[${i}]`).toBeCloseTo(expected, 6);
      }
    });

    it("determinant of a TRS matrix equals the product of its scale factors", () => {
      const m = new Matrix4();
      m.compose(new Vector3D(0, 0, 0), new Vector3D(0.2, 0.5, -0.4), new Vector3D(2, 3, 4));
      // det(T * R * S) = det(S) = sx * sy * sz for a right-handed TRS.
      expect(m.determinant()).toBeCloseTo(24, 5);
    });

    it("rejects singular matrices on invert", () => {
      const m = Matrix4.scale(0, 0, 0);
      const inv = new Matrix4();
      expect(m.invert(inv)).toBe(false);
    });

    it("a rotation matrix is orthonormal: it preserves vector lengths and dot products", () => {
      const m = new Matrix4();
      m.compose(new Vector3D(0, 0, 0), new Vector3D(-0.3, 0.9, 0.6), new Vector3D(1, 1, 1));

      const u = new Vector3D(1, 2, 3);
      const v = new Vector3D(-4, 5, -6);
      // transformVector mutates in place (see "should transform a vector correctly" above).
      const ru = new Vector3D(u.x, u.y, u.z);
      const rv = new Vector3D(v.x, v.y, v.z);
      m.transformVector(ru);
      m.transformVector(rv);

      // Length preservation.
      expect(ru.length()).toBeCloseTo(u.length(), 6);
      expect(rv.length()).toBeCloseTo(v.length(), 6);
      // Angle (dot product) preservation.
      expect(ru.dot(rv)).toBeCloseTo(u.dot(v), 5);
    });
  });

  describe("lookAt", () => {
    it("should construct valid non-degenerate matrix when eye-target and up are collinear along X-axis", () => {
      const eye = new Vector3D(10, 0, 0);
      const target = new Vector3D(0, 0, 0);
      const up = new Vector3D(1, 0, 0); // parallel to view direction along X
      const m = new Matrix4();

      Matrix4.lookAt(eye, target, up, m);

      // Determinant of a pure rotation/view matrix must be 1.0 (non-degenerate)
      const d = m.determinant();
      expect(Math.abs(d)).toBeCloseTo(1, 3);
    });

    it("should construct valid non-degenerate matrix when eye-target and up are collinear along Y-axis", () => {
      const eye = new Vector3D(0, 10, 0);
      const target = new Vector3D(0, 0, 0);
      const up = new Vector3D(0, 1, 0);
      const m = new Matrix4();

      Matrix4.lookAt(eye, target, up, m);

      const d = m.determinant();
      expect(Math.abs(d)).toBeCloseTo(1, 3);
    });
  });
});
