import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

/**
 * Deliberate ghost/afterimage motion-trail effect -- a stylistic sibling of `TaaElement`, not
 * an anti-aliasing technique. It reuses the exact same exponential history-blend pass (no
 * camera jitter, no motion vectors), just tuned with a higher feedback so fast-moving objects
 * visibly smear behind themselves on purpose, instead of that smear being an unwanted
 * side-effect of trying to do anti-aliasing.
 */
export class MotionTrailElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.MOTION_TRAIL;

  /** Off by default -- opt-in. */
  public override enabled: boolean = false;

  /** How much of the previous frame's resolved color to keep (0 = no trail, 1 = frozen). Default 0.92. */
  public feedback: number = 0.92;
}
