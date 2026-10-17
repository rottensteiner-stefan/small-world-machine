import type { BoundingBox } from "./BoundingBox.js";
import type { BoundingSphere } from "./BoundingSphere.js";
import type { OBB } from "./OBB.js";
import { BoundingType } from "../enums/index.js";
import type { BoundingVolume } from "../interfaces/index.js";
import { Vector3D, MathPool } from "../math/index.js";

/**
 * Represents a mathematical ray in 3D space.
 */
export class Ray {
  /**
   * Creates a new Ray.
   * @param origin The origin point of the ray.
   * @param direction The normalized direction vector of the ray.
   */
  constructor(
    public origin: Vector3D = new Vector3D(),
    public direction: Vector3D = new Vector3D(0, 0, -1),
  ) {}

  /**
   * Sets the ray's origin and direction.
   * @param origin The new origin.
   * @param direction The new normalized direction.
   * @returns This ray instance.
   */
  public set(origin: Vector3D, direction: Vector3D): this {
    this.origin.copyFrom(origin);
    this.direction.copyFrom(direction);
    return this;
  }

  /**
   * Computes the point along the ray at a given distance.
   * @param t The distance along the ray.
   * @param target Optional target vector.
   * @returns The computed point.
   */
  public at(t: number, target: Vector3D = new Vector3D()): Vector3D {
    return target.copyFrom(this.direction).scale(t).add(this.origin);
  }

