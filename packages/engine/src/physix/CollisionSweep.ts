import { Vector3D, MathPool, MathUtils } from "../math/index.js";
import { Ray } from "./Ray.js";
import { BoundingBox } from "./BoundingBox.js";
import type { BoundingSphere } from "./BoundingSphere.js";
import type { OBB } from "./OBB.js";
import type { BoundingVolume } from "../interfaces/index.js";
import { BoundingType } from "../enums/index.js";

/**
 * Sweep kernel of the collision system: continuous-collision-detection (CCD) time-of-impact
 * sweeps of a moving volume against a static one, plus the universal `sweep`/`sweepRayVolume`
 * dispatchers. Extracted from `Collision` (Collision-Kern): the public `Collision.sweep*`
 * facade delegates here. No behavior change -- predicates are byte-identical to the pre-split
 * implementation.
 */
export class CollisionSweepSolver {
  // Reused by sweepSphereBox/sweepSphereObb and friends (CCD) instead of allocating a fresh
  // BoundingBox/Ray per call -- these run up to `maxSubSteps` times per frame per fast-moving
  // sphere body. Only `min`/`max` are ever read by Ray.intersectsBox(), so mutating them via
  // `.set()` and leaving `center` stale is safe. Lazily constructed (not a field initializer)
  // because this module and BoundingBox.ts import each other; constructing a real BoundingBox
  // at class-evaluation time can run before the circular import has finished resolving,
  // depending on which module a given entry point happens to load first.
  private static _sweepScratchBox: BoundingBox | undefined;
  private static _sweepScratchRay: Ray | undefined;

  /**
   * Sweeps a moving sphere against a static sphere, used for Continuous Collision Detection
   * (CCD) of fast-moving bodies that could otherwise tunnel through thin/small geometry in a
   * single discrete step.
   * @param origin The moving sphere's center at the start of this step.
   * @param delta The moving sphere's displacement over this step (NOT normalized -- its length
   * matters, since the returned time-of-impact is a fraction of this vector).
   * @param radius The moving sphere's radius.
   * @param s The static sphere to sweep against.
   * @returns The time-of-impact as a fraction of `delta` in `[0, 1]`, or -1 if no impact occurs
   * during this sweep (including if the two spheres already overlap at `origin`, since that's a
   * pre-existing overlap the discrete resolver already handles, not a new tunneling event).
   */
  public static sweepSphereSphere(
    origin: Vector3D,
    delta: Vector3D,
    radius: number,
    s: BoundingSphere,
  ): number {
    const m = MathPool.acquireVector().copyFrom(origin).sub(s.center);
    const sumRad = radius + s.radius;

    const a = delta.lengthSq();
    if (a < 1e-12) {
      MathPool.releaseVector(m);
      return -1;
    }

    const b = 2 * m.dot(delta);
    const c = m.lengthSq() - sumRad * sumRad;
    MathPool.releaseVector(m);

    if (c <= 0) return -1;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return -1;

    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  }

  /**
   * Internal sweep kernel: intersects a ray against an axis-aligned box representing an inflated
   * swept target. If the ray starts inside the box (containsPoint or tmin < 0), returns -1
   * (indicating pre-existing overlap / invalid TOI, rather than returning the exit TOI).
   */
  private static _sweepRayBox(ray: Ray, box: BoundingBox): number {
    if (box.containsPoint(ray.origin)) {
      return -1;
    }

    let tmin = -Infinity;
    let tmax = Infinity;

    const dirX = ray.direction.x;
    const dirY = ray.direction.y;
    const dirZ = ray.direction.z;

    const oriX = ray.origin.x;
    const oriY = ray.origin.y;
    const oriZ = ray.origin.z;

    const invDirX = 1.0 / (0 === dirX ? 1e-10 : dirX);
    const invDirY = 1.0 / (0 === dirY ? 1e-10 : dirY);
    const invDirZ = 1.0 / (0 === dirZ ? 1e-10 : dirZ);

    let t1 = (box.min.x - oriX) * invDirX;
    let t2 = (box.max.x - oriX) * invDirX;
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

    if (tmin < 0 || tmin > tmax) {
      return -1;
    }

    return tmin <= 1 ? tmin : -1;
  }

