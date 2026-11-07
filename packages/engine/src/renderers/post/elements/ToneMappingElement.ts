import { PostProcessingElement } from "../PostProcessingElement.js";
import { ToneMappingMode, PostProcessingEffectType } from "../../../enums/index.js";

/**
 * Tone Mapping and Gamma Correction parameters.
 */
export class ToneMappingElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.TONE_MAPPING;

  public mode: ToneMappingMode = ToneMappingMode.DEFAULT;
  /** @domain Linear value mapped to white by `REINHARD_EXTENDED` (> 0); compiled into the post shader. */
  public whitePoint: number = 4.0;
  public exposure: number = 1.0;
  public gamma: number = 2.2;

  public override packUniforms(out: Float32Array, offset: number): void {
    const o = offset;
    out[o + 1] = this.exposure; // a.y: exposure
    out[o + 2] = 1.0 / this.gamma; // a.z: inverseGamma
  }

  public override structuralKey(): string {
    // The white point is compiled into the WebGPU post shader, so it is structural -- but only for
    // the one curve that reads it.
    const base = `${this.enabled ? 1 : 0}|${this.enabled ? this.mode : 0}`;
    return this.enabled && this.mode === ToneMappingMode.REINHARD_EXTENDED
      ? `${base}|${this.whitePoint}`
      : base;
  }
}
