import { Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

export interface GravityOptions {
  /** Constant acceleration in m/s². Defaults to (0, -9.81, 0) — Earth gravity. */
  acceleration?: Vector3D | undefined;
}

/**
 * Applies a constant acceleration to every particle (e.g. gravitational pull). The system resets
 * per-particle accelerations to zero each frame, so this affector must add — it never replaces.
 * Weak or stylized motion (ember fall-back, slow smoke sink) uses a fraction of 9.81 m/s².
 */
export class GravityAffector extends BatchedAffector {
  /** @domain constant acceleration vector in m/s². */
  public acceleration: Vector3D;

  constructor(options: GravityOptions = {}) {
    super();
    this.acceleration = options.acceleration?.clone() ?? new Vector3D(0, -9.81, 0);
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    const o = index * 3;
    arrays.accelerations[o]! += this.acceleration.x;
    arrays.accelerations[o + 1]! += this.acceleration.y;
    arrays.accelerations[o + 2]! += this.acceleration.z;
  }
}
