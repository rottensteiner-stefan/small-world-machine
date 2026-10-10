import { AbstractGeometry, Vector3D } from "@small-world-machine/engine";

/**
 * A user-supplied parametric surface evaluator. `u` and `v` traverse the domains
 * [uMin, uMax] × [vMin, vMax] and the callback must return a finite 3D point.
 */
export type ParametricSurfaceFunction = (u: number, v: number) => Vector3D;

/**
 * Configuration options for parametric surface geometry.
 */
export interface ParametricSurfaceOptions {
  /** The surface evaluator `(u, v) → point`. Required. */
  surface: ParametricSurfaceFunction;
  /** Lower bound of the `u` domain. Defaults to -1. */
  uMin?: number;
  /** Upper bound of the `u` domain. Defaults to 1. */
  uMax?: number;
  /** Lower bound of the `v` domain. Defaults to -1. */
  vMin?: number;
  /** Upper bound of the `v` domain. Defaults to 1. */
  vMax?: number;
  /** Number of subdivisions along `u`. Defaults to 64. */
  uSegments?: number;
  /** Number of subdivisions along `v`. Defaults to 64. */
  vSegments?: number;
  /** Whether the surface is periodic in `u` (the last column wraps to the first). Defaults to false. */
  closedU?: boolean;
  /** Whether the surface is periodic in `v`. Defaults to false. */
  closedV?: boolean;
}

/**
 * A generic parametric surface grid `(u, v) → (x, y, z)`. This single building block covers
 * arbitrary procedurally defined shapes -- waves, flags, helixes, twisting ribbons, terrain
 * patches -- without a dedicated class per family. The domain traversal of `surface` is
 * `u ∈ [uMin, uMax]`, `v ∈ [vMin, vMax]`; degenerated or non-monotonic evaluators are the
 * caller's responsibility.
 */
export class ParametricSurface extends AbstractGeometry {
  /** The surface evaluator. */
  public surface: ParametricSurfaceFunction;
  /** Lower bound of the `u` domain. */
  public uMin: number;
  /** Upper bound of the `u` domain. */
  public uMax: number;
  /** Lower bound of the `v` domain. */
  public vMin: number;
  /** Upper bound of the `v` domain. */
  public vMax: number;
  /** Number of subdivisions along `u`. */
  public uSegments: number;
  /** Number of subdivisions along `v`. */
  public vSegments: number;
  /** Whether the surface is periodic in `u`. */
  public closedU: boolean;
  /** Whether the surface is periodic in `v`. */
  public closedV: boolean;

  /**
   * Creates a new parametric surface geometry.
   * @param options The configuration options.
   */
  constructor(options: ParametricSurfaceOptions) {
    super();
    this.surface = options.surface;
    this.uMin = options.uMin ?? -1;
    this.uMax = options.uMax ?? 1;
    this.vMin = options.vMin ?? -1;
    this.vMax = options.vMax ?? 1;
    this.uSegments = Math.max(1, Math.floor(options.uSegments ?? 64));
    this.vSegments = Math.max(1, Math.floor(options.vSegments ?? 64));
    this.closedU = options.closedU ?? false;
    this.closedV = options.closedV ?? false;
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const uCols = this.closedU ? this.uSegments : this.uSegments + 1;
    const vRows = this.closedV ? this.vSegments : this.vSegments + 1;
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    const du = (this.uMax - this.uMin) / this.uSegments;
    const dv = (this.vMax - this.vMin) / this.vSegments;

    for (let ui = 0; ui < vRows; ui++) {
      const vFrac = this.closedV ? ui / this.vSegments : ui / (vRows - 1);
      const vv = this.vMin + ui * dv;
      for (let uAlpha = 0; uAlpha < uCols; uAlpha++) {
        const uFrac = this.closedU ? uAlpha / this.uSegments : uAlpha / (uCols - 1);
        const uu = this.uMin + uAlpha * du;
        const p = this.surface(uu, vv);
        v.push(p.x, p.y, p.z);
        uv.push(uFrac, vFrac);
      }
    }

    for (let ui = 0; ui < this.vSegments; ui++) {
      for (let uAlpha = 0; uAlpha < this.uSegments; uAlpha++) {
        const a = ui * uCols + uAlpha;
        const b = ui * uCols + ((uAlpha + 1) % uCols);
        const c = ((ui + 1) % vRows) * uCols + ((uAlpha + 1) % uCols);
        const d = ((ui + 1) % vRows) * uCols + uAlpha;
        idx.push(a, b, d);
        idx.push(b, c, d);
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }
}
