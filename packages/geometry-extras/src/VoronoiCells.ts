import { AbstractGeometry } from "@small-world-machine/engine";
import type { Vec3Like } from "./Vec3Like.js";

/** An axis-aligned box, used both as the seed-point spawn volume and the clipping bound. */
export interface BoxBounds {
  min: Vec3Like;
  max: Vec3Like;
}

/**
 * Configuration options for Voronoi cell geometry.
 */
export interface VoronoiCellsOptions {
  /** Explicit seed points. If omitted, `pointCount` random points are generated instead. */
  points?: readonly Vec3Like[];
  /** The number of random seed points to generate when `points` is omitted. Defaults to 12. */
  pointCount?: number;
  /** The spawn volume for random points, and the clipping bound for every cell. Defaults to a (-1,-1,-1)..(1,1,1) cube. */
  bounds?: BoxBounds;
  /** Seed for the deterministic random point generator. Defaults to 1. */
  seed?: number;
  /**
   * Per-point weights for a power diagram (additively weighted / Laguerre-Voronoi
   * diagram): a point with a larger weight claims more space, shifting its cell
   * boundaries away from itself instead of sitting exactly at the midpoint to its
   * neighbors. Parallel to `points`. Defaults to equal weights (a plain Voronoi
   * diagram).
   */
  weights?: readonly number[];
  /**
   * Shrinks each cell towards its own centroid by this factor (1 = seamless
   * tessellation, touching neighbors; less than 1 opens visible gaps between
   * cells, reading as separate floating crystal/fracture chunks). Defaults to 0.9.
   */
  cellPadding?: number;
  /**
   * Number of Lloyd relaxation iterations applied to the seed points before
   * building the final cells (see `relaxPoints`). Defaults to 0 (no relaxation).
   */
  relaxationIterations?: number;
}

const EPS: number = 0.0000001;

/**
 * A deterministic 32-bit PRNG (mulberry32), matching the seeding scheme used
 * elsewhere in the engine (see `HeightmapGenerator`).
 * @param seed The numeric seed.
 * @returns A function producing floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a: number = seed;
  return (): number => {
    a += 0x6d2b79f5;
    let t: number = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function subtract(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3Like, b: Vec3Like): Vec3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The centroid (vertex average) of a set of convex polyhedron faces. Used both
 * to shrink cells towards their own center (`cellPadding`) and to relax seed
 * points towards their cell's center (`relaxPoints`).
 * @param faces The polyhedron's faces.
 * @returns The averaged centroid, or the origin for an empty polyhedron.
 */
export function cellCentroid(faces: readonly Vec3Like[][]): Vec3Like {
  let cx: number = 0;
  let cy: number = 0;
  let cz: number = 0;
  let count: number = 0;
  for (const face of faces) {
    for (const p of face) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
      count++;
    }
  }
  if (0 === count) return { x: 0, y: 0, z: 0 };
  return { x: cx / count, y: cy / count, z: cz / count };
}

function isClose(a: Vec3Like, b: Vec3Like): boolean {
  return (
    Math.abs(a.x - b.x) < 0.00001 && Math.abs(a.y - b.y) < 0.00001 && Math.abs(a.z - b.z) < 0.00001
  );
}

/**
 * Builds the 6 quad faces of an axis-aligned box, each wound CCW as seen from
 * outside the box (verified by construction so its outward face normals match
 * the box's actual outward directions).
 * @param bounds The box's min/max corners.
 * @returns The 6 box faces.
 */
function boxFaces(bounds: BoxBounds): Vec3Like[][] {
  const { min, max } = bounds;
  const c000: Vec3Like = { x: min.x, y: min.y, z: min.z };
  const c100: Vec3Like = { x: max.x, y: min.y, z: min.z };
  const c110: Vec3Like = { x: max.x, y: max.y, z: min.z };
  const c010: Vec3Like = { x: min.x, y: max.y, z: min.z };
  const c001: Vec3Like = { x: min.x, y: min.y, z: max.z };
  const c101: Vec3Like = { x: max.x, y: min.y, z: max.z };
  const c111: Vec3Like = { x: max.x, y: max.y, z: max.z };
  const c011: Vec3Like = { x: min.x, y: max.y, z: max.z };

  return [
    [c000, c010, c110, c100], // -Z
    [c001, c101, c111, c011], // +Z
    [c000, c100, c101, c001], // -Y
    [c010, c011, c111, c110], // +Y
    [c000, c001, c011, c010], // -X
    [c100, c110, c111, c101], // +X
  ];
}

