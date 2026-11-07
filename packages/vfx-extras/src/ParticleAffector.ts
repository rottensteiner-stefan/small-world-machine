import type { ParticleArrays } from "./Particle.js";

/**
 * Interface for any modifier or force field that affects particles each tick.
 */
export interface ParticleAffector {
  /** Per-frame hook for time-dependent state (must not accumulate per particle). */
  beginFrame?(dt: number): void;

  /** Applies this affector to a single live particle slot (index-based fallback path). */
  apply(arrays: ParticleArrays, index: number, dt: number): void;

  /**
   * Optional batched hot path for the system: when present, `ParticleSystem.update` calls this
   * once per frame instead of dispatching per live slot, avoiding per-particle call overhead.
   * Implementations must skip `aliveFlags[i] === 0` slots and stay bit-identical to `apply`.
   */
  applyBatch?(arrays: ParticleArrays, count: number, dt: number): void;

  /**
   * Optional post-integration hook: invoked after `ParticleSystem` has integrated velocity and
   * position, once per frame with the frame-start slot count. Position-correcting forces (SDF
   * collision push-out, hard constraints) run here so their results are final for the frame.
   * Implementations must skip `aliveFlags[i] === 0` slots. Absence leaves `update()` unchanged.
   */
  postIntegrate?(arrays: ParticleArrays, count: number, dt: number): void;
}
