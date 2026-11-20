import { Vector3D, MathPool, MathUtils } from "../math/index.js";
import { Ray } from "./Ray.js";
import { BoundingBox } from "./BoundingBox.js";
import { BoundingSphere } from "./BoundingSphere.js";
import type { OBB } from "./OBB.js";
import type { BoundingVolume } from "../interfaces/index.js";
import { BoundingType } from "../enums/index.js";

/**
 * A mover that starts already overlapping its target only gets a time-of-impact of 0 when its
 * displacement carries it further in by more than the current penetration plus this tolerance.
 * Resting/sliding contacts (tiny inward drift, e.g. one gravity step) must not be frozen.
 */
const CCD_PENETRATION_TOLERANCE = 0.01;

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
  // Input box of `sweepBoxSphere`: must not alias `_sweepScratchBox`, which `sweepSphereBox`
  // overwrites while it reads its `b` argument.
  private static _sweepScratchInputBox: BoundingBox | undefined;
  // Stand-in sphere for hull targets (see `sweep`: hulls sweep as their bounding sphere).
  private static _sweepScratchSphere: BoundingSphere | undefined;

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
   * during this sweep. If the spheres already overlap at `origin`, the discrete resolver owns the
   * pre-existing overlap (-1) unless the motion drives them clearly deeper (more than the current
   * penetration plus a small tolerance): then the TOI is 0, so a body with residual penetration
   * cannot tunnel through a thin target.
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
    if (c <= 0) {
      // Already overlapping: moving deeper = moving along -m. Inward travel along the contact
      // normal is -(m . delta)/|m|; penetration depth is sumRad - |m|.
      const dist = Math.sqrt(m.lengthSq());
      const inward = dist > 1e-9 ? -m.dot(delta) / dist : delta.length();
      MathPool.releaseVector(m);
      return inward > sumRad - dist + CCD_PENETRATION_TOLERANCE ? 0 : -1;
    }
    MathPool.releaseVector(m);

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return -1;

    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  }

  /**
   * Start-inside case of {@link _sweepRayBox}. `roundRadius > 0` means the box is a sphere-inflated
   * (rounded) target: only a start that really overlaps the rounded shape counts (corner regions of
   * the inflated box do not touch). Returns 0 if the displacement drives the mover deeper than the
   * current penetration plus {@link CCD_PENETRATION_TOLERANCE}, otherwise -1 (the discrete resolver
   * owns resting/separating overlaps).
   */
  private static _sweepStartInside(ray: Ray, box: BoundingBox, roundRadius: number): number {
    const o = ray.origin;
    const d = ray.direction;
    let inward: number;
    let depth: number;
    if (roundRadius > 0) {
      const qx = Math.max(box.min.x + roundRadius, Math.min(o.x, box.max.x - roundRadius));
      const qy = Math.max(box.min.y + roundRadius, Math.min(o.y, box.max.y - roundRadius));
      const qz = Math.max(box.min.z + roundRadius, Math.min(o.z, box.max.z - roundRadius));
      const nx = o.x - qx;
      const ny = o.y - qy;
      const nz = o.z - qz;
      const dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (dist >= roundRadius) return -1; // corner region of the inflated box: not touching
      if (dist > 1e-9) {
        inward = -(d.x * nx + d.y * ny + d.z * nz) / dist;
        depth = roundRadius - dist;
        return inward > depth + CCD_PENETRATION_TOLERANCE ? 0 : -1;
      }
    }
    // Centre inside the (inner) box, or an exact box: nearest face of `box` is the exit axis.
    const dxMin = o.x - box.min.x;
    const dxMax = box.max.x - o.x;
    const dyMin = o.y - box.min.y;
    const dyMax = box.max.y - o.y;
    const dzMin = o.z - box.min.z;
    const dzMax = box.max.z - o.z;
    depth = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
    if (depth === dxMin) inward = d.x;
    else if (depth === dxMax) inward = -d.x;
    else if (depth === dyMin) inward = d.y;
    else if (depth === dyMax) inward = -d.y;
    else if (depth === dzMin) inward = d.z;
    else inward = -d.z;
    return inward > depth + CCD_PENETRATION_TOLERANCE ? 0 : -1;
  }

  /**
   * Internal sweep kernel: intersects a ray against an axis-aligned box representing an inflated
   * swept target. If the ray starts inside the box (containsPoint), the result comes from
   * {@link _sweepStartInside} (TOI 0 when driving deeper, else -1), never the exit TOI.
   */
  private static _sweepRayBox(ray: Ray, box: BoundingBox, roundRadius: number = 0): number {
    if (box.containsPoint(ray.origin)) {
      return this._sweepStartInside(ray, box, roundRadius);
    }

    let tmin = -Infinity;
    let tmax = Infinity;

    const dirX = ray.direction.x;
    const dirY = ray.direction.y;
    const dirZ = ray.direction.z;

    const oriX = ray.origin.x;
    const oriY = ray.origin.y;
    const oriZ = ray.origin.z;

    if (Math.abs(dirX) <= 1e-10) {
      if (oriX < box.min.x || oriX > box.max.x) return -1;
    } else {
      const invDirX = 1.0 / dirX;
      const t1 = (box.min.x - oriX) * invDirX;
      const t2 = (box.max.x - oriX) * invDirX;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax || tmax < 0) return -1;
    }

    if (Math.abs(dirY) <= 1e-10) {
      if (oriY < box.min.y || oriY > box.max.y) return -1;
    } else {
      const invDirY = 1.0 / dirY;
      const t1 = (box.min.y - oriY) * invDirY;
      const t2 = (box.max.y - oriY) * invDirY;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax || tmax < 0) return -1;
    }

    if (Math.abs(dirZ) <= 1e-10) {
      if (oriZ < box.min.z || oriZ > box.max.z) return -1;
    } else {
      const invDirZ = 1.0 / dirZ;
      const t1 = (box.min.z - oriZ) * invDirZ;
      const t2 = (box.max.z - oriZ) * invDirZ;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax || tmax < 0) return -1;
    }

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
    return this._sweepRayBox(ray, box, radius);
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
    return this._sweepRayBox(ray, box, radius);
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
    const box = (this._sweepScratchInputBox ??= new BoundingBox(new Vector3D(), new Vector3D()));
    box.min.set(origin.x - halfExtents.x, origin.y - halfExtents.y, origin.z - halfExtents.z);
    box.max.set(origin.x + halfExtents.x, origin.y + halfExtents.y, origin.z + halfExtents.z);
    const negDelta = MathPool.acquireVector().copyFrom(delta).scale(-1);
    const t = this.sweepSphereBox(s.center, negDelta, s.radius, box);
    MathPool.releaseVector(negDelta);
    return t;
  }

  /**
   * 15-axis Dynamic-SAT sweep between moving box A (at `origin`, moving by `delta`, axes `a0, a1, a2`,
   * half-extents `hA`) and static box B (at `centerB`, axes `b0, b1, b2`, half-extents `hB`).
   */
  private static _sweepDynamicSat15(
    origin: Vector3D,
    delta: Vector3D,
    a0: Vector3D,
    a1: Vector3D,
    a2: Vector3D,
    hA: Vector3D,
    centerB: Vector3D,
    b0: Vector3D,
    b1: Vector3D,
    b2: Vector3D,
    hB: Vector3D,
  ): number {
    const d0x = centerB.x - origin.x;
    const d0y = centerB.y - origin.y;
    const d0z = centerB.z - origin.z;

    let tFirst = -Infinity;
    let tLast = Infinity;
    let minOverlap = Infinity;
    let minInward = 0;

    const testAxis = (lx: number, ly: number, lz: number): boolean => {
      const lenSq = lx * lx + ly * ly + lz * lz;
      if (lenSq <= 1e-8) {
        return true;
      }
      const invLen = Math.abs(lenSq - 1.0) > 1e-6 ? 1.0 / Math.sqrt(lenSq) : 1.0;
      const nx = lx * invLen;
      const ny = ly * invLen;
      const nz = lz * invLen;

      const rA =
        hA.x * Math.abs(nx * a0.x + ny * a0.y + nz * a0.z) +
        hA.y * Math.abs(nx * a1.x + ny * a1.y + nz * a1.z) +
        hA.z * Math.abs(nx * a2.x + ny * a2.y + nz * a2.z);
      const rB =
        hB.x * Math.abs(nx * b0.x + ny * b0.y + nz * b0.z) +
        hB.y * Math.abs(nx * b1.x + ny * b1.y + nz * b1.z) +
        hB.z * Math.abs(nx * b2.x + ny * b2.y + nz * b2.z);
      const R = rA + rB;
      const p0 = d0x * nx + d0y * ny + d0z * nz;
      const v = -(delta.x * nx + delta.y * ny + delta.z * nz);

      const overlap = R - Math.abs(p0);
      if (overlap < minOverlap) {
        minOverlap = overlap;
        // Normal pointing from A towards B has sign(p0); inward velocity of A towards B is -v * sign(p0)
        minInward = p0 >= 0 ? -v : v;
      }

      if (Math.abs(v) <= 1e-10) {
        return Math.abs(p0) <= R;
      }

      const invV = 1.0 / v;
      let t0 = (-R - p0) * invV;
      let t1 = (R - p0) * invV;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      if (t0 > tFirst) tFirst = t0;
      if (t1 < tLast) tLast = t1;
      return tFirst <= tLast && tLast >= 0;
    };

    if (!testAxis(a0.x, a0.y, a0.z)) return -1;
    if (!testAxis(a1.x, a1.y, a1.z)) return -1;
    if (!testAxis(a2.x, a2.y, a2.z)) return -1;

    if (!testAxis(b0.x, b0.y, b0.z)) return -1;
    if (!testAxis(b1.x, b1.y, b1.z)) return -1;
    if (!testAxis(b2.x, b2.y, b2.z)) return -1;

    const aAxes = [a0, a1, a2] as const;
    const bAxes = [b0, b1, b2] as const;
    for (let i = 0; i < 3; i++) {
      const u = aAxes[i]!;
      for (let j = 0; j < 3; j++) {
        const w = bAxes[j]!;
        const cx = u.y * w.z - u.z * w.y;
        const cy = u.z * w.x - u.x * w.z;
        const cz = u.x * w.y - u.y * w.x;
        if (!testAxis(cx, cy, cz)) return -1;
      }
    }

    if (tFirst > tLast || tLast < 0) {
      return -1;
    }

    if (minOverlap >= 0) {
      return minInward > minOverlap + CCD_PENETRATION_TOLERANCE ? 0 : -1;
    }

    return tFirst >= 0 && tFirst <= 1 ? tFirst : -1;
  }

  private static readonly _AXIS_X = new Vector3D(1, 0, 0);
  private static readonly _AXIS_Y = new Vector3D(0, 1, 0);
  private static readonly _AXIS_Z = new Vector3D(0, 0, 1);

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
    return this._sweepDynamicSat15(
      origin,
      delta,
      this._AXIS_X,
      this._AXIS_Y,
      this._AXIS_Z,
      halfExtents,
      o.center,
      MathUtils.at(o.axes, 0),
      MathUtils.at(o.axes, 1),
      MathUtils.at(o.axes, 2),
      o.halfExtents,
    );
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

    return this._sweepRayBox(ray, box, s.radius);
  }

  /**
   * Sweeps a moving OBB against a static AABB for CCD.
   */
  public static sweepObbBox(origin: Vector3D, delta: Vector3D, o: OBB, b: BoundingBox): number {
    const bHalf = MathPool.acquireVector().set(
      (b.max.x - b.min.x) * 0.5,
      (b.max.y - b.min.y) * 0.5,
      (b.max.z - b.min.z) * 0.5,
    );
    const t = this._sweepDynamicSat15(
      origin,
      delta,
      MathUtils.at(o.axes, 0),
      MathUtils.at(o.axes, 1),
      MathUtils.at(o.axes, 2),
      o.halfExtents,
      b.center,
      this._AXIS_X,
      this._AXIS_Y,
      this._AXIS_Z,
      bHalf,
    );
    MathPool.releaseVector(bHalf);
    return t;
  }

  /**
   * Sweeps a moving OBB against a static OBB for CCD.
   */
  public static sweepObbObb(origin: Vector3D, delta: Vector3D, oA: OBB, oB: OBB): number {
    return this._sweepDynamicSat15(
      origin,
      delta,
      MathUtils.at(oA.axes, 0),
      MathUtils.at(oA.axes, 1),
      MathUtils.at(oA.axes, 2),
      oA.halfExtents,
      oB.center,
      MathUtils.at(oB.axes, 0),
      MathUtils.at(oB.axes, 1),
      MathUtils.at(oB.axes, 2),
      oB.halfExtents,
    );
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
      // A point projectile that starts inside a volume has no entry time (same as the sphere case).
      if (volume.containsPoint(origin)) return -1;
      return this._sweepRayBox(ray, volume);
    } else if (BoundingType.HULL === volume.type) {
      if (volume.containsPoint(origin)) return -1;
      const t = volume.rayDistance(ray);
      return t >= 0 && t <= 1 ? t : -1;
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
      if (box.containsPoint(ray.origin)) return -1;
      return this._sweepRayBox(ray, box);
    }
    return -1;
  }

  /** Sweeps a sphere of `radius` against any non-hull static volume. */
  private static _sweepSphereAgainst(
    origin: Vector3D,
    delta: Vector3D,
    radius: number,
    target: BoundingVolume,
  ): number {
    if (BoundingType.SPHERE === target.type) {
      return this.sweepSphereSphere(origin, delta, radius, target);
    } else if (BoundingType.BOX === target.type) {
      return this.sweepSphereBox(origin, delta, radius, target);
    } else if (BoundingType.OBB === target.type) {
      return this.sweepSphereObb(origin, delta, radius, target);
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

    // Convex hulls are swept as their bounding sphere (conservative): the sweep can report an
    // impact slightly before the exact shapes touch (up to the hull's slack inside its sphere) but
    // never misses one, so a fast shard cannot tunnel. Previously hulls silently returned -1.
    if (BoundingType.HULL === target.type) {
      const sph = (this._sweepScratchSphere ??= new BoundingSphere(new Vector3D(), 1));
      sph.center.copyFrom(target.center);
      sph.radius = target.getBroadRadius();
      return this.sweep(moving, origin, delta, sph);
    }
    if (BoundingType.HULL === moving.type) {
      return this._sweepSphereAgainst(origin, delta, moving.getBroadRadius(), target);
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
