import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

export interface TurbulenceOptions {
  /** Frequency / spatial scale of the turbulence field. Defaults to 1.0. */
  frequency?: number;
  /** Force amplitude / speed of the turbulent gusts. Defaults to 5.0. */
  strength?: number;
  /** Evolution speed of the noise field over time. Defaults to 1.0. */
  evolutionSpeed?: number;
}

/**
 * Generates continuous pseudo-fluid rotational turbulence (divergence-free curl approximations)
 * for realistic smoke, dust clouds, flames, and energetic plasma.
 */
export class TurbulenceAffector extends BatchedAffector {
  public frequency: number;
  public strength: number;
  public evolutionSpeed: number;
  private _time: number = 0;

  constructor(options: TurbulenceOptions = {}) {
    super();
    this.frequency = options.frequency ?? 1.0;
    this.strength = options.strength ?? 5.0;
    this.evolutionSpeed = options.evolutionSpeed ?? 1.0;
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    const f = this.frequency;
    const t = this._time;
    const o = index * 3;

    const px = arrays.positions[o]! * f;
    const py = arrays.positions[o + 1]! * f;
    const pz = arrays.positions[o + 2]! * f;

    // Fast trigonometric curl approximation (divergence-free curl-noise field)
    const fx = Math.sin(py + t) * Math.cos(pz + t * 0.7);
    const fy = Math.sin(pz + t) * Math.cos(px + t * 0.7);
    const fz = Math.sin(px + t) * Math.cos(py + t * 0.7);

    const mass = arrays.masses[index]!;
    // Non-positive mass = immovable: skip instead of dividing by zero (Infinity/NaN acceleration).
    if (!(mass > 0)) {
      return;
    }
    arrays.accelerations[o]! += (fx * this.strength) / mass;
    arrays.accelerations[o + 1]! += (fy * this.strength) / mass;
    arrays.accelerations[o + 2]! += (fz * this.strength) / mass;
  }
}
