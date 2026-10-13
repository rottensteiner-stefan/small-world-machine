import { BoundingBox } from "./BoundingBox.js";
import { BoundingSphere } from "./BoundingSphere.js";
import { OBB } from "./OBB.js";
import { ConvexHull } from "./ConvexHull.js";
import { Ray } from "./Ray.js";
import { BoundingVolume } from "../interfaces/index.js";
import { Vector3D, MathPool, MathUtils } from "../math/index.js";
import { BoundingType } from "../enums/index.js";

/**
 * The minimal shape `_satPolytopes` needs: a convex shape's world-space vertices,
 * face normals, and unique edge directions. `ConvexHull` satisfies this
 * structurally; `_boxAsHull`/`_obbAsHull` adapt `BoundingBox`/`OBB` to it too.
 */
interface Polytope {
  vertices: readonly Vector3D[];
  faceNormals: readonly Vector3D[];
  edgeDirections: readonly Vector3D[];
}

/**
 * Static class for collision detection and resolution.
 */
export class Collision {
  private static _tempBoxObb = {
    center: new Vector3D(),
    halfExtents: new Vector3D(),
    axes: [new Vector3D(1, 0, 0), new Vector3D(0, 1, 0), new Vector3D(0, 0, 1)],
  } as unknown as OBB;

  // Reused by sweepSphereBox/sweepSphereObb (CCD) instead of allocating a fresh BoundingBox/Ray
  // per call -- these run up to `maxSubSteps` times per frame per fast-moving sphere body. Only
  // `min`/`max` are ever read by Ray.intersectsBox(), so mutating them via `.set()` and leaving
  // `center` stale is safe. Lazily constructed (not a field initializer) because Collision.ts and
  // BoundingBox.ts import each other; constructing a real BoundingBox at class-evaluation time
  // can run before the circular import has finished resolving, depending on which module a given
  // entry point happens to load first.
  private static _sweepScratchBox: BoundingBox | undefined;
  private static _sweepScratchRay: Ray | undefined;

  // Scratch state for `_considerAxis`, shared by resolveObbObb's three axis-sweep loops (3 from
  // A, 3 from B, 9 cross products). Plain static fields rather than a per-call state object to
  // stay allocation-free; safe since resolveObbObb never re-enters itself.
  private static _obbSatMinOverlap = Infinity;
  private static _obbSatBestX = 0;
  private static _obbSatBestY = 0;
  private static _obbSatBestZ = 0;
  private static _obbSatBestSign = 1;

  // Scratch state for the generic convex-polytope SAT used by every HULL-involving
  // pair (`_satPolytopes`/`_considerHullAxis`), mirroring the `_obbSat*` fields above.
  private static _hullSatMinOverlap = Infinity;
  private static _hullSatBestX = 0;
  private static _hullSatBestY = 0;
  private static _hullSatBestZ = 0;
  private static readonly _satResult = { overlap: 0, x: 0, y: 0, z: 0 };

  // Reused world-space corner arrays for treating a BoundingBox/OBB as an 8-vertex
  // convex hull in `_satPolytopes`, avoiding a fresh Vector3D[8] allocation per test.
  private static _scratchBoxCorners: Vector3D[] = Array.from({ length: 8 }, () => new Vector3D());
  private static _scratchObbCorners: Vector3D[] = Array.from({ length: 8 }, () => new Vector3D());
  private static _boxAxes: Vector3D[] = [
    new Vector3D(1, 0, 0),
    new Vector3D(0, 1, 0),
    new Vector3D(0, 0, 1),
  ];

