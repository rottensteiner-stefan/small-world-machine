/** Horizontal lean in world XZ (tangent of the tip lean angle). Reused out-parameter, no allocation. */
export interface WindLean {
  x: number;
  z: number;
}

export interface WindFieldOptions {
  /** Downwind direction in world XZ; normalized internally. Defaults to +X. */
  directionX?: number;
  directionZ?: number;
  /** Travel speed of gust fronts in m/s. Defaults to 6. */
  speed?: number;
  /** Base lean that is always present (tangent). Defaults to 0.08. */
  strength?: number;
  /** Extra lean at full gust (tangent). Defaults to 0.35. */
  gustStrength?: number;
  /** Gust wavelength along the wind in metres. Defaults to 40. */
  gustLength?: number;
  /** Across-wind stretch factor of gust blobs (wide fronts, not round puffs). Defaults to 2.5. */
  crossStretch?: number;
  /** Fraction of the noise range that stays calm (0..0.95). Defaults to 0.35. */
  calm?: number;
  /** Small per-plant oscillation amplitude (tangent). Defaults to 0.06. */
  flutterStrength?: number;
  /** Flutter frequency in Hz. Defaults to 1.6. */
  flutterFrequency?: number;
  /** Plant height in metres at which the full wind applies. Defaults to 10. */
  boundaryHeight?: number;
  /** Wind factor for plants of zero height (ground boundary layer). Defaults to 0.55. */
  groundFactor?: number;
  /** Clamp for the total lean (tangent). Defaults to 0.9. */
  maxLean?: number;
}

/**
 * Shared vegetation wind field (ADR 0059 step 1b): gust fronts travel downwind as value-noise waves
 * stretched across the wind, plants flutter with a per-root phase, and the lean is attenuated near
 * the ground and by a consumer-supplied shelter factor (canopy cover). One instance drives every
 * vegetation layer so ground cover, trees and impostors move coherently.
 *
 * GPU side: `WIND_FIELD_WGSL` / `WIND_FIELD_GLSL` (identical math, mirrored here for CPU consumers
 * and tests). Upload `uniforms` (4 x vec4) to wherever the consumer binds `SwmWind`.
 */
export class WindField {
  /** Gust lattice period along the wind; scroll wraps here seamlessly (noise is periodic in x). */
  public static readonly PERIOD: number = 256;
  /** Float count of the `SwmWind` block (4 x vec4). */
  public static readonly UNIFORM_FLOATS: number = 16;

  private static readonly _TAU: number = Math.PI * 2;
  private static readonly _CROSS_FLUTTER: number = 0.35;
  private static readonly _FLUTTER_FLOOR: number = 0.25;
  private static readonly _MAX_CALM: number = 0.95;
  private static readonly _MIN_LENGTH: number = 1e-3;
  private static readonly _EPS: number = 1e-5;

  public speed: number;
  public strength: number;
  public gustStrength: number;
  public gustLength: number;
  public crossStretch: number;
  public calm: number;
  public flutterStrength: number;
  public flutterFrequency: number;
  public boundaryHeight: number;
  public groundFactor: number;
  public maxLean: number;

  /** `SwmWind` block, rewritten in place by `update()`; safe to upload every frame. */
  public readonly uniforms: Float32Array = new Float32Array(WindField.UNIFORM_FLOATS);

  private _dirX: number = 1;
  private _dirZ: number = 0;
  private _scroll: number = 0;
  private _flutterPhase: number = 0;

  constructor(options: WindFieldOptions = {}) {
    this.speed = options.speed ?? 6;
    this.strength = options.strength ?? 0.08;
    this.gustStrength = options.gustStrength ?? 0.35;
    this.gustLength = options.gustLength ?? 40;
    this.crossStretch = options.crossStretch ?? 2.5;
    this.calm = options.calm ?? 0.35;
    this.flutterStrength = options.flutterStrength ?? 0.06;
    this.flutterFrequency = options.flutterFrequency ?? 1.6;
    this.boundaryHeight = options.boundaryHeight ?? 10;
    this.groundFactor = options.groundFactor ?? 0.55;
    this.maxLean = options.maxLean ?? 0.9;
    this.setDirection(options.directionX ?? 1, options.directionZ ?? 0);
    this._writeUniforms();
  }

  public get directionX(): number {
    return this._dirX;
  }

  public get directionZ(): number {
    return this._dirZ;
  }

  /** Gust scroll offset in lattice cells, in [0, PERIOD). */
  public get scroll(): number {
    return this._scroll;
  }

  /** Sets the downwind direction. A zero vector keeps the previous direction. */
  public setDirection(x: number, z: number): void {
    const len = Math.hypot(x, z);
    if (len < WindField._EPS) {
      return;
    }
    this._dirX = x / len;
    this._dirZ = z / len;
  }

