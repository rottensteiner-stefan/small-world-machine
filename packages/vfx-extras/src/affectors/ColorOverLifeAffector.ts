import { Color } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

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
export class ColorOverLifeAffector extends BatchedAffector {
  public startColor: Color;
  public endColor: Color;
  public interpolateAlpha: boolean;

  constructor(options: ColorOverLifeOptions = {}) {
    super();
    this.startColor = options.startColor?.clone() ?? new Color(1, 1, 1, 1);
    this.endColor = options.endColor?.clone() ?? new Color(0, 0, 0, 0);
    this.interpolateAlpha = options.interpolateAlpha ?? true;
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    if (arrays.maxLives[index]! <= 0 || !isFinite(arrays.maxLives[index]!)) {
      return;
    }

    const progress = Math.max(0, Math.min(1, arrays.lives[index]! / arrays.maxLives[index]!));
    const o4 = index * 4;
    arrays.colors[o4] = this.startColor.r + (this.endColor.r - this.startColor.r) * progress;
    arrays.colors[o4 + 1] = this.startColor.g + (this.endColor.g - this.startColor.g) * progress;
    arrays.colors[o4 + 2] = this.startColor.b + (this.endColor.b - this.startColor.b) * progress;

    if (this.interpolateAlpha) {
      arrays.alphas[index] = this.startColor.a + (this.endColor.a - this.startColor.a) * progress;
    }
  }
}
