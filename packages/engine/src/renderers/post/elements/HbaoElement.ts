import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

/**
 * Ground-truth-ish ambient occlusion (HBAO) effect parameters. Darkens contact/crevice areas
 * by estimating the horizon angle around each pixel from the opaque depth buffer. WebGL2 and
 * WebGPU only -- WebGL1 has no sampleable depth texture to reconstruct view-space position from.
 */
export class HbaoElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.HBAO;

  /** Off by default -- opt-in, unlike the pre-existing effects registered for backward compat. */
  public override enabled: boolean = false;

  /** World-space search radius for occluders (default: 0.5). */
  public radius: number = 0.5;
  /** Strength of the darkening (default: 1.0). */
  public intensity: number = 1.0;

  public override structuralKey(): string {
    return `${this.enabled ? 1 : 0}`;
  }
}
