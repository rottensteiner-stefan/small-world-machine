import { AbstractGeometry, MathUtils } from "@small-world-machine/engine";

/**
 * Configuration options for torus knot geometry.
 */
export interface TorusKnotOptions {
  /** The overall radius of the underlying knot curve. Defaults to 1. */
  radius?: number;
  /** The radius of the tube around the curve. Defaults to 0.3. */
  tube?: number;
  /** Winding number around the torus axis. Defaults to 2. */
  p?: number;
  /** Winding number around the torus tube. Defaults to 3. */
  q?: number;
  /** The number of segments along the knot curve. Defaults to 128. */
  tubularSegments?: number;
  /** The number of segments around the tube cross-section. Defaults to 12. */
  radialSegments?: number;
}

const FRAME_EPSILON: number = 0.0001;

/**
 * A (p,q) torus knot: a closed curve that winds p times around the torus axis and
 * q times around the torus tube, rendered as a tube swept along that curve.
 * With p=1 or q=1 it degenerates into an unknotted twisted loop.
 */
export class TorusKnot extends AbstractGeometry {
  /** The overall radius of the underlying knot curve. */
  public radius: number;
  /** The radius of the tube around the curve. */
  public tube: number;
  /** Winding number around the torus axis. */
  public p: number;
  /** Winding number around the torus tube. */
  public q: number;
  /** The number of segments along the knot curve. */
  public tubularSegments: number;
  /** The number of segments around the tube cross-section. */
  public radialSegments: number;

  /**
   * Creates a new TorusKnot geometry.
   * @param options The configuration options.
   */
  constructor(options: TorusKnotOptions = {}) {
    super();
    const {
      radius = 1,
      tube = 0.3,
      p = 2,
      q = 3,
      tubularSegments = 128,
      radialSegments = 12,
    } = options;
    this.radius = Math.max(0, radius);
    this.tube = Math.max(0, tube);
    this.p = Math.max(1, Math.floor(Math.abs(p)));
    this.q = Math.max(1, Math.floor(Math.abs(q)));
    this.tubularSegments = Math.max(3, Math.floor(tubularSegments));
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.generateGeometryData();
  }

  /**
   * Evaluates the (p,q) torus knot curve at parameter u.
   * @param u The curve parameter, expected in [0, p * 2π].
   * @returns The [x, y, z] point on the curve.
   */
  private _curvePoint(u: number): readonly [number, number, number] {
    const cu: number = Math.cos(u);
    const su: number = Math.sin(u);
    const quOverP: number = (this.q / this.p) * u;
    const cs: number = Math.cos(quOverP);

    return [
      this.radius * (2 + cs) * 0.5 * cu,
      this.radius * Math.sin(quOverP) * 0.5,
      this.radius * (2 + cs) * 0.5 * su,
    ];
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const cols: number = this.radialSegments + 1;

    for (let i: number = 0; i <= this.tubularSegments; i++) {
      const uRatio: number = i / this.tubularSegments;
      const u: number = uRatio * this.p * MathUtils.TWO_PI;

      const [px, py, pz] = this._curvePoint(u);
      const [qx, qy, qz] = this._curvePoint(u + FRAME_EPSILON);

      const tx: number = qx - px;
      const ty: number = qy - py;
      const tz: number = qz - pz;
      const tLen: number = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const invTLen: number = tLen > 0.000001 ? 1.0 / tLen : 0;
      const tangentX: number = tx * invTLen;
      const tangentY: number = ty * invTLen;
      const tangentZ: number = tz * invTLen;

      // Build a stable normal/binormal frame by projecting a reference "up" vector
      // against the tangent (Gram-Schmidt), swapping references near the singular case
      // where the tangent is (almost) parallel to it.
      let upX: number = 0;
      let upY: number = 1;
      let upZ: number = 0;
      let dot: number = tangentX * upX + tangentY * upY + tangentZ * upZ;
      if (Math.abs(dot) > 0.999999) {
        upX = 1;
        upY = 0;
        upZ = 0;
        dot = tangentX * upX + tangentY * upY + tangentZ * upZ;
      }

      let nx: number = upX - dot * tangentX;
      let ny: number = upY - dot * tangentY;
      let nz: number = upZ - dot * tangentZ;
      const nLen: number = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const invNLen: number = nLen > 0.000001 ? 1.0 / nLen : 0;
      nx *= invNLen;
      ny *= invNLen;
      nz *= invNLen;

      const bx: number = tangentY * nz - tangentZ * ny;
      const by: number = tangentZ * nx - tangentX * nz;
      const bz: number = tangentX * ny - tangentY * nx;

      for (let j: number = 0; j <= this.radialSegments; j++) {
        const vRatio: number = j / this.radialSegments;
        const angle: number = vRatio * MathUtils.TWO_PI;
        const cosA: number = Math.cos(angle);
        const sinA: number = Math.sin(angle);

        v.push(
          px + this.tube * (cosA * nx + sinA * bx),
          py + this.tube * (cosA * ny + sinA * by),
          pz + this.tube * (cosA * nz + sinA * bz),
        );
        uv.push(uRatio, vRatio);
      }
    }

    for (let i: number = 0; i < this.tubularSegments; i++) {
      for (let j: number = 0; j < this.radialSegments; j++) {
        const a: number = i * cols + j;
        const b: number = (i + 1) * cols + j;
        const c: number = (i + 1) * cols + j + 1;
        const d: number = i * cols + j + 1;
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
