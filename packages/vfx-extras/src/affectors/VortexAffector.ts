import { Vector3D } from "@small-world-machine/engine";
import { Particle } from "../Particle.js";
import { ParticleAffector } from "../ParticleAffector.js";

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
