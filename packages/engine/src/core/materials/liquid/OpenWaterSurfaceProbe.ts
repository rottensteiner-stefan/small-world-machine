import { OpenWaterMaterial } from "./OpenWaterMaterial.js";

type WaveLane = [number, number, number, number];

/**
 * The lanes of an OpenWater material the vertex shader evaluates. The wave lanes are transmitted
 * as `u_extraParams`, `u_liquidParams` and `u_thresholds`, `speed` as `u_reflectivity`, `splat` as
 * `u_styleA` and `poolHalfExtent` as `u_matParam2.w`. S1 contract: the probe must read these SAME
 * fields and never re-derive or hand-copy constants, otherwise the "same-field" proof (G2
 * constants-equality manifest) breaks.
 *
 * The object is read LIVE on every query (an `OpenWaterMaterial` passes itself via
 * `fromMaterial`), so inspector edits and `emitSplat` calls reach the probe. Pass a frozen
 * snapshot to pin the values.
 */
export interface OpenWaterWaveLanes {
  wave1: readonly [number, number, number, number];
  wave2: readonly [number, number, number, number];
  wave3: readonly [number, number, number, number];
  speed: number;
  /** `[x, z, spawnTime, energy]`; omitted = no impact ring. */
  splat?: readonly [number, number, number, number];
  /** Half extent of the clapotis basin walls; omitted or 0 = no wall reflection (the shader's `u_matParam2.w`). */
  poolHalfExtent?: number;
}

export interface OpenWaterSurfaceProbeOptions {
  /** World-space rest height of the water plane. Defaults to 0. */
  restHeight?: number;
  /**
   * When true, every intermediate of the mirror is rounded to float32 via Math.fround,
   * emulating the GPU's IEEE-754 f32 arithmetic. Defaults to true.
   */
  f32Precision?: boolean;
}

interface WaveTerms {
  nx: number;
  ny: number;
  a: number;
  k: number;
  sinf: number;
  cosf: number;
}

interface HorizontalSolve {
  dx: number;
  dz: number;
  jxx: number;
  jxz: number;
  jzz: number;
}

const PI_2 = 6.28318530718;
const GRAVITY = 9.81;
const MIN_K = 0.001;
const MIN_WAVELENGTH = 0.001;

// Splat ring constants of the `OpenWater.vert.*` impact-ring block.
const SPLAT_MAX_AGE = 4.0;
const SPLAT_SPEED = 3.5;
const SPLAT_RING_WIDTH = 0.8;
const SPLAT_DECAY_RATE = 1.2;
const SPLAT_FREQUENCY = 8.0;
const SPLAT_AMPLITUDE = 0.15;

// Clapotis wall constants of the same shader: the reflected wave is active in
// (-WALL_OUTER, WALL_INNER) of distance to a wall and fades in over the inner band.
const WALL_INNER = 1.5;
const WALL_OUTER = -0.5;
const WALL_STEEPNESS_SCALE = 0.85;

/**
 * CPU-side mirror of the OpenWater vertex shader's height field: the six-wave Gerstner sum
 * (shared `liquid_gerstner_wave` chunk), the S2 impact ring (`emitSplat`) and the S3 clapotis
 * wall reflection (`poolHalfExtent`). Reproduces the per-op sequence and, by default, rounds
 * every intermediate to float32 so the computed surface height matches what the GPU would
 * produce. Not mirrored: the vertex normal / crest foam metric (visual only).
 *
 * S1 purpose: replace the flat `fv.bounds.max.y` probe in `BuoyancySolver` with a query of the
 * actual wave surface ("the body rides the real surface").
 *
 * Queries are allocation-free (scratch fields); they are not re-entrant.
 */
export class OpenWaterSurfaceProbe {
  private readonly _lanes: OpenWaterWaveLanes;
  private readonly _restHeight: number;
  private readonly _f32: boolean;

  /** w1..w6 of the current query, refreshed from the live lanes by `_syncWaves()`. */
  private readonly _waves: WaveLane[] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  private readonly _wallWave: WaveLane = [0, 0, 0, 0];
  private readonly _termsScratch: WaveTerms = { nx: 0, ny: 0, a: 0, k: 0, sinf: 0, cosf: 0 };
  private readonly _solveScratch: HorizontalSolve = { dx: 0, dz: 0, jxx: 1, jxz: 0, jzz: 1 };

  constructor(lanes: OpenWaterWaveLanes, options: OpenWaterSurfaceProbeOptions = {}) {
    this._lanes = lanes;
    this._restHeight = options.restHeight ?? 0.0;
    this._f32 = options.f32Precision ?? true;
  }

