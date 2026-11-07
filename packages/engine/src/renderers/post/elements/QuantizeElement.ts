import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

/**
 * Quantize/Posterize effect parameters for 8-bit retro banding.
 */
export class QuantizeElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.QUANTIZE;

  /** Opt-in: unlike the other default effects, posterization should not silently apply. */
  public override enabled: boolean = false;

  /** Number of color steps per RGB channel. E.g. 8.0 = 3 bits per channel. */
  public steps: number = 8.0;

  public override packUniforms(out: Float32Array, offset: number): void {
    out[offset + 8] = this.steps; // c.x: quantizeSteps
  }

  public override structuralKey(): string {
    return `${this.enabled ? 1 : 0}`;
  }
}
