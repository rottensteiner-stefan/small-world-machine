import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

export interface SizeGrowthOptions {
  /** Multiplicative growth rate per second: a rate of 1.2 grows a particle by ×(1 + 1.2·dt) every frame. Defaults to 0.5. */
  rate?: number | undefined;
  /** Absolute size ceiling in the system's units (meters for world-space emitters). Defaults to Infinity. */
  maxScale?: number | undefined;
}

/**
 * Grows every particle's `sizes` multiplicatively while preserving the random base size a spawner
 * chose. `SizeOverLifeAffector` overwrites `sizes` as an absolute value and would erase exactly
 * that variety; smoke puffs need growth that keeps their individual scale. Pair with a renderer
 * that does not fold alpha into scale (`ParticleMeshRenderer.foldAlphaIntoScale = false`), so the
 * growing quad is not counter-shrunk by its opacity fade.
 */
export class SizeGrowthAffector extends BatchedAffector {
  /** @domain multiplicative growth rate per second (>=0). */
  public rate: number;
  /** @domain absolute size ceiling in system units (>=0). */
  public maxScale: number;

  constructor(options: SizeGrowthOptions = {}) {
    super();
    this.rate = Math.max(0, options.rate ?? 0.5);
    this.maxScale = Math.max(0, options.maxScale ?? Number.POSITIVE_INFINITY);
  }

  public apply(arrays: ParticleArrays, index: number, dt: number): void {
    if (this.rate <= 0 || dt <= 0) {
      return;
    }
    const grown = arrays.sizes[index]! * (1 + this.rate * dt);
    arrays.sizes[index] = grown > this.maxScale ? this.maxScale : grown;
  }
}
