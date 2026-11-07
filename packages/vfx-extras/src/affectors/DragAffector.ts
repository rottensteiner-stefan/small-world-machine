import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

export interface DragOptions {
  /** Linear drag coefficient (F = -drag * v). Defaults to 0.5. */
  drag?: number;
  /** Quadratic aerodynamic drag coefficient (F = -quadDrag * |v| * v). Defaults to 0.0. */
  quadraticDrag?: number;
}

/**
 * Simulates fluid/air resistance to decelerate fast moving particles naturally.
 */
export class DragAffector extends BatchedAffector {
  public drag: number;
  public quadraticDrag: number;

  constructor(options: DragOptions = {}) {
    super();
    this.drag = options.drag ?? 0.5;
    this.quadraticDrag = options.quadraticDrag ?? 0.0;
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    const o = index * 3;
    const vx = arrays.velocities[o]!;
    const vy = arrays.velocities[o + 1]!;
    const vz = arrays.velocities[o + 2]!;

    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const dragCoeff = this.drag + this.quadraticDrag * speed;

    const mass = arrays.masses[index]!;
    // Non-positive mass = immovable: skip instead of dividing by zero (Infinity/NaN acceleration).
    if (!(mass > 0)) {
      return;
    }
    arrays.accelerations[o]! -= (vx * dragCoeff) / mass;
    arrays.accelerations[o + 1]! -= (vy * dragCoeff) / mass;
    arrays.accelerations[o + 2]! -= (vz * dragCoeff) / mass;
  }
}
