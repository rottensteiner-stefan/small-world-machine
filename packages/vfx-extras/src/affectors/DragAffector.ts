import type { Particle } from "../Particle.js";
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

  public apply(particle: Particle, _dt: number): void {
    const vx = particle.velocity.x;
    const vy = particle.velocity.y;
    const vz = particle.velocity.z;

    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const dragCoeff = this.drag + this.quadraticDrag * speed;

    particle.acceleration.x -= (vx * dragCoeff) / particle.mass;
    particle.acceleration.y -= (vy * dragCoeff) / particle.mass;
    particle.acceleration.z -= (vz * dragCoeff) / particle.mass;
  }
}
