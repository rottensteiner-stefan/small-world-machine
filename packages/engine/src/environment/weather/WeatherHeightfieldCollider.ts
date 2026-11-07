/**
 * Roof-height oracle for weather particles. A fixed-resolution, world-anchored heightfield.
 * @invariant HEIGHTFIELD-ROOF-CULL: every weather particle with `y < y_roof(x, z) + cullEpsilon`
 * is culled -- rain/snow/ash never render below a roof; the independent roof-depth oracle stays
 * consistent with the 256x256 bake (monotone, no precipitation below the roof).
 *
 * The grid is a 256x256 (default) bilinear-interpolated top-down roof map around a point the
 * caller controls (e.g. the camera): `bake()` samples an INDEPENDENT height source at every cell
 * center, and `roofY(x, z)` is the interpolation oracle any other subsystem may use. Bake cadence
 * is CALLER-governed -- this class never auto-bakes inside an update tick, and neither `roofY`
 * nor `isCulled` allocates (pure scalar math over the preallocated `Float32Array`).
 *
 * Subsystem independence: the height source is provided by the caller (analytic scene height,
 * ortho depth readback, physics voxel map, ...), so the engine keeps no renderer dependency here.
 */

/** World-space roof height at `(worldX, worldZ)`; the caller supplies the actual oracle. */
export type WeatherRoofSource = (worldX: number, worldZ: number) => number;

export interface WeatherHeightfieldColliderOptions {
  /** Cells per side. The contract roof bake is 256x256; must be >= 2. Defaults to 256. */
  resolution?: number;
  /** World size of one cell (equal in X and Z). Must be > 0. Defaults to 1. */
  cellSize?: number;
  /** Cull margin: `isCulled` is true exactly when `y < roofY(x,z) + cullEpsilon`. Defaults
   * to 0.05 so particles flush with a roof surface do not flicker in and out. */
  cullEpsilon?: number;
}

const DEFAULT_RESOLUTION = 256;
const DEFAULT_CELL_SIZE = 1;
const DEFAULT_CULL_EPSILON = 0.05;

export class WeatherHeightfieldCollider {
  private readonly _heights: Float32Array;
  private readonly _resolution: number;
  private readonly _cellSize: number;
  private readonly _cullEpsilon: number;
  /** World coordinates of cell (0,0) -- moved by `bake(center)`, never read on the hot path. */
  private _originX = 0;
  private _originZ = 0;

  constructor(options: WeatherHeightfieldColliderOptions = {}) {
    const resolution = options.resolution ?? DEFAULT_RESOLUTION;
    if (resolution < 2 || !Number.isInteger(resolution)) {
      throw new Error(
        `[WeatherHeightfieldCollider] resolution must be an integer >= 2, got ${resolution}.`,
      );
    }
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    if (cellSize <= 0 || !Number.isFinite(cellSize)) {
      throw new Error(`[WeatherHeightfieldCollider] cellSize must be > 0, got ${cellSize}.`);
    }
    const cullEpsilon = options.cullEpsilon ?? DEFAULT_CULL_EPSILON;
    if (cullEpsilon < 0 || !Number.isFinite(cullEpsilon)) {
      throw new Error(`[WeatherHeightfieldCollider] cullEpsilon must be >= 0, got ${cullEpsilon}.`);
    }
    this._resolution = resolution;
    this._cellSize = cellSize;
    this._cullEpsilon = cullEpsilon;
    this._heights = new Float32Array(resolution * resolution);
  }

  /** Grid cells per side. */
  public get resolution(): number {
    return this._resolution;
  }

  /** World extent of an entire grid side (`resolution * cellSize`). */
  public get extent(): number {
    return this._resolution * this._cellSize;
  }

  /** World X of cell column 0. */
  public get originX(): number {
    return this._originX;
  }

  /** World Z of cell row 0. */
  public get originZ(): number {
    return this._originZ;
  }

  /** Read-only view of the baked grid (row-major, index = row * resolution + column). The
   * backing array is reused across `bake()` calls; never mutated by queries. */
  public get heights(): Readonly<Float32Array> {
    return this._heights;
  }

  /**
   * Re-bakes the ENTIRE grid from `source` centered on `(centerX, centerZ)` -- the caller
   * governs cadence (e.g. a few times per second, never per frame). Each cell stores the roof
   * height sampled at its center. Zero allocation: writes into the preallocated grid.
   */
  public bake(source: WeatherRoofSource, centerX: number, centerZ: number): void {
    const half = this.extent / 2;
    this._originX = centerX - half;
    this._originZ = centerZ - half;
    const cell = this._cellSize;
    const res = this._resolution;
    const heights = this._heights;
    for (let row = 0; row < res; row++) {
      const wz = this._originZ + (row + 0.5) * cell;
      const base = row * res;
      for (let col = 0; col < res; col++) {
        const wx = this._originX + (col + 0.5) * cell;
        heights[base + col] = source(wx, wz);
      }
    }
  }

  /**
   * Roof-height oracle at `(worldX, worldZ)`: bilinear interpolation over the baked grid,
   * clamped to the footprint (a query outside the baked area resolves to the nearest edge cell,
   * never NaN). Zero allocation.
   */
  public roofY(worldX: number, worldZ: number): number {
    const res = this._resolution;
    const cell = this._cellSize;
    // Value i sits at the cell CENTER (origin + (i + 0.5) * cell), see `bake`.
    const fx = (worldX - this._originX) / cell - 0.5;
    const fz = (worldZ - this._originZ) / cell - 0.5;
    const last = res - 1;
    const cx0 = clampTo(fx, 0, last - 1);
    const cz0 = clampTo(fz, 0, last - 1);
    const x0 = Math.floor(cx0);
    const z0 = Math.floor(cz0);
    const tx = Math.min(Math.max(cx0 - x0, 0), 1);
    const tz = Math.min(Math.max(cz0 - z0, 0), 1);

    const h = this._heights;
    const a = h[z0 * res + x0]!;
    const b = h[z0 * res + x0 + 1]!;
    const c = h[(z0 + 1) * res + x0]!;
    const d = h[(z0 + 1) * res + x0 + 1]!;
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /**
   * @invariant HEIGHTFIELD-ROOF-CULL: eps-driven cull decision -- `true` exactly when
   * `y < roofY(x, z) + cullEpsilon`. Zero allocation; safe to call per particle per frame.
   */
  public isCulled(x: number, y: number, z: number): boolean {
    return y < this.roofY(x, z) + this._cullEpsilon;
  }
}

function clampTo(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
