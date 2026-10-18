import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface PlanarSpringOptions {
  /** Plane normal axis. Defaults to "y". */
  axis?: "x" | "y" | "z";
  /** Target coordinate along the plane axis. Defaults to 0.0. */
  planePosition?: number;
  /** Spring stiffness coefficient k (F = -k * displacement). Defaults to 2.0. */
  stiffness?: number;
  /** Damping coefficient d (F_damping = -d * v). Defaults to 0.5. */
  damping?: number;
}

/**
 * Constrains particles to an orbital or flat plane (e.g. y = 0) with a damped restoring spring.
 */
export class PlanarSpringAffector implements ParticleAffector {
  public axis: "x" | "y" | "z";
  public planePosition: number;
  public stiffness: number;
  public damping: number;

  constructor(options: PlanarSpringOptions = {}) {
    this.axis = options.axis ?? "y";
    this.planePosition = options.planePosition ?? 0.0;
    this.stiffness = options.stiffness ?? 2.0;
    this.damping = options.damping ?? 0.5;
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    const o = index * 3;
    const mass = arrays.masses[index]!;

    if (this.axis === "y") {
      const dy = arrays.positions[o + 1]! - this.planePosition;
      const springForce = -this.stiffness * dy;
      const dampingForce = -this.damping * arrays.velocities[o + 1]!;
      arrays.accelerations[o + 1]! += (springForce + dampingForce) / mass;
    } else if (this.axis === "x") {
      const dx = arrays.positions[o]! - this.planePosition;
      const springForce = -this.stiffness * dx;
      const dampingForce = -this.damping * arrays.velocities[o]!;
      arrays.accelerations[o]! += (springForce + dampingForce) / mass;
    } else if (this.axis === "z") {
      const dz = arrays.positions[o + 2]! - this.planePosition;
      const springForce = -this.stiffness * dz;
      const dampingForce = -this.damping * arrays.velocities[o + 2]!;
      arrays.accelerations[o + 2]! += (springForce + dampingForce) / mass;
    }
  }

  public applyBatch(arrays: ParticleArrays, count: number, _dt: number): void {
    const axis = this.axis;
    const planePosition = this.planePosition;
    const stiffness = this.stiffness;
    const damping = this.damping;

    for (let i = 0; i < count; i++) {
      if (arrays.aliveFlags[i] === 0) {
        continue;
      }

      const o = i * 3;
      const mass = arrays.masses[i]!;

      if (axis === "y") {
        const dy = arrays.positions[o + 1]! - planePosition;
        const springForce = -stiffness * dy;
        const dampingForce = -damping * arrays.velocities[o + 1]!;
        arrays.accelerations[o + 1]! += (springForce + dampingForce) / mass;
      } else if (axis === "x") {
        const dx = arrays.positions[o]! - planePosition;
        const springForce = -stiffness * dx;
        const dampingForce = -damping * arrays.velocities[o]!;
        arrays.accelerations[o]! += (springForce + dampingForce) / mass;
      } else if (axis === "z") {
        const dz = arrays.positions[o + 2]! - planePosition;
        const springForce = -stiffness * dz;
        const dampingForce = -damping * arrays.velocities[o + 2]!;
        arrays.accelerations[o + 2]! += (springForce + dampingForce) / mass;
      }
    }
  }
}
