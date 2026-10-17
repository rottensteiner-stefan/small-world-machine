import { AbstractGeometry } from "@small-world-machine/engine";
import type { Vec3Like } from "./Vec3Like.js";

/** A single metaball (blobby sphere) contributing to a scalar field. */
export interface MetaballDefinition {
  /** Center X. Defaults to 0. */
  x?: number;
  /** Center Y. Defaults to 0. */
  y?: number;
  /** Center Z. Defaults to 0. */
  z?: number;
  /** The ball's nominal radius -- the field equals `strength` exactly at this distance. Defaults to 0.5. */
  radius?: number;
  /** Relative contribution strength. Defaults to 1. */
  strength?: number;
}

const DEFAULT_METABALLS: readonly Required<MetaballDefinition>[] = [
  { x: -0.4, y: 0, z: 0, radius: 0.6, strength: 1 },
  { x: 0.4, y: 0.2, z: 0, radius: 0.5, strength: 1 },
  { x: 0, y: -0.35, z: 0.3, radius: 0.45, strength: 1 },
];

/**
 * Builds a metaball scalar field sampler: a blend of inverse-square falloff spheres
 * that smoothly merge where they overlap. The field equals a ball's `strength`
 * exactly at its `radius`, so a threshold (isoLevel) around 1 traces near each
 * ball's nominal surface when isolated, and bulges outward where balls blend.
 * @param balls The metaballs contributing to the field. Defaults to a small 3-ball cluster.
 * @returns A sampling function suitable for `MarchingCubesOptions.sample`.
 */
export function metaballField(
  balls: readonly MetaballDefinition[] = DEFAULT_METABALLS,
): (x: number, y: number, z: number) => number {
  const resolved = balls.map((b) => ({
    x: b.x ?? 0,
    y: b.y ?? 0,
    z: b.z ?? 0,
    radiusSq: Math.max(0.000001, b.radius ?? 0.5) ** 2,
    strength: b.strength ?? 1,
  }));

  return (x: number, y: number, z: number): number => {
    let sum: number = 0;
    for (const b of resolved) {
      const dx: number = x - b.x;
      const dy: number = y - b.y;
      const dz: number = z - b.z;
      const distSq: number = Math.max(0.000001, dx * dx + dy * dy + dz * dz);
      sum += (b.strength * b.radiusSq) / distSq;
    }
    return sum;
  };
}

/**
 * Configuration options for marching cubes geometry.
 */
export interface MarchingCubesOptions {
  /** The scalar field to polygonise. Defaults to a small metaball cluster. */
  sample?: (x: number, y: number, z: number) => number;
  /** The threshold at which the field is considered "inside" the surface. Defaults to 1. */
  isoLevel?: number;
  /** The minimum corner of the sampling volume. Defaults to (-1.2, -1.2, -1.2). */
  min?: Vec3Like;
  /** The maximum corner of the sampling volume. Defaults to (1.2, 1.2, 1.2). */
  max?: Vec3Like;
  /** The number of grid cells per axis. Defaults to 16. */
  resolution?: number;
}

/** Cube corner offsets, using the standard Lorensen-Cline numbering. */
const CUBE_CORNER_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

/**
 * Decomposition of a cube into 6 tetrahedra sharing the main diagonal between
 * corners 0 and 6. Used instead of the classic 256-case marching-cubes edge/tri
 * lookup tables: marching tetrahedra only has 16 small, easily verified cases
 * (see `_processTetrahedron`), and is immune to the classic marching-cubes
 * ambiguous-face artifacts, at the cost of producing somewhat more triangles.
 */
const CUBE_TETRAHEDRA: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
];

/**
 * Linearly interpolates the point along an edge where the field crosses zero.
 * @param pa The first edge endpoint.
 * @param da The (bias-adjusted) field value at `pa`.
 * @param pb The second edge endpoint.
 * @param db The (bias-adjusted) field value at `pb`.
 * @returns The interpolated zero-crossing point.
 */
function edgeCrossing(pa: Vec3Like, da: number, pb: Vec3Like, db: number): Vec3Like {
  const denom: number = da - db;
  const t: number = Math.abs(denom) > 0.000001 ? da / denom : 0.5;
  return {
    x: pa.x + t * (pb.x - pa.x),
    y: pa.y + t * (pb.y - pa.y),
    z: pa.z + t * (pb.z - pa.z),
  };
}

/**
 * An isosurface extracted from an arbitrary 3D scalar field (e.g. metaballs, noise,
 * signed distance functions) via marching tetrahedra: each grid cube is split into
 * 6 tetrahedra, and each tetrahedron's 16 inside/outside corner combinations are
 * resolved generically (0, 1, or 2 triangles per tetrahedron), auto-orienting every
 * triangle by checking its normal against the local inside-to-outside direction.
 */
