import type { Matrix4 } from "../math/index.js";
import { Vector3D, Matrix3 } from "../math/index.js";
import type { Ray } from "./Ray.js";
import { BoundingBox } from "./BoundingBox.js";
import type { BoundingVolume, BoundingVolumeShape, FrustumInterface } from "../interfaces/index.js";
import { BoundingType } from "../enums/index.js";
import { Collision } from "./Collision.js";

const MIN_LENGTH_SQ: number = 0.0000001;

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

    const keyOf = (v: Vector3D): string => `${v.x.toFixed(5)}|${v.y.toFixed(5)}|${v.z.toFixed(5)}`;

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
    let maxSq: number = 0;
    for (const v of this.vertices) {
      const d: number = v.distanceToSq(this.center);
      if (d > maxSq) maxSq = d;
    }
    return Math.sqrt(maxSq);
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

  /** @inheritdoc */
  public translate(v: Vector3D): void {
    // Keep both the source-of-truth local list and the world-space copies in sync so a
    // subsequent `transform()` reproduces the translated position instead of reverting.
    for (const lv of this._localVertices) lv.add(v);
    this._localCenter.add(v);
    this.center.add(v);
    for (const wv of this.vertices) wv.add(v);
  }

  /** @inheritdoc */
  public intersectsRay(ray: Ray): boolean {
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      for (let i = 1; i < face.length - 1; i++) {
        if (this._rayTriangle(ray, v0, this.vertices[face[i]!]!, this.vertices[face[i + 1]!]!)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Möller–Trumbore ray/triangle test; returns whether the ray hits the triangle at t >= 0.
   */
  private _rayTriangle(ray: Ray, a: Vector3D, b: Vector3D, c: Vector3D): boolean {
    const e1 = b.clone().sub(a);
    const e2 = c.clone().sub(a);
    const p = ray.direction.clone().cross(e2);
    const det = e1.dot(p);
    if (Math.abs(det) < 1e-9) return false;
    const invDet = 1 / det;
    const tvec = ray.origin.clone().sub(a);
    const u = tvec.dot(p) * invDet;
    if (u < 0 || u > 1) return false;
    const q = tvec.clone().cross(e1);
    const v = ray.direction.dot(q) * invDet;
    if (v < 0 || u + v > 1) return false;
    const t = e2.dot(q) * invDet;
    return t >= 0;
  }

  /** @inheritdoc */
  public surfaceNormalAt(point: Vector3D): Vector3D {
    let best: Vector3D | undefined;
    let bestDist = Infinity;
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      const v1 = this.vertices[face[1]!]!;
      const v2 = this.vertices[face[2]!]!;
      const n = v1.clone().sub(v0).cross(v2.clone().sub(v0));
      const len = n.length();
      if (len < 1e-9) continue;
      n.scale(1 / len);
      const dist = Math.abs(n.dot(point.clone().sub(v0)));
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best ?? new Vector3D(0, 1, 0);
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
        tetraSum += v0.dot(v1.clone().cross(v2));
      }
    }
    // Triangulation in a consistent (outward) winding over a convex polyhedron yields a
    // positive total, but guard defensively for robustness against winding quirks.
    return Math.abs(tetraSum) / 6;
  }

  /** @inheritdoc */
  public closestPoint(point: Vector3D): Vector3D {
    let bestPoint: Vector3D = this.center.clone();
    let bestDistSq = Infinity;
    for (const face of this._faces) {
      if (face.length < 3) continue;
      const v0 = this.vertices[face[0]!]!;
      for (let i = 1; i < face.length - 1; i++) {
        const p = ConvexHull._closestPointOnTriangle(
          point,
          v0,
          this.vertices[face[i]!]!,
          this.vertices[face[i + 1]!]!,
        );
        const distSq = p.distanceToSq(point);
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestPoint = p;
        }
      }
    }
    return bestPoint;
  }

  private static _closestPointOnTriangle(
    p: Vector3D,
    a: Vector3D,
    b: Vector3D,
    c: Vector3D,
  ): Vector3D {
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    const ap = p.clone().sub(a);
    const d1 = ab.dot(ap);
    const d2 = ac.dot(ap);
    if (d1 <= 0 && d2 <= 0) return a.clone();
    const bp = p.clone().sub(b);
    const d3 = ab.dot(bp);
    const d4 = ac.dot(bp);
    if (d3 >= 0 && d4 <= d3) return b.clone();
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return a.clone().add(ab.scale(v));
    }
    const cp = p.clone().sub(c);
    const d5 = ab.dot(cp);
    const d6 = ac.dot(cp);
    if (d6 >= 0 && d5 <= d6) return c.clone();
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return a.clone().add(ac.scale(w));
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return b.clone().add(c.clone().sub(b).scale(w));
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return a.clone().add(ab.scale(v)).add(ac.scale(w));
  }

  /** @inheritdoc */
  public cloneEmpty(): BoundingVolume {
    return new ConvexHull([], []);
  }

  /** @inheritdoc */
  public setFromLocal(center: Vector3D, _halfExtents: Vector3D): void {
    // A hull's shape comes from its vertex/face list, not half extents -- `setFromLocal`
    // therefore re-positions the hull so its centroid lands at `center` (spatial queries
    // that need a specific origin rely on this); `_halfExtents` is semantically inapplicable.
    const shift = center.clone().sub(this.center);
    this.translate(shift);
  }
}
