import type { Vector3D} from "../math/index.js";
import { MathPool, MathUtils } from "../math/index.js";
import { OBB } from "./OBB.js";
import type { BoundingBox } from "./BoundingBox.js";
import type { BoundingSphere } from "./BoundingSphere.js";

/**
 * OBB-SAT kernel of the collision system: Separating-Axis-Theorem detection and
 * minimum-translation-vector resolution for oriented bounding boxes (and their sphere/box
 * interactions). Extracted from `Collision` (Collision-Kern): the public `Collision`
 * facade delegates here. No behavior change -- every predicate is byte-identical to the
 * pre-split implementation.
 */
export class CollisionObbSolver {
  // Lazily-constructed OBB used by resolveBoxObb/testBoxObb to treat a BoundingBox as an OBB:
  // this module and OBB.ts import each other, so constructing a real OBB eagerly at
  // class-evaluation time risks a half-initialized circular import; the lazy pattern sidesteps
  // that. `testBoxObb` reads only `center`/`halfExtents`/`axes`, which a fresh OBB initializes
  // to the same identity state the former object literal provided.
  private static _tempBoxObb: OBB | undefined;

  private static _getTempBoxObb(): OBB {
    return (this._tempBoxObb ??= new OBB());
  }

  // Scratch state for `_considerAxis`, shared by resolveObbObb's three axis-sweep loops (3 from
  // A, 3 from B, 9 cross products). Plain static fields rather than a per-call state object to
  // stay allocation-free; safe since resolveObbObb never re-enters itself.
  private static _obbSatMinOverlap = Infinity;
  private static _obbSatBestX = 0;
  private static _obbSatBestY = 0;
  private static _obbSatBestZ = 0;
  private static _obbSatBestSign = 1;

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
   * Resolves collision between an axis-aligned box and an oriented bounding box, returning a correction vector.
   * @param b The box.
   * @param o The OBB.
   * @param result Vector to store the correction (points from o to b).
   * @returns True if collision was resolved.
   */
  public static resolveBoxObb(b: BoundingBox, o: OBB, result: Vector3D): boolean {
    const boxAsObb = this._getTempBoxObb();
    boxAsObb.center.copyFrom(b.center);
    boxAsObb.halfExtents.copyFrom(b.max).sub(b.min).scale(0.5);
    return this.resolveObbObb(boxAsObb, o, result);
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
   * Treats a `BoundingBox` as an OBB and performs the SAT test. Returns true if they intersect.
   */
  public static testBoxObb(b: BoundingBox, o: OBB): boolean {
    const boxAsObb = this._getTempBoxObb();
    boxAsObb.center.copyFrom(b.center);
    boxAsObb.halfExtents.copyFrom(b.max).sub(b.min).scale(0.5);
    return this.testObbObb(boxAsObb, o);
  }

  /**
   * Performs the Separating Axis Theorem (SAT) test for two OBBs.
   * Returns true if they intersect.
   */
  public static testObbObb(a: OBB, b: OBB): boolean {
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
   * Performs the sphere-vs-OBB intersection test.
   */
  public static testSphereObb(s: BoundingSphere, o: OBB): boolean {
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