  /** Probe bound to the material itself, so wave edits and `emitSplat` calls are picked up live. */
  public static fromMaterial(
    material: OpenWaterMaterial,
    options: OpenWaterSurfaceProbeOptions = {},
  ): OpenWaterSurfaceProbe {
    return new OpenWaterSurfaceProbe(material, options);
  }

  /**
   * Snapshot of the lanes this probe currently reads. Used by the constants-equality manifest to
   * prove the probe reads the same fields the material packs for the GPU -- the "same field"
   * proof.
   */
  public getWaveLanes(): OpenWaterWaveLanes {
    const lanes = this._lanes;
    const snapshot: OpenWaterWaveLanes = {
      wave1: lanes.wave1.slice() as WaveLane,
      wave2: lanes.wave2.slice() as WaveLane,
      wave3: lanes.wave3.slice() as WaveLane,
      speed: lanes.speed,
    };
    if (undefined !== lanes.splat) {
      snapshot.splat = lanes.splat.slice() as WaveLane;
    }
    if (undefined !== lanes.poolHalfExtent) {
      snapshot.poolHalfExtent = lanes.poolHalfExtent;
    }
    return snapshot;
  }

  public get restHeight(): number {
    return this._restHeight;
  }

  /**
   * Height of the vertex whose REST position is (x, z) -- NOT the height above a world point.
   * Gerstner waves also move vertices horizontally, so for a body standing at a world position
   * use {@link surfaceHeightAt}. Includes the impact ring and the wall reflection.
   */
  public heightAt(x: number, z: number, time: number): number {
    this._syncWaves();
    return this._heightAtRest(x, z, time);
  }

  /**
   * Surface height above the WORLD point (x, z). The shader displaces vertices horizontally as
   * well (Gerstner), so the vertex that ends up above (x, z) started at a different rest
   * position. This solves `rest + horizontalDisplacement(rest) = target` with Newton's method
   * (analytic 2x2 Jacobian, quadratic convergence; a plain fixed-point iteration does not
   * converge once the summed steepness of all six waves exceeds 1) and returns the height at
   * the resulting rest position. Use this for buoyancy. Valid for surfaces that do not fold over
   * themselves: where the Jacobian is singular the last estimate is kept, and on very steep lane
   * sets (summed steepness far above 1) several vertices can lie above one point, so the result
   * may belong to any of them. The wall fade `smoothstep` is treated as constant in the
   * Jacobian (it only slows convergence near walls). Checked against the real vertex shader by
   * `scripts/probe-gpu-parity.js`.
   */
  public surfaceHeightAt(x: number, z: number, time: number, iterations: number = 4): number {
    this._syncWaves();
    let restX = x;
    let restZ = z;
    for (let i = 0; i < iterations; i++) {
      const g = this._horizontalDisplacement(restX, restZ, time);
      const residualX = restX + g.dx - x;
      const residualZ = restZ + g.dz - z;
      const det = g.jxx * g.jzz - g.jxz * g.jxz;
      if (Math.abs(det) < 1e-6) {
        break;
      }
      restX = this._round(restX - (g.jzz * residualX - g.jxz * residualZ) / det);
      restZ = this._round(restZ - (g.jxx * residualZ - g.jxz * residualX) / det);
    }
    return this._heightAtRest(restX, restZ, time);
  }

  /**
   * Vertical displacement contribution of a single wave lane, mirroring the
   * `gerstnerWave` chunk (chunks/liquid_gerstner_wave.glsl). The world position (x, z) is
   * the REST position -- the shader evaluates Gerstner at the undisplaced vertex.
   */
  public static waveHeight(
    wave: readonly [number, number, number, number],
    x: number,
    z: number,
    speed: number,
    time: number,
    f32Precision: boolean = true,
  ): number {
    const terms: WaveTerms = { nx: 0, ny: 0, a: 0, k: 0, sinf: 0, cosf: 0 };
    OpenWaterSurfaceProbe._terms(wave, x, z, speed, time, f32Precision, terms);
    return f32Precision ? Math.fround(terms.a * terms.sinf) : terms.a * terms.sinf;
  }

