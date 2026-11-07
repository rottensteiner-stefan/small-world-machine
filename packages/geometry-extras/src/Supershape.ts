import { AbstractGeometry, MathUtils } from "@small-world-machine/engine";

/**
 * Parameters for one 2D superformula profile (Johan Gielis' generalization of the
 * superellipse). Combining a longitude and a latitude profile produces the family of
 * "supershapes" -- organic, crystalline, or star-like closed surfaces.
 */
export interface SuperformulaParams {
  /** Angular symmetry (number of "lobes"). Defaults to 6. */
  m?: number;
  /** Overall roundness exponent. Defaults to 1. */
  n1?: number;
  /** Secondary shape exponent. Defaults to 1. */
  n2?: number;
  /** Tertiary shape exponent. Defaults to 1. */
  n3?: number;
  /** Horizontal scale of the profile. Defaults to 1. */
  a?: number;
  /** Vertical scale of the profile. Defaults to 1. */
  b?: number;
}

interface ResolvedSuperformulaParams {
  m: number;
  n1: number;
  n2: number;
  n3: number;
  a: number;
  b: number;
}

/**
 * Configuration options for supershape geometry.
 */
export interface SupershapeOptions {
  /** Overall radius scale. Defaults to 1. */
  radius?: number;
  /** The number of segments around the longitude (theta) axis. Defaults to 64. */
  longitudeSegments?: number;
  /** The number of segments along the latitude (phi) axis. Defaults to 32. */
  latitudeSegments?: number;
  /** The superformula profile driving the longitude (theta) axis. */
  longitude?: SuperformulaParams;
  /** The superformula profile driving the latitude (phi) axis. */
  latitude?: SuperformulaParams;
}

const MIN_EXPONENT: number = 0.000001;

/**
 * Resolves a (possibly partial) superformula profile into safe, non-degenerate values.
 * @param params The user-supplied profile parameters.
 * @returns Fully resolved parameters, clamped to avoid division-by-zero.
 */
function resolveSuperformulaParams(
  params: SuperformulaParams | undefined,
): ResolvedSuperformulaParams {
  const { m = 6, n1 = 1, n2 = 1, n3 = 1, a = 1, b = 1 } = params ?? {};
  return {
    m,
    n1: Math.max(MIN_EXPONENT, Math.abs(n1)),
    n2,
    n3,
    a: Math.max(MIN_EXPONENT, Math.abs(a)),
    b: Math.max(MIN_EXPONENT, Math.abs(b)),
  };
}

/**
 * Evaluates the superformula radius for a given angle.
 * @param angle The angle in radians.
 * @param p The resolved profile parameters.
 * @returns The radius at that angle. Always finite and non-negative.
 */
function superformulaRadius(angle: number, p: ResolvedSuperformulaParams): number {
  const t1: number = Math.abs(Math.cos((p.m * angle) / 4) / p.a);
  const t2: number = Math.abs(Math.sin((p.m * angle) / 4) / p.b);
  const sum: number = Math.pow(t1, p.n2) + Math.pow(t2, p.n3);
  if (0 === sum) return 0;
  return Math.pow(sum, -1 / p.n1);
}

/**
 * A Gielis supershape: a closed surface swept from two independent superformula
 * profiles (longitude and latitude). With the right exponents it can look like a
 * sphere, a starfish, a gemstone, or an alien organism.
 */
export class Supershape extends AbstractGeometry {
  /** The overall radius scale. */
  public radius: number;
  /** The number of segments around the longitude (theta) axis. */
  public longitudeSegments: number;
  /** The number of segments along the latitude (phi) axis. */
  public latitudeSegments: number;
  /** The superformula profile driving the longitude (theta) axis. */
  public longitude: SuperformulaParams;
  /** The superformula profile driving the latitude (phi) axis. */
  public latitude: SuperformulaParams;

  private readonly _resolvedLongitude: ResolvedSuperformulaParams;
  private readonly _resolvedLatitude: ResolvedSuperformulaParams;

  /**
   * Creates a new Supershape geometry.
   * @param options The configuration options.
   */
  constructor(options: SupershapeOptions = {}) {
    super();
    const {
      radius = 1,
      longitudeSegments = 64,
      latitudeSegments = 32,
      longitude,
      latitude,
    } = options;
    this.radius = Math.max(0, radius);
    this.longitudeSegments = Math.max(3, Math.floor(longitudeSegments));
    this.latitudeSegments = Math.max(2, Math.floor(latitudeSegments));
    this.longitude = longitude ?? {};
    this.latitude = latitude ?? { m: 3 };
    this._resolvedLongitude = resolveSuperformulaParams(this.longitude);
    this._resolvedLatitude = resolveSuperformulaParams(this.latitude);
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    for (let y: number = 0; y <= this.latitudeSegments; y++) {
      const vRatio: number = y / this.latitudeSegments;
      const phi: number = vRatio * Math.PI - Math.PI / 2;
      const r2: number = superformulaRadius(phi, this._resolvedLatitude);
      const cosPhi: number = Math.cos(phi);
      const sinPhi: number = Math.sin(phi);

      for (let x: number = 0; x <= this.longitudeSegments; x++) {
        const uRatio: number = x / this.longitudeSegments;
        const theta: number = uRatio * MathUtils.TWO_PI - Math.PI;
        const r1: number = superformulaRadius(theta, this._resolvedLongitude);

        const px: number = this.radius * r1 * Math.cos(theta) * r2 * cosPhi;
        const py: number = this.radius * r2 * sinPhi;
        const pz: number = this.radius * r1 * Math.sin(theta) * r2 * cosPhi;

        v.push(px, py, pz);
        uv.push(uRatio, vRatio);
      }
    }

    for (let y: number = 0; y < this.latitudeSegments; y++) {
      for (let x: number = 0; x < this.longitudeSegments; x++) {
        const first: number = y * (this.longitudeSegments + 1) + x;
        const second: number = first + this.longitudeSegments + 1;
        idx.push(first, second, first + 1);
        idx.push(second, second + 1, first + 1);
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }

  /**
   * Computes the wireframe indices as a latitude/longitude grid, avoiding the
   * diagonal quad lines a generic triangle-edge wireframe would produce.
   */
  public override computeWireframeIndices(): void {
    const lines: number[] = [];
    const cols: number = this.longitudeSegments + 1;

    for (let y: number = 0; y <= this.latitudeSegments; y++) {
      for (let x: number = 0; x < this.longitudeSegments; x++) {
        const current: number = y * cols + x;
        lines.push(current, current + 1);
      }
    }

    for (let x: number = 0; x <= this.longitudeSegments; x++) {
      for (let y: number = 0; y < this.latitudeSegments; y++) {
        const current: number = y * cols + x;
        lines.push(current, current + cols);
      }
    }

    this._wireframeIndices = this._createIndexArray(lines.length);
    this._wireframeIndices.set(lines);
  }
}
