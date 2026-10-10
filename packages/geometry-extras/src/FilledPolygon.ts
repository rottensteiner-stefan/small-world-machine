import { AbstractGeometry, Vector3D } from "@small-world-machine/engine";

/**
 * Configuration options for filled (triangulated) polygon geometry.
 */
export interface FilledPolygonOptions {
  /** Outer boundary ring, in edge order. At least 3 points, all strictly coplanar. */
  outer: Vector3D[];
  /** Optional hole rings. Each hole must be strictly inside the outer ring and the holes
   *  must not overlap each other nor the outer boundary. Defaults to no holes. */
  holes?: Vector3D[][];
}

/** A 2D point during triangulation. */
type Point2D = readonly [number, number];

const EPSILON: number = 1e-9;

/**
 * Fills a (possibly concave) planar polygon, with optional holes, by ear clipping. Unlike the
 * core `PolygonFan` -- which fills only star-shaped profiles as a fan from the first vertex --
 * this handles arbitrary simple outer contours and subtracts holes, producing a clean indexed
 * mesh with consistent winding. All input rings must be strictly coplanar; the mesh is built
 * in that plane and normals follow the plane orientation.
 */
export class FilledPolygon extends AbstractGeometry {
  /** The outer boundary ring. */
  public outer: Vector3D[];
  /** The hole rings. */
  public holes: Vector3D[][];
  /** The plane normal of the polygon, matching the outward winding direction of the mesh. */
  public planeNormal: Vector3D;

  /** All projected ring points in fixed order: outer, then each hole. */
  private _allPts: Point2D[] = [];
  /** Cumulative ring boundaries into `_allPts`: [outerLen, outerLen+hole0Len, ...]. */
  private _ringBounds: number[] = [];

  /**
   * Creates a new filled polygon geometry.
   * @param options The configuration options.
   */
  constructor(options: FilledPolygonOptions) {
    super();
    this.outer = options.outer.map((p: Vector3D) => new Vector3D(p.x, p.y, p.z));
    this.holes = (options.holes ?? []).map((hole: Vector3D[]) =>
      hole.map((p: Vector3D) => new Vector3D(p.x, p.y, p.z)),
    );
    this.planeNormal = new Vector3D(0, 1, 0);
    this.generateGeometryData();
  }

  /** Computes the plane normal of the outer ring via Newell's method. */
  private _computePlaneNormal(): Vector3D {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const n = this.outer.length;
    for (let i = 0; i < n; i++) {
      const cur = this.outer[i]!;
      const next = this.outer[(i + 1) % n]!;
      nx += (cur.y - next.y) * (cur.z + next.z);
      ny += (cur.z - next.z) * (cur.x + next.x);
      nz += (cur.x - next.x) * (cur.y + next.y);
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < EPSILON) {
      return new Vector3D(0, 1, 0);
    }
    return new Vector3D(nx / len, ny / len, nz / len);
  }

  /** Projects a 3D point onto a 2D orthonormal basis whose normal equals the plane normal. */
  private _project(p: Vector3D): Point2D {
    const n = this.planeNormal;
    // Pick an arbitrary vector not parallel to n, then build u = raw × n, v = n × u,
    // so that u × v aligns with the plane normal and CCW winding maps to that normal.
    let ux = -n.y;
    let uy = n.x;
    let uz = 0;
    if (Math.abs(ux) < EPSILON && Math.abs(uy) < EPSILON) {
      ux = 0;
      uy = -n.z;
      uz = n.y;
    }
    const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
    const vx = (uy * n.z - uz * n.y) / uLen;
    const vy = (uz * n.x - ux * n.z) / uLen;
    const vz = (ux * n.y - uy * n.x) / uLen;
    return [(p.x * ux + p.y * uy + p.z * uz) / uLen, p.x * vx + p.y * vy + p.z * vz];
  }

  /** Index of the ring (0 = outer, 1+ = holes) containing a projected point index. */
  private _ringOf(index: number): number {
    for (let r = 0; r < this._ringBounds.length; r++) {
      if (index < this._ringBounds[r]!) return r;
    }
    return this._ringBounds.length;
  }

