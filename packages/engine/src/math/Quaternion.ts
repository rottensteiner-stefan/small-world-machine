import { Vector3D } from "./Vector3D.js";
import type { Matrix4 } from "./Matrix4.js";

/**
 * A class representing a quaternion for rotations.
 */
export class Quaternion {
  /** The x component. */
  public x: number;
  /** The y component. */
  public y: number;
  /** The z component. */
  public z: number;
  /** The w component. */
  public w: number;

  /**
   * Creates a new Quaternion.
   * @param x The x component. Defaults to 0.
   * @param y The y component. Defaults to 0.
   * @param z The z component. Defaults to 0.
   * @param w The w component. Defaults to 1.
   */
  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * Sets the components of the quaternion.
   * @param x The x component.
   * @param y The y component.
   * @param z The z component.
   * @param w The w component.
   * @returns this
   */
  public set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  /**
   * Resets the quaternion to the identity rotation.
   * @returns this
   */
  public identity(): this {
    return this.set(0, 0, 0, 1);
  }

  /**
   * Copies the values from another quaternion.
   * @param q The other quaternion.
   * @returns this
   */
  public copyFrom(q: Quaternion): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  /**
   * Multiplies this quaternion by another (this = this * q).
   * @param q The other quaternion.
   * @returns this
   */
  public multiply(q: Quaternion): this {
    const qax: number = this.x,
      qay: number = this.y,
      qaz: number = this.z,
      qaw: number = this.w;
    const qbx: number = q.x,
      qby: number = q.y,
      qbz: number = q.z,
      qbw: number = q.w;

    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;

    return this;
  }

  /**
   * Pre-multiplies this quaternion by another (this = q * this).
   * @param q The other quaternion.
   * @returns this
   */
  public premultiply(q: Quaternion): this {
    const qax: number = q.x,
      qay: number = q.y,
      qaz: number = q.z,
      qaw: number = q.w;
    const qbx: number = this.x,
      qby: number = this.y,
      qbz: number = this.z,
      qbw: number = this.w;

    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;

    return this;
  }

  /**
   * Sets the quaternion from axis and angle.
   * @param axis The rotation axis (must be normalized).
   * @param angle The rotation angle in radians.
   * @returns this
   */
  public setFromAxisAngle(axis: Vector3D, angle: number): this {
    const halfAngle: number = angle / 2.0;
    const s: number = Math.sin(halfAngle);

    this.x = axis.x * s;
    this.y = axis.y * s;
    this.z = axis.z * s;
    this.w = Math.cos(halfAngle);

    return this;
  }

  /**
   * Sets the quaternion from a rotation matrix.
   * @param m The rotation matrix.
   * @returns this
   */
  public setFromRotationMatrix(m: Matrix4): this {
    const te: Float32Array = m.data;
    const m11: number = te[0]!,
      m12: number = te[4]!,
      m13: number = te[8]!;
    const m21: number = te[1]!,
      m22: number = te[5]!,
      m23: number = te[9]!;
    const m31: number = te[2]!,
      m32: number = te[6]!,
      m33: number = te[10]!;
    const trace: number = m11 + m22 + m33;

    if (0 < trace) {
      const s: number = 0.5 / Math.sqrt(trace + 1.0);
      this.w = 0.25 / s;
      this.x = (m32 - m23) * s;
      this.y = (m13 - m31) * s;
      this.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s: number = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this.w = (m32 - m23) / s;
      this.x = 0.25 * s;
      this.y = (m12 + m21) / s;
      this.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s: number = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this.w = (m13 - m31) / s;
      this.x = (m12 + m21) / s;
      this.y = 0.25 * s;
      this.z = (m23 + m32) / s;
    } else {
      const s: number = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this.w = (m21 - m12) / s;
      this.x = (m13 + m31) / s;
      this.y = (m23 + m32) / s;
      this.z = 0.25 * s;
    }

    return this;
  }

