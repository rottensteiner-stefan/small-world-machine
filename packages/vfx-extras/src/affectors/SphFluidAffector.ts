import type { Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

/**
 * Axis-aligned world-space containment box optionally enforced in {@link SphFluidAffector.postIntegrate}.
 */
export interface SphFluidBounds {
  /** @domain Minimum world-space corner (meters) of the fluid container box. */
  readonly min: Vector3D;
  /** @domain Maximum world-space corner (meters) of the fluid container box. */
  readonly max: Vector3D;
  /** @domain [0, 1] — Normal bounce restitution against container walls; defaults to 0.25. */
  readonly restitution?: number;
  /** @domain [0, 1] — Tangential velocity damping on wall contact; defaults to 0.1. */
  readonly friction?: number;
}

/**
 * Configuration options for {@link SphFluidAffector}.
 */
export interface SphFluidAffectorOptions {
  /**
   * Kernel support / smoothing radius `h` in world-space meters.
   * @domain (0, Infinity) — defaults to 0.25.
   */
  smoothingRadius?: number;
  /**
   * Target rest density `rho0` in mass per cubic meter.
   * @domain (0, Infinity) — defaults to 300.
   */
  restDensity?: number;
  /**
   * Ideal-gas pressure stiffness `k` relating compression `(rho - rho0)` to pressure.
   * @domain [0, Infinity) — defaults to 3.0.
   */
  stiffness?: number;
  /**
   * Dynamic viscosity coefficient `mu` smoothing relative neighbor velocities.
   * @domain [0, Infinity) — defaults to 0.8.
   */
  viscosity?: number;
  /**
   * Symmetric pairwise surface cohesion strength pulling nearby particles together.
   * @domain [0, Infinity) — defaults to 0.0.
   */
  cohesion?: number;
  /**
   * Maximum SPH acceleration magnitude clamp in meters per second squared for explicit stability.
   * @domain (0, Infinity) — defaults to 250.
   */
  maxAcceleration?: number;
  /**
   * Pre-allocated particle capacity for the SoA linked-cell spatial hash; grows once if exceeded.
   * @domain Positive integer — defaults to 1024.
   */
  capacity?: number;
  /**
   * Optional axis-aligned world-space container bounds resolved in `postIntegrate`.
   */
  bounds?: SphFluidBounds;
}

const HASH_PRIME_X = 73856093;
const HASH_PRIME_Y = 19349663;
const HASH_PRIME_Z = 83492791;

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}

/**
 * Evaluates the normalized 3D Poly6 density smoothing kernel `W_poly6(r, h)` (Müller et al. 2003)
 * from squared distance `r2 = ||x_i - x_j||^2`.
 *
 * @invariant SPH-KERNEL-NORMALIZATION — `∫_0^h 4πr^2 W_poly6(r, h) dr = 1`.
 */
export function sphPoly6(r2: number, h: number): number {
  if (h <= 0 || r2 < 0) return 0;
  const h2 = h * h;
  if (r2 >= h2) return 0;
  const diff = h2 - r2;
  const h3 = h2 * h;
  const h9 = h3 * h3 * h3;
  return (315 / (64 * Math.PI * h9)) * diff * diff * diff;
}

/**
 * Evaluates the radial derivative scalar `dW_spiky(r, h) / dr` of the 3D Spiky pressure kernel
 * (Müller et al. 2003). Multiply by the unit separation vector `(x_i - x_j) / r` to obtain
 * `∇W_spiky`. Always non-positive inside `[0, h)`.
 */
export function sphSpikyGradFactor(r: number, h: number): number {
  if (h <= 0 || r < 0 || r >= h) return 0;
  const diff = h - r;
  const h2 = h * h;
  const h6 = h2 * h2 * h2;
  return (-45 / (Math.PI * h6)) * diff * diff;
}

/**
 * Evaluates the 3D Viscosity kernel Laplacian `∇^2 W_visc(r, h)` (Müller et al. 2003).
 * Always non-negative inside `[0, h)`.
 */