  /** The circular index sequence of ring `r` starting at `start`. */
  private _ringIndices(r: number, start: number): number[] {
    const begin = r === 0 ? 0 : this._ringBounds[r - 1]!;
    const end = this._ringBounds[r]!;
    const n = end - begin;
    const out: number[] = [];
    for (let k = 0; k < n; k++) out.push(begin + ((start - begin + k) % n));
    return out;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    if (this.outer.length < 3) {
      this._vertices = new Float32Array();
      this._indices = undefined;
      return;
    }

    this.planeNormal = this._computePlaneNormal();

    const outer3d = this.outer.map((p: Vector3D) => new Vector3D(p.x, p.y, p.z));
    const outer2d = outer3d.map((p: Vector3D) => this._project(p));
    if (signedArea(outer2d) < -EPSILON) {
      outer3d.reverse();
      outer2d.reverse();
    }

    const holes3d: Vector3D[][] = [];
    const holes2d: Point2D[][] = [];
    for (const hole of this.holes) {
      const h3d = hole.map((p: Vector3D) => new Vector3D(p.x, p.y, p.z));
      const h2d = h3d.map((p: Vector3D) => this._project(p));
      if (signedArea(h2d) > EPSILON) {
        h3d.reverse();
        h2d.reverse();
      }
      holes3d.push(h3d);
      holes2d.push(h2d);
    }

    const allPts3d: Vector3D[] = [...outer3d];
    this._allPts = [...outer2d];
    this._ringBounds = [outer2d.length];
    for (let i = 0; i < holes2d.length; i++) {
      allPts3d.push(...holes3d[i]!);
      this._allPts.push(...holes2d[i]!);
      this._ringBounds.push(this._allPts.length);
    }

    if (this._allPts.length < 3) {
      this._vertices = new Float32Array();
      this._indices = undefined;
      return;
    }

    const merged = this._mergeHoles();
    const tris = earClipPolygon(this._allPts, merged);

    const finalV: number[] = [];
    const finalUv: number[] = [];
    for (const p of allPts3d) {
      finalV.push(p.x, p.y, p.z);
      finalUv.push(0, 0);
    }
    const finalIdx: number[] = [];
    for (const tri of tris) {
      finalIdx.push(tri[0]!, tri[1]!, tri[2]!);
    }

    this._vertices = new Float32Array(finalV);
    this._uvs = new Float32Array(finalUv);
    this._indices = this._createIndexArray(finalIdx.length);
    this._indices.set(finalIdx);
    this.computeNormals();
  }

  /**
   * Connects each hole to the current merged polygon by a bridge through a mutually visible
   * vertex pair, producing a single simple polygon that ear clipping can consume.
   */
  private _mergeHoles(): number[] {
    let merged: number[] = [];
    for (let i = 0; i < this._ringBounds[0]!; i++) merged.push(i);

    for (let r = 1; r < this._ringBounds.length; r++) {
      const begin = this._ringBounds[r - 1]!;
      const end = this._ringBounds[r]!;

      // Bridge anchor: the rightmost hole vertex (max projected x).
      let hIdx = begin;
      for (let k = begin + 1; k < end; k++) {
        if (this._allPts[k]![0]! > this._allPts[hIdx]![0]!) hIdx = k;
      }

      // Find the closest merged-polygon vertex visible from the anchor.
      let best = -1;
      let bestDist = Infinity;
      for (const mi of merged) {
        const d = dist(this._allPts[mi]!, this._allPts[hIdx]!);
        if (d < bestDist && this._visible(mi, hIdx)) {
          bestDist = d;
          best = mi;
        }
      }
      if (best < 0) {
        for (const mi of merged) {
          if (this._visible(mi, hIdx)) {
            best = mi;
            break;
          }
        }
        if (best < 0) best = 0;
      }

      const holeSeq = this._ringIndices(r, hIdx);
      const bestPos = merged.indexOf(best);
      if (bestPos >= 0) {
        merged = [
          ...merged.slice(0, bestPos + 1),
          ...holeSeq,
          hIdx,
          best,
          ...merged.slice(bestPos + 1),
        ];
      }
    }
    return merged;
  }

  /** True if the open segment between `a` and `b` is a valid bridge: crosses no polygon
   *  boundary and its midpoint is inside the outer ring and outside every hole. */
  private _visible(a: number, b: number): boolean {
    const pa = this._allPts[a]!;
    const pb = this._allPts[b]!;
    for (let i = 0; i < this._allPts.length; i++) {
      const next = this._nextOf(i);
      if (segmentsIntersect(pa, pb, this._allPts[i]!, this._allPts[next]!)) return false;
    }
    const mid: Point2D = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    if (!pointInside(mid, this._allPts, this._ringBounds, 0)) return false;
    for (let r = 1; r < this._ringBounds.length; r++) {
      if (pointInside(mid, this._allPts, this._ringBounds, r)) return false;
    }
    return true;
  }

