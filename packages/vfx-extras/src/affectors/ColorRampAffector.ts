import { Color } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";
import { ColorRamp } from "../math/ColorRamp.js";

export interface ColorRampAffectorOptions {
  /** Multi-stop RGBA ramp evaluated over normalized lifetime t in [0, 1]. */
  ramp?: ColorRamp;
  /** If true, the ramp's alpha is written into the per-particle alpha channel. Defaults to true. */
  rampAlpha?: boolean;
}

/**
 * Drives per-particle color (and optionally alpha) from a multi-stop {@link ColorRamp} over the
 * normalized lifetime -- the curve-based successor of the 2-stop `ColorOverLifeAffector`. The
 * batch/apply single source (via `BatchedAffector`) keeps both paths bit-identical.
 */
export class ColorRampAffector extends BatchedAffector {
  public ramp: ColorRamp;
  /** @domain If true, ramp alpha propagates into the alpha channel. */
  public rampAlpha: boolean;

  private readonly _scratch: Color;

  constructor(options: ColorRampAffectorOptions = {}) {
    super();
    this.ramp = options.ramp ?? new ColorRamp();
    this.rampAlpha = options.rampAlpha ?? true;
    this._scratch = new Color(1, 1, 1, 1);
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    if (arrays.maxLives[index]! <= 0 || !isFinite(arrays.maxLives[index]!)) {
      return;
    }
    const progress = Math.max(0, Math.min(1, arrays.lives[index]! / arrays.maxLives[index]!));
    this.ramp.evaluateInto(progress, this._scratch);
    const o4 = index * 4;
    arrays.colors[o4] = this._scratch.r;
    arrays.colors[o4 + 1] = this._scratch.g;
    arrays.colors[o4 + 2] = this._scratch.b;
    arrays.colors[o4 + 3] = this._scratch.a;
    if (this.rampAlpha) {
      arrays.alphas[index] = this._scratch.a;
    }
  }
}