export function sphViscosityLaplacian(r: number, h: number): number {
  if (h <= 0 || r < 0 || r >= h) return 0;
  const h2 = h * h;
  const h6 = h2 * h2 * h2;
  return (45 / (Math.PI * h6)) * (h - r);
}

/**
 * Smoothed Particle Hydrodynamics (SPH) 3D fluid dynamics affector for `@small-world-machine/vfx-extras`
 * implementing Müller et al. (2003) density, symmetric pressure, viscosity, optional cohesion, and a
 * zero-GC SoA linked-cell spatial hash (`Teschner et al. 2003` / `Ihmsen et al. 2011`).
 *
 * @invariant SPH-KERNEL-NORMALIZATION — Poly6 satisfies exact 3D unit-volume normalization; Spiky
 * gradient and Viscosity Laplacian match their analytical kernel derivatives.
 * @invariant SPH-MOMENTUM-CONSERVATION — Pairwise pressure, viscosity, and cohesion interactions are
 * strictly antisymmetric (`F_ij + F_ji = 0`), conserving total linear momentum even at `r -> 0` and
 * across heterogeneous particle masses when unclamped.
 */
export class SphFluidAffector implements ParticleAffector {
  /** @domain (0, Infinity) — SPH kernel support radius `h` in world meters. */
  public smoothingRadius: number;
  /** @domain (0, Infinity) — Target fluid rest density `rho0` (mass / m^3). */
  public restDensity: number;
  /** @domain [0, Infinity) — Pressure equation-of-state stiffness `k`. */
  public stiffness: number;
  /** @domain [0, Infinity) — Dynamic viscosity coefficient `mu`. */
  public viscosity: number;
  /** @domain [0, Infinity) — Pairwise surface cohesion coefficient. */
  public cohesion: number;
  /** @domain (0, Infinity) — Maximum fluid acceleration magnitude clamp (m/s^2). */
  public maxAcceleration: number;
  /** Optional world-space containment box resolved during `postIntegrate`. */
  public bounds: SphFluidBounds | undefined;

  /** @derived Per-slot fluid density computed in the most recent `applyBatch` pass. */
  public densities: Float32Array;
  /** @derived Per-slot fluid pressure computed in the most recent `applyBatch` pass. */
  public pressures: Float32Array;

  private _capacity: number;
  private _hashMask: number;
  private _liveIndices: Int32Array;
  private _cellCoords: Int32Array;
  private _particleNext: Int32Array;
  private _cellHead: Int32Array;
  private _dirtyBuckets: Int32Array;

  constructor(options: SphFluidAffectorOptions = {}) {
    this.smoothingRadius =
      options.smoothingRadius !== undefined && options.smoothingRadius > 0
        ? options.smoothingRadius
        : 0.25;
    this.restDensity =
      options.restDensity !== undefined && options.restDensity > 0 ? options.restDensity : 300;
    this.stiffness = Math.max(0, options.stiffness ?? 3.0);
    this.viscosity = Math.max(0, options.viscosity ?? 0.8);
    this.cohesion = Math.max(0, options.cohesion ?? 0.0);
    this.maxAcceleration =
      options.maxAcceleration !== undefined && options.maxAcceleration > 0
        ? options.maxAcceleration
        : 250;
    this.bounds = options.bounds;

    const initialCapacity = Math.max(16, Math.floor(options.capacity ?? 1024));
    const tableSize = nextPowerOfTwo(Math.max(256, initialCapacity * 2));

    this._capacity = initialCapacity;
    this._hashMask = tableSize - 1;
    this.densities = new Float32Array(initialCapacity);
    this.pressures = new Float32Array(initialCapacity);
    this._liveIndices = new Int32Array(initialCapacity);
    this._cellCoords = new Int32Array(initialCapacity * 3);
    this._particleNext = new Int32Array(initialCapacity);
    this._dirtyBuckets = new Int32Array(initialCapacity);
    this._cellHead = new Int32Array(tableSize);
    this._cellHead.fill(-1);
  }

