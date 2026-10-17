import { Vector3D } from "@small-world-machine/engine";
import type { Particle } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface VortexOptions {
  /** The rotation center. Defaults to (0, 0, 0). */
  center?: Vector3D;
  /** The axis of rotation. Defaults to Y axis (0, 1, 0). */
  axis?: "x" | "y" | "z";
  /** Swirl tangential strength (speed multiplier). Defaults to 1.0. */
  strength?: number;
  /** Inward suction speed towards the vortex core. Defaults to 0.0. */
  inwardSuction?: number;
}

/**
 * Applies a swirling vortex / tangential force field around a central axis.
 */
export class VortexAffector implements ParticleAffector {
  public center: Vector3D;
  public axis: "x" | "y" | "z";
  public strength: number;
  public inwardSuction: number;

  constructor(options: VortexOptions = {}) {
    this.center = options.center?.clone() ?? new Vector3D(0, 0, 0);
    this.axis = options.axis ?? "y";
    this.strength = options.strength ?? 1.0;
    this.inwardSuction = options.inwardSuction ?? 0.0;
  }

  public apply(particle: Particle, _dt: number): void {
    if (this.axis === "x") {
      const dy = particle.position.y - this.center.y;
      const dz = particle.position.z - this.center.z;
      const r = Math.sqrt(dy * dy + dz * dz) || 0.001;

      // Tangential direction around X: (-z, 0, y) mapped to (0, -z, y)
      const tangY = -dz / r;
      const tangZ = dy / r;

      // Centripetal inward suction direction: (-y, 0, -z)
      const inY = -dy / r;
      const inZ = -dz / r;

      particle.acceleration.y += (tangY * this.strength + inY * this.inwardSuction) / particle.mass;
      particle.acceleration.z += (tangZ * this.strength + inZ * this.inwardSuction) / particle.mass;
      return;
    }

    if (this.axis === "z") {
      const dx = particle.position.x - this.center.x;
      const dy = particle.position.y - this.center.y;
      const r = Math.sqrt(dx * dx + dy * dy) || 0.001;

      // Tangential direction around Z: (x, -y, 0) mapped to (-y, x, 0)
      const tangX = -dy / r;
      const tangY = dx / r;

      // Centripetal inward suction direction: (-x, -y, 0)
      const inX = -dx / r;
      const inY = -dy / r;

      particle.acceleration.x += (tangX * this.strength + inX * this.inwardSuction) / particle.mass;
      particle.acceleration.y += (tangY * this.strength + inY * this.inwardSuction) / particle.mass;
      return;
    }

    if (this.axis === "y") {
      const dx = particle.position.x - this.center.x;
      const dz = particle.position.z - this.center.z;
      const r = Math.sqrt(dx * dx + dz * dz) || 0.001;

      // Tangential direction: (-z, 0, x)
      const tangX = -dz / r;
      const tangZ = dx / r;

      // Centripetal inward suction direction: (-x, 0, -z)
      const inX = -dx / r;
      const inZ = -dz / r;

      particle.acceleration.x += (tangX * this.strength + inX * this.inwardSuction) / particle.mass;
      particle.acceleration.z += (tangZ * this.strength + inZ * this.inwardSuction) / particle.mass;
    }
  }
}
