import type { Particle } from "./Particle.js";

/**
 * Interface for any modifier or force field that affects particles each tick.
 */
export interface ParticleAffector {
  /**
   * Optional per-frame hook invoked exactly once per tick, before any particle apply() call.
   * Use it for time accumulation or other state that must advance at frame rate, not at
   * N x dt when applied per living particle.
   * @param dt Delta time in seconds.
   */
  beginFrame?(dt: number): void;

  /**
   * Applies the affector's forces or mutations to an individual particle or the full list.
   * @param particle The particle being updated.
   * @param dt Delta time in seconds.
   * @param index Index of the particle in the active particle list.
   * @param total Total number of active particles.
   */
  apply(particle: Particle, dt: number, index: number, total: number): void;

  /**
   * Optional batch entry point for the hot path. When present, ParticleSystem.update calls this
   * exactly once per affector per tick instead of dispatching apply() per particle. Implementations
   * operate on particles[0 .. count), MUST skip dead particles, and MUST stay bit-identical to
   * calling apply() on each particle individually. Third-party affectors without this method keep
   * working through the per-particle fallback.
   * @param particles The particle pool. May contain dead slots that must be skipped.
   * @param count Number of slots in `particles` to consider.
   * @param dt Delta time in seconds.
   */
  applyBatch?(particles: readonly Particle[], count: number, dt: number): void;
}