  /**
   * The shared per-wave terms of the `gerstnerWave` chunk: normalized direction, amplitude `a`,
   * `sin`/`cos` of the phase. Exact op order of the shader, rounded to f32 when requested.
   */
  private static _terms(
    wave: readonly [number, number, number, number],
    x: number,
    z: number,
    speed: number,
    time: number,
    f32Precision: boolean,
    out: WaveTerms,
  ): void {
    const f = (v: number): number => (f32Precision ? Math.fround(v) : v);

    const dirX = f(wave[0]);
    const dirY = f(wave[1]);
    const steepness = f(wave[2]);
    const wavelength = f(Math.max(wave[3], MIN_WAVELENGTH));
    const k = f(PI_2 / wavelength);
    const w = f(Math.sqrt(f(GRAVITY * k)));
    const a = f(steepness / f(Math.max(k, MIN_K)));
    // normalize(wave.xy): no clamp in the shader -- GLSL and WGSL both call
    // `normalize(wave.xy)` verbatim. Reproduces length then the two divisions.
    const len = f(Math.sqrt(f(f(dirX * dirX) + f(dirY * dirY))));
    const nx = f(dirX / len);
    const ny = f(dirY / len);
    const dot = f(f(nx * x) + f(ny * z));
    const kDot = f(k * dot);
    // f = k * dot - w * speed * time: GLSL groups `w * speed * time` as ((w*speed)*time).
    const wSpeed = f(w * f(speed));
    const phaseTerm = f(wSpeed * f(time));
    const phase = f(kDot - phaseTerm);
    out.nx = nx;
    out.ny = ny;
    out.a = a;
    out.k = k;
    out.sinf = f(Math.sin(phase));
    out.cosf = f(Math.cos(phase));
  }

  /** Height of the vertex at rest position (x, z); requires `_syncWaves()` for this query. */
  private _heightAtRest(x: number, z: number, time: number): number {
    const speed = this._lanes.speed;
    const f32 = this._f32;
    const terms = this._termsScratch;
    // The shader accumulates `displacement += gerstnerWave(...)` six times; every `+` is an
    // f32 add on the GPU, so each intermediate sum is rounded when f32Precision is enabled.
    let sum = 0.0;
    for (let i = 0; i < 6; i++) {
      OpenWaterSurfaceProbe._terms(this._waves[i]!, x, z, speed, time, f32, terms);
      sum = this._round(sum + this._round(terms.a * terms.sinf));
    }
    sum = this._round(sum + this._splatHeight(x, z, time));
    sum = this._round(sum + this._wallHeight(x, z, time));
    return this._round(this._restHeight + sum);
  }

  /** `displacement.y += rippleDisp` of the shader's S2 block. */
  private _splatHeight(x: number, z: number, time: number): number {
    const splat = this._lanes.splat;
    if (undefined === splat) {
      return 0.0;
    }
    const r = (v: number): number => this._round(v);
    const age = r(time - splat[2]);
    if (!(age >= 0.0 && age < SPLAT_MAX_AGE && splat[3] > 0.0)) {
      return 0.0;
    }
    const dx = r(x - splat[0]);
    const dz = r(z - splat[1]);
    const dist = r(Math.sqrt(r(r(dx * dx) + r(dz * dz))));
    const ringDist = r(dist - r(age * SPLAT_SPEED));
    const mask = r(Math.exp(r(r(-ringDist * ringDist) / r(SPLAT_RING_WIDTH * SPLAT_RING_WIDTH))));
    const decay = r(r(Math.exp(r(-age * SPLAT_DECAY_RATE))) * splat[3]);
    return r(r(r(r(Math.sin(r(ringDist * SPLAT_FREQUENCY))) * mask) * decay) * SPLAT_AMPLITUDE);
  }

  /** Summed vertical contribution of the S3 wall-reflected waves (x wall first, then z wall). */
  private _wallHeight(x: number, z: number, time: number): number {
    const half = this._lanes.poolHalfExtent;
    if (undefined === half || !(half > 0.0)) {
      return 0.0;
    }
    let sum = 0.0;
    for (let axis = 0; axis < 2; axis++) {
      const trap = this._fillWallWave(axis, x, z, half);
      if (trap < 0.0) {
        continue;
      }
      OpenWaterSurfaceProbe._terms(
        this._wallWave,
        x,
        z,
        this._lanes.speed,
        time,
        this._f32,
        this._termsScratch,
      );
      const t = this._termsScratch;
      sum = this._round(sum + this._round(this._round(t.a * t.sinf) * trap));
    }
    return sum;
  }

