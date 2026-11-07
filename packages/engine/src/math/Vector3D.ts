import type { Matrix4 } from "./Matrix4.js";
import type { Vector } from "../interfaces/index.js";

/**
 * A class representing a 3D vector.
 * Data is stored as individual properties for fast access in JS engines.
 */
export class Vector3D implements Vector {
  /** Static zero vector to avoid unnecessary allocations. Should be treated as read-only. */
  public static readonly ZERO: Vector3D = new Vector3D(0, 0, 0);

  /**
   * Creates a new Vector3D.
   * @param x The x component. Defaults to 0.
   * @param y The y component. Defaults to 0.
   * @param z The z component. Defaults to 0.
   */
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0,
  ) {}

  /**
   * Sets the components of the vector.
   * @param x The x component.
   * @param y The y component. Defaults to x.
   * @param z The z component. Defaults to y.
   * @returns this
   */
  public set(x: number, y: number = x, z: number = y): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  /**
   * Adds another vector to this one.
   * @param v The vector to add.
   * @returns this
   */
  public add(v: Vector3D): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  /**
   * Subtracts another vector from this one.
   * @param v The vector to subtract.
   * @returns this
   */
  public sub(v: Vector3D): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  /**
   * Scales the vector by a scalar value.
   * @param s The scalar factor.
   * @returns this
   */
  public scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  /**
   * Calculates the dot product of this vector and another.
   * @param v The other vector.
   * @returns The dot product.
   */
  public dot(v: Vector3D): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * Adds a scalar value to all components.
   * @param s The scalar to add.
   * @returns this
   */
  public addScalar(s: number): this {
    this.x += s;
    this.y += s;
    this.z += s;
    return this;
  }

  /**
   * Multiplies the vector components by another vector (component-wise).
   * @param v The vector to multiply by.
   * @returns this
   */
  public multiply(v: Vector3D): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }

  /**
   * Divides the vector by a scalar.
   * @param s The scalar to divide by.
   * @returns this
   */
  public divideScalar(s: number): this {
    return this.scale(1.0 / s);
  }

  /**
   * Calculates the cross product of this vector and another vector.
   * @param v The other vector.
   * @returns this
   */
  public cross(v: Vector3D): this {
    const x: number = this.x;
    const y: number = this.y;
    const z: number = this.z;

    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;

    return this;
  }

  /**
   * Calculates the cross product of two vectors and stores the result in this vector.
   * @param a The first vector.
   * @param b The second vector.
   * @returns this
   */
  public crossVectors(a: Vector3D, b: Vector3D): this {
    const ax: number = a.x;
    const ay: number = a.y;
    const az: number = a.z;
    const bx: number = b.x;
    const by: number = b.y;
    const bz: number = b.z;

    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;

    return this;
  }

  /**
   * Calculates the squared length of the vector.
   * @returns The squared length.
   */
  public lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /**
   * Calculates the Euclidean length of the vector.
   * @returns The length.
   */
  public length(): number {
    return Math.sqrt(this.lengthSq());
  }

  /**
   * Calculates the squared distance to another vector.
   * @param v The other vector.
   * @returns The squared distance.
   */
  public distanceToSq(v: Vector3D): number {
    const dx: number = this.x - v.x;
    const dy: number = this.y - v.y;
    const dz: number = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Calculates the Euclidean distance to another vector.
   * @param v The other vector.
   * @returns The distance.
   */
  public distanceTo(v: Vector3D): number {
    return Math.sqrt(this.distanceToSq(v));
  }

  /**
   * Copies components from another vector.
   * @param v The vector to copy from.
   * @returns this
   */
  public copyFrom(v: Vector3D): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  /**
   * Sets this vector's components to the minimum of its own and the given vector's.
   * @param v The other vector.
   * @returns this
   */
  public min(v: Vector3D): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    return this;
  }

  /**
   * Sets this vector's components to the maximum of its own and the given vector's.
   * @param v The other vector.
   * @returns this
   */
  public max(v: Vector3D): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    return this;
  }

  /**
   * Clones the vector into a new instance.
   * @returns A new Vector3D.
   */
  public clone(): Vector3D {
    return new Vector3D(this.x, this.y, this.z);
  }

  /**
   * Clamps the vector components between min and max vectors.
   * @param min The minimum vector.
   * @param max The maximum vector.
   * @returns this
   */
  public clamp(min: Vector3D, max: Vector3D): this {
    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));
    this.z = Math.max(min.z, Math.min(max.z, this.z));
    return this;
  }

  /**
   * Normalizes the vector to a unit length of 1.
   * @returns this
   */
  public normalize(): this {
    const len: number = this.length();

    if (0.000001 < len) {
      const invLen: number = 1.0 / len;
      this.x *= invLen;
      this.y *= invLen;
      this.z *= invLen;
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
    }

    return this;
  }

  /**
   * Rotates this vector in place by a quaternion. Accepts any quaternion-shaped object
   * (avoids importing the `Quaternion` class here, which would create a circular
   * dependency since `Quaternion` itself imports `Vector3D`).
   * @param q The rotation quaternion (x, y, z, w components).
   * @returns this
   */
  public applyQuaternion(q: { x: number; y: number; z: number; w: number }): this {
    const x: number = this.x;
    const y: number = this.y;
    const z: number = this.z;
    const qx: number = q.x;
    const qy: number = q.y;
    const qz: number = q.z;
    const qw: number = q.w;

    // t = 2 * (q.xyz x v)
    const tx: number = 2 * (qy * z - qz * y);
    const ty: number = 2 * (qz * x - qx * z);
    const tz: number = 2 * (qx * y - qy * x);

    // v' = v + qw * t + (q.xyz x t)
    this.x = x + qw * tx + (qy * tz - qz * ty);
    this.y = y + qw * ty + (qz * tx - qx * tz);
    this.z = z + qw * tz + (qx * ty - qy * tx);

    return this;
  }

  /**
   * Linearly interpolates this vector toward another vector by a factor `t`.
   * @param v The target vector.
   * @param t The interpolation factor, typically in [0, 1] (0 = stays at this, 1 = becomes v).
   * @returns this
   */
  public lerp(v: Vector3D, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  /**
   * Transforms the direction of this vector with a matrix.
   * This ignores the translation component of the matrix.
   * @param m The transformation matrix.
   * @returns this
   */
  public transformDirection(m: Matrix4): this {
    const d: Float32Array = m.data;
    const x: number = this.x;
    const y: number = this.y;
    const z: number = this.z;

    const d0 = d[0]!,
      d4 = d[4]!,
      d8 = d[8]!;
    const d1 = d[1]!,
      d5 = d[5]!,
      d9 = d[9]!;
    const d2 = d[2]!,
      d6 = d[6]!,
      d10 = d[10]!;

    this.x = d0 * x + d4 * y + d8 * z;
    this.y = d1 * x + d5 * y + d9 * z;
    this.z = d2 * x + d6 * y + d10 * z;

    return this.normalize();
  }
}
