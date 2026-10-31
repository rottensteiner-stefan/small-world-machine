import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";
import { Curve1D } from "../math/Curve1D.js";

export interface CurveOverLifeOptions {
  /** Multi-stop curve evaluated over normalized lifetime t in [0, 1] driving the particle size. */
  curve?: Curve1D;
}

/**
 * Drives the per-particle `sizes` channel from a multi-stop {@link Curve1D} over the normalized
 * lifetime -- absolute sizes (like a PlayCanvas scaleGraph), in contrast to `SizeGrowthAffector`
 * which grows multiplicatively and `SizeOverLifeAffector` which linear-interpolates. An empty
 * curve leaves the size untouched so a default instance is inert; authored negative values are
 * clamped to zero (a negative size would invert the instanced scale).
 */
export class CurveOverLifeAffector extends BatchedAffector {
  public curve: Curve1D;

  constructor(options: CurveOverLifeOptions = {}) {
    super();
    this.curve = options.curve ?? new Curve1D();
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    if (arrays.maxLives[index]! <= 0 || !isFinite(arrays.maxLives[index]!)) {
      return;
    }
    if (this.curve.pointCount === 0) {
      return;
    }
    const progress = Math.max(0, Math.min(1, arrays.lives[index]! / arrays.maxLives[index]!));
    arrays.sizes[index] = Math.max(0, this.curve.evaluate(progress));
  }
}
