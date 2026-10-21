import type { Matrix4 } from "../math/index.js";
import { Vector3D, Matrix3 } from "../math/index.js";
import type { Ray } from "./Ray.js";
import { BoundingBox } from "./BoundingBox.js";
import type { BoundingVolume, BoundingVolumeShape, FrustumInterface } from "../interfaces/index.js";
import { BoundingType } from "../enums/index.js";
import { Collision } from "./Collision.js";

const MIN_LENGTH_SQ: number = 0.0000001;

// Module-level scratch for the per-triangle queries below (single-threaded, never re-entrant
// across these methods), so ray casts and closest-point queries over many triangles allocate
// nothing.
const _s0 = new Vector3D();
const _s1 = new Vector3D();
const _s2 = new Vector3D();
const _s3 = new Vector3D();
const _s4 = new Vector3D();
const _s5 = new Vector3D();

/**
 * An arbitrary convex polyhedron bounding volume (face/vertex list), e.g. a
 * Voronoi fracture shard. Unlike `BoundingBox`/`OBB`, its shape is fully general
 * instead of a fixed box, at the cost of a more expensive SAT test (see
 * `Collision`'s `HULL`-prefixed methods).
 */
export class ConvexHull implements BoundingVolumeShape {
  /** @inheritdoc */
  public readonly type: typeof BoundingType.HULL = BoundingType.HULL;
  /** @inheritdoc */
  public center: Vector3D = new Vector3D();

  /** World-space vertex positions, recomputed by `transform()`. */
  public vertices: Vector3D[];
  /** World-space outward-facing face normals (unit length), recomputed by `transform()`. */
  public faceNormals: Vector3D[];
  /** World-space unique edge directions (unit length), recomputed by `transform()`. */
  public edgeDirections: Vector3D[];

  /** Untransformed local-space vertices; the source of truth for `transform()`. */
  private readonly _localVertices: Vector3D[];
  private readonly _localFaceNormals: Vector3D[];
  private readonly _localEdgeDirections: Vector3D[];
  private readonly _localCenter: Vector3D;
  private readonly _faces: readonly (readonly number[])[];
  /** Cached bounding radius around `center`; refreshed by `transform()` (vertex set is fixed). */
  private _broadRadius: number = 0;

  /**
   * Creates a new ConvexHull. Prefer `ConvexHull.fromFaceLoops()` when you only
   * have each face as a list of (possibly duplicated across faces) points rather
   * than an already-deduplicated vertex/face-index structure.
   * @param localVertices The hull's local-space vertices.
   * @param faces Each face as a CCW-outward-wound (as seen from outside the hull)
   * list of indices into `localVertices`.
   */
  constructor(localVertices: readonly Vector3D[], faces: readonly (readonly number[])[]) {
    this._localVertices = localVertices.map((v) => v.clone());
    this._faces = faces;
    this._localCenter = ConvexHull._computeCentroid(this._localVertices);
    this._localFaceNormals = ConvexHull._computeFaceNormals(
      this._localVertices,
      faces,
      this._localCenter,
    );
    this._localEdgeDirections = ConvexHull._computeEdgeDirections(this._localVertices, faces);

    this.vertices = this._localVertices.map((v) => v.clone());
    this.faceNormals = this._localFaceNormals.map((n) => n.clone());
    this.edgeDirections = this._localEdgeDirections.map((e) => e.clone());
    this.center.copyFrom(this._localCenter);
    this._refreshBroadRadius();
  }

  /**
   * Builds a ConvexHull from faces given as loops of (possibly repeated across
   * faces) points -- the shape `VoronoiCells`' cell-clipping produces -- welding
   * coincident points into a shared vertex list.
   * @param faceLoops Each face as an ordered, CCW-outward-wound point loop.
   * @returns A new ConvexHull.
   */
  public static fromFaceLoops(faceLoops: readonly (readonly Vector3D[])[]): ConvexHull {
    const vertices: Vector3D[] = [];
    const indexOf: Map<string, number> = new Map();
    const faces: number[][] = [];

    // Scale-relative weld tolerance (1e-5 of the largest coordinate) quantised to integers:
    // unlike `toFixed(5)` it does not depend on the model's units and has no "-0" vs "0" split.
    let maxAbs = 0;
    for (const loop of faceLoops) {
      for (const p of loop) {
        maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
      }
    }
    const eps = Math.max(1e-9, maxAbs * 1e-5);
    const q = (n: number): number => Math.round(n / eps) + 0; // `+ 0` folds -0 into 0
    const keyOf = (v: Vector3D): string => `${q(v.x)}|${q(v.y)}|${q(v.z)}`;

    for (const loop of faceLoops) {
      const faceIndices: number[] = [];
      for (const p of loop) {
        const key: string = keyOf(p);
        let idx: number | undefined = indexOf.get(key);
        if (undefined === idx) {
          idx = vertices.length;
          vertices.push(p.clone());
          indexOf.set(key, idx);
        }
        faceIndices.push(idx);
      }
      if (faceIndices.length >= 3) faces.push(faceIndices);
    }

    return new ConvexHull(vertices, faces);
  }