export class MarchingCubes extends AbstractGeometry {
  /** The scalar field being polygonised. */
  public readonly sample: (x: number, y: number, z: number) => number;
  /** The threshold at which the field is considered "inside" the surface. */
  public isoLevel: number;
  /** The minimum corner of the sampling volume. */
  public min: Vec3Like;
  /** The maximum corner of the sampling volume. */
  public max: Vec3Like;
  /** The number of grid cells per axis. */
  public resolution: number;

  private readonly _vertexMap: Map<string, number> = new Map();
  private _vertexList: number[] = [];

  /**
   * Creates a new MarchingCubes geometry.
   * @param options The configuration options.
   */
  constructor(options: MarchingCubesOptions = {}) {
    super();
    const {
      sample = metaballField(),
      isoLevel = 1,
      min = { x: -1.2, y: -1.2, z: -1.2 },
      max = { x: 1.2, y: 1.2, z: 1.2 },
      resolution = 16,
    } = options;
    this.sample = sample;
    this.isoLevel = isoLevel;
    this.min = min;
    this.max = max;
    this.resolution = Math.max(1, Math.floor(resolution));
    this.generateGeometryData();
  }

  /**
   * Finds the shared vertex index for a point, welding coincident positions so
   * `computeNormals()` can average across tetrahedron/cube boundaries for smooth
   * shading instead of a faceted look.
   * @param p The point to look up or insert.
   * @returns The vertex index.
   */
  private _getOrAddVertex(p: Vec3Like): number {
    const key: string = `${p.x.toFixed(5)}|${p.y.toFixed(5)}|${p.z.toFixed(5)}`;
    const existing: number | undefined = this._vertexMap.get(key);
    if (undefined !== existing) return existing;
    const index: number = this._vertexList.length / 3;
    this._vertexList.push(p.x, p.y, p.z);
    this._vertexMap.set(key, index);
    return index;
  }

  /**
   * Emits a triangle, auto-orienting it so its normal points towards `reference`
   * (roughly "away from the solid"), regardless of the winding the caller provides.
   * @param idx The shared output index buffer.
   * @param a First vertex.
   * @param b Second vertex.
   * @param c Third vertex.
   * @param reference A direction the resulting outward normal should agree with.
   */
  private _pushTriangle(
    idx: number[],
    a: Vec3Like,
    b: Vec3Like,
    c: Vec3Like,
    reference: Vec3Like,
  ): void {
    const abx: number = b.x - a.x;
    const aby: number = b.y - a.y;
    const abz: number = b.z - a.z;
    const acx: number = c.x - a.x;
    const acy: number = c.y - a.y;
    const acz: number = c.z - a.z;
    const nx: number = aby * acz - abz * acy;
    const ny: number = abz * acx - abx * acz;
    const nz: number = abx * acy - aby * acx;
    const dot: number = nx * reference.x + ny * reference.y + nz * reference.z;

    const ia: number = this._getOrAddVertex(a);
    const ib: number = this._getOrAddVertex(dot < 0 ? c : b);
    const ic: number = this._getOrAddVertex(dot < 0 ? b : c);
    idx.push(ia, ib, ic);
  }

