import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

/**
 * Vignette effect parameters.
 */
export class VignetteElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.VIGNETTE;

  /** Controls the outer radius of the vignette effect (default: 0.8). */
  public offset: number = 0.8;
  /** Controls the intensity of the vignette effect (default: 0.5) */
  public darkness: number = 0.5;
  /** Controls the shape. 2.0 = elliptical, 6.0+ = rounded rectangle (default: 2.0) */
  public roundness: number = 2.0;

  public override packUniforms(out: Float32Array, offset: number): void {
    const o = offset;
    out[o + 3] = this.offset; // a.w: vignetteOffset
    out[o + 4] = this.darkness; // b.x: vignetteDarkness
    out[o + 5] = this.roundness; // b.y: vignetteRoundness
  }

  public override structuralKey(): string {
    return `${this.enabled ? 1 : 0}`;
  }
}