  private static _computeCentroid(vertices: readonly Vector3D[]): Vector3D {
    const c: Vector3D = new Vector3D();
    for (const v of vertices) c.add(v);
    if (vertices.length > 0) c.scale(1 / vertices.length);
    return c;
  }

  private static _computeFaceNormals(
    vertices: readonly Vector3D[],
    faces: readonly (readonly number[])[],
    centroid: Vector3D,
  ): Vector3D[] {
    const normals: Vector3D[] = [];
    for (const face of faces) {
      if (face.length < 3) continue;
      const a: Vector3D = vertices[face[0]!]!;
      const b: Vector3D = vertices[face[1]!]!;
      const c: Vector3D = vertices[face[2]!]!;
      const n: Vector3D = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.lengthSq() < MIN_LENGTH_SQ) continue;
      n.normalize();
      // The face loops are expected to already be wound CCW-outward, but flip
      // defensively if the normal still points towards the hull's own centroid.
      if (n.dot(centroid.clone().sub(a)) > 0) n.scale(-1);
      normals.push(n);
    }
    return normals;
  }

  private static _computeEdgeDirections(
    vertices: readonly Vector3D[],
    faces: readonly (readonly number[])[],
  ): Vector3D[] {
    const dirs: Vector3D[] = [];
    for (const face of faces) {
      const n: number = face.length;
      for (let i: number = 0; i < n; i++) {
        const a: Vector3D = vertices[face[i]!]!;
        const b: Vector3D = vertices[face[(i + 1) % n]!]!;
        const d: Vector3D = b.clone().sub(a);
        if (d.lengthSq() < MIN_LENGTH_SQ) continue;
        d.normalize();
        // Canonicalize so an edge and its reverse dedupe to the same direction.
        if (0 > d.x || (0 === d.x && 0 > d.y) || (0 === d.x && 0 === d.y && 0 > d.z)) d.scale(-1);

        let duplicate: boolean = false;
        for (const existing of dirs) {
          if (Math.abs(existing.dot(d)) > 0.999999) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) dirs.push(d);
      }
    }
    return dirs;
  }

  /** @inheritdoc */
  public getBroadRadius(): number {
    return this._broadRadius;
  }

  private _refreshBroadRadius(): void {
    let maxSq: number = 0;
    for (let i = 0; i < this.vertices.length; i++) {
      const d: number = this.vertices[i]!.distanceToSq(this.center);
      if (d > maxSq) maxSq = d;
    }
    this._broadRadius = Math.sqrt(maxSq);
  }

  /** @inheritdoc */
  public intersectsFrustum(frustum: FrustumInterface): boolean {
    const p: Float32Array = frustum.planes;
    for (let i: number = 0; 6 > i; i++) {
      const idx: number = i * 4;
      const nx: number = p[idx]!;
      const ny: number = p[idx + 1]!;
      const nz: number = p[idx + 2]!;
      const d: number = p[idx + 3]!;

      let allOutside: boolean = true;
      for (const v of this.vertices) {
        if (0 <= nx * v.x + ny * v.y + nz * v.z + d) {
          allOutside = false;
          break;
        }
      }
      if (allOutside) return false;
    }
    return true;
  }

  /** @inheritdoc */
  public intersectsVolume(other: BoundingVolume): boolean {
    return Collision.test(this, other);
  }

  /** @inheritdoc */
  public containsVolume(_other: BoundingVolume): boolean {
    // Not implemented for broad phase yet, matching OBB's placeholder.
    return false;
  }

  private static readonly _scratchNormalMatrix: Matrix3 = new Matrix3();

  /** @inheritdoc */
  public transform(matrix: Matrix4): void {
    for (let i: number = 0; i < this._localVertices.length; i++) {
      this.vertices[i]!.copyFrom(this._localVertices[i]!);
      matrix.transformVector(this.vertices[i]!);
    }
    ConvexHull._scratchNormalMatrix.getNormalMatrix(matrix);
    for (let i: number = 0; i < this._localFaceNormals.length; i++) {
      this.faceNormals[i]!.copyFrom(this._localFaceNormals[i]!);
      ConvexHull._scratchNormalMatrix.transformVector(this.faceNormals[i]!);
      this.faceNormals[i]!.normalize();
    }
    for (let i: number = 0; i < this._localEdgeDirections.length; i++) {
      this.edgeDirections[i]!.copyFrom(this._localEdgeDirections[i]!).transformDirection(matrix);
    }
    this.center.copyFrom(this._localCenter);
    matrix.transformVector(this.center);
    this._refreshBroadRadius();
  }

  /**
   * Clones this ConvexHull.
   */
  public clone(): ConvexHull {
    return new ConvexHull(this._localVertices, this._faces);
  }

  /** @inheritdoc */
  public getAabb(): BoundingBox {
    const min = new Vector3D(Infinity, Infinity, Infinity);
    const max = new Vector3D(-Infinity, -Infinity, -Infinity);
    for (const v of this.vertices) {
      min.x = Math.min(min.x, v.x);
      min.y = Math.min(min.y, v.y);
      min.z = Math.min(min.z, v.z);
      max.x = Math.max(max.x, v.x);
      max.y = Math.max(max.y, v.y);
      max.z = Math.max(max.z, v.z);
    }
    return new BoundingBox(min, max);
  }

  /**
   * Translates the world-space vertices and center by `v`. Like `BoundingBox.translate`, this
   * only moves the *world* copy: the local source of truth is untouched, so the offset is valid
   * until the next `transform()` re-derives the world data from the local shape (it is never
   * pushed through that matrix a second time).
   */
  public translate(v: Vector3D): void {
    this.center.add(v);
    for (const wv of this.vertices) wv.add(v);
  }

  /** @inheritdoc */
  public intersectsRay(ray: Ray): boolean {
    return this.rayDistance(ray) >= 0;
  }

  /** True when `point` lies inside (or on) every face plane of the hull. Allocation-free. */
  public containsPoint(point: Vector3D): boolean {
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      const n = _s0
        .copyFrom(this.vertices[face[1]!]!)
        .sub(v0)
        .cross(_s1.copyFrom(this.vertices[face[2]!]!).sub(v0));
      const len = n.length();
      if (len < 1e-9) continue;
      // Orient outward (away from the centroid), independent of the loop winding.
      const side = n.dot(_s2.copyFrom(this.center).sub(v0)) > 0 ? -1 : 1;
      if ((side * n.dot(_s2.copyFrom(point).sub(v0))) / len > 1e-9) return false;
    }
    return true;
  }

  /**
   * Distance `t >= 0` (in units of `ray.direction`) to the nearest face hit, or -1 on a miss.
   * A ray starting inside the hull reports the exit point, matching Sphere/Box/OBB.
   */
  public rayDistance(ray: Ray): number {
    let best = -1;
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      for (let i = 1; i < face.length - 1; i++) {
        const t = this._rayTriangle(
          ray,
          v0,
          this.vertices[face[i]!]!,
          this.vertices[face[i + 1]!]!,
        );
        if (t >= 0 && (best < 0 || t < best)) best = t;
      }
    }
    return best;
  }

  /**
   * Möller–Trumbore ray/triangle test; returns the hit distance `t >= 0`, or -1 on a miss.
   */
  private _rayTriangle(ray: Ray, a: Vector3D, b: Vector3D, c: Vector3D): number {
    const e1 = _s0.copyFrom(b).sub(a);
    const e2 = _s1.copyFrom(c).sub(a);
    const p = _s2.copyFrom(ray.direction).cross(e2);
    const det = e1.dot(p);
    if (Math.abs(det) < 1e-9) return -1;
    const invDet = 1 / det;
    const tvec = _s3.copyFrom(ray.origin).sub(a);
    const u = tvec.dot(p) * invDet;
    if (u < 0 || u > 1) return -1;
    const q = _s4.copyFrom(tvec).cross(e1);
    const v = ray.direction.dot(q) * invDet;
    if (v < 0 || u + v > 1) return -1;
    const t = e2.dot(q) * invDet;
    return t >= 0 ? t : -1;
  }

  /** @inheritdoc */
  public surfaceNormalAt(point: Vector3D): Vector3D {
    const best = new Vector3D();
    let found = false;
    let bestDist = Infinity;
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      const v1 = this.vertices[face[1]!]!;
      const v2 = this.vertices[face[2]!]!;
      const n = _s0.copyFrom(v1).sub(v0).cross(_s1.copyFrom(v2).sub(v0));
      const len = n.length();
      if (len < 1e-9) continue;
      n.scale(1 / len);
      const dist = Math.abs(n.dot(_s2.copyFrom(point).sub(v0)));
      if (dist < bestDist) {
        bestDist = dist;
        best.copyFrom(n);
        found = true;
      }
    }
    return found ? best : best.set(0, 1, 0);
  }

  /** @inheritdoc */
  public volume(): number {
    let tetraSum = 0;
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      for (let i = 1; i < face.length - 1; i++) {
        const v1 = this.vertices[face[i]!]!;
        const v2 = this.vertices[face[i + 1]!]!;
        tetraSum += v0.dot(_s0.copyFrom(v1).cross(v2));
      }
    }
    // Triangulation in a consistent (outward) winding over a convex polyhedron yields a
    // positive total, but guard defensively for robustness against winding quirks.
    return Math.abs(tetraSum) / 6;
  }

  /** @inheritdoc */
  public closestPoint(point: Vector3D): Vector3D {
    return this.closestPointInto(point, new Vector3D());
  }

  /** Allocation-free {@link closestPoint}: writes the closest surface point into `out`. */
  public closestPointInto(point: Vector3D, out: Vector3D): Vector3D {
    const bestPoint = out.copyFrom(this.center);
    let bestDistSq = Infinity;
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      for (let i = 1; i < face.length - 1; i++) {
        ConvexHull._closestPointOnTriangle(
          point,
          v0,
          this.vertices[face[i]!]!,
          this.vertices[face[i + 1]!]!,
          _s5,
        );
        const distSq = _s5.distanceToSq(point);
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestPoint.copyFrom(_s5);
        }
      }
    }
    return bestPoint;
  }

  /** Closest point on triangle `abc` to `p`, written into `out` (uses `_s0.._s4` as scratch). */
  private static _closestPointOnTriangle(
    p: Vector3D,
    a: Vector3D,
    b: Vector3D,
    c: Vector3D,
    out: Vector3D,
  ): void {
    const ab = _s0.copyFrom(b).sub(a);
    const ac = _s1.copyFrom(c).sub(a);
    const ap = _s2.copyFrom(p).sub(a);
    const d1 = ab.dot(ap);
    const d2 = ac.dot(ap);
    if (d1 <= 0 && d2 <= 0) {
      out.copyFrom(a);
      return;
    }
    const bp = _s2.copyFrom(p).sub(b);
    const d3 = ab.dot(bp);
    const d4 = ac.dot(bp);
    if (d3 >= 0 && d4 <= d3) {
      out.copyFrom(b);
      return;
    }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      out.copyFrom(a).add(_s3.copyFrom(ab).scale(v));
      return;
    }
    const cp = _s2.copyFrom(p).sub(c);
    const d5 = ab.dot(cp);
    const d6 = ac.dot(cp);
    if (d6 >= 0 && d5 <= d6) {
      out.copyFrom(c);
      return;
    }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      out.copyFrom(a).add(_s3.copyFrom(ac).scale(w));
      return;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      out.copyFrom(b).add(_s3.copyFrom(c).sub(b).scale(w));
      return;
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    out.copyFrom(a).add(_s3.copyFrom(ab).scale(v)).add(_s4.copyFrom(ac).scale(w));
  }

  /** @inheritdoc */
  public cloneEmpty(): BoundingVolume {
    return new ConvexHull([], []);
  }

  /** @inheritdoc */
  public setFromLocal(center: Vector3D, _halfExtents: Vector3D): void {
    // A hull's shape comes from its vertex/face list, not half extents -- `setFromLocal`
    // therefore re-positions the *local* source so its centroid lands at `center` (the world
    // copy follows immediately and survives later `transform()` calls); `_halfExtents` is
    // semantically inapplicable.
    const sx = center.x - this._localCenter.x;
    const sy = center.y - this._localCenter.y;
    const sz = center.z - this._localCenter.z;
    for (const lv of this._localVertices) lv.set(lv.x + sx, lv.y + sy, lv.z + sz);
    this._localCenter.set(center.x, center.y, center.z);
    for (let i = 0; i < this._localVertices.length; i++) {
      this.vertices[i]!.copyFrom(this._localVertices[i]!);
    }
    this.center.copyFrom(this._localCenter);
    this._refreshBroadRadius();
  }
}