  /**
   * Tests whether this ray intersects the given AABB.
   * Uses the slab method.
   * @param box The axis-aligned bounding box.
   * @returns The distance `t` to the intersection, or -1 if no intersection.
   */
  public intersectsBox(box: BoundingBox): number {
    let tmin: number = -Infinity;
    let tmax: number = Infinity;

    const dirX: number = this.direction.x;
    const dirY: number = this.direction.y;
    const dirZ: number = this.direction.z;

    const oriX: number = this.origin.x;
    const oriY: number = this.origin.y;
    const oriZ: number = this.origin.z;

    const invDirX: number = 1.0 / (0 === dirX ? 1e-10 : dirX);
    const invDirY: number = 1.0 / (0 === dirY ? 1e-10 : dirY);
    const invDirZ: number = 1.0 / (0 === dirZ ? 1e-10 : dirZ);

    let t1: number = (box.min.x - oriX) * invDirX;
    let t2: number = (box.max.x - oriX) * invDirX;

    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));

    t1 = (box.min.y - oriY) * invDirY;
    t2 = (box.max.y - oriY) * invDirY;

    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));

    t1 = (box.min.z - oriZ) * invDirZ;
    t2 = (box.max.z - oriZ) * invDirZ;

    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));

    if (tmax >= tmin && 0 <= tmax) {
      return 0 <= tmin ? tmin : tmax;
    }

    return -1;
  }

  /**
   * Tests whether this ray intersects the given bounding sphere.
   * @param sphere The bounding sphere.
   * @returns The distance `t` to the nearest intersection, or -1 if no intersection.
   */
  public intersectsSphere(sphere: BoundingSphere): number {
    const ocX = this.origin.x - sphere.center.x;
    const ocY = this.origin.y - sphere.center.y;
    const ocZ = this.origin.z - sphere.center.z;

    const dirX = this.direction.x;
    const dirY = this.direction.y;
    const dirZ = this.direction.z;

    const a = dirX * dirX + dirY * dirY + dirZ * dirZ;
    const b = 2 * (ocX * dirX + ocY * dirY + ocZ * dirZ);
    const c = ocX * ocX + ocY * ocY + ocZ * ocZ - sphere.radius * sphere.radius;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0 || 0 === a) return -1;

    const sqrtDiscriminant = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDiscriminant) / (2 * a);
    const t2 = (-b + sqrtDiscriminant) / (2 * a);

    if (0 <= t1) return t1;
    if (0 <= t2) return t2;
    return -1;
  }

  /**
   * Tests whether this ray intersects the given OBB.
   * Uses the slab method projected onto the OBB's local axes.
   * @param obb The oriented bounding box.
   * @returns The distance `t` to the nearest intersection, or -1 if no intersection.
   */
  public intersectsOBB(obb: OBB): number {
    let tmin = -Infinity;
    let tmax = Infinity;

    const pX = this.origin.x - obb.center.x;
    const pY = this.origin.y - obb.center.y;
    const pZ = this.origin.z - obb.center.z;

    // Axis 0 (X)
    {
      const a = obb.axes[0];
      const e = a.x * this.direction.x + a.y * this.direction.y + a.z * this.direction.z;
      const f = a.x * pX + a.y * pY + a.z * pZ;
      const hi = obb.halfExtents.x;
      if (Math.abs(e) > 1e-10) {
        let t1 = (-f - hi) / e;
        let t2 = (-f + hi) / e;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax || tmax < 0) return -1;
      } else if (-f - hi > 0 || -f + hi < 0) {
        return -1;
      }
    }

    // Axis 1 (Y)
    {
      const a = obb.axes[1];
      const e = a.x * this.direction.x + a.y * this.direction.y + a.z * this.direction.z;
      const f = a.x * pX + a.y * pY + a.z * pZ;
      const hi = obb.halfExtents.y;
      if (Math.abs(e) > 1e-10) {
        let t1 = (-f - hi) / e;
        let t2 = (-f + hi) / e;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax || tmax < 0) return -1;
      } else if (-f - hi > 0 || -f + hi < 0) {
        return -1;
      }
    }

    // Axis 2 (Z)
    {
      const a = obb.axes[2];
      const e = a.x * this.direction.x + a.y * this.direction.y + a.z * this.direction.z;
      const f = a.x * pX + a.y * pY + a.z * pZ;
      const hi = obb.halfExtents.z;
      if (Math.abs(e) > 1e-10) {
        let t1 = (-f - hi) / e;
        let t2 = (-f + hi) / e;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax || tmax < 0) return -1;
      } else if (-f - hi > 0 || -f + hi < 0) {
        return -1;
      }
    }

    if (tmax >= tmin && tmax >= 0) {
      return tmin >= 0 ? tmin : tmax;
    }

    return -1;
  }

  /**
   * Tests whether this ray intersects any bounding volume (Sphere, Box, OBB).
   * @param volume Target bounding volume.
   * @returns Distance t to the nearest intersection, or -1 if no intersection.
   */
  public intersectVolume(volume: BoundingVolume): number {
    if (BoundingType.SPHERE === volume.type) {
      return this.intersectsSphere(volume as BoundingSphere);
    } else if (BoundingType.BOX === volume.type) {
      return this.intersectsBox(volume as BoundingBox);
    } else if (BoundingType.OBB === volume.type) {
      return this.intersectsOBB(volume as import("./OBB.js").OBB);
    }
    return -1;
  }

  /**
   * Tests whether this ray intersects any bounding volume, computing the exact world hit point and outward surface normal.
   * @param volume Target bounding volume.
   * @param outPoint Vector3D receiving the computed world hit position.
   * @param outNormal Vector3D receiving the outward-pointing surface normal.
   * @returns Distance t to the nearest intersection, or -1 if no intersection.
   */
  public intersectVolumeDetailed(
    volume: BoundingVolume,
    outPoint: Vector3D,
    outNormal: Vector3D,
  ): number {
    const t = this.intersectVolume(volume);
    if (t < 0) return -1;

    this.at(t, outPoint);

    if (BoundingType.SPHERE === volume.type) {
      const s = volume as BoundingSphere;
      outNormal.copyFrom(outPoint).sub(s.center);
      const len = outNormal.length();
      if (len > 1e-8) {
        outNormal.scale(1.0 / len);
      } else {
        outNormal.set(0, 1, 0);
      }
    } else if (BoundingType.BOX === volume.type) {
      const b = volume as BoundingBox;
      const dMinX = Math.abs(outPoint.x - b.min.x);
      const dMaxX = Math.abs(outPoint.x - b.max.x);
      const dMinY = Math.abs(outPoint.y - b.min.y);
      const dMaxY = Math.abs(outPoint.y - b.max.y);
      const dMinZ = Math.abs(outPoint.z - b.min.z);
      const dMaxZ = Math.abs(outPoint.z - b.max.z);

      let minD = dMinX;
      outNormal.set(-1, 0, 0);

      if (dMaxX < minD) {
        minD = dMaxX;
        outNormal.set(1, 0, 0);
      }
      if (dMinY < minD) {
        minD = dMinY;
        outNormal.set(0, -1, 0);
      }
      if (dMaxY < minD) {
        minD = dMaxY;
        outNormal.set(0, 1, 0);
      }
      if (dMinZ < minD) {
        minD = dMinZ;
        outNormal.set(0, 0, -1);
      }
      if (dMaxZ < minD) {
        outNormal.set(0, 0, 1);
      }
    } else if (BoundingType.OBB === volume.type) {
      const o = volume as import("./OBB.js").OBB;
      const rel = MathPool.acquireVector().copyFrom(outPoint).sub(o.center);
      const u0 = o.axes[0]!;
      const u1 = o.axes[1]!;
      const u2 = o.axes[2]!;

      const p0 = rel.dot(u0);
      const p1 = rel.dot(u1);
      const p2 = rel.dot(u2);
      MathPool.releaseVector(rel);

      const dMin0 = Math.abs(p0 - -o.halfExtents.x);
      const dMax0 = Math.abs(p0 - o.halfExtents.x);
      const dMin1 = Math.abs(p1 - -o.halfExtents.y);
      const dMax1 = Math.abs(p1 - o.halfExtents.y);
      const dMin2 = Math.abs(p2 - -o.halfExtents.z);
      const dMax2 = Math.abs(p2 - o.halfExtents.z);

      let minD = dMin0;
      outNormal.copyFrom(u0).scale(-1);

      if (dMax0 < minD) {
        minD = dMax0;
        outNormal.copyFrom(u0);
      }
      if (dMin1 < minD) {
        minD = dMin1;
        outNormal.copyFrom(u1).scale(-1);
      }
      if (dMax1 < minD) {
        minD = dMax1;
        outNormal.copyFrom(u1);
      }
      if (dMin2 < minD) {
        minD = dMin2;
        outNormal.copyFrom(u2).scale(-1);
      }
      if (dMax2 < minD) {
        outNormal.copyFrom(u2);
      }
    }
    return t;
  }
}