  private _ensureCapacity(needed: number): void {
    if (needed <= this._capacity) return;
    const nextCap = Math.max(needed, this._capacity * 2);
    const nextTable = nextPowerOfTwo(Math.max(256, nextCap * 2));
    this._capacity = nextCap;
    this._hashMask = nextTable - 1;
    this.densities = new Float32Array(nextCap);
    this.pressures = new Float32Array(nextCap);
    this._liveIndices = new Int32Array(nextCap);
    this._cellCoords = new Int32Array(nextCap * 3);
    this._particleNext = new Int32Array(nextCap);
    this._dirtyBuckets = new Int32Array(nextCap);
    this._cellHead = new Int32Array(nextTable);
    this._cellHead.fill(-1);
  }

  /**
   * SPH requires collective neighbor density/pressure evaluation and runs through {@link applyBatch}.
   * The single-slot `apply` entry point is a deliberate no-op when invoked outside batching.
   */
  public apply(_arrays: ParticleArrays, _index: number, _dt: number): void {
    // Handled collectively in applyBatch.
  }

  /**
   * Evaluates SPH densities, pressures, pressure gradients, viscosity, and optional cohesion over
   * all active slots in a single zero-GC two-pass sweep using an O(N) linked-cell spatial hash.
   */
  public applyBatch(arrays: ParticleArrays, count: number, _dt: number): void {
    if (count <= 0) return;
    const h = this.smoothingRadius;
    if (h <= 0) return;

    this._ensureCapacity(count);

    const positions = arrays.positions;
    const velocities = arrays.velocities;
    const accelerations = arrays.accelerations;
    const masses = arrays.masses;
    const alive = arrays.aliveFlags;

    const liveIndices = this._liveIndices;
    const cellCoords = this._cellCoords;
    const particleNext = this._particleNext;
    const cellHead = this._cellHead;
    const dirtyBuckets = this._dirtyBuckets;
    const densities = this.densities;
    const pressures = this.pressures;
    const mask = this._hashMask;
    const invCell = 1 / h;

    let liveCount = 0;
    let dirtyCount = 0;

    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue;
      liveIndices[liveCount++] = i;

      const i3 = i * 3;
      const cx = Math.floor(positions[i3]! * invCell);
      const cy = Math.floor(positions[i3 + 1]! * invCell);
      const cz = Math.floor(positions[i3 + 2]! * invCell);
      cellCoords[i3] = cx;
      cellCoords[i3 + 1] = cy;
      cellCoords[i3 + 2] = cz;

      const hash =
        (Math.imul(cx, HASH_PRIME_X) ^ Math.imul(cy, HASH_PRIME_Y) ^ Math.imul(cz, HASH_PRIME_Z)) &
        mask;

      if (cellHead[hash] === -1) {
        dirtyBuckets[dirtyCount++] = hash;
      }
      particleNext[i] = cellHead[hash]!;
      cellHead[hash] = i;
    }

    if (liveCount === 0) return;

    const h2 = h * h;
    const h3 = h2 * h;
    const h6 = h3 * h3;
    const h9 = h6 * h3;
    const poly6Coeff = 315 / (64 * Math.PI * h9);
    const spikyCoeff = -45 / (Math.PI * h6);
    const viscCoeff = 45 / (Math.PI * h6);
    const wPoly6Self = poly6Coeff * h6;
    const restDensity = this.restDensity;
    const stiffness = this.stiffness;
    const viscosity = this.viscosity;
    const cohesion = this.cohesion;
    const maxAccel = this.maxAcceleration;
    const maxAccelSq = maxAccel * maxAccel;

