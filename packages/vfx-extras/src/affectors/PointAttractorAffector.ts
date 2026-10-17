import { Vector3D } from "@small-world-machine/engine";
import type { Particle } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface PointAttractorOptions {
  /** The position of the gravitational attractor / center of mass. Defaults to (0, 0, 0). */
  center?: Vector3D;
  /** The mass / strength of the attractor (G * M). Defaults to 100. */
  strength?: number;
  /** Plummer softening parameter (epsilon) to avoid infinite force at r -> 0. Defaults to 0.5. */
  softening?: number;
  /** If true, uses Plummer potential softening; if false, uses standard softened Newtonian gravity. Defaults to true. */
  plummer?: boolean;
}

/**
 * Applies a gravitational / central force field toward a point in space.
 * Uses Plummer potential softening to prevent numerical explosion near r = 0.
 * Formula: F = - G*M * r / (r^2 + epsilon^2)^1.5
 */
export class PointAttractorAffector implements ParticleAffector {
  public center: Vector3D;
  public strength: number;
  public softening: number;
  public plummer: boolean;

  constructor(options: PointAttractorOptions = {}) {
    this.center = options.center?.clone() ?? new Vector3D(0, 0, 0);
    this.strength = options.strength ?? 100;
    this.softening = options.softening ?? 0.5;
    this.plummer = options.plummer ?? true;
  }

  public apply(particle: Particle, _dt: number): void {
    const dx = this.center.x - particle.position.x;
    const dy = this.center.y - particle.position.y;
    const dz = this.center.z - particle.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const dist = Math.sqrt(distSq) || 0.001;

    let forceMag: number;
    if (this.plummer) {
      // Plummer softened gravity: F = (GM * r) / (r^2 + eps^2)^1.5 -- eps is squared, matching
      // the non-Plummer branch below and the Kepler velocity used by AccretionDiskEmitter.
      const plummerDenom = distSq + this.softening * this.softening;
      forceMag = (this.strength * dist) / (plummerDenom * Math.sqrt(plummerDenom));
    } else {
      // Newtonian with minimum cutoff
      forceMag = this.strength / (distSq + this.softening * this.softening);
    }

    const fx = (dx / dist) * forceMag;
    const fy = (dy / dist) * forceMag;
    const fz = (dz / dist) * forceMag;

    particle.acceleration.x += fx / particle.mass;
    particle.acceleration.y += fy / particle.mass;
    particle.acceleration.z += fz / particle.mass;
  }
}