  /** Advances gusts and flutter by `deltaTime` seconds and rewrites `uniforms`. Allocation-free. */
  public update(deltaTime: number): void {
    const length = Math.max(this.gustLength, WindField._MIN_LENGTH);
    this._scroll = WindField._wrap(
      this._scroll + (this.speed * deltaTime) / length,
      WindField.PERIOD,
    );
    this._flutterPhase = WindField._wrap(
      this._flutterPhase + WindField._TAU * this.flutterFrequency * deltaTime,
      WindField._TAU,
    );
    this._writeUniforms();
  }

  /** Gust envelope 0..1 at world XZ. CPU mirror of `swmWindGust`; reads the last written uniforms. */
  public gust(x: number, z: number): number {
    const u = this.uniforms;
    const dirX = u[0]!;
    const dirZ = u[1]!;
    const along = (x * dirX + z * dirZ) * u[6]! - u[2]!;
    const across = (-x * dirZ + z * dirX) * u[7]!;
    const n1 = WindField._noise(along, across, WindField.PERIOD);
    const n2 = WindField._noise(2 * along, 2 * across + 17, 2 * WindField.PERIOD);
    const n = (2 * n1 + n2) / 3;
    const g = WindField._saturate((n - u[8]!) * u[13]!);
    return g * g * (3 - 2 * g);
  }

  /**
   * Lean for a plant rooted at world XZ. CPU mirror of `swmWindLean`.
   * @param height plant height in metres (vertical wind profile)
   * @param shelter 0 = open field .. 1 = fully sheltered (e.g. canopy density under trees)
   */
  public sampleLean(
    x: number,
    z: number,
    height: number,
    shelter: number,
    out: WindLean,
  ): WindLean {
    const u = this.uniforms;
    const dirX = u[0]!;
    const dirZ = u[1]!;
    const g = this.gust(x, z);
    const groundFactor = u[11]!;
    const profile = groundFactor + (1 - groundFactor) * WindField._saturate(height * u[10]!);
    const phase = u[3]! + WindField._TAU * WindField._hash(x * 0.73 + 11.1, z * 0.73 + 3.7);
    const flutter = u[9]! * (WindField._FLUTTER_FLOOR + g);
    const alongLean = u[4]! + u[5]! * g + flutter * Math.sin(phase);
    const crossLean = WindField._CROSS_FLUTTER * flutter * Math.cos(phase);
    const scale = profile * (1 - shelter);
    const lx = (dirX * alongLean - dirZ * crossLean) * scale;
    const lz = (dirZ * alongLean + dirX * crossLean) * scale;
    const clamp = Math.min(1, u[12]! / Math.max(Math.hypot(lx, lz), WindField._EPS));
    out.x = lx * clamp;
    out.z = lz * clamp;
    return out;
  }

  private _writeUniforms(): void {
    const u = this.uniforms;
    const length = Math.max(this.gustLength, WindField._MIN_LENGTH);
    const calm = Math.min(Math.max(this.calm, 0), WindField._MAX_CALM);
    u[0] = this._dirX;
    u[1] = this._dirZ;
    u[2] = this._scroll;
    u[3] = this._flutterPhase;
    u[4] = this.strength;
    u[5] = this.gustStrength;
    u[6] = 1 / length;
    u[7] = 1 / (length * Math.max(this.crossStretch, WindField._MIN_LENGTH));
    u[8] = calm;
    u[9] = this.flutterStrength;
    u[10] = 1 / Math.max(this.boundaryHeight, WindField._MIN_LENGTH);
    u[11] = this.groundFactor;
    u[12] = this.maxLean;
    u[13] = 1 / (1 - calm);
    u[14] = 0;
    u[15] = 0;
  }

  private static _wrap(value: number, period: number): number {
    return value - period * Math.floor(value / period);
  }

  private static _saturate(value: number): number {
    return Math.min(Math.max(value, 0), 1);
  }

  private static _fract(value: number): number {
    return value - Math.floor(value);
  }

  /** Dave Hoskins hash12 (sin-free, stable across GPUs); same constants as the shader chunks. */
  private static _hash(x: number, y: number): number {
    let a = WindField._fract(x * 0.1031);
    let b = WindField._fract(y * 0.1031);
    let c = a;
    const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
    a += d;
    b += d;
    c += d;
    return WindField._fract((a + b) * c);
  }

  private static _noise(x: number, y: number, period: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const x0 = WindField._wrap(ix, period);
    const x1 = WindField._wrap(x0 + 1, period);
    const a = WindField._hash(x0, iy);
    const b = WindField._hash(x1, iy);
    const c = WindField._hash(x0, iy + 1);
    const e = WindField._hash(x1, iy + 1);
    const top = a + (b - a) * ux;
    const bottom = c + (e - c) * ux;
    return top + (bottom - top) * uy;
  }
}