    // Pass 1: density rho_i and clamped ideal-gas pressure p_i.
    for (let l = 0; l < liveCount; l++) {
      const idx = liveIndices[l]!;
      const i3 = idx * 3;
      const xi = positions[i3]!;
      const yi = positions[i3 + 1]!;
      const zi = positions[i3 + 2]!;
      const cx = cellCoords[i3]!;
      const cy = cellCoords[i3 + 1]!;
      const cz = cellCoords[i3 + 2]!;

      let rho = masses[idx]! * wPoly6Self;

      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        const hx = Math.imul(nx, HASH_PRIME_X);
        for (let oy = -1; oy <= 1; oy++) {
          const ny = cy + oy;
          const hxy = hx ^ Math.imul(ny, HASH_PRIME_Y);
          for (let oz = -1; oz <= 1; oz++) {
            const nz = cz + oz;
            const hash = (hxy ^ Math.imul(nz, HASH_PRIME_Z)) & mask;
            let j = cellHead[hash]!;
            while (j !== -1) {
              if (j !== idx) {
                const j3 = j * 3;
                // Exact integer cell check prevents double-counting when two neighbor cells collide in the hash.
                if (
                  cellCoords[j3] === nx &&
                  cellCoords[j3 + 1] === ny &&
                  cellCoords[j3 + 2] === nz
                ) {
                  const dx = xi - positions[j3]!;
                  const dy = yi - positions[j3 + 1]!;
                  const dz = zi - positions[j3 + 2]!;
                  const r2 = dx * dx + dy * dy + dz * dz;
                  if (r2 < h2) {
                    const diff = h2 - r2;
                    rho += masses[j]! * poly6Coeff * diff * diff * diff;
                  }
                }
              }
              j = particleNext[j]!;
            }
          }
        }
      }