  /** Returns the successor index of `i` within its ring (with wrap-around). */
  private _nextOf(i: number): number {
    const r = this._ringOf(i);
    const begin = r === 0 ? 0 : this._ringBounds[r - 1]!;
    const end = this._ringBounds[r]!;
    const off = i - begin;
    return begin + ((off + 1) % (end - begin));
  }
}

/** Signed (counter-clockwise positive) area of a ring. */
function signedArea(pts: Point2D[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area / 2;
}

/** Euclidean distance between two 2D points. */
function dist(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Cross product sign of (b - a) × (c - a). */
function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** True if p lies inside or on the boundary of CCW triangle (a, b, c), excluding vertices. */
function pointInTriangle(a: Point2D, b: Point2D, c: Point2D, p: Point2D): boolean {
  if (
    (Math.abs(p[0] - a[0]) < EPSILON && Math.abs(p[1] - a[1]) < EPSILON) ||
    (Math.abs(p[0] - b[0]) < EPSILON && Math.abs(p[1] - b[1]) < EPSILON) ||
    (Math.abs(p[0] - c[0]) < EPSILON && Math.abs(p[1] - c[1]) < EPSILON)
  ) {
    return false;
  }
  const d0 = cross(a, b, p);
  const d1 = cross(b, c, p);
  const d2 = cross(c, a, p);
  return d0 >= -EPSILON && d1 >= -EPSILON && d2 >= -EPSILON;
}

/** Ray-casting point-in-ring test (points on the boundary count as inside). */
function pointInside(p: Point2D, allPts: Point2D[], ringBounds: number[], ring: number): boolean {
  const begin = ring === 0 ? 0 : ringBounds[ring - 1]!;
  const end = ringBounds[ring]!;
  const n = end - begin;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = allPts[begin + i]!;
    const b = allPts[begin + j]!;
    const intersects =
      a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True if open segments (a, b) and (c, d) properly intersect (shared endpoints allowed). */
function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = cross(a, b, c);
  const o2 = cross(a, b, d);
  const o3 = cross(c, d, a);
  const o4 = cross(c, d, b);
  return (
    ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))
  );
}

/**
 * Ear-clips a simple CCW polygon given as an index list referencing `pts`. Called only on
 * merged (hole-free) loops. Returns the triangle index list.
 */
export function earClipPolygon(pts: Point2D[], loopIn: number[]): number[][] {
  const loop: number[] = [...loopIn];
  const tris: number[][] = [];
  let guard = loop.length * loop.length * 2 + 100;
  while (loop.length > 3 && guard-- > 0) {
    let earFound = false;
    for (let i = 0; i < loop.length && !earFound; i++) {
      const prev = loop[(i - 1 + loop.length) % loop.length]!;
      const cur = loop[i]!;
      const next = loop[(i + 1) % loop.length]!;
      if (cross(pts[prev]!, pts[cur]!, pts[next]!) <= EPSILON) continue;
      let blocked = false;
      for (let j = 0; j < loop.length && !blocked; j++) {
        const v = loop[j]!;
        if (v === prev || v === cur || v === next) continue;
        if (pointInTriangle(pts[prev]!, pts[cur]!, pts[next]!, pts[v]!)) blocked = true;
      }
      if (!blocked) {
        tris.push([prev, cur, next]);
        loop.splice(i, 1);
        earFound = true;
      }
    }
    if (!earFound && loop.length > 3) {
      // Numerical collapse (collinear points from bridging): drop the shallowest vertex.
      let worst = 0;
      let worstArea = Infinity;
      for (let i = 0; i < loop.length; i++) {
        const prev = loop[(i - 1 + loop.length) % loop.length]!;
        const cur = loop[i]!;
        const next = loop[(i + 1) % loop.length]!;
        const a = Math.abs(cross(pts[prev]!, pts[cur]!, pts[next]!));
        if (a < worstArea) {
          worstArea = a;
          worst = i;
        }
      }
      loop.splice(worst, 1);
    }
  }
  if (loop.length === 3) {
    tris.push([loop[0]!, loop[1]!, loop[2]!]);
  }
  return tris;
}
