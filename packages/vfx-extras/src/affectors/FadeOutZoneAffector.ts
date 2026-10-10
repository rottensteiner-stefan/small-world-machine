import { Vector3D } from "@small-world-machine/engine";
import { Particle } from "../Particle.js";
import { ParticleAffector } from "../ParticleAffector.js";

export interface FadeOutZoneOptions {
  /** Center of the absorption zone. Defaults to (0, 0, 0). */
  center?: Vector3D;
  /** Distance at which fading starts (outer radius). Defaults to 0.55. */
  fadeStartRadius?: number;
  /** Distance at which particle is completely absorbed / invisible (inner radius). Defaults to 0.35. */
  fadeEndRadius?: number;
  /** If true, shrinks particle.size proportionally to alpha. Defaults to false. */
  shrinkSize?: boolean;
}

/**
 * Simulates gravitational redshift / event horizon fading by attenuating alpha and emissive
 * as particles cross into the point-of-no-return boundary.
 */
export class FadeOutZoneAffector implements ParticleAffector {
  public center: Vector3D;
  public fadeStartRadius: number;
  public fadeEndRadius: number;
  public shrinkSize: boolean;

  constructor(options: FadeOutZoneOptions = {}) {
    this.center = options.center?.clone() ?? new Vector3D(0, 0, 0);
    this.fadeStartRadius = options.fadeStartRadius ?? 0.55;
    this.fadeEndRadius = options.fadeEndRadius ?? 0.35;
    this.shrinkSize = options.shrinkSize ?? false;
  }

  public apply(particle: Particle, _dt: number): void {
    const dx = particle.position.x - this.center.x;
    const dy = particle.position.y - this.center.y;
    const dz = particle.position.z - this.center.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < this.fadeStartRadius) {
      const span = Math.max(0.001, this.fadeStartRadius - this.fadeEndRadius);
      const factor = Math.max(0.0, Math.min(1.0, (dist - this.fadeEndRadius) / span));

      particle.alpha = factor;
      if (this.shrinkSize) {
        particle.size = factor;
      }
      if (dist <= this.fadeEndRadius) {
        particle.dead = true;
      }
    }
  }
}