  /**
   * Spherically interpolates this quaternion toward another by a factor `t`, taking the shortest
   * arc (flips `q` if the two quaternions are more than 90 degrees apart). Falls back to linear
   * interpolation + normalize when the two rotations are nearly identical, where slerp's formula
   * becomes numerically unstable (division by a near-zero `sinHalfTheta`).
   * @param q The target quaternion.
   * @param t The interpolation factor, typically in [0, 1] (0 = stays at this, 1 = becomes q).
   * @returns this
   */
  public slerp(q: Quaternion, t: number): this {
    if (0 === t) return this;
    if (1 === t) return this.copyFrom(q);

    const x: number = this.x,
      y: number = this.y,
      z: number = this.z,
      w: number = this.w;
    let qx: number = q.x,
      qy: number = q.y,
      qz: number = q.z,
      qw: number = q.w;

    let cosHalfTheta: number = w * qw + x * qx + y * qy + z * qz;

    if (0 > cosHalfTheta) {
      qw = -qw;
      qx = -qx;
      qy = -qy;
      qz = -qz;
      cosHalfTheta = -cosHalfTheta;
    }

    if (1 <= cosHalfTheta) {
      this.set(x, y, z, w);
      return this;
    }

    const sqrSinHalfTheta: number = 1.0 - cosHalfTheta * cosHalfTheta;
    if (sqrSinHalfTheta <= Number.EPSILON) {
      const s: number = 1 - t;
      this.w = s * w + t * qw;
      this.x = s * x + t * qx;
      this.y = s * y + t * qy;
      this.z = s * z + t * qz;
      return this.normalize();
    }

    const sinHalfTheta: number = Math.sqrt(sqrSinHalfTheta);
    const halfTheta: number = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA: number = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB: number = Math.sin(t * halfTheta) / sinHalfTheta;

    this.w = w * ratioA + qw * ratioB;
    this.x = x * ratioA + qx * ratioB;
    this.y = y * ratioA + qy * ratioB;
    this.z = z * ratioA + qz * ratioB;

    return this;
  }

  /**
   * Calculates the Euclidean length of the quaternion.
   * @returns The length.
   */
  public length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }

  /**
   * Normalizes the quaternion to a unit length of 1.
   * @returns this
   */
  public normalize(): this {
    let l: number = this.length();
    if (0 === l) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    } else {
      l = 1.0 / l;
      this.x *= l;
      this.y *= l;
      this.z *= l;
      this.w *= l;
    }
    return this;
  }

  /**
   * Sets this quaternion from Euler angles (in radians, intrinsic YXZ order).
   * @param euler Vector3D containing rotation angles (x, y, z) in radians.
   * @returns this
   */
  public setFromEuler(euler: Vector3D): this {
    const rx = euler.x * 0.5;
    const ry = euler.y * 0.5;
    const rz = euler.z * 0.5;
    const cx = Math.cos(rx),
      sx = Math.sin(rx);
    const cy = Math.cos(ry),
      sy = Math.sin(ry);
    const cz = Math.cos(rz),
      sz = Math.sin(rz);

    this.x = cy * sx * cz + sy * cx * sz;
    this.y = sy * cx * cz - cy * sx * sz;
    this.z = cy * cx * sz - sy * sx * cz;
    this.w = cy * cx * cz + sy * sx * sz;
    return this;
  }

  /**
   * Converts this quaternion to Euler angles (in radians, intrinsic YXZ order).
   * @param out Target Vector3D to store the Euler angles. If omitted, a new Vector3D is created.
   * @returns The target Vector3D with Euler angles in radians.
   */
  public toEuler(out: Vector3D = new Vector3D()): Vector3D {
    const qx = this.x,
      qy = this.y,
      qz = this.z,
      qw = this.w;
    const sinX = 2 * (qw * qx - qy * qz);
    const clampedSinX = Math.max(-1, Math.min(1, sinX));
    out.x = Math.asin(clampedSinX);

    if (Math.abs(clampedSinX) < 0.99999) {
      out.y = Math.atan2(2 * (qz * qx + qw * qy), 1 - 2 * (qx * qx + qy * qy));
      out.z = Math.atan2(2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz));
    } else {
      out.y = Math.atan2(2 * (qw * qy - qx * qz), 1 - 2 * (qy * qy + qz * qz));
      out.z = 0;
    }
    return out;
  }

  /**
   * Clones the quaternion into a new instance.
   * @returns A new Quaternion.
   */
  public clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }
}