/**
 * Clips a convex polyhedron (a list of CCW-outward-wound planar faces) against a
 * half-space, keeping the side the plane's normal points away from, and capping
 * the resulting hole with one new face. This is the 3D analog of Sutherland-Hodgman
 * polygon clipping: each face is clipped independently, and every face actually
 * cut contributes exactly one edge (2 points) lying on the cutting plane; those
 * edges are chained into the new cap face, which is explicitly re-oriented to
 * face along `planeNormal` since the chaining order alone doesn't guarantee it.
 * @param faces The polyhedron's current faces.
 * @param planePoint A point on the cutting plane.
 * @param planeNormal The plane's normal; the side it points towards is discarded.
 * @returns The clipped faces, or `null` if nothing of the polyhedron survives.
 */
function clipPolyhedron(
  faces: readonly Vec3Like[][],
  planePoint: Vec3Like,
  planeNormal: Vec3Like,
): Vec3Like[][] | null {
  const dist = (p: Vec3Like): number => dot(subtract(p, planePoint), planeNormal);

  const newFaces: Vec3Like[][] = [];
  const capSegments: [Vec3Like, Vec3Like][] = [];

  for (const face of faces) {
    const n: number = face.length;
    const dists: number[] = face.map(dist);
    const newFace: Vec3Like[] = [];
    const crossings: Vec3Like[] = [];

    for (let i: number = 0; i < n; i++) {
      const curr: Vec3Like = face[i]!;
      const next: Vec3Like = face[(i + 1) % n]!;
      const dCurr: number = dists[i]!;
      const dNext: number = dists[(i + 1) % n]!;
      const currInside: boolean = dCurr <= EPS;

      if (currInside) newFace.push(curr);

      if (currInside !== dNext <= EPS) {
        const denom: number = dCurr - dNext;
        const t: number = Math.abs(denom) > EPS ? dCurr / denom : 0.5;
        const p: Vec3Like = {
          x: curr.x + t * (next.x - curr.x),
          y: curr.y + t * (next.y - curr.y),
          z: curr.z + t * (next.z - curr.z),
        };
        newFace.push(p);
        crossings.push(p);
      }
    }

    if (newFace.length >= 3) newFaces.push(newFace);
    if (2 === crossings.length) capSegments.push([crossings[0]!, crossings[1]!]);
  }

  if (0 === newFaces.length) return null;
  if (capSegments.length < 3) return newFaces;

  const used: boolean[] = new Array(capSegments.length).fill(false);
  const loop: Vec3Like[] = [capSegments[0]![0], capSegments[0]![1]];
  used[0] = true;

  for (let iter: number = 0; iter < capSegments.length; iter++) {
    const currentEnd: Vec3Like = loop[loop.length - 1]!;
    if (loop.length > 2 && isClose(currentEnd, loop[0]!)) break;

    let found: boolean = false;
    for (let k: number = 0; k < capSegments.length; k++) {
      if (used[k]) continue;
      const [segA, segB] = capSegments[k]!;
      if (isClose(segA, currentEnd)) {
        loop.push(segB);
        used[k] = true;
        found = true;
        break;
      }
      if (isClose(segB, currentEnd)) {
        loop.push(segA);
        used[k] = true;
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  if (loop.length > 2 && isClose(loop[0]!, loop[loop.length - 1]!)) loop.pop();

  if (loop.length >= 3) {
    const faceNormal: Vec3Like = cross(subtract(loop[1]!, loop[0]!), subtract(loop[2]!, loop[0]!));
    if (dot(faceNormal, planeNormal) < 0) loop.reverse();
    newFaces.push(loop);
  }

  return newFaces;
}

function distanceSq(a: Vec3Like, b: Vec3Like): number {
  const d: Vec3Like = subtract(a, b);
  return dot(d, d);
}

/**
 * The furthest distance from `point` to any vertex of `faces`. Used as a
 * conservative "safe radius": once this shrinks below a candidate bisector
 * plane's distance from the seed, that plane (and every plane at least as far)
 * can no longer cut the cell any further.
 * @param faces The polyhedron's faces.
 * @param point The reference point (the cell's own seed).
 * @returns The maximum vertex distance, or 0 for an empty polyhedron.
 */
function maxDistanceFromPoint(faces: readonly Vec3Like[][], point: Vec3Like): number {
  let maxSq: number = 0;
  for (const face of faces) {
    for (const p of face) {
      const d: number = distanceSq(p, point);
      if (d > maxSq) maxSq = d;
    }
  }
  return Math.sqrt(maxSq);
}

/**
 * Builds one seed point's Voronoi (or, with `weights`, power-diagram/Laguerre-Voronoi)
 * cell: starting from the bounding box, successively clips it against every other
 * seed's bisector plane. Candidates are visited nearest-first, and any plane that
 * is already further from the seed than the cell's current furthest vertex is
 * skipped entirely (see `maxDistanceFromPoint`) -- this is the dominant cost
 * (each clip touches every face of the current polyhedron), so skipping
 * irrelevant neighbors is what actually matters at larger point counts, not just
 * visiting them in a good order.
 * @param points All seed points.
 * @param index The index of the seed to build a cell for.
 * @param bounds The clipping bounding box.
 * @param weights Optional per-point weights (parallel to `points`) for a power diagram.
 * @returns The cell's faces, or `null` if the cell is empty/degenerate.
 */
export function computeCellFaces(
  points: readonly Vec3Like[],
  index: number,
  bounds: BoxBounds,
  weights?: readonly number[],
): Vec3Like[][] | null {
  const seedPoint: Vec3Like = points[index]!;
  const seedWeight: number = weights?.[index] ?? 1;

  let faces: Vec3Like[][] | null = boxFaces(bounds);
  let currentRadius: number = maxDistanceFromPoint(faces, seedPoint);

  const order: number[] = points
    .map((_, j) => j)
    .filter((j) => j !== index)
    .sort((a, b) => distanceSq(points[a]!, seedPoint) - distanceSq(points[b]!, seedPoint));

  for (const j of order) {
    if (null === faces) break;

    const other: Vec3Like = points[j]!;
    const otherWeight: number = weights?.[j] ?? 1;
    const normalRaw: Vec3Like = subtract(other, seedPoint);
    const d: number = Math.sqrt(dot(normalRaw, normalRaw));
    if (d < EPS) continue;

    const planeNormal: Vec3Like = { x: normalRaw.x / d, y: normalRaw.y / d, z: normalRaw.z / d };
    // Power-diagram shift: a relatively heavier seed pushes the bisector plane
    // away from itself (and towards the lighter neighbor), claiming more space.
    const shift: number = (seedWeight * seedWeight - otherWeight * otherWeight) / (2 * d);
    const planePoint: Vec3Like = {
      x: (seedPoint.x + other.x) / 2 + shift * planeNormal.x,
      y: (seedPoint.y + other.y) / 2 + shift * planeNormal.y,
      z: (seedPoint.z + other.z) / 2 + shift * planeNormal.z,
    };

    const planeDistFromSeed: number = Math.abs(dot(subtract(planePoint, seedPoint), planeNormal));
    if (planeDistFromSeed >= currentRadius - EPS) continue;

    faces = clipPolyhedron(faces, planePoint, planeNormal);
    if (null !== faces) currentRadius = maxDistanceFromPoint(faces, seedPoint);
  }

  if (null === faces || faces.length < 4) return null;
  return faces;
}

/**
 * Applies Lloyd relaxation (iterative centroidal Voronoi tessellation): each
 * round, every point is moved to its own cell's centroid, which evens out cell
 * sizes over a few iterations instead of leaving purely random seed clustering
 * (some tiny slivers next to oversized cells).
 * @param points The starting seed points.
 * @param bounds The clipping bounding box.
 * @param iterations The number of relaxation rounds to run.
 * @param weights Optional per-point weights (parallel to `points`) for a power diagram.
 * @returns The relaxed points (weights, if any, are left unchanged and reusable as-is).
 */
export function relaxPoints(
  points: readonly Vec3Like[],
  bounds: BoxBounds,
  iterations: number,
  weights?: readonly number[],
): Vec3Like[] {
  let current: Vec3Like[] = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));

  for (let iter: number = 0; iter < iterations; iter++) {
    current = current.map((p, i) => {
      const faces: Vec3Like[][] | null = computeCellFaces(current, i, bounds, weights);
      return null === faces ? p : cellCentroid(faces);
    });
  }

  return current;
}

/**
 * A 3D Voronoi diagram (or, with `weights`, a power/Laguerre-Voronoi diagram),
 * rendered as one merged mesh of clipped convex cells: each seed point's cell is
 * built by starting from a bounding box and successively clipping it against the
 * bisector plane to every other seed.
 */
export class VoronoiCells extends AbstractGeometry {
  /** The seed points (either explicit, randomly generated, and/or Lloyd-relaxed). */
  public readonly points: readonly Vec3Like[];
  /** The spawn/clipping bounding box. */
  public readonly bounds: BoxBounds;
  /** Per-point power-diagram weights, if any. */
  public readonly weights: readonly number[] | undefined;
  /** The per-cell shrink-towards-centroid factor. */
  public cellPadding: number;

  /**
   * Creates a new VoronoiCells geometry.
   * @param options The configuration options.
   */
  constructor(options: VoronoiCellsOptions = {}) {
    super();
    const {
      points,
      pointCount = 12,
      bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      seed = 1,
      weights,
      cellPadding = 0.9,
      relaxationIterations = 0,
    } = options;

    this.bounds = bounds;
    this.weights = weights;
    this.cellPadding = Math.min(1, Math.max(0.01, cellPadding));

    const initialPoints: Vec3Like[] =
      undefined !== points
        ? points.map((p) => ({ x: p.x, y: p.y, z: p.z }))
        : this._generatePoints(Math.max(2, Math.floor(pointCount)), bounds, seed);

    this.points =
      relaxationIterations > 0
        ? relaxPoints(initialPoints, bounds, Math.floor(relaxationIterations), weights)
        : initialPoints;

    this.generateGeometryData();
  }

  /**
   * Generates deterministic random points inside a box.
   * @param count The number of points to generate.
   * @param bounds The spawn volume.
   * @param seed The PRNG seed.
   * @returns The generated points.
   */
  private _generatePoints(count: number, bounds: BoxBounds, seed: number): Vec3Like[] {
    const rng: () => number = mulberry32(seed);
    const pts: Vec3Like[] = [];
    for (let i: number = 0; i < count; i++) {
      pts.push({
        x: bounds.min.x + rng() * (bounds.max.x - bounds.min.x),
        y: bounds.min.y + rng() * (bounds.max.y - bounds.min.y),
        z: bounds.min.z + rng() * (bounds.max.z - bounds.min.z),
      });
    }
    return pts;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const idx: number[] = [];

    for (let i: number = 0; i < this.points.length; i++) {
      const faces: Vec3Like[][] | null = computeCellFaces(
        this.points,
        i,
        this.bounds,
        this.weights,
      );
      if (null === faces) continue;

      const centroid: Vec3Like = cellCentroid(faces);

      for (const face of faces) {
        const base: number = v.length / 3;
        for (const p of face) {
          v.push(
            centroid.x + (p.x - centroid.x) * this.cellPadding,
            centroid.y + (p.y - centroid.y) * this.cellPadding,
            centroid.z + (p.z - centroid.z) * this.cellPadding,
          );
        }
        for (let k: number = 1; k < face.length - 1; k++) {
          idx.push(base, base + k, base + k + 1);
        }
      }
    }

    const uv: number[] = [];
    const sizeX = Math.max(0.0001, this.bounds.max.x - this.bounds.min.x);
    const sizeY = Math.max(0.0001, this.bounds.max.y - this.bounds.min.y);
    for (let i = 0; i < v.length; i += 3) {
      uv.push((v[i]! - this.bounds.min.x) / sizeX, (v[i + 1]! - this.bounds.min.y) / sizeY);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }
}
