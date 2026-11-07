import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";
import type { SdfColliderAffector } from "./SdfColliderAffector.js";

export interface CurlNoiseAffectorOptions {
  /**
   * Spatial frequency of the turbulence field in cycles per meter.
   * @domain (0, Infinity) — defaults to 1.0.
   */
  frequency?: number;
  /**
   * Turbulence acceleration / velocity strength multiplier.
   * @domain [0, Infinity) — defaults to 2.0.
   */
  strength?: number;
  /**
   * Temporal scroll speed of the noise field (animated evolution over time).
   * @domain [0, Infinity) — defaults to 0.5.
   */
  scrollSpeed?: number;
  /**
   * Deterministic integer seed offsetting the 3 vector-potential channels.
   * @domain Integer — defaults to 1337.
   */
  seed?: number;
  /**
   * Optional SDF collider whose distance field ramps the vector potential `Ψ` to zero near
   * obstacle surfaces (Bridson 2007 §3.2), making the curl flow slip tangentially around obstacles
   * while remaining strictly divergence-free everywhere.
   */
  collider?: SdfColliderAffector;
  /**
   * Boundary ramp width `d_ramp` in meters over which the vector potential ramps from 0 at the SDF
   * surface (`φ = 0`) to 1 in the free stream (`φ >= rampWidth`).
   * @domain (0, Infinity) — defaults to 0.5.
   */
  rampWidth?: number;
}

/**
 * Deterministic 3D integer lattice hash returning a float in `[-1, 1]`.
 */
function hashLattice3(ix: number, iy: number, iz: number, channelSeed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(iz, 2147483647) +
    Math.imul(channelSeed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  // Map signed 32-bit int to [-1, 1]
  return (h | 0) * 4.6566128730773926e-10;
}

/**
 * Evaluates 3D C² quintic value noise and its exact analytical gradient `(val, d/dx, d/dy, d/dz)`
 * with respect to the scaled lattice coordinates `(x, y, z)`.
 * Since `u(t) = 6t^5 - 15t^4 + 10t^3` has `u'(0)=u'(1)=u''(0)=u''(1)=0`, the potential is C²
 * across integer cell boundaries and mixed partials commute everywhere.
 */
function evalNoise3AndGrad(x: number, y: number, z: number, seed: number, out: Float64Array): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

  const dux = 30 * fx * fx * (fx - 1) * (fx - 1);
  const duy = 30 * fy * fy * (fy - 1) * (fy - 1);
  const duz = 30 * fz * fz * (fz - 1) * (fz - 1);

  const n000 = hashLattice3(ix, iy, iz, seed);
  const n100 = hashLattice3(ix + 1, iy, iz, seed);
  const n010 = hashLattice3(ix, iy + 1, iz, seed);
  const n110 = hashLattice3(ix + 1, iy + 1, iz, seed);
  const n001 = hashLattice3(ix, iy, iz + 1, seed);
  const n101 = hashLattice3(ix + 1, iy, iz + 1, seed);
  const n011 = hashLattice3(ix, iy + 1, iz + 1, seed);
  const n111 = hashLattice3(ix + 1, iy + 1, iz + 1, seed);

  const k0 = n000;
  const k1 = n100 - n000;
  const k2 = n010 - n000;
  const k3 = n001 - n000;
  const k4 = n000 - n100 - n010 + n110;
  const k5 = n000 - n010 - n001 + n011;
  const k6 = n000 - n100 - n001 + n101;
  const k7 = -n000 + n100 + n010 - n110 + n001 - n101 - n011 + n111;

  out[0] =
    k0 +
    k1 * ux +
    k2 * uy +
    k3 * uz +
    k4 * ux * uy +
    k5 * uy * uz +
    k6 * uz * ux +
    k7 * ux * uy * uz;
  out[1] = (k1 + k4 * uy + k6 * uz + k7 * uy * uz) * dux;
  out[2] = (k2 + k4 * ux + k5 * uz + k7 * ux * uz) * duy;
  out[3] = (k3 + k5 * uy + k6 * ux + k7 * ux * uy) * duz;
}

/**
 * Divergence-free 3D curl-noise turbulence affector (Bridson et al., SIGGRAPH 2007).
 * Computes the analytical curl `v = ∇ × (ramp(φ(p)) · Ψ(p, t))` of a 3-component C² quintic
 * vector potential `Ψ` and adds it to particle accelerations.
 *
 * @invariant CURL-DIVERGENCE-FREE — Because the vector potential `A(p) = ramp(φ(p)) · Ψ(p)` is C²
 * and ramped prior to taking the curl, the resulting field satisfies `∇ · v = 0` everywhere,
 * including across SDF obstacle boundary ramps, and vanishes normal to the obstacle at `φ = 0`.
 */
export class CurlNoiseAffector implements ParticleAffector {
  public frequency: number;
  public strength: number;
  public scrollSpeed: number;
  public readonly seed: number;
  public collider: SdfColliderAffector | undefined;
  public rampWidth: number;

  private _time = 0;
  // Pre-allocated scratch buffers for potential evaluation [val, d/dx, d/dy, d/dz].
  private readonly _potX = new Float64Array(4);
  private readonly _potY = new Float64Array(4);
  private readonly _potZ = new Float64Array(4);
  private readonly _outField = new Float64Array(3);

