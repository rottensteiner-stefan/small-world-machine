import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";
import type { Lut3D } from "../../../core/textures/Lut3D.js";

/**
 * 3D LUT (Look-Up Table) color grading element.
 * Applies a 3D LUT texture (e.g. loaded from a .cube file) in the post-processing pass.
 * Supported on WebGPU and WebGL2 (WebGL1 falls back cleanly to analytical grading).
 */
export class LutGradingElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.LUT_GRADING;

  /** The 3D color lookup table. If null or not loaded, the effect is skipped. */
  public lut: Lut3D | null = null;

  /** Blend factor between original color (0.0) and LUT-graded color (1.0). Default: 1.0. */
  public intensity: number = 1.0;

  constructor(lut: Lut3D | null = null, intensity: number = 1.0) {
    super();
    this.lut = lut;
    this.intensity = intensity;
  }

  public override packUniforms(out: Float32Array, offset: number): void {
    const o = offset;
    // Uses formerly unread pad slots in shaftsParams (indices 46 and 47)
    out[o + 46] = this.enabled && this.lut !== null ? this.intensity : 0.0;
    out[o + 47] = this.lut ? this.lut.size : 32.0;
  }

  public override structuralKey(): string {
    const active = this.enabled && this.lut !== null;
    return `${active ? 1 : 0}|${active && this.lut ? this.lut.size : 0}`;
  }
}
