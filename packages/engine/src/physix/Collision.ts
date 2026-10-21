import type { BoundingBox } from "./BoundingBox.js";
import type { BoundingSphere } from "./BoundingSphere.js";
import type { OBB } from "./OBB.js";
import type { ConvexHull } from "./ConvexHull.js";
import type { BoundingVolume } from "../interfaces/index.js";
import type { Vector3D } from "../math/index.js";
import { MathPool } from "../math/index.js";
import { BoundingType } from "../enums/index.js";
import { CollisionObbSolver } from "./CollisionObb.js";
import { CollisionHullSolver } from "./CollisionHull.js";
import { CollisionSweepSolver } from "./CollisionSweep.js";

/**
 * Static facade for collision detection and resolution. The algorithmic kernels live in
 * dedicated modules (Collision-Kern): {@link CollisionObbSolver} (OBB-SAT),
 * {@link CollisionHullSolver} (`CollisionHull.ts`, convex-hull SAT) and
 * {@link CollisionSweepSolver} (CCD sweep TOIs). `Collision` keeps the sphere/box
 * primitives and the generic `test`/`resolve` dispatch, and delegates every typed
 * public method to the matching kernel -- so the exact pre-split behavior (byte-identical
 * values) is preserved.
 */
export class Collision {
  /**
   * Performs a collision test between two bounding volumes.
   */
  public static test(a: BoundingVolume, b: BoundingVolume): boolean {
    const distSq: number = a.center.distanceToSq(b.center);
    const sumRad: number = a.getBroadRadius() + b.getBroadRadius();
    if (distSq > sumRad * sumRad) return false;

    // Use specific logic based on types to avoid infinite recursion
    if (BoundingType.SPHERE === a.type && BoundingType.SPHERE === b.type) {
      return this._sphereSphere(a, b);
    }
    if (BoundingType.BOX === a.type && BoundingType.BOX === b.type) {
      return this._boxBox(a, b);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.BOX === b.type) {
      return this._sphereBox(a, b);
    }
    if (BoundingType.BOX === a.type && BoundingType.SPHERE === b.type) {
      return this._sphereBox(b, a);
    }
    if (BoundingType.OBB === a.type && BoundingType.OBB === b.type) {
      return CollisionObbSolver.testObbObb(a, b);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.OBB === b.type) {
      return CollisionObbSolver.testSphereObb(a, b);
    }
    if (BoundingType.OBB === a.type && BoundingType.SPHERE === b.type) {
      return CollisionObbSolver.testSphereObb(b, a);
    }
    if (BoundingType.BOX === a.type && BoundingType.OBB === b.type) {
      return CollisionObbSolver.testBoxObb(a, b);
    }
    if (BoundingType.OBB === a.type && BoundingType.BOX === b.type) {
      return CollisionObbSolver.testBoxObb(b, a);
    }
    if (BoundingType.HULL === a.type && BoundingType.HULL === b.type) {
      return null !== CollisionHullSolver.satPolytopes(a, b);
    }
    if (BoundingType.HULL === a.type && BoundingType.SPHERE === b.type) {
      return CollisionHullSolver.hullSphere(a, b);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.HULL === b.type) {
      return CollisionHullSolver.hullSphere(b, a);
    }
    if (BoundingType.HULL === a.type && BoundingType.BOX === b.type) {
      return null !== CollisionHullSolver.satPolytopes(a, CollisionHullSolver.boxAsHull(b));
    }
    if (BoundingType.BOX === a.type && BoundingType.HULL === b.type) {
      return null !== CollisionHullSolver.satPolytopes(b, CollisionHullSolver.boxAsHull(a));
    }
    if (BoundingType.HULL === a.type && BoundingType.OBB === b.type) {
      return null !== CollisionHullSolver.satPolytopes(a, CollisionHullSolver.obbAsHull(b));
    }
    if (BoundingType.OBB === a.type && BoundingType.HULL === b.type) {
      return null !== CollisionHullSolver.satPolytopes(b, CollisionHullSolver.obbAsHull(a));
    }
    return false;
  }

