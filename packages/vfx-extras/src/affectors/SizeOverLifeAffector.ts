import type { Particle } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface SizeOverLifeOptions {
  /** Particle size multiplier at birth (life = 0). Defaults to 1.0. */
  startScale?: number;
  /** Particle size multiplier at death (life = maxLife). Defaults to 0.0. */
  endScale?: number;
}

/**
 * Animates particle size/scale over its lifetime.
 */
export class SizeOverLifeAffector implements ParticleAffector {
  public startScale: number;
  public endScale: number;

  constructor(options: SizeOverLifeOptions = {}) {
    this.startScale = options.startScale ?? 1.0;
    this.endScale = options.endScale ?? 0.0;
  }

  public apply(particle: Particle, _dt: number): void {
    if (particle.maxLife <= 0 || !isFinite(particle.maxLife)) {
      return;
    }

    const progress = Math.max(0, Math.min(1, particle.life / particle.maxLife));
    particle.size = this.startScale + (this.endScale - this.startScale) * progress;
  }

  public applyBatch(particles: readonly Particle[], count: number, _dt: number): void {
    const startScale = this.startScale;
    const endScale = this.endScale;

    for (let i = 0; i < count; i++) {
      const particle = particles[i]!;
      if (particle.dead) {
        continue;
      }
      if (particle.maxLife <= 0 || !isFinite(particle.maxLife)) {
        continue;
      }

      const progress = Math.max(0, Math.min(1, particle.life / particle.maxLife));
      particle.size = startScale + (endScale - startScale) * progress;
    }
  }
}