      if (rho < 1e-6) {
        rho = 1e-6;
      }
      densities[idx] = rho;
      const delta = rho - restDensity;
      pressures[idx] = delta > 0 ? stiffness * delta : 0;
    }

    // Pass 2: symmetric pressure + viscosity + optional cohesion accelerations.
    for (let l = 0; l < liveCount; l++) {
      const idx = liveIndices[l]!;
      const i3 = idx * 3;
      const xi = positions[i3]!;
      const yi = positions[i3 + 1]!;
      const zi = positions[i3 + 2]!;
      const vxi = velocities[i3]!;
      const vyi = velocities[i3 + 1]!;
      const vzi = velocities[i3 + 2]!;
      const cx = cellCoords[i3]!;
      const cy = cellCoords[i3 + 1]!;
      const cz = cellCoords[i3 + 2]!;

      const rhoI = densities[idx]!;
      const pI = pressures[idx]!;
      let fx = 0;
      let fy = 0;
      let fz = 0;

      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        const hx = Math.imul(nx, HASH_PRIME_X);
        for (let oy = -1; oy <= 1; oy++) {
          const ny = cy + oy;
          const hxy = hx ^ Math.imul(ny, HASH_PRIME_Y);
          for (let oz = -1; oz <= 1; oz++) {
            const nz = cz + oz;
            const hash = (hxy ^ Math.imul(nz, HASH_PRIME_Z)) & mask;
            let j = cellHead[hash]!;
            while (j !== -1) {
              if (j !== idx) {
                const j3 = j * 3;
                if (
                  cellCoords[j3] === nx &&
                  cellCoords[j3 + 1] === ny &&
                  cellCoords[j3 + 2] === nz
                ) {
                  const dx = xi - positions[j3]!;
                  const dy = yi - positions[j3 + 1]!;
                  const dz = zi - positions[j3 + 2]!;
                  const r2 = dx * dx + dy * dy + dz * dz;
                  if (r2 < h2) {
                    const r = Math.sqrt(r2);
                    const mj = masses[j]!;
                    const rhoJ = densities[j]!;
                    const mjOverRhoJ = mj / rhoJ;
                    const hMinusR = h - r;

                    let dirX: number;
                    let dirY: number;
                    let dirZ: number;
                    if (r > 1e-6) {
                      const invR = 1 / r;
                      dirX = dx * invR;
                      dirY = dy * invR;
                      dirZ = dz * invR;
                    } else {
                      // Antisymmetric deterministic separation prevents 0/0 NaN while preserving F_ij + F_ji = 0.
                      dirX = 0;
                      dirY = idx < j ? 1 : -1;
                      dirZ = 0;
                    }

                    const pSum = pI + pressures[j]!;
                    if (pSum > 0) {
                      const pTerm = -mjOverRhoJ * 0.5 * pSum * spikyCoeff * hMinusR * hMinusR;
                      fx += pTerm * dirX;
                      fy += pTerm * dirY;
                      fz += pTerm * dirZ;
                    }

                    if (viscosity > 0) {
                      const vFactor = viscosity * mjOverRhoJ * viscCoeff * hMinusR;
                      fx += vFactor * (velocities[j3]! - vxi);
                      fy += vFactor * (velocities[j3 + 1]! - vyi);
                      fz += vFactor * (velocities[j3 + 2]! - vzi);
                    }

                    if (cohesion > 0) {
                      const diff = h2 - r2;
                      const cFactor = cohesion * mjOverRhoJ * poly6Coeff * diff * diff * diff;
                      fx -= cFactor * dx;
                      fy -= cFactor * dy;
                      fz -= cFactor * dz;
                    }
                  }
                }
              }
              j = particleNext[j]!;
            }
          }
        }
      }

      const invRhoI = 1 / rhoI;
      let ax = fx * invRhoI;
      let ay = fy * invRhoI;
      let az = fz * invRhoI;

      const aSq = ax * ax + ay * ay + az * az;
      if (aSq > maxAccelSq) {
        const s = maxAccel / Math.sqrt(aSq);
        ax *= s;
        ay *= s;
        az *= s;
      }

      accelerations[i3] = accelerations[i3]! + ax;
      accelerations[i3 + 1] = accelerations[i3 + 1]! + ay;
      accelerations[i3 + 2] = accelerations[i3 + 2]! + az;
    }

    // O(N) hash cleanup: reset only the buckets populated this tick.
    for (let d = 0; d < dirtyCount; d++) {
      cellHead[dirtyBuckets[d]!] = -1;
    }
  }

  /**
   * Resolves optional world-space containment bounds after Euler integration, applying normal
   * restitution and tangential wall friction without heap allocations.
   */
  public postIntegrate(arrays: ParticleArrays, count: number, _dt: number): void {
    const b = this.bounds;
    if (b === undefined || count <= 0) return;

    const minX = b.min.x;
    const minY = b.min.y;
    const minZ = b.min.z;
    const maxX = b.max.x;
    const maxY = b.max.y;
    const maxZ = b.max.z;
    const restitution = Math.max(0, Math.min(1, b.restitution ?? 0.25));
    const tangScale = 1 - Math.max(0, Math.min(1, b.friction ?? 0.1));

    const positions = arrays.positions;
    const velocities = arrays.velocities;
    const alive = arrays.aliveFlags;

    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue;
      const o = i * 3;
      let px = positions[o]!;
      let py = positions[o + 1]!;
      let pz = positions[o + 2]!;
      let vx = velocities[o]!;
      let vy = velocities[o + 1]!;
      let vz = velocities[o + 2]!;
      let hit = false;

      if (px < minX) {
        px = minX;
        if (vx < 0) vx = -vx * restitution;
        vy *= tangScale;
        vz *= tangScale;
        hit = true;
      } else if (px > maxX) {
        px = maxX;
        if (vx > 0) vx = -vx * restitution;
        vy *= tangScale;
        vz *= tangScale;
        hit = true;
      }

      if (py < minY) {
        py = minY;
        if (vy < 0) vy = -vy * restitution;
        vx *= tangScale;
        vz *= tangScale;
        hit = true;
      } else if (py > maxY) {
        py = maxY;
        if (vy > 0) vy = -vy * restitution;
        vx *= tangScale;
        vz *= tangScale;
        hit = true;
      }

      if (pz < minZ) {
        pz = minZ;
        if (vz < 0) vz = -vz * restitution;
        vx *= tangScale;
        vy *= tangScale;
        hit = true;
      } else if (pz > maxZ) {
        pz = maxZ;
        if (vz > 0) vz = -vz * restitution;
        vx *= tangScale;
        vy *= tangScale;
        hit = true;
      }

      if (hit) {
        positions[o] = px;
        positions[o + 1] = py;
        positions[o + 2] = pz;
        velocities[o] = vx;
        velocities[o + 1] = vy;
        velocities[o + 2] = vz;
      }
    }
  }
}
