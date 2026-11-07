import { Vector3D } from "./Vector3D.js";
import { Matrix4 } from "./Matrix4.js";
import { Quaternion } from "./Quaternion.js";

/**
 * A pool for mathematical objects to reduce garbage collection pressure.
 */
export class MathPool {
  private static readonly _VECTOR_POOL: Vector3D[] = [];
  private static readonly _MATRIX_POOL: Matrix4[] = [];
  private static readonly _QUATERNION_POOL: Quaternion[] = [];

  /**
   * Acquires a Vector3D from the pool.
   * @returns A Vector3D instance.
   */
  public static acquireVector(): Vector3D {
    const v = this._VECTOR_POOL.pop();
    if (v) {
      return v.set(0, 0, 0);
    }
    return new Vector3D();
  }

  /**
   * Releases a Vector3D back into the pool.
   * @param v The Vector3D to release.
   */
  public static releaseVector(v: Vector3D): void {
    this._VECTOR_POOL.push(v);
  }

  /**
   * Acquires a Matrix4 from the pool.
   * @returns A Matrix4 instance.
   */
  public static acquireMatrix(): Matrix4 {
    const m = this._MATRIX_POOL.pop();
    if (m) {
      return m.identity();
    }
    return new Matrix4();
  }

  /**
   * Releases a Matrix4 back into the pool.
   * @param m The Matrix4 to release.
   */
  public static releaseMatrix(m: Matrix4): void {
    this._MATRIX_POOL.push(m);
  }

  /**
   * Acquires a Quaternion from the pool.
   * @returns A Quaternion instance.
   */
  public static acquireQuaternion(): Quaternion {
    const q = this._QUATERNION_POOL.pop();
    if (q) {
      return q.identity();
    }
    return new Quaternion();
  }

  /**
   * Releases a Quaternion back into the pool.
   * @param q The Quaternion to release.
   */
  public static releaseQuaternion(q: Quaternion): void {
    this._QUATERNION_POOL.push(q);
  }
}
