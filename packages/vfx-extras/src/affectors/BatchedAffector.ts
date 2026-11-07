import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

/**
 * Shared base for affectors that implement only the per-slot `apply`. `applyBatch` is derived once
 * here (skipping dead slots), so the two paths cannot drift apart: batch == apply by construction.
 */
export abstract class BatchedAffector implements ParticleAffector {
  public abstract apply(arrays: ParticleArrays, index: number, dt: number): void;

  public applyBatch(arrays: ParticleArrays, count: number, dt: number): void {
    const alive = arrays.aliveFlags;
    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) {
        continue;
      }
      this.apply(arrays, i, dt);
    }
  }
}