  /**
   * Fills `_wallWave` with the reflected wave of the x (axis 0) or z (axis 1) wall and returns
   * its `wallTrap` fade, or -1 when the vertex is outside that wall's active band.
   */
  private _fillWallWave(axis: number, x: number, z: number, half: number): number {
    const r = (v: number): number => this._round(v);
    const coord = 0 === axis ? x : z;
    const wallDist = r(half - Math.abs(coord));
    if (!(wallDist < WALL_INNER && wallDist > WALL_OUTER)) {
      return -1.0;
    }
    const w1 = this._waves[0]!;
    const sign = Math.sign(coord);
    const normX = 0 === axis ? -sign : 0.0;
    const normZ = 0 === axis ? 0.0 : -sign;
    const dot = r(r(w1[0] * normX) + r(w1[1] * normZ));
    const twoDot = r(2.0 * dot);
    const wave = this._wallWave;
    wave[0] = r(w1[0] - r(twoDot * normX));
    wave[1] = r(w1[1] - r(twoDot * normZ));
    wave[2] = r(w1[2] * WALL_STEEPNESS_SCALE);
    wave[3] = w1[3];
    // smoothstep(1.5, 0.0, d) with the reversed edges the shader passes.
    const u = Math.min(1.0, Math.max(0.0, r(r(wallDist - WALL_INNER) / r(0.0 - WALL_INNER))));
    return r(r(u * u) * r(3.0 - r(2.0 * u)));
  }

  /**
   * Summed horizontal Gerstner displacement `(dir.x, dir.y) * a * cos(phase)` of all waves
   * (including the wall reflections) and its Jacobian with respect to the rest position
   * (`jxx`, `jxz`, `jzz` are the entries of `I + d(displacement)/d(rest)`). The returned object
   * is a scratch instance, overwritten by the next call.
   */
  private _horizontalDisplacement(x: number, z: number, time: number): HorizontalSolve {
    const out = this._solveScratch;
    out.dx = 0.0;
    out.dz = 0.0;
    out.jxx = 1.0;
    out.jxz = 0.0;
    out.jzz = 1.0;
    for (let i = 0; i < 6; i++) {
      this._accumulate(this._waves[i]!, x, z, time, 1.0);
    }
    const half = this._lanes.poolHalfExtent;
    if (undefined !== half && half > 0.0) {
      for (let axis = 0; axis < 2; axis++) {
        const trap = this._fillWallWave(axis, x, z, half);
        if (trap >= 0.0) {
          this._accumulate(this._wallWave, x, z, time, trap);
        }
      }
    }
    return out;
  }

  private _accumulate(wave: WaveLane, x: number, z: number, time: number, weight: number): void {
    const out = this._solveScratch;
    const t = this._termsScratch;
    OpenWaterSurfaceProbe._terms(wave, x, z, this._lanes.speed, time, this._f32, t);
    out.dx = this._round(out.dx + this._round(this._round(t.nx * t.a) * t.cosf) * weight);
    out.dz = this._round(out.dz + this._round(this._round(t.ny * t.a) * t.cosf) * weight);
    const slope = t.a * t.k * t.sinf * weight;
    out.jxx -= slope * t.nx * t.nx;
    out.jxz -= slope * t.nx * t.ny;
    out.jzz -= slope * t.ny * t.ny;
  }

  private _round(v: number): number {
    return this._f32 ? Math.fround(v) : v;
  }

  /** Refreshes w1..w6 from the live lanes (w4..w6 are derived exactly as the vertex shader does). */
  private _syncWaves(): void {
    const f = (v: number): number => this._round(v);
    const w1 = this._lanes.wave1;
    const w2 = this._lanes.wave2;
    const w3 = this._lanes.wave3;
    const waves = this._waves;
    for (let i = 0; i < 4; i++) {
      waves[0]![i] = w1[i]!;
      waves[1]![i] = w2[i]!;
      waves[2]![i] = w3[i]!;
    }
    // vec4(w1.y, -w1.x, w1.z * 0.45, w1.w * 0.42) -- perpendicular detail wave 1.
    const w4 = waves[3]!;
    w4[0] = f(w1[1]);
    w4[1] = f(-w1[0]);
    w4[2] = f(w1[2] * 0.45);
    w4[3] = f(w1[3] * 0.42);
    // vec4(-w2.y, w2.x, w2.z * 0.35, w2.w * 0.35) -- detail wave 2.
    const w5 = waves[4]!;
    w5[0] = f(-w2[1]);
    w5[1] = f(w2[0]);
    w5[2] = f(w2[2] * 0.35);
    w5[3] = f(w2[3] * 0.35);
    // vec4(w1.x*0.5 - w1.y*0.866, w1.x*0.866 + w1.y*0.5, w1.z*0.25, w1.w*0.22) -- bimodal 60-deg cross-swell.
    const w6 = waves[5]!;
    w6[0] = f(f(w1[0] * 0.5) - f(w1[1] * 0.866));
    w6[1] = f(f(w1[0] * 0.866) + f(w1[1] * 0.5));
    w6[2] = f(w1[2] * 0.25);
    w6[3] = f(w1[3] * 0.22);
  }
}
