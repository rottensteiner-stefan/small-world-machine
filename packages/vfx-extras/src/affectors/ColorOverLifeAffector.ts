import { Color } from "@small-world-machine/engine";
import type { Particle } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface ColorOverLifeOptions {
  /** Particle color at birth (life = 0). */
  startColor?: Color;
  /** Particle color at death (life = maxLife). */
  endColor?: Color;
  /** If true, interpolates alpha as well. Defaults to true. */
  interpolateAlpha?: boolean;
}

/**
 * Interpolates particle color and alpha smoothly across its lifetime.
 */
export class ColorOverLifeAffector implements ParticleAffector {
  public startColor: Color;
  public endColor: Color;
  public interpolateAlpha: boolean;

  constructor(options: ColorOverLifeOptions = {}) {
    this.startColor = options.startColor?.clone() ?? new Color(1, 1, 1, 1);
    this.endColor = options.endColor?.clone() ?? new Color(0, 0, 0, 0);
    this.interpolateAlpha = options.interpolateAlpha ?? true;
  }

  public apply(particle: Particle, _dt: number): void {
    if (particle.maxLife <= 0 || !isFinite(particle.maxLife)) {
      return;
    }

    const progress = Math.max(0, Math.min(1, particle.life / particle.maxLife));
    particle.color.r = this.startColor.r + (this.endColor.r - this.startColor.r) * progress;
    particle.color.g = this.startColor.g + (this.endColor.g - this.startColor.g) * progress;
    particle.color.b = this.startColor.b + (this.endColor.b - this.startColor.b) * progress;

    if (this.interpolateAlpha) {
      particle.alpha = this.startColor.a + (this.endColor.a - this.startColor.a) * progress;
    }
  }
}
