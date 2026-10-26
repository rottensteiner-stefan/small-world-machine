import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";
import { Color } from "../../../core/colors/index.js";

/**
 * Bloom effect parameters.
 */
export class BloomElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.BLOOM;

  /** The brightness threshold at which bloom is applied (default: 1.0). */
  public threshold: number = 1.0;
  /** Controls the soft knee for the threshold (default: 0.1). */
  public softThreshold: number = 0.1;
  /** Intensity of the bloom effect (default: 1.0). */
  public intensity: number = 1.0;
  /** Radius/spread of the bloom. Controls the filter weights or mip level accumulation (default: 1.0). */
  public radius: number = 1.0;
  /** Color tint applied to the bloom highlights (default: white). */
  public color: Color = new Color(1.0, 1.0, 1.0);

  private readonly _linearTint: Color = new Color();

  public override packUniforms(out: Float32Array, offset: number): void {
    const o = offset;
    out[o + 7] = this.intensity; // b.w: bloomIntensity
    // WebGPU adds bloom to linear HDR: the sRGB-authored tint is decoded (ADR 0049).
    const tint = this.color.toLinear(this._linearTint);
    out[o + 12] = tint.r; // bloomColor.rgb
    out[o + 13] = tint.g;
    out[o + 14] = tint.b;
    out[o + 15] = 0.0; // pad
  }

  public override structuralKey(): string {
    return `${this.enabled ? 1 : 0}`;
  }
}