  /**
   * Resolves one tetrahedron's inside/outside corner combination into 0, 1, or 2
   * output triangles.
   * @param idx The shared output index buffer.
   * @param p The tetrahedron's 4 corner positions.
   * @param d The tetrahedron's 4 (bias-adjusted) corner field values.
   */
  private _processTetrahedron(idx: number[], p: readonly Vec3Like[], d: readonly number[]): void {
    const insideIdx: number[] = [];
    const outsideIdx: number[] = [];
    for (let i: number = 0; i < 4; i++) {
      if ((d[i] ?? 0) >= 0) {
        insideIdx.push(i);
      } else {
        outsideIdx.push(i);
      }
    }

    if (0 === insideIdx.length || 4 === insideIdx.length) return;

    if (1 === insideIdx.length || 3 === insideIdx.length) {
      const singleIsInside: boolean = 1 === insideIdx.length;
      const lone: number = (singleIsInside ? insideIdx : outsideIdx)[0]!;
      const others: number[] = singleIsInside ? outsideIdx : insideIdx;

      const pts: Vec3Like[] = others.map((o) => edgeCrossing(p[lone]!, d[lone]!, p[o]!, d[o]!));

      const cx: number = (pts[0]!.x + pts[1]!.x + pts[2]!.x) / 3;
      const cy: number = (pts[0]!.y + pts[1]!.y + pts[2]!.y) / 3;
      const cz: number = (pts[0]!.z + pts[1]!.z + pts[2]!.z) / 3;

      const reference: Vec3Like = singleIsInside
        ? { x: cx - p[lone]!.x, y: cy - p[lone]!.y, z: cz - p[lone]!.z }
        : { x: p[lone]!.x - cx, y: p[lone]!.y - cy, z: p[lone]!.z - cz };

      this._pushTriangle(idx, pts[0]!, pts[1]!, pts[2]!, reference);
      return;
    }

    // Exactly 2 inside, 2 outside: the cross-section is a quadrilateral (A-B-C-D),
    // adjacent point pairs sharing a tetrahedron face -- see class doc comment.
    const i0: number = insideIdx[0]!;
    const i1: number = insideIdx[1]!;
    const o0: number = outsideIdx[0]!;
    const o1: number = outsideIdx[1]!;

    const a: Vec3Like = edgeCrossing(p[i0]!, d[i0]!, p[o0]!, d[o0]!);
    const b: Vec3Like = edgeCrossing(p[i0]!, d[i0]!, p[o1]!, d[o1]!);
    const c: Vec3Like = edgeCrossing(p[i1]!, d[i1]!, p[o1]!, d[o1]!);
    const e: Vec3Like = edgeCrossing(p[i1]!, d[i1]!, p[o0]!, d[o0]!);

    const reference: Vec3Like = {
      x: (p[o0]!.x + p[o1]!.x) / 2 - (p[i0]!.x + p[i1]!.x) / 2,
      y: (p[o0]!.y + p[o1]!.y) / 2 - (p[i0]!.y + p[i1]!.y) / 2,
      z: (p[o0]!.z + p[o1]!.z) / 2 - (p[i0]!.z + p[i1]!.z) / 2,
    };

    this._pushTriangle(idx, a, b, c, reference);
    this._pushTriangle(idx, a, c, e, reference);
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const res: number = this.resolution;
    const nx: number = res + 1;
    const ny: number = res + 1;
    const nz: number = res + 1;

    const dx: number = (this.max.x - this.min.x) / res;
    const dy: number = (this.max.y - this.min.y) / res;
    const dz: number = (this.max.z - this.min.z) / res;

    const idxOf = (ix: number, iy: number, iz: number): number => (iz * ny + iy) * nx + ix;

    const field: Float32Array = new Float32Array(nx * ny * nz);
    for (let iz: number = 0; iz < nz; iz++) {
      for (let iy: number = 0; iy < ny; iy++) {
        for (let ix: number = 0; ix < nx; ix++) {
          const x: number = this.min.x + ix * dx;
          const y: number = this.min.y + iy * dy;
          const z: number = this.min.z + iz * dz;
          field[idxOf(ix, iy, iz)] = this.sample(x, y, z) - this.isoLevel;
        }
      }
    }

    this._vertexMap.clear();
    this._vertexList = [];
    const idx: number[] = [];
    const cornerPos: Vec3Like[] = new Array(8);
    const cornerVal: number[] = new Array(8);

    for (let iz: number = 0; iz < res; iz++) {
      for (let iy: number = 0; iy < res; iy++) {
        for (let ix: number = 0; ix < res; ix++) {
          for (let k: number = 0; k < 8; k++) {
            const [ox, oy, oz] = CUBE_CORNER_OFFSETS[k]!;
            const cix: number = ix + ox;
            const ciy: number = iy + oy;
            const ciz: number = iz + oz;
            cornerPos[k] = {
              x: this.min.x + cix * dx,
              y: this.min.y + ciy * dy,
              z: this.min.z + ciz * dz,
            };
            cornerVal[k] = field[idxOf(cix, ciy, ciz)]!;
          }

          for (const tet of CUBE_TETRAHEDRA) {
            this._processTetrahedron(
              idx,
              [cornerPos[tet[0]]!, cornerPos[tet[1]]!, cornerPos[tet[2]]!, cornerPos[tet[3]]!],
              [cornerVal[tet[0]]!, cornerVal[tet[1]]!, cornerVal[tet[2]]!, cornerVal[tet[3]]!],
            );
          }
        }
      }
    }

    const uvList: number[] = [];
    const sizeX = Math.max(0.0001, this.max.x - this.min.x);
    const sizeY = Math.max(0.0001, this.max.y - this.min.y);
    for (let i = 0; i < this._vertexList.length; i += 3) {
      const vx = this._vertexList[i]!;
      const vy = this._vertexList[i + 1]!;
      uvList.push((vx - this.min.x) / sizeX, (vy - this.min.y) / sizeY);
    }

    this._vertices = new Float32Array(this._vertexList);
    this._uvs = new Float32Array(uvList);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }
}