  /**
   * Performs a collision test between two bounding volumes.
   */
  public static test(a: BoundingVolume, b: BoundingVolume): boolean {
    const distSq: number = a.center.distanceToSq(b.center);
    const sumRad: number = a.getBroadRadius() + b.getBroadRadius();
    if (distSq > sumRad * sumRad) return false;

    // Use specific logic based on types to avoid infinite recursion
    if (BoundingType.SPHERE === a.type && BoundingType.SPHERE === b.type) {
      return this._sphereSphere(a as BoundingSphere, b as BoundingSphere);
    }
    if (BoundingType.BOX === a.type && BoundingType.BOX === b.type) {
      return this._boxBox(a as BoundingBox, b as BoundingBox);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.BOX === b.type) {
      return this._sphereBox(a as BoundingSphere, b as BoundingBox);
    }
    if (BoundingType.BOX === a.type && BoundingType.SPHERE === b.type) {
      return this._sphereBox(b as BoundingSphere, a as BoundingBox);
    }
    if (BoundingType.OBB === a.type && BoundingType.OBB === b.type) {
      return this._obbObb(a as unknown as OBB, b as unknown as OBB);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.OBB === b.type) {
      return this._sphereObb(a as BoundingSphere, b as unknown as OBB);
    }
    if (BoundingType.OBB === a.type && BoundingType.SPHERE === b.type) {
      return this._sphereObb(b as BoundingSphere, a as unknown as OBB);
    }
    if (BoundingType.BOX === a.type && BoundingType.OBB === b.type) {
      return this._boxObb(a as BoundingBox, b as unknown as OBB);
    }
    if (BoundingType.OBB === a.type && BoundingType.BOX === b.type) {
      return this._boxObb(b as BoundingBox, a as unknown as OBB);
    }
    if (BoundingType.HULL === a.type && BoundingType.HULL === b.type) {
      return null !== this._satPolytopes(a as ConvexHull, b as ConvexHull);
    }
    if (BoundingType.HULL === a.type && BoundingType.SPHERE === b.type) {
      return this._hullSphere(a as ConvexHull, b as BoundingSphere);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.HULL === b.type) {
      return this._hullSphere(b as ConvexHull, a as BoundingSphere);
    }
    if (BoundingType.HULL === a.type && BoundingType.BOX === b.type) {
      return null !== this._satPolytopes(a as ConvexHull, this._boxAsHull(b as BoundingBox));
    }
    if (BoundingType.BOX === a.type && BoundingType.HULL === b.type) {
      return null !== this._satPolytopes(b as ConvexHull, this._boxAsHull(a as BoundingBox));
    }
    if (BoundingType.HULL === a.type && BoundingType.OBB === b.type) {
      return null !== this._satPolytopes(a as ConvexHull, this._obbAsHull(b as unknown as OBB));
    }
    if (BoundingType.OBB === a.type && BoundingType.HULL === b.type) {
      return null !== this._satPolytopes(b as ConvexHull, this._obbAsHull(a as unknown as OBB));
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
      return this.resolveSphereSphere(a as BoundingSphere, b as BoundingSphere, result);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.BOX === b.type) {
      return this.resolveSphereBox(a as BoundingSphere, b as BoundingBox, result);
    }
    if (BoundingType.BOX === a.type && BoundingType.SPHERE === b.type) {
      const hit = this.resolveSphereBox(b as BoundingSphere, a as BoundingBox, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.BOX === a.type && BoundingType.BOX === b.type) {
      return this.resolveBoxBox(a as BoundingBox, b as BoundingBox, result);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.OBB === b.type) {
      return this.resolveSphereObb(a as BoundingSphere, b as unknown as OBB, result);
    }
    if (BoundingType.OBB === a.type && BoundingType.SPHERE === b.type) {
      const hit = this.resolveSphereObb(b as BoundingSphere, a as unknown as OBB, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.BOX === a.type && BoundingType.OBB === b.type) {
      return this.resolveBoxObb(a as BoundingBox, b as unknown as OBB, result);
    }
    if (BoundingType.OBB === a.type && BoundingType.BOX === b.type) {
      const hit = this.resolveBoxObb(b as BoundingBox, a as unknown as OBB, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.OBB === a.type && BoundingType.OBB === b.type) {
      return this.resolveObbObb(a as unknown as OBB, b as unknown as OBB, result);
    }
    if (BoundingType.HULL === a.type && BoundingType.HULL === b.type) {
      return this.resolveHullHull(a as ConvexHull, b as ConvexHull, result);
    }
    if (BoundingType.HULL === a.type && BoundingType.SPHERE === b.type) {
      return this.resolveHullSphere(a as ConvexHull, b as BoundingSphere, result);
    }
    if (BoundingType.SPHERE === a.type && BoundingType.HULL === b.type) {
      const hit = this.resolveHullSphere(b as ConvexHull, a as BoundingSphere, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.HULL === a.type && BoundingType.BOX === b.type) {
      return this.resolveHullBox(a as ConvexHull, b as BoundingBox, result);
    }
    if (BoundingType.BOX === a.type && BoundingType.HULL === b.type) {
      const hit = this.resolveHullBox(b as ConvexHull, a as BoundingBox, result);
      if (hit) result.scale(-1);
      return hit;
    }
    if (BoundingType.HULL === a.type && BoundingType.OBB === b.type) {
      return this.resolveHullObb(a as ConvexHull, b as unknown as OBB, result);
    }
    if (BoundingType.OBB === a.type && BoundingType.HULL === b.type) {
      const hit = this.resolveHullObb(b as ConvexHull, a as unknown as OBB, result);
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
    const overlapX = Math.min(b1.max.x, b2.max.x) - Math.max(b1.min.x, b2.min.x);
    if (overlapX <= 0) return false;
    const overlapY = Math.min(b1.max.y, b2.max.y) - Math.max(b1.min.y, b2.min.y);
    if (overlapY <= 0) return false;
    const overlapZ = Math.min(b1.max.z, b2.max.z) - Math.max(b1.min.z, b2.min.z);
    if (overlapZ <= 0) return false;

    // Push out along the single axis of least penetration.
    if (overlapX <= overlapY && overlapX <= overlapZ) {
      const dir = b1.center.x - b2.center.x >= 0 ? 1 : -1;
      result.set(overlapX * dir, 0, 0);
    } else if (overlapY <= overlapX && overlapY <= overlapZ) {
      const dir = b1.center.y - b2.center.y >= 0 ? 1 : -1;
      result.set(0, overlapY * dir, 0);
    } else {
      const dir = b1.center.z - b2.center.z >= 0 ? 1 : -1;
      result.set(0, 0, overlapZ * dir);
    }

    return true;
  }

  /**
   * Resolves collision between an axis-aligned box and an oriented bounding box, returning a correction vector.
   * @param b The box.
   * @param o The OBB.
   * @param result Vector to store the correction (points from o to b).
   * @returns True if collision was resolved.
   */
  public static resolveBoxObb(b: BoundingBox, o: OBB, result: Vector3D): boolean {
    this._tempBoxObb.center.copyFrom(b.center);
    this._tempBoxObb.halfExtents.copyFrom(b.max).sub(b.min).scale(0.5);
    return this.resolveObbObb(this._tempBoxObb, o, result);
  }

  /**
   * Resolves collision between a sphere and an OBB, returning a correction vector.
   * @param s The sphere.
   * @param o The OBB.
   * @param result Vector to store the correction (points from the OBB towards the sphere).
   * @returns True if collision was resolved.
   */
  public static resolveSphereObb(s: BoundingSphere, o: OBB, result: Vector3D): boolean {
    const d = MathPool.acquireVector().copyFrom(s.center).sub(o.center);
    const lx = d.dot(MathUtils.at(o.axes, 0));
    const ly = d.dot(MathUtils.at(o.axes, 1));
    const lz = d.dot(MathUtils.at(o.axes, 2));

    const cx = MathUtils.clamp(lx, -o.halfExtents.x, o.halfExtents.x);
    const cy = MathUtils.clamp(ly, -o.halfExtents.y, o.halfExtents.y);
    const cz = MathUtils.clamp(lz, -o.halfExtents.z, o.halfExtents.z);

    const scratch = MathPool.acquireVector();
    const closest = MathPool.acquireVector().copyFrom(o.center);
    closest.add(scratch.copyFrom(MathUtils.at(o.axes, 0)).scale(cx));
    closest.add(scratch.copyFrom(MathUtils.at(o.axes, 1)).scale(cy));
    closest.add(scratch.copyFrom(MathUtils.at(o.axes, 2)).scale(cz));
    MathPool.releaseVector(scratch);

    // Reuse `d` as the sphere-center-to-closest-point difference.
    d.copyFrom(s.center).sub(closest);
    const distSq = d.lengthSq();
    MathPool.releaseVector(closest);

    if (distSq >= s.radius * s.radius) {
      MathPool.releaseVector(d);
      return false;
    }

    const dist: number = Math.sqrt(distSq);
    if (0.0001 < dist) {
      result
        .copyFrom(d)
        .normalize()
        .scale(s.radius - dist);
    } else {
      // Sphere center is inside the OBB. Push out along the local axis of least penetration.
      const dx1: number = lx + o.halfExtents.x;
      const dx2: number = o.halfExtents.x - lx;
      const dy1: number = ly + o.halfExtents.y;
      const dy2: number = o.halfExtents.y - ly;
      const dz1: number = lz + o.halfExtents.z;
      const dz2: number = o.halfExtents.z - lz;
      const min: number = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
      if (min === dx1) {
        result.copyFrom(MathUtils.at(o.axes, 0)).scale(-(s.radius + dx1));
      } else if (min === dx2) {
        result.copyFrom(MathUtils.at(o.axes, 0)).scale(s.radius + dx2);
      } else if (min === dy1) {
        result.copyFrom(MathUtils.at(o.axes, 1)).scale(-(s.radius + dy1));
      } else if (min === dy2) {
        result.copyFrom(MathUtils.at(o.axes, 1)).scale(s.radius + dy2);
      } else if (min === dz1) {
        result.copyFrom(MathUtils.at(o.axes, 2)).scale(-(s.radius + dz1));
      } else {
        result.copyFrom(MathUtils.at(o.axes, 2)).scale(s.radius + dz2);
      }
    }

    MathPool.releaseVector(d);
    return true;
  }

  /**
   * Resolves collision between two OBBs via the Separating Axis Theorem,
   * returning the minimum-translation-vector correction.
   * @param a The first OBB.
   * @param b The second OBB.
   * @param result Vector to store the correction (points from b to a, along the axis of least penetration).
   * @returns True if collision was resolved.
   */
  public static resolveObbObb(a: OBB, b: OBB, result: Vector3D): boolean {
    const t = MathPool.acquireVector().copyFrom(b.center).sub(a.center);
    this._obbSatMinOverlap = Infinity;

    for (let i = 0; i < 3; i++) {
      if (!this._considerAxis(MathUtils.at(a.axes, i), a, b, t)) {
        MathPool.releaseVector(t);
        return false;
      }
    }

    for (let i = 0; i < 3; i++) {
      if (!this._considerAxis(MathUtils.at(b.axes, i), a, b, t)) {
        MathPool.releaseVector(t);
        return false;
      }
    }

    const crossAxis = MathPool.acquireVector();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        crossAxis.copyFrom(MathUtils.at(a.axes, i)).cross(MathUtils.at(b.axes, j));
        // If axes are parallel, cross product is nearly zero, skip
        if (crossAxis.lengthSq() > 0.0001) {
          crossAxis.normalize();
          if (!this._considerAxis(crossAxis, a, b, t)) {
            MathPool.releaseVector(crossAxis);
            MathPool.releaseVector(t);
            return false;
          }
        }
      }
    }

    MathPool.releaseVector(crossAxis);
    MathPool.releaseVector(t);

    result
      .set(this._obbSatBestX, this._obbSatBestY, this._obbSatBestZ)
      .scale(this._obbSatBestSign * this._obbSatMinOverlap);
    return true;
  }

  /**
   * Considers one candidate SAT separating axis for `resolveObbObb`, updating the shared
   * `_obbSat*` scratch state if this axis has the smallest overlap seen so far. Returns false to
   * signal a separating axis was found (the shared early-exit condition of all three axis-sweep
   * loops there: 3 from A, 3 from B, 9 cross products).
   */
  private static _considerAxis(axis: Vector3D, a: OBB, b: OBB, t: Vector3D): boolean {
    const overlap = this._axisOverlap(axis, a, b, t);
    if (0 > overlap) return false;
    if (overlap < this._obbSatMinOverlap) {
      this._obbSatMinOverlap = overlap;
      this._obbSatBestX = axis.x;
      this._obbSatBestY = axis.y;
      this._obbSatBestZ = axis.z;
      this._obbSatBestSign = 0 <= t.dot(axis) ? -1 : 1;
    }
    return true;
  }

  /**
   * Resolves collision between two convex hulls via the Separating Axis Theorem,
   * returning the minimum-translation-vector correction.
   * @param a The first hull.
   * @param b The second hull.
   * @param result Vector to store the correction (points from b to a, along the axis of least penetration).
   * @returns True if collision was resolved.
   */
  public static resolveHullHull(a: ConvexHull, b: ConvexHull, result: Vector3D): boolean {
    return this._resolvePolytopes(a, b, a.center, b.center, result);
  }

  /**
   * Resolves collision between a convex hull and an axis-aligned box, returning a
   * correction vector (points from the box towards the hull).
   */
  public static resolveHullBox(h: ConvexHull, b: BoundingBox, result: Vector3D): boolean {
    const box = this._boxAsHull(b);
    return this._resolvePolytopes(h, box, h.center, b.center, result);
  }

  /**
   * Resolves collision between a convex hull and an OBB, returning a correction
   * vector (points from the OBB towards the hull).
   */
  public static resolveHullObb(h: ConvexHull, o: OBB, result: Vector3D): boolean {
    const obb = this._obbAsHull(o);
    return this._resolvePolytopes(h, obb, h.center, o.center, result);
  }

  /**
   * Resolves collision between a convex hull and a sphere, returning a correction
   * vector (points from the sphere towards the hull).
   */
  public static resolveHullSphere(h: ConvexHull, s: BoundingSphere, result: Vector3D): boolean {
    const sat = this._satHullSphere(h, s.center, s.radius);
    if (null === sat) return false;

    const t = MathPool.acquireVector().copyFrom(s.center).sub(h.center);
    result.set(sat.x, sat.y, sat.z);
    const sign = 0 <= t.dot(result) ? -1 : 1;
    MathPool.releaseVector(t);

    result.scale(sign * sat.overlap);
    return true;
  }

  /**
   * Shared MTV resolution for any pair of polytope-like shapes (hull/box/obb),
   * given their SAT test result and center-to-center direction. `result` ends up
   * pointing from `centerB` towards `centerA` (i.e. towards `a`).
   */
  private static _resolvePolytopes(
    a: Polytope,
    b: Polytope,
    centerA: Vector3D,
    centerB: Vector3D,
    result: Vector3D,
  ): boolean {
    const sat = this._satPolytopes(a, b);
    if (null === sat) return false;

    const t = MathPool.acquireVector().copyFrom(centerB).sub(centerA);
    result.set(sat.x, sat.y, sat.z);
    const sign = 0 <= t.dot(result) ? -1 : 1;
    MathPool.releaseVector(t);

    result.scale(sign * sat.overlap);
    return true;
  }

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
    const t = ray.intersectsBox(box);
    return t >= 0 && t <= 1 ? t : -1;
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
    const t = ray.intersectsBox(box);
    return t >= 0 && t <= 1 ? t : -1;
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
    const t = ray.intersectsBox(box);
    return t >= 0 && t <= 1 ? t : -1;
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

    const t = ray.intersectsBox(box);
    return t >= 0 && t <= 1 ? t : -1;
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

    const t = ray.intersectsBox(box);
    return t >= 0 && t <= 1 ? t : -1;
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

    const t = ray.intersectsBox(box);
    return t >= 0 && t <= 1 ? t : -1;
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

    const t = ray.intersectsBox(box);
    return t >= 0 && t <= 1 ? t : -1;
  }

  /**
   * Sweeps a mathematical ray / fast projectile from origin with displacement delta against any volume.
   */
  public static sweepRayVolume(origin: Vector3D, delta: Vector3D, volume: BoundingVolume): number {
    const ray = (this._sweepScratchRay ??= new Ray());
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(delta);

    let t = -1;
    if (BoundingType.SPHERE === volume.type) {
      t = ray.intersectsSphere(volume as BoundingSphere);
    } else if (BoundingType.BOX === volume.type) {
      t = ray.intersectsBox(volume as BoundingBox);
    } else if (BoundingType.OBB === volume.type) {
      t = ray.intersectsOBB(volume as OBB);
    }
    return t >= 0 && t <= 1 ? t : -1;
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
      const s = moving as BoundingSphere;
      if (BoundingType.SPHERE === target.type) {
        return this.sweepSphereSphere(origin, delta, s.radius, target as BoundingSphere);
      } else if (BoundingType.BOX === target.type) {
        return this.sweepSphereBox(origin, delta, s.radius, target as BoundingBox);
      } else if (BoundingType.OBB === target.type) {
        return this.sweepSphereObb(origin, delta, s.radius, target as OBB);
      }
    } else if (BoundingType.BOX === moving.type) {
      const b = moving as BoundingBox;
      const hx = (b.max.x - b.min.x) * 0.5;
      const hy = (b.max.y - b.min.y) * 0.5;
      const hz = (b.max.z - b.min.z) * 0.5;
      const half = MathPool.acquireVector().set(hx, hy, hz);
      let t = -1;
      if (BoundingType.BOX === target.type) {
        t = this.sweepBoxBox(origin, delta, half, target as BoundingBox);
      } else if (BoundingType.SPHERE === target.type) {
        t = this.sweepBoxSphere(origin, delta, half, target as BoundingSphere);
      } else if (BoundingType.OBB === target.type) {
        t = this.sweepBoxObb(origin, delta, half, target as OBB);
      }
      MathPool.releaseVector(half);
      return t;
    } else if (BoundingType.OBB === moving.type) {
      const o = moving as OBB;
      if (BoundingType.SPHERE === target.type) {
        return this.sweepObbSphere(origin, delta, o, target as BoundingSphere);
      } else if (BoundingType.BOX === target.type) {
        return this.sweepObbBox(origin, delta, o, target as BoundingBox);
      } else if (BoundingType.OBB === target.type) {
        return this.sweepObbObb(origin, delta, o, target as OBB);
      }
    }
    return -1;
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

  private static _boxObb(b: BoundingBox, o: OBB): boolean {
    this._tempBoxObb.center.copyFrom(b.center);
    this._tempBoxObb.halfExtents.copyFrom(b.max).sub(b.min).scale(0.5);
    return this._obbObb(this._tempBoxObb, o);
  }

  /**
   * Performs the Separating Axis Theorem (SAT) test for two OBBs.
   * Returns true if they intersect.
   */
  private static _obbObb(a: OBB, b: OBB): boolean {
    const t = MathPool.acquireVector().copyFrom(b.center).sub(a.center);

    // We have 15 potential separating axes:
    // 3 from A, 3 from B, 9 cross products of A and B
    for (let i = 0; i < 3; i++) {
      if (!this._testAxis(MathUtils.at(a.axes, i), a, b, t)) return false;
    }
    for (let i = 0; i < 3; i++) {
      if (!this._testAxis(MathUtils.at(b.axes, i), a, b, t)) return false;
    }

    const crossAxis = MathPool.acquireVector();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        crossAxis.copyFrom(MathUtils.at(a.axes, i)).cross(MathUtils.at(b.axes, j));
        // If axes are parallel, cross product is nearly zero, skip
        if (crossAxis.lengthSq() > 0.0001) {
          crossAxis.normalize();
          if (!this._testAxis(crossAxis, a, b, t)) {
            MathPool.releaseVector(crossAxis);
            MathPool.releaseVector(t);
            return false;
          }
        }
      }
    }

    MathPool.releaseVector(crossAxis);
    MathPool.releaseVector(t);
    return true;
  }

