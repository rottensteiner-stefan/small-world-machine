import { Vector3D, Matrix4 } from "../math/index.js";
import { BoundingVolume, FrustumInterface } from "../interfaces/index.js";
import { BoundingType } from "../enums/index.js";
import { Collision } from "./Collision.js";

/**
 * An Oriented Bounding Box (OBB).
 * Essential for the Separating Axis Theorem (SAT) and precise collisions of rotated objects.
 */
export class OBB implements BoundingVolume {
  public type: BoundingType = BoundingType.OBB;

  /** Center of the OBB in world space. */
  public center: Vector3D = new Vector3D();
  /** Half-extents of the OBB along its local axes (scaled to world space). */
  public halfExtents: Vector3D = new Vector3D(0.5, 0.5, 0.5);

  /**
   * Unscaled local center offset, used as the source of truth for `transform()`.
   */
  private _localCenter: Vector3D = new Vector3D();

  /**
   * Unscaled local half-extents, used as the source of truth for `transform()`.
   * Keeping this separate from `halfExtents` prevents repeated `transform()` calls
   * from cumulatively multiplying the scale into `halfExtents` (see `transform()`).
   */
  private _localHalfExtents: Vector3D = new Vector3D(0.5, 0.5, 0.5);

  /** The 3 orthogonal local axes of the OBB (X, Y, Z). */
  public axes: [Vector3D, Vector3D, Vector3D] = [
    new Vector3D(1, 0, 0),
    new Vector3D(0, 1, 0),
    new Vector3D(0, 0, 1),
  ];

  constructor(center?: Vector3D, halfExtents?: Vector3D) {
    if (center) {
      this.center.copyFrom(center);
      this._localCenter.copyFrom(center);
    }
    if (halfExtents) {
      this.halfExtents.copyFrom(halfExtents);
      this._localHalfExtents.copyFrom(halfExtents);
    }
  }

  /**
   * Sets the unscaled local center offset.
   */
  public setLocalCenter(x: number, y: number, z: number): void {
    this._localCenter.set(x, y, z);
    this.center.set(x, y, z);
  }

  /**
   * Copies the unscaled local center offset from a vector.
   */
  public copyLocalCenterFrom(v: Vector3D): void {
    this._localCenter.copyFrom(v);
    this.center.copyFrom(v);
  }

  /**
   * Sets the unscaled local half-extents (and the current `halfExtents`) from individual
   * components. Use this instead of mutating `halfExtents` directly when the OBB will later
   * be transformed — it is the value `transform()` scales from, so it must be updated whenever
   * the untransformed source bounds change (e.g. once per frame before re-transforming).
   */
  public setLocalHalfExtents(x: number, y: number, z: number): void {
    this._localHalfExtents.set(x, y, z);
    this.halfExtents.set(x, y, z);
  }

  /**
   * Sets the unscaled local half-extents (and the current `halfExtents`) from a vector.
   * See `setLocalHalfExtents()` for why this should be preferred over mutating `halfExtents`.
   */
  public copyLocalHalfExtentsFrom(v: Vector3D): void {
    this._localHalfExtents.copyFrom(v);
    this.halfExtents.copyFrom(v);
  }

  public getBroadRadius(): number {
    return this.halfExtents.length();
  }

  public intersectsFrustum(frustum: FrustumInterface): boolean {
    const c: Vector3D = this.center;
    const hx: number = this.halfExtents.x;
    const hy: number = this.halfExtents.y;
    const hz: number = this.halfExtents.z;
    const a0: Vector3D = this.axes[0];
    const a1: Vector3D = this.axes[1];
    const a2: Vector3D = this.axes[2];
    const p: Float32Array = frustum.planes;

    for (let i: number = 0; 6 > i; i++) {
      const idx: number = i * 4;
      const nx: number = p[idx]!;
      const ny: number = p[idx + 1]!;
      const nz: number = p[idx + 2]!;
      const dPlane: number = p[idx + 3]!;

      // Project the OBB's half-extents onto the frustum plane normal
      // This is mathematically equivalent to checking all 8 corners.
      const r: number =
        hx * Math.abs(nx * a0.x + ny * a0.y + nz * a0.z) +
        hy * Math.abs(nx * a1.x + ny * a1.y + nz * a1.z) +
        hz * Math.abs(nx * a2.x + ny * a2.y + nz * a2.z);

      // Distance from the OBB center to the plane
      const dist: number = nx * c.x + ny * c.y + nz * c.z + dPlane;

      if (-r > dist) {
        return false;
      }
    }
    return true;
  }

  public intersectsVolume(other: BoundingVolume): boolean {
    return Collision.test(this, other);
  }

  public containsVolume(_other: BoundingVolume): boolean {
    // Not implemented for broad phase yet
    return false;
  }

  /**
   * Transforms this OBB using a world matrix.
   * @param matrix The transformation matrix.
   */
  public transform(matrix: Matrix4): void {
    const e = matrix.data;

    // 1. Transform local center to world position
    this.center.copyFrom(this._localCenter);
    matrix.transformVector(this.center);

    // 2. Extract rotation (local axes) and scale
    const sx = Math.hypot(e[0]!, e[1]!, e[2]!);
    const sy = Math.hypot(e[4]!, e[5]!, e[6]!);
    const sz = Math.hypot(e[8]!, e[9]!, e[10]!);

    this.axes[0].set(e[0]!, e[1]!, e[2]!);
    if (sx > 0.00001) this.axes[0].scale(1.0 / sx);
    else this.axes[0].set(1, 0, 0);

    this.axes[1].set(e[4]!, e[5]!, e[6]!);
    if (sy > 0.00001) this.axes[1].scale(1.0 / sy);
    else this.axes[1].set(0, 1, 0);

    this.axes[2].set(e[8]!, e[9]!, e[10]!);
    if (sz > 0.00001) this.axes[2].scale(1.0 / sz);
    else this.axes[2].set(0, 0, 1);

    // 3. Extract scale and apply to the unscaled local half extents.
    // Always deriving from `_localHalfExtents` (rather than multiplying `halfExtents`
    // in place) keeps repeated `transform()` calls idempotent instead of cumulative.
    this.halfExtents.x = this._localHalfExtents.x * sx;
    this.halfExtents.y = this._localHalfExtents.y * sy;
    this.halfExtents.z = this._localHalfExtents.z * sz;
  }

  /**
   * Clones this OBB.
   */
  public clone(): OBB {
    const copy = new OBB();
    copy.center.copyFrom(this.center);
    copy._localCenter.copyFrom(this._localCenter);
    copy.halfExtents.copyFrom(this.halfExtents);
    copy._localHalfExtents.copyFrom(this._localHalfExtents);
    copy.axes[0].copyFrom(this.axes[0]);
    copy.axes[1].copyFrom(this.axes[1]);
    copy.axes[2].copyFrom(this.axes[2]);
    return copy;
  }
}