  constructor(options: CurlNoiseAffectorOptions = {}) {
    this.frequency = options.frequency && options.frequency > 0 ? options.frequency : 1.0;
    this.strength = Math.max(0, options.strength ?? 2.0);
    this.scrollSpeed = Math.max(0, options.scrollSpeed ?? 0.5);
    this.seed = (options.seed ?? 1337) | 0;
    this.collider = options.collider;
    this.rampWidth = options.rampWidth && options.rampWidth > 0 ? options.rampWidth : 0.5;
  }

  /** @inheritdoc */
  public beginFrame(dt: number): void {
    if (dt > 0) {
      this._time += dt * this.scrollSpeed;
    }
  }

  /**
   * Evaluates the divergence-free curl vector field `(vx, vy, vz)` at world position `(px, py, pz)`
   * into `out` (`[vx, vy, vz]`). Exposed for deterministic testing and numerical divergence probes.
   */
  public sampleFieldInto(
    px: number,
    py: number,
    pz: number,
    out: Float64Array | Float32Array,
  ): void {
    const freq = this.frequency;
    const t = this._time;
    const sx = px * freq + t * 0.7;
    const sy = py * freq - t * 0.5;
    const sz = pz * freq + t * 0.3;

    const potX = this._potX;
    const potY = this._potY;
    const potZ = this._potZ;

    evalNoise3AndGrad(sx, sy, sz, this.seed, potX);
    evalNoise3AndGrad(sx + 31.416, sy - 19.19, sz + 73.13, this.seed + 1013904223, potY);
    evalNoise3AndGrad(sx - 57.71, sy + 43.87, sz - 11.31, this.seed - 1664525, potZ);

    // Chain rule factor from scaled coordinates to world meters: d/dp = freq * d/ds.
    let dAx_dy = potX[2]! * freq;
    let dAx_dz = potX[3]! * freq;
    let dAy_dx = potY[1]! * freq;
    let dAy_dz = potY[3]! * freq;
    let dAz_dx = potZ[1]! * freq;
    let dAz_dy = potZ[2]! * freq;

    const collider = this.collider;
    if (collider !== undefined && collider.primitives.length > 0) {
      const phi = collider.evaluate(px, py, pz);
      if (phi <= 0) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return;
      }
      const w = this.rampWidth;
      if (phi < w) {
        // C² quintic ramp r(s) = 6s^5 - 15s^4 + 10s^3 on s = phi / w in (0, 1).
        const s = phi / w;
        const r = s * s * s * (s * (s * 6 - 15) + 10);
        const dr_dphi = (30 * s * s * (s - 1) * (s - 1)) / w;

        const eps = 1e-4;
        const d0 = collider.evaluate(px + eps, py - eps, pz - eps);
        const d1 = collider.evaluate(px - eps, py - eps, pz + eps);
        const d2 = collider.evaluate(px - eps, py + eps, pz - eps);
        const d3 = collider.evaluate(px + eps, py + eps, pz + eps);
        const inv4Eps = 1 / (4 * eps);
        const dphi_dx = (d0 - d1 - d2 + d3) * inv4Eps;
        const dphi_dy = (-d0 - d1 + d2 + d3) * inv4Eps;
        const dphi_dz = (-d0 + d1 - d2 + d3) * inv4Eps;

        const dr_dx = dr_dphi * dphi_dx;
        const dr_dy = dr_dphi * dphi_dy;
        const dr_dz = dr_dphi * dphi_dz;

        // Product rule: d(r * Ψ)/dx_i = r * dΨ/dx_i + (dr/dx_i) * Ψ
        const psiX = potX[0]!;
        const psiY = potY[0]!;
        const psiZ = potZ[0]!;

        dAx_dy = r * dAx_dy + dr_dy * psiX;
        dAx_dz = r * dAx_dz + dr_dz * psiX;
        dAy_dx = r * dAy_dx + dr_dx * psiY;
        dAy_dz = r * dAy_dz + dr_dz * psiY;
        dAz_dx = r * dAz_dx + dr_dx * psiZ;
        dAz_dy = r * dAz_dy + dr_dy * psiZ;
      }
    }

    const scale = this.strength;
    out[0] = (dAz_dy - dAy_dz) * scale;
    out[1] = (dAx_dz - dAz_dx) * scale;
    out[2] = (dAy_dx - dAx_dy) * scale;
  }

  /** @inheritdoc */
  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    const o = index * 3;
    const out = this._outField;
    this.sampleFieldInto(
      arrays.positions[o]!,
      arrays.positions[o + 1]!,
      arrays.positions[o + 2]!,
      out,
    );
    arrays.accelerations[o] = arrays.accelerations[o]! + out[0]!;
    arrays.accelerations[o + 1] = arrays.accelerations[o + 1]! + out[1]!;
    arrays.accelerations[o + 2] = arrays.accelerations[o + 2]! + out[2]!;
  }

  /** @inheritdoc */
  public applyBatch(arrays: ParticleArrays, count: number, _dt: number): void {
    const alive = arrays.aliveFlags;
    const positions = arrays.positions;
    const accelerations = arrays.accelerations;
    const out = this._outField;

    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue;
      const o = i * 3;
      this.sampleFieldInto(positions[o]!, positions[o + 1]!, positions[o + 2]!, out);
      accelerations[o] = accelerations[o]! + out[0]!;
      accelerations[o + 1] = accelerations[o + 1]! + out[1]!;
      accelerations[o + 2] = accelerations[o + 2]! + out[2]!;
    }
  }
}