  /**
   * Signed SAT overlap along a single axis: positive/zero means the OBBs
   * overlap by that depth along the axis, negative means the axis separates
   * them entirely. Shared by `_testAxis` (boolean detection) and
   * `resolveObbObb` (needs the actual depth to find the minimum-translation axis).
   */
  private static _axisOverlap(axis: Vector3D, a: OBB, b: OBB, t: Vector3D): number {
    // Project OBB A's half-extents onto the axis
    const rA =
      a.halfExtents.x * Math.abs(axis.dot(MathUtils.at(a.axes, 0))) +
      a.halfExtents.y * Math.abs(axis.dot(MathUtils.at(a.axes, 1))) +
      a.halfExtents.z * Math.abs(axis.dot(MathUtils.at(a.axes, 2)));

    // Project OBB B's half-extents onto the axis
    const rB =
      b.halfExtents.x * Math.abs(axis.dot(MathUtils.at(b.axes, 0))) +
      b.halfExtents.y * Math.abs(axis.dot(MathUtils.at(b.axes, 1))) +
      b.halfExtents.z * Math.abs(axis.dot(MathUtils.at(b.axes, 2)));

    // Project the distance vector between centers onto the axis
    const dist = Math.abs(t.dot(axis));

    return rA + rB - dist;
  }