  /**
   * Sweeps a moving sphere against a static AABB for CCD. Approximates the swept volume as the
   * box expanded by the sphere's radius on every axis (a cheap, standard approximation -- the
   * true Minkowski sum would round the box's edges/corners, which this cheap version doesn't).
   * @param origin The moving sphere's center at the start of this step.
   * @param delta The moving sphere's displacement over this step (not normalized).
   * @param radius The moving sphere's radius.
   * @param b The static box to sweep against.
   * @returns The time-of-impact as a fraction of `delta` in `[0, 1]`, or -1 if no impact.
   */
  public static sweepSphereBox(
    origin: Vector3D,
    delta: Vector3D,
    radius: number,
    b: BoundingBox,
  ): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    const ray = (this._sweepScratchRay ??= new Ray());
    box.min.set(b.min.x - radius, b.min.y - radius, b.min.z - radius);
    box.max.set(b.max.x + radius, b.max.y + radius, b.max.z + radius);
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(delta);
    return this._sweepRayBox(ray, box);
  }

  /**
   * Sweeps a moving sphere against a static OBB for CCD, by transforming the sweep into the
   * OBB's local space (where it becomes an axis-aligned sphere-vs-box sweep, same approach as
   * {@link sweepSphereBox}).
   * @param origin The moving sphere's center at the start of this step.
   * @param delta The moving sphere's displacement over this step (not normalized).
   * @param radius The moving sphere's radius.
   * @param o The static OBB to sweep against.
   * @returns The time-of-impact as a fraction of `delta` in `[0, 1]`, or -1 if no impact.
   */
  public static sweepSphereObb(origin: Vector3D, delta: Vector3D, radius: number, o: OBB): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    const ray = (this._sweepScratchRay ??= new Ray());

    const rel = MathPool.acquireVector().copyFrom(origin).sub(o.center);
    ray.origin.set(
      rel.dot(MathUtils.at(o.axes, 0)),
      rel.dot(MathUtils.at(o.axes, 1)),
      rel.dot(MathUtils.at(o.axes, 2)),
    );
    MathPool.releaseVector(rel);

    ray.direction.set(
      delta.dot(MathUtils.at(o.axes, 0)),
      delta.dot(MathUtils.at(o.axes, 1)),
      delta.dot(MathUtils.at(o.axes, 2)),
    );

    box.min.set(-o.halfExtents.x - radius, -o.halfExtents.y - radius, -o.halfExtents.z - radius);
    box.max.set(o.halfExtents.x + radius, o.halfExtents.y + radius, o.halfExtents.z + radius);
    return this._sweepRayBox(ray, box);
  }

  /**
   * Sweeps a moving AABB against a static AABB for CCD.
   * @param origin Center of moving box at the start of the step.
   * @param delta Displacement vector of the moving box.
   * @param halfExtents Half-extents of the moving box.
   * @param b The static box to sweep against.
   * @returns Time of impact in [0, 1] or -1 if no impact.
   */
  public static sweepBoxBox(
    origin: Vector3D,
    delta: Vector3D,
    halfExtents: Vector3D,
    b: BoundingBox,
  ): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    const ray = (this._sweepScratchRay ??= new Ray());
    box.min.set(b.min.x - halfExtents.x, b.min.y - halfExtents.y, b.min.z - halfExtents.z);
    box.max.set(b.max.x + halfExtents.x, b.max.y + halfExtents.y, b.max.z + halfExtents.z);
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(delta);
    return this._sweepRayBox(ray, box);
  }

  /**
   * Sweeps a moving AABB against a static sphere for CCD.
   * @param origin Center of moving box at the start of the step.
   * @param delta Displacement vector of the moving box.
   * @param halfExtents Half-extents of the moving box.
   * @param s The static sphere to sweep against.
   * @returns Time of impact in [0, 1] or -1 if no impact.
   */
  public static sweepBoxSphere(
    origin: Vector3D,
    delta: Vector3D,
    halfExtents: Vector3D,
    s: BoundingSphere,
  ): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    box.min.set(origin.x - halfExtents.x, origin.y - halfExtents.y, origin.z - halfExtents.z);
    box.max.set(origin.x + halfExtents.x, origin.y + halfExtents.y, origin.z + halfExtents.z);
    const negDelta = MathPool.acquireVector().copyFrom(delta).scale(-1);
    const t = this.sweepSphereBox(s.center, negDelta, s.radius, box);
    MathPool.releaseVector(negDelta);
    return t;
  }

  /**
   * Sweeps a moving AABB against a static OBB for CCD.
   * @param origin Center of moving box at the start of the step.
   * @param delta Displacement vector of the moving box.
   * @param halfExtents Half-extents of the moving box.
   * @param o The static OBB to sweep against.
   * @returns Time of impact in [0, 1] or -1 if no impact.
   */
  public static sweepBoxObb(
    origin: Vector3D,
    delta: Vector3D,
    halfExtents: Vector3D,
    o: OBB,
  ): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    const ray = (this._sweepScratchRay ??= new Ray());

    const rel = MathPool.acquireVector().copyFrom(origin).sub(o.center);
    const u0 = MathUtils.at(o.axes, 0);
    const u1 = MathUtils.at(o.axes, 1);
    const u2 = MathUtils.at(o.axes, 2);

    ray.origin.set(rel.dot(u0), rel.dot(u1), rel.dot(u2));
    MathPool.releaseVector(rel);

    ray.direction.set(delta.dot(u0), delta.dot(u1), delta.dot(u2));

    const r0 =
      halfExtents.x * Math.abs(u0.x) +
      halfExtents.y * Math.abs(u0.y) +
      halfExtents.z * Math.abs(u0.z);
    const r1 =
      halfExtents.x * Math.abs(u1.x) +
      halfExtents.y * Math.abs(u1.y) +
      halfExtents.z * Math.abs(u1.z);
    const r2 =
      halfExtents.x * Math.abs(u2.x) +
      halfExtents.y * Math.abs(u2.y) +
      halfExtents.z * Math.abs(u2.z);

    box.min.set(-o.halfExtents.x - r0, -o.halfExtents.y - r1, -o.halfExtents.z - r2);
    box.max.set(o.halfExtents.x + r0, o.halfExtents.y + r1, o.halfExtents.z + r2);

    return this._sweepRayBox(ray, box);
  }

  /**
   * Sweeps a moving OBB against a static sphere for CCD.
   */
  public static sweepObbSphere(
    origin: Vector3D,
    delta: Vector3D,
    o: OBB,
    s: BoundingSphere,
  ): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    const ray = (this._sweepScratchRay ??= new Ray());

    const rel = MathPool.acquireVector().copyFrom(s.center).sub(origin);
    const u0 = MathUtils.at(o.axes, 0);
    const u1 = MathUtils.at(o.axes, 1);
    const u2 = MathUtils.at(o.axes, 2);

    ray.origin.set(rel.dot(u0), rel.dot(u1), rel.dot(u2));
    MathPool.releaseVector(rel);

    ray.direction.set(-delta.dot(u0), -delta.dot(u1), -delta.dot(u2));

    box.min.set(
      -o.halfExtents.x - s.radius,
      -o.halfExtents.y - s.radius,
      -o.halfExtents.z - s.radius,
    );
    box.max.set(o.halfExtents.x + s.radius, o.halfExtents.y + s.radius, o.halfExtents.z + s.radius);

    return this._sweepRayBox(ray, box);
  }

  /**
   * Sweeps a moving OBB against a static AABB for CCD.
   */
  public static sweepObbBox(origin: Vector3D, delta: Vector3D, o: OBB, b: BoundingBox): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    const ray = (this._sweepScratchRay ??= new Ray());

    const rel = MathPool.acquireVector().copyFrom(b.center).sub(origin);
    const u0 = MathUtils.at(o.axes, 0);
    const u1 = MathUtils.at(o.axes, 1);
    const u2 = MathUtils.at(o.axes, 2);

    ray.origin.set(rel.dot(u0), rel.dot(u1), rel.dot(u2));
    MathPool.releaseVector(rel);

    ray.direction.set(-delta.dot(u0), -delta.dot(u1), -delta.dot(u2));

    const bhx = (b.max.x - b.min.x) * 0.5;
    const bhy = (b.max.y - b.min.y) * 0.5;
    const bhz = (b.max.z - b.min.z) * 0.5;

    const r0 = bhx * Math.abs(u0.x) + bhy * Math.abs(u0.y) + bhz * Math.abs(u0.z);
    const r1 = bhx * Math.abs(u1.x) + bhy * Math.abs(u1.y) + bhz * Math.abs(u1.z);
    const r2 = bhx * Math.abs(u2.x) + bhy * Math.abs(u2.y) + bhz * Math.abs(u2.z);

    box.min.set(-o.halfExtents.x - r0, -o.halfExtents.y - r1, -o.halfExtents.z - r2);
    box.max.set(o.halfExtents.x + r0, o.halfExtents.y + r1, o.halfExtents.z + r2);

    return this._sweepRayBox(ray, box);
  }

  /**
   * Sweeps a moving OBB against a static OBB for CCD.
   */
  public static sweepObbObb(origin: Vector3D, delta: Vector3D, oA: OBB, oB: OBB): number {
    const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    const ray = (this._sweepScratchRay ??= new Ray());

    const rel = MathPool.acquireVector().copyFrom(origin).sub(oB.center);
    const uB0 = MathUtils.at(oB.axes, 0);
    const uB1 = MathUtils.at(oB.axes, 1);
    const uB2 = MathUtils.at(oB.axes, 2);

    ray.origin.set(rel.dot(uB0), rel.dot(uB1), rel.dot(uB2));
    MathPool.releaseVector(rel);

    ray.direction.set(delta.dot(uB0), delta.dot(uB1), delta.dot(uB2));

    const uA0 = MathUtils.at(oA.axes, 0);
    const uA1 = MathUtils.at(oA.axes, 1);
    const uA2 = MathUtils.at(oA.axes, 2);
    const hA = oA.halfExtents;

    const r0 =
      hA.x * Math.abs(uB0.dot(uA0)) + hA.y * Math.abs(uB0.dot(uA1)) + hA.z * Math.abs(uB0.dot(uA2));
    const r1 =
      hA.x * Math.abs(uB1.dot(uA0)) + hA.y * Math.abs(uB1.dot(uA1)) + hA.z * Math.abs(uB1.dot(uA2));
    const r2 =
      hA.x * Math.abs(uB2.dot(uA0)) + hA.y * Math.abs(uB2.dot(uA1)) + hA.z * Math.abs(uB2.dot(uA2));

    box.min.set(-oB.halfExtents.x - r0, -oB.halfExtents.y - r1, -oB.halfExtents.z - r2);
    box.max.set(oB.halfExtents.x + r0, oB.halfExtents.y + r1, oB.halfExtents.z + r2);

    return this._sweepRayBox(ray, box);
  }

  /**
   * Sweeps a mathematical ray / fast projectile from origin with displacement delta against any volume.
   */
  public static sweepRayVolume(origin: Vector3D, delta: Vector3D, volume: BoundingVolume): number {
    const ray = (this._sweepScratchRay ??= new Ray());
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(delta);

    if (BoundingType.SPHERE === volume.type) {
      const s = volume;
      if (origin.distanceToSq(s.center) <= s.radius * s.radius) {
        return -1;
      }
      const t = ray.intersectsSphere(s);
      return t >= 0 && t <= 1 ? t : -1;
    } else if (BoundingType.BOX === volume.type) {
      return this._sweepRayBox(ray, volume);
    } else if (BoundingType.OBB === volume.type) {
      const o = volume;
      const box = (this._sweepScratchBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
      const rel = MathPool.acquireVector().copyFrom(origin).sub(o.center);
      const u0 = MathUtils.at(o.axes, 0);
      const u1 = MathUtils.at(o.axes, 1);
      const u2 = MathUtils.at(o.axes, 2);
      ray.origin.set(rel.dot(u0), rel.dot(u1), rel.dot(u2));
      MathPool.releaseVector(rel);
      ray.direction.set(delta.dot(u0), delta.dot(u1), delta.dot(u2));
      box.min.set(-o.halfExtents.x, -o.halfExtents.y, -o.halfExtents.z);
      box.max.set(o.halfExtents.x, o.halfExtents.y, o.halfExtents.z);
      return this._sweepRayBox(ray, box);
    }
    return -1;
  }

  /**
   * Universal sweep dispatcher: sweeps any moving bounding volume from origin with displacement delta against any static volume.
   * Supports both 3-arg (moving, delta, target) and 4-arg (moving, origin, delta, target) forms.
   * @param moving The moving bounding volume.
   * @param delta Displacement vector.
   * @param target Target static bounding volume.
   * @returns Time of impact in [0, 1] or -1 if no impact.
   */
  public static sweep(moving: BoundingVolume, delta: Vector3D, target: BoundingVolume): number;
  /**
   * 4-arg form of {@link Collision.sweep}: sweeps from an explicit origin.
   * @param moving The moving bounding volume.
   * @param origin Center/origin at start of step.
   * @param delta Displacement vector.
   * @param target Target static bounding volume.
   * @returns Time of impact in [0, 1] or -1 if no impact.
   */
  public static sweep(
    moving: BoundingVolume,
    origin: Vector3D,
    delta: Vector3D,
    target: BoundingVolume,
  ): number;
  public static sweep(
    moving: BoundingVolume,
    originOrDelta: Vector3D,
    deltaOrTarget: Vector3D | BoundingVolume,
    targetParam?: BoundingVolume,
  ): number {
    let origin: Vector3D;
    let delta: Vector3D;
    let target: BoundingVolume;

    if (targetParam !== undefined) {
      origin = originOrDelta;
      delta = deltaOrTarget as Vector3D;
      target = targetParam;
    } else {
      origin = moving.center;
      delta = originOrDelta;
      target = deltaOrTarget as BoundingVolume;
    }

    if (BoundingType.SPHERE === moving.type) {
      const s = moving;
      if (BoundingType.SPHERE === target.type) {
        return this.sweepSphereSphere(origin, delta, s.radius, target);
      } else if (BoundingType.BOX === target.type) {
        return this.sweepSphereBox(origin, delta, s.radius, target);
      } else if (BoundingType.OBB === target.type) {
        return this.sweepSphereObb(origin, delta, s.radius, target);
      }
    } else if (BoundingType.BOX === moving.type) {
      const b = moving;
      const hx = (b.max.x - b.min.x) * 0.5;
      const hy = (b.max.y - b.min.y) * 0.5;
      const hz = (b.max.z - b.min.z) * 0.5;
      const half = MathPool.acquireVector().set(hx, hy, hz);
      let t = -1;
      if (BoundingType.BOX === target.type) {
        t = this.sweepBoxBox(origin, delta, half, target);
      } else if (BoundingType.SPHERE === target.type) {
        t = this.sweepBoxSphere(origin, delta, half, target);
      } else if (BoundingType.OBB === target.type) {
        t = this.sweepBoxObb(origin, delta, half, target);
      }
      MathPool.releaseVector(half);
      return t;
    } else if (BoundingType.OBB === moving.type) {
      const o = moving;
      if (BoundingType.SPHERE === target.type) {
        return this.sweepObbSphere(origin, delta, o, target);
      } else if (BoundingType.BOX === target.type) {
        return this.sweepObbBox(origin, delta, o, target);
      } else if (BoundingType.OBB === target.type) {
        return this.sweepObbObb(origin, delta, o, target);
      }
    }
    return -1;
  }
}
