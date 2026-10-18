import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface DragOptions {
  /** Linear drag coefficient (F = -drag * v). Defaults to 0.5. */
  drag?: number;
  /** Quadratic aerodynamic drag coefficient (F = -quadDrag * |v| * v). Defaults to 0.0. */
  quadraticDrag?: number;
}

/**
 * Simulates fluid/air resistance to decelerate fast moving particles naturally.
 */
export class DragAffector implements ParticleAffector {
  public drag: number;
  public quadraticDrag: number;

  constructor(options: DragOptions = {}) {
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
    arrays.accelerations[o]! -= (vx * dragCoeff) / mass;
    arrays.accelerations[o + 1]! -= (vy * dragCoeff) / mass;
    arrays.accelerations[o + 2]! -= (vz * dragCoeff) / mass;
  }

  public applyBatch(arrays: ParticleArrays, count: number, _dt: number): void {
    const drag = this.drag;
    const quadraticDrag = this.quadraticDrag;

    for (let i = 0; i < count; i++) {
      if (arrays.aliveFlags[i] === 0) {
        continue;
      }

      const o = i * 3;
      const vx = arrays.velocities[o]!;
      const vy = arrays.velocities[o + 1]!;
      const vz = arrays.velocities[o + 2]!;

      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const dragCoeff = drag + quadraticDrag * speed;

      const mass = arrays.masses[i]!;
      arrays.accelerations[o]! -= (vx * dragCoeff) / mass;
      arrays.accelerations[o + 1]! -= (vy * dragCoeff) / mass;
      arrays.accelerations[o + 2]! -= (vz * dragCoeff) / mass;
    }
  }
}
