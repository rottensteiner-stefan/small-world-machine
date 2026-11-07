import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

export interface SizeOverLifeOptions {
  /** Particle size multiplier at birth (life = 0). Defaults to 1.0. */
  startScale?: number;
  /** Particle size multiplier at death (life = maxLife). Defaults to 0.0. */
  endScale?: number;
}

/**
 * Animates particle size/scale over its lifetime.
 */
export class SizeOverLifeAffector extends BatchedAffector {
  public startScale: number;
  public endScale: number;

  constructor(options: SizeOverLifeOptions = {}) {
    super();
    this.startScale = options.startScale ?? 1.0;
    this.endScale = options.endScale ?? 0.0;
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    if (arrays.maxLives[index]! <= 0 || !isFinite(arrays.maxLives[index]!)) {
      return;
    }

    const progress = Math.max(0, Math.min(1, arrays.lives[index]! / arrays.maxLives[index]!));
    arrays.sizes[index] = this.startScale + (this.endScale - this.startScale) * progress;
  }
}