  /**
   * Tests a single axis for SAT. Returns false if a separating gap is found.
   */
  private static _testAxis(axis: Vector3D, a: OBB, b: OBB, t: Vector3D): boolean {
    return 0 <= this._axisOverlap(axis, a, b, t);
  }

  /**
   * Fills and returns the reused world-space corner array for treating a
   * `BoundingBox` as an 8-vertex convex hull for `_satPolytopes` -- its 3 face
   * normals/edge directions are always the world axes.
   */
  private static _boxAsHull(b: BoundingBox): Polytope {
    const c = this._scratchBoxCorners;
    c[0]!.set(b.min.x, b.min.y, b.min.z);
    c[1]!.set(b.max.x, b.min.y, b.min.z);
    c[2]!.set(b.min.x, b.max.y, b.min.z);
    c[3]!.set(b.max.x, b.max.y, b.min.z);
    c[4]!.set(b.min.x, b.min.y, b.max.z);
    c[5]!.set(b.max.x, b.min.y, b.max.z);
    c[6]!.set(b.min.x, b.max.y, b.max.z);
    c[7]!.set(b.max.x, b.max.y, b.max.z);
    return { vertices: c, faceNormals: this._boxAxes, edgeDirections: this._boxAxes };
  }

  /**
   * Fills and returns the reused world-space corner array for treating an `OBB`
   * as an 8-vertex convex hull for `_satPolytopes`.
   */
  private static _obbAsHull(o: OBB): Polytope {
    const c = this._scratchObbCorners;
    const center = o.center;
    const hx = o.halfExtents.x;
    const hy = o.halfExtents.y;
    const hz = o.halfExtents.z;
    const a0 = MathUtils.at(o.axes, 0);
    const a1 = MathUtils.at(o.axes, 1);
    const a2 = MathUtils.at(o.axes, 2);

    let k = 0;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          const ox = sx * hx;
          const oy = sy * hy;
          const oz = sz * hz;
          c[k]!.set(
            center.x + a0.x * ox + a1.x * oy + a2.x * oz,
            center.y + a0.y * ox + a1.y * oy + a2.y * oz,
            center.z + a0.z * ox + a1.z * oy + a2.z * oz,
          );
          k++;
        }
      }
    }
    return { vertices: c, faceNormals: o.axes, edgeDirections: o.axes };
  }

  /**
   * The full Separating Axis Theorem test for two convex polytopes (any
   * combination of `ConvexHull`, `BoundingBox`-as-hull, `OBB`-as-hull): every
   * face normal of both shapes, plus every pairwise cross product between their
   * edge directions, is a candidate separating axis. Returns the minimum-overlap
   * axis and its depth, or `null` if any axis separates them.
   */
  private static _satPolytopes(
    a: Polytope,
    b: Polytope,
  ): { overlap: number; x: number; y: number; z: number } | null {
    this._hullSatMinOverlap = Infinity;

    for (const n of a.faceNormals) {
      if (!this._considerHullAxis(n.x, n.y, n.z, a.vertices, b.vertices)) return null;
    }
    for (const n of b.faceNormals) {
      if (!this._considerHullAxis(n.x, n.y, n.z, a.vertices, b.vertices)) return null;
    }
    for (const ea of a.edgeDirections) {
      for (const eb of b.edgeDirections) {
        const cx = ea.y * eb.z - ea.z * eb.y;
        const cy = ea.z * eb.x - ea.x * eb.z;
        const cz = ea.x * eb.y - ea.y * eb.x;
        if (!this._considerHullAxis(cx, cy, cz, a.vertices, b.vertices)) return null;
      }
    }

    const res = this._satResult;
    res.overlap = this._hullSatMinOverlap;
    res.x = this._hullSatBestX;
    res.y = this._hullSatBestY;
    res.z = this._hullSatBestZ;
    return res;
  }

  /**
   * Considers one candidate SAT axis for `_satPolytopes`, updating the shared
   * `_hullSat*` scratch state if this axis has the smallest overlap seen so far.
   * Returns false to signal a separating axis was found. Near-zero-length axes
   * (parallel edge directions) are skipped, not treated as separating.
   */
  private static _considerHullAxis(
    ax: number,
    ay: number,
    az: number,
    verticesA: readonly Vector3D[],
    verticesB: readonly Vector3D[],
  ): boolean {
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (0.000001 > len) return true;
    const nx = ax / len;
    const ny = ay / len;
    const nz = az / len;

    let minA = Infinity;
    let maxA = -Infinity;
    for (const v of verticesA) {
      const d = v.x * nx + v.y * ny + v.z * nz;
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    let minB = Infinity;
    let maxB = -Infinity;
    for (const v of verticesB) {
      const d = v.x * nx + v.y * ny + v.z * nz;
      if (d < minB) minB = d;
      if (d > maxB) maxB = d;
    }

    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (0 > overlap) return false;
    if (overlap < this._hullSatMinOverlap) {
      this._hullSatMinOverlap = overlap;
      this._hullSatBestX = nx;
      this._hullSatBestY = ny;
      this._hullSatBestZ = nz;
    }
    return true;
  }

  private static _hullSphere(h: ConvexHull, s: BoundingSphere): boolean {
    return null !== this._satHullSphere(h, s.center, s.radius);
  }

  /**
   * SAT test for a convex hull against a sphere: every face normal of the hull is
   * a candidate axis, plus the axis from the sphere's center to the hull's
   * nearest vertex (handling the sphere resting near a corner/edge, where no
   * single face normal alone is the true minimum-separating axis).
   */
  private static _satHullSphere(
    h: ConvexHull,
    center: Vector3D,
    radius: number,
  ): { overlap: number; x: number; y: number; z: number } | null {
    this._hullSatMinOverlap = Infinity;

    for (const n of h.faceNormals) {
      if (!this._considerHullSphereAxis(n.x, n.y, n.z, h.vertices, center, radius)) return null;
    }

    let nearest: Vector3D | undefined;
    let nearestDistSq = Infinity;
    for (const v of h.vertices) {
      const d = v.distanceToSq(center);
      if (d < nearestDistSq) {
        nearestDistSq = d;
        nearest = v;
      }
    }
    if (nearest) {
      const ax = center.x - nearest.x;
      const ay = center.y - nearest.y;
      const az = center.z - nearest.z;
      if (!this._considerHullSphereAxis(ax, ay, az, h.vertices, center, radius)) return null;
    }

    const res = this._satResult;
    res.overlap = this._hullSatMinOverlap;
    res.x = this._hullSatBestX;
    res.y = this._hullSatBestY;
    res.z = this._hullSatBestZ;
    return res;
  }

  private static _considerHullSphereAxis(
    ax: number,
    ay: number,
    az: number,
    vertices: readonly Vector3D[],
    center: Vector3D,
    radius: number,
  ): boolean {
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (0.000001 > len) return true;
    const nx = ax / len;
    const ny = ay / len;
    const nz = az / len;

    let minH = Infinity;
    let maxH = -Infinity;
    for (const v of vertices) {
      const d = v.x * nx + v.y * ny + v.z * nz;
      if (d < minH) minH = d;
      if (d > maxH) maxH = d;
    }
    const c = center.x * nx + center.y * ny + center.z * nz;
    const minS = c - radius;
    const maxS = c + radius;

    const overlap = Math.min(maxH, maxS) - Math.max(minH, minS);
    if (0 > overlap) return false;
    if (overlap < this._hullSatMinOverlap) {
      this._hullSatMinOverlap = overlap;
      this._hullSatBestX = nx;
      this._hullSatBestY = ny;
      this._hullSatBestZ = nz;
    }
    return true;
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

  private static _sphereObb(s: BoundingSphere, o: OBB): boolean {
    const d = MathPool.acquireVector().copyFrom(s.center).sub(o.center);
    const lx = MathUtils.clamp(d.dot(MathUtils.at(o.axes, 0)), -o.halfExtents.x, o.halfExtents.x);
    const ly = MathUtils.clamp(d.dot(MathUtils.at(o.axes, 1)), -o.halfExtents.y, o.halfExtents.y);
    const lz = MathUtils.clamp(d.dot(MathUtils.at(o.axes, 2)), -o.halfExtents.z, o.halfExtents.z);

    const scratch = MathPool.acquireVector();
    const closest = MathPool.acquireVector().copyFrom(o.center);
    closest.add(scratch.copyFrom(MathUtils.at(o.axes, 0)).scale(lx));
    closest.add(scratch.copyFrom(MathUtils.at(o.axes, 1)).scale(ly));
    closest.add(scratch.copyFrom(MathUtils.at(o.axes, 2)).scale(lz));

    const result: boolean = closest.distanceToSq(s.center) <= s.radius * s.radius;
    MathPool.releaseVector(d);
    MathPool.releaseVector(scratch);
    MathPool.releaseVector(closest);
    return result;
  }
}
