import { Vector3D, MathPool } from "../math/index.js";
import type { ConvexHull } from "./ConvexHull.js";
import type { BoundingBox } from "./BoundingBox.js";
import type { OBB } from "./OBB.js";
import type { BoundingSphere } from "./BoundingSphere.js";

/**
 * The minimal shape `_satPolytopes` needs: a convex shape's world-space vertices,
 * face normals, and unique edge directions. `ConvexHull` satisfies this
 * structurally; `boxAsHull`/`obbAsHull` adapt `BoundingBox`/`OBB` to it too.
 */
interface Polytope {
  vertices: readonly Vector3D[];
  faceNormals: readonly Vector3D[];
  edgeDirections: readonly Vector3D[];
}

/**
 * Convex-hull SAT kernel of the collision system: Separating-Axis-Theorem detection and
 * minimum-translation-vector resolution for `ConvexHull` against every other volume type
 * (hull/box/obb/sphere). Extracted from `Collision` (Collision-Kern): the `Collision` facade
 * and the `Collision.test` ladder delegate here. No behavior change -- every predicate is
 * byte-identical to the pre-split implementation.
 */
export class CollisionHullSolver {
  // Scratch state for the generic convex-polytope SAT used by every HULL-involving
  // pair (`_satPolytopes`/`_considerHullAxis`), mirroring the OBB-SAT scratch fields.
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
    const box = this.boxAsHull(b);
    return this._resolvePolytopes(h, box, h.center, b.center, result);
  }

  /**
   * Resolves collision between a convex hull and an OBB, returning a correction
   * vector (points from the OBB towards the hull).
   */
  public static resolveHullObb(h: ConvexHull, o: OBB, result: Vector3D): boolean {
    const obb = this.obbAsHull(o);
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
    const sat = this.satPolytopes(a, b);
    if (null === sat) return false;

    const t = MathPool.acquireVector().copyFrom(centerB).sub(centerA);
    result.set(sat.x, sat.y, sat.z);
    const sign = 0 <= t.dot(result) ? -1 : 1;
    MathPool.releaseVector(t);

    result.scale(sign * sat.overlap);
    return true;
  }

  /**
   * Intersection test between a convex hull and a sphere.
   */
  public static hullSphere(h: ConvexHull, s: BoundingSphere): boolean {
    return null !== this._satHullSphere(h, s.center, s.radius);
  }

  /**
   * Fills and returns the reused world-space corner array for treating a
   * `BoundingBox` as an 8-vertex convex hull for `satPolytopes` -- its 3 face
   * normals/edge directions are always the world axes.
   */
  public static boxAsHull(b: BoundingBox): Polytope {
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
   * as an 8-vertex convex hull for `satPolytopes`.
   */
  public static obbAsHull(o: OBB): Polytope {
    const c = this._scratchObbCorners;
    const center = o.center;
    const hx = o.halfExtents.x;
    const hy = o.halfExtents.y;
    const hz = o.halfExtents.z;
    const a0 = o.axes[0]!;
    const a1 = o.axes[1]!;
    const a2 = o.axes[2]!;

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
  public static satPolytopes(
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
   * Considers one candidate SAT axis for `satPolytopes`, updating the shared
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

    // Penetration depth along this axis = the shorter way out (MTV). The interval intersection
    // width `min(max) - max(min)` equals it only for partial overlap; under containment it is just
    // the inner interval's length and badly under-reports the depth.
    const overlap = Math.min(maxA - minB, maxB - minA);
    if (0 > overlap) return false;
    if (overlap < this._hullSatMinOverlap) {
      this._hullSatMinOverlap = overlap;
      this._hullSatBestX = nx;
      this._hullSatBestY = ny;
      this._hullSatBestZ = nz;
    }
    return true;
  }

  /**
   * SAT test for a convex hull against a sphere: every face normal of the hull is
   * a candidate axis, plus the axis from the hull's closest surface point to the
   * sphere's center (handling the sphere resting near a corner/edge, where no
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

    // The remaining candidate axis runs from the closest point on the hull's surface to the sphere
    // centre. That point is a vertex, an edge point or a face point; the nearest *vertex* alone is
    // not enough: near an edge it is not a separating axis, so a sphere still clear of the edge
    // would be reported as touching.
    const closest = h.closestPoint(center);
    if (
      !this._considerHullSphereAxis(
        center.x - closest.x,
        center.y - closest.y,
        center.z - closest.z,
        h.vertices,
        center,
        radius,
      )
    ) {
      return null;
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

    const overlap = Math.min(maxH - minS, maxS - minH); // shorter way out, see _considerHullAxis
    if (0 > overlap) return false;
    if (overlap < this._hullSatMinOverlap) {
      this._hullSatMinOverlap = overlap;
      this._hullSatBestX = nx;
      this._hullSatBestY = ny;
      this._hullSatBestZ = nz;
    }
    return true;
  }
}
