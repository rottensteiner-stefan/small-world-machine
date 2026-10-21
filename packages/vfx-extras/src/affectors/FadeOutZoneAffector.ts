import { Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

const REFERENCE_FPS = 60;

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
export class FadeOutZoneAffector extends BatchedAffector {
  public center: Vector3D;
  public fadeStartRadius: number;
  public fadeEndRadius: number;
  public shrinkSize: boolean;

  constructor(options: FadeOutZoneOptions = {}) {
    super();
    this.center = options.center?.clone() ?? new Vector3D(0, 0, 0);
    this.fadeStartRadius = options.fadeStartRadius ?? 0.55;
    this.fadeEndRadius = options.fadeEndRadius ?? 0.35;
    this.shrinkSize = options.shrinkSize ?? false;
  }

  public apply(arrays: ParticleArrays, index: number, dt: number): void {
    const o = index * 3;
    const dx = arrays.positions[o]! - this.center.x;
    const dy = arrays.positions[o + 1]! - this.center.y;
    const dz = arrays.positions[o + 2]! - this.center.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < this.fadeStartRadius) {
      const span = Math.max(0.001, this.fadeStartRadius - this.fadeEndRadius);
      const factor = Math.max(0.0, Math.min(1.0, (dist - this.fadeEndRadius) / span));

      // Scale alpha/size multiplicatively instead of overwriting absolutely -- an absolute
      // assignment snapped a 0.1-sized AccretionDisk particle back to ~1.0 on zone entry and
      // clobbered any ColorOverLife alpha state.
      // `factor` is the attenuation per reference frame (1/60 s); exponentiate by dt so the fade
      // is frame-rate independent (unchanged at 60 Hz).
      const scale = Math.pow(factor, dt * REFERENCE_FPS);
      arrays.alphas[index]! *= scale;
      if (this.shrinkSize) {
        arrays.sizes[index]! *= scale;
      }
      if (dist <= this.fadeEndRadius) {
        arrays.aliveFlags[index] = 0;
      }
    }
  }
}
