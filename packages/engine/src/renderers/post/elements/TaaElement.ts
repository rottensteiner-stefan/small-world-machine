import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

/**
 * Simplified Temporal Anti-Aliasing: sub-pixel camera jitter (Halton(2,3) sequence) combined
 * with an exponential history blend, no motion vectors/reprojection. Smooths edges in
 * static/slow scenes; will visibly smear/ghost under fast camera movement -- an accepted
 * trade-off for a smaller engine (see docs/research/aaa-engine-techniques.md). WebGL2 and
 * WebGPU only -- WebGL1 has no sampleable HDR history target to blend against.
 */
export class TaaElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.TAA;

  /** Off by default -- opt-in, unlike the pre-existing effects registered for backward compat. */
  public override enabled: boolean = false;

  /** How much of the previous frame's resolved color to keep (0 = no history, 1 = frozen). Default 0.9. */
  public feedback: number = 0.9;
}
