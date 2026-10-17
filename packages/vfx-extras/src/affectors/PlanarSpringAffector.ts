import type { Particle } from "../Particle.js";
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

  public apply(particle: Particle, _dt: number): void {
    if (this.axis === "y") {
      const dy = particle.position.y - this.planePosition;
      const springForce = -this.stiffness * dy;
      const dampingForce = -this.damping * particle.velocity.y;
      particle.acceleration.y += (springForce + dampingForce) / particle.mass;
    } else if (this.axis === "x") {
      const dx = particle.position.x - this.planePosition;
      const springForce = -this.stiffness * dx;
      const dampingForce = -this.damping * particle.velocity.x;
      particle.acceleration.x += (springForce + dampingForce) / particle.mass;
    } else if (this.axis === "z") {
      const dz = particle.position.z - this.planePosition;
      const springForce = -this.stiffness * dz;
      const dampingForce = -this.damping * particle.velocity.z;
      particle.acceleration.z += (springForce + dampingForce) / particle.mass;
    }
  }

  public applyBatch(particles: readonly Particle[], count: number, _dt: number): void {
    const axis = this.axis;
    const planePosition = this.planePosition;
    const stiffness = this.stiffness;
    const damping = this.damping;

    for (let i = 0; i < count; i++) {
      const particle = particles[i]!;
      if (particle.dead) {
        continue;
      }

      if (axis === "y") {
        const dy = particle.position.y - planePosition;
        const springForce = -stiffness * dy;
        const dampingForce = -damping * particle.velocity.y;
        particle.acceleration.y += (springForce + dampingForce) / particle.mass;
      } else if (axis === "x") {
        const dx = particle.position.x - planePosition;
        const springForce = -stiffness * dx;
        const dampingForce = -damping * particle.velocity.x;
        particle.acceleration.x += (springForce + dampingForce) / particle.mass;
      } else if (axis === "z") {
        const dz = particle.position.z - planePosition;
        const springForce = -stiffness * dz;
        const dampingForce = -damping * particle.velocity.z;
        particle.acceleration.z += (springForce + dampingForce) / particle.mass;
      }
    }
  }
}