  /**
   * Resolves collision between two bounding volumes, computing the minimum translation vector (MTV)
   * stored in `result` pointing in the direction to push volume `a` out of volume `b`.
   * @param a The first bounding volume.
   * @param b The second bounding volume.
   * @param result Out vector storing the correction to push `a` away from `b`.
   * @returns True if the volumes are intersecting and MTV was computed, false otherwise.
   */
  public static resolve(a: BoundingVolume, b: BoundingVolume, result: Vector3D): boolean {
    if (BoundingType.SPHERE === a.type && BoundingType.SPHERE === b.type) {
      return this.resolveSphereSphere(a, b, result);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.BOX === b.type) {
      return this.resolveSphereBox(a, b, result);
    }
    if (BoundingType.BOX === a.type && BoundingType.SPHERE === b.type) {
      const hit = this.resolveSphereBox(b, a, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.BOX === a.type && BoundingType.BOX === b.type) {
      return this.resolveBoxBox(a, b, result);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.OBB === b.type) {
      return CollisionObbSolver.resolveSphereObb(a, b, result);
    }
    if (BoundingType.OBB === a.type && BoundingType.SPHERE === b.type) {
      const hit = CollisionObbSolver.resolveSphereObb(b, a, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.BOX === a.type && BoundingType.OBB === b.type) {
      return CollisionObbSolver.resolveBoxObb(a, b, result);
    }
    if (BoundingType.OBB === a.type && BoundingType.BOX === b.type) {
      const hit = CollisionObbSolver.resolveBoxObb(b, a, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.OBB === a.type && BoundingType.OBB === b.type) {
      return CollisionObbSolver.resolveObbObb(a, b, result);
    }
    if (BoundingType.HULL === a.type && BoundingType.HULL === b.type) {
      return CollisionHullSolver.resolveHullHull(a, b, result);
    }
    if (BoundingType.HULL === a.type && BoundingType.SPHERE === b.type) {
      return CollisionHullSolver.resolveHullSphere(a, b, result);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.HULL === b.type) {
      const hit = CollisionHullSolver.resolveHullSphere(b, a, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.HULL === a.type && BoundingType.BOX === b.type) {
      return CollisionHullSolver.resolveHullBox(a, b, result);
    }
    if (BoundingType.BOX === a.type && BoundingType.HULL === b.type) {
      const hit = CollisionHullSolver.resolveHullBox(b, a, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.HULL === a.type && BoundingType.OBB === b.type) {
      return CollisionHullSolver.resolveHullObb(a, b, result);
    }
    if (BoundingType.OBB === a.type && BoundingType.HULL === b.type) {
      const hit = CollisionHullSolver.resolveHullObb(b, a, result);
      if (hit) result.scale(-1);
      return hit;
    }
    return false;
  }

  /**
   * Resolves collision between a sphere and a box, returning a correction vector.
   * @param s The sphere (e.g. Camera).
   * @param b The box (e.g. Wall).
   * @param result Vector to store the correction.
   * @returns True if collision was resolved.
   */
  public static resolveSphereBox(s: BoundingSphere, b: BoundingBox, result: Vector3D): boolean {
    const closest = MathPool.acquireVector().set(
      Math.max(b.min.x, Math.min(s.center.x, b.max.x)),
      Math.max(b.min.y, Math.min(s.center.y, b.max.y)),
      Math.max(b.min.z, Math.min(s.center.z, b.max.z)),
    );

    const diff = MathPool.acquireVector().copyFrom(s.center).sub(closest);
    const distSq = diff.lengthSq();

    if (distSq >= s.radius * s.radius) {
      MathPool.releaseVector(closest);
      MathPool.releaseVector(diff);
      return false;
    }

    const dist: number = Math.sqrt(distSq);
    if (0.0001 > dist) {
      // Sphere center is exactly on the edge or inside. Push out along the axis of least penetration.
      const dx1: number = s.center.x - b.min.x;
      const dx2: number = b.max.x - s.center.x;
      const dy1: number = s.center.y - b.min.y;
      const dy2: number = b.max.y - s.center.y;
      const dz1: number = s.center.z - b.min.z;
      const dz2: number = b.max.z - s.center.z;
      const min: number = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
      if (min === dx1) {
        result.set(-s.radius - dx1, 0, 0);
      } else if (min === dx2) {
        result.set(s.radius + dx2, 0, 0);
      } else if (min === dy1) {
        result.set(0, -s.radius - dy1, 0);
      } else if (min === dy2) {
        result.set(0, s.radius + dy2, 0);
      } else if (min === dz1) {
        result.set(0, 0, -s.radius - dz1);
      } else {
        result.set(0, 0, s.radius + dz2);
      }
    } else {
      const overlap: number = s.radius - dist;
      result.copyFrom(diff).normalize().scale(overlap);
    }

    MathPool.releaseVector(closest);
    MathPool.releaseVector(diff);
    return true;
  }

  /**
   * Resolves collision between two spheres, returning a correction vector.
   * @param s1 The first sphere.
   * @param s2 The second sphere.
   * @param result Vector to store the correction (points from s2 to s1).
   * @returns True if collision was resolved.
   */
  public static resolveSphereSphere(
    s1: BoundingSphere,
    s2: BoundingSphere,
    result: Vector3D,
  ): boolean {
    const diff = MathPool.acquireVector().copyFrom(s1.center).sub(s2.center);
    const distSq = diff.lengthSq();
    const sumRad = s1.radius + s2.radius;

    if (distSq >= sumRad * sumRad) {
      MathPool.releaseVector(diff);
      return false;
    }

    const dist = Math.sqrt(distSq);
    if (dist < 0.0001) {
      // Exactly same center, push up
      result.set(0, 1, 0).scale(sumRad);
    } else {
      const overlap = sumRad - dist;
      result.copyFrom(diff).normalize().scale(overlap);
    }
    MathPool.releaseVector(diff);
    return true;
  }

  /**
   * Resolves collision between two axis-aligned boxes, returning a correction vector.
   * @param b1 The first box.
   * @param b2 The second box.
   * @param result Vector to store the correction (points from b2 to b1, along the axis of least penetration).
   * @returns True if collision was resolved.
   */
  public static resolveBoxBox(b1: BoundingBox, b2: BoundingBox, result: Vector3D): boolean {
    // Per axis the shorter way out: push b1 up (b2.max - b1.min) or down (b1.max - b2.min). That
    // equals the intersection width for partial overlap but, unlike it, stays correct when one
    // box lies inside the other along the axis (a thin plate inside a tall box).
    const upX = b2.max.x - b1.min.x;
    const downX = b1.max.x - b2.min.x;
    if (upX <= 0 || downX <= 0) return false;
    const upY = b2.max.y - b1.min.y;
    const downY = b1.max.y - b2.min.y;
    if (upY <= 0 || downY <= 0) return false;
    const upZ = b2.max.z - b1.min.z;
    const downZ = b1.max.z - b2.min.z;
    if (upZ <= 0 || downZ <= 0) return false;

    const depthX = Math.min(upX, downX);
    const depthY = Math.min(upY, downY);
    const depthZ = Math.min(upZ, downZ);

    // Push out along the single axis of least penetration.
    if (depthX <= depthY && depthX <= depthZ) {
      result.set(upX <= downX ? depthX : -depthX, 0, 0);
    } else if (depthY <= depthX && depthY <= depthZ) {
      result.set(0, upY <= downY ? depthY : -depthY, 0);
    } else {
      result.set(0, 0, upZ <= downZ ? depthZ : -depthZ);
    }

    return true;
  }

  /**
   * Resolves collision between an axis-aligned box and an oriented bounding box, returning a correction vector.
   * Delegates to {@link CollisionObbSolver.resolveBoxObb}.
   */
  public static resolveBoxObb(b: BoundingBox, o: OBB, result: Vector3D): boolean {
    return CollisionObbSolver.resolveBoxObb(b, o, result);
  }

  /**
   * Resolves collision between a sphere and an OBB, returning a correction vector.
   * Delegates to {@link CollisionObbSolver.resolveSphereObb}.
   */
  public static resolveSphereObb(s: BoundingSphere, o: OBB, result: Vector3D): boolean {
    return CollisionObbSolver.resolveSphereObb(s, o, result);
  }

  /**
   * Resolves collision between two OBBs via the Separating Axis Theorem,
   * returning the minimum-translation-vector correction. Delegates to
   * {@link CollisionObbSolver.resolveObbObb}.
   */
  public static resolveObbObb(a: OBB, b: OBB, result: Vector3D): boolean {
    return CollisionObbSolver.resolveObbObb(a, b, result);
  }

  /**
   * Resolves collision between two convex hulls via the Separating Axis Theorem,
   * returning the minimum-translation-vector correction. Delegates to
   * {@link CollisionHullSolver.resolveHullHull}.
   */
  public static resolveHullHull(a: ConvexHull, b: ConvexHull, result: Vector3D): boolean {
    return CollisionHullSolver.resolveHullHull(a, b, result);
  }

  /**
   * Resolves collision between a convex hull and an axis-aligned box, returning a
   * correction vector (points from the box towards the hull). Delegates to
   * {@link CollisionHullSolver.resolveHullBox}.
   */
  public static resolveHullBox(h: ConvexHull, b: BoundingBox, result: Vector3D): boolean {
    return CollisionHullSolver.resolveHullBox(h, b, result);
  }

  /**
   * Resolves collision between a convex hull and an OBB, returning a correction
   * vector (points from the OBB towards the hull). Delegates to
   * {@link CollisionHullSolver.resolveHullObb}.
   */
  public static resolveHullObb(h: ConvexHull, o: OBB, result: Vector3D): boolean {
    return CollisionHullSolver.resolveHullObb(h, o, result);
  }

  /**
   * Resolves collision between a convex hull and a sphere, returning a correction
   * vector (points from the sphere towards the hull). Delegates to
   * {@link CollisionHullSolver.resolveHullSphere}.
   */
  public static resolveHullSphere(h: ConvexHull, s: BoundingSphere, result: Vector3D): boolean {
    return CollisionHullSolver.resolveHullSphere(h, s, result);
  }

  /**
   * Sweeps a moving sphere against a static sphere, used for Continuous Collision Detection
   * (CCD) of fast-moving bodies. Delegates to {@link CollisionSweepSolver.sweepSphereSphere}.
   */
  public static sweepSphereSphere(
    origin: Vector3D,
    delta: Vector3D,
    radius: number,
    s: BoundingSphere,
  ): number {
    return CollisionSweepSolver.sweepSphereSphere(origin, delta, radius, s);
  }

  /**
   * Sweeps a moving sphere against a static AABB for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepSphereBox}.
   */
  public static sweepSphereBox(
    origin: Vector3D,
    delta: Vector3D,
    radius: number,
    b: BoundingBox,
  ): number {
    return CollisionSweepSolver.sweepSphereBox(origin, delta, radius, b);
  }

  /**
   * Sweeps a moving sphere against a static OBB for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepSphereObb}.
   */
  public static sweepSphereObb(origin: Vector3D, delta: Vector3D, radius: number, o: OBB): number {
    return CollisionSweepSolver.sweepSphereObb(origin, delta, radius, o);
  }

  /**
   * Sweeps a moving AABB against a static AABB for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepBoxBox}.
   */
  public static sweepBoxBox(
    origin: Vector3D,
    delta: Vector3D,
    halfExtents: Vector3D,
    b: BoundingBox,
  ): number {
    return CollisionSweepSolver.sweepBoxBox(origin, delta, halfExtents, b);
  }

  /**
   * Sweeps a moving AABB against a static sphere for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepBoxSphere}.
   */
  public static sweepBoxSphere(
    origin: Vector3D,
    delta: Vector3D,
    halfExtents: Vector3D,
    s: BoundingSphere,
  ): number {
    return CollisionSweepSolver.sweepBoxSphere(origin, delta, halfExtents, s);
  }

  /**
   * Sweeps a moving AABB against a static OBB for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepBoxObb}.
   */
  public static sweepBoxObb(
    origin: Vector3D,
    delta: Vector3D,
    halfExtents: Vector3D,
    o: OBB,
  ): number {
    return CollisionSweepSolver.sweepBoxObb(origin, delta, halfExtents, o);
  }

  /**
   * Sweeps a moving OBB against a static sphere for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepObbSphere}.
   */
  public static sweepObbSphere(
    origin: Vector3D,
    delta: Vector3D,
    o: OBB,
    s: BoundingSphere,
  ): number {
    return CollisionSweepSolver.sweepObbSphere(origin, delta, o, s);
  }

  /**
   * Sweeps a moving OBB against a static AABB for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepObbBox}.
   */
  public static sweepObbBox(origin: Vector3D, delta: Vector3D, o: OBB, b: BoundingBox): number {
    return CollisionSweepSolver.sweepObbBox(origin, delta, o, b);
  }

  /**
   * Sweeps a moving OBB against a static OBB for CCD. Delegates to
   * {@link CollisionSweepSolver.sweepObbObb}.
   */
  public static sweepObbObb(origin: Vector3D, delta: Vector3D, oA: OBB, oB: OBB): number {
    return CollisionSweepSolver.sweepObbObb(origin, delta, oA, oB);
  }

  /**
   * Sweeps a mathematical ray / fast projectile from origin with displacement delta against any
   * volume. Delegates to {@link CollisionSweepSolver.sweepRayVolume}.
   */
  public static sweepRayVolume(origin: Vector3D, delta: Vector3D, volume: BoundingVolume): number {
    return CollisionSweepSolver.sweepRayVolume(origin, delta, volume);
  }

  /**
   * Universal sweep dispatcher: sweeps any moving bounding volume from origin with displacement delta against any static volume.
   * Supports both 3-arg (moving, delta, target) and 4-arg (moving, origin, delta, target) forms.
   * Delegates to {@link CollisionSweepSolver.sweep}.
   */
  public static sweep(moving: BoundingVolume, delta: Vector3D, target: BoundingVolume): number;
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
    // Route through the kernel's typed forms so overload resolution holds; the kernel
    // re-disambiguates on `targetParam`, so run-time behavior is unchanged either way.
    if (targetParam === undefined) {
      // 3-arg form: originOrDelta is the delta, deltaOrTarget is the target.
      return CollisionSweepSolver.sweep(moving, originOrDelta, deltaOrTarget as BoundingVolume);
    }
    return CollisionSweepSolver.sweep(
      moving,
      originOrDelta,
      deltaOrTarget as Vector3D,
      targetParam,
    );
  }

  private static _sphereSphere(s1: BoundingSphere, s2: BoundingSphere): boolean {
    const d2: number = s1.center.distanceToSq(s2.center);
    const r2: number = (s1.radius + s2.radius) * (s1.radius + s2.radius);
    return d2 <= r2;
  }

  private static _boxBox(b1: BoundingBox, b2: BoundingBox): boolean {
    return (
      b1.min.x <= b2.max.x &&
      b1.max.x >= b2.min.x &&
      b1.min.y <= b2.max.y &&
      b1.max.y >= b2.min.y &&
      b1.min.z <= b2.max.z &&
      b1.max.z >= b2.min.z
    );
  }

  private static _sphereBox(s: BoundingSphere, b: BoundingBox): boolean {
    const closest = MathPool.acquireVector().set(
      Math.max(b.min.x, Math.min(s.center.x, b.max.x)),
      Math.max(b.min.y, Math.min(s.center.y, b.max.y)),
      Math.max(b.min.z, Math.min(s.center.z, b.max.z)),
    );
    const result: boolean = closest.distanceToSq(s.center) <= s.radius * s.radius;
    MathPool.releaseVector(closest);
    return result;
  }
}
