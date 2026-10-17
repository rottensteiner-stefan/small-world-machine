import type { PostProcessingEffectType } from "../../enums/index.js";

/**
 * Base class for a post-processing element (effect).
 */
export abstract class PostProcessingElement {
  /** If false, the effect will be bypassed (cheap). */
  public enabled: boolean = true;
  /** Unique string identifier for the effect. */
  public abstract readonly type: PostProcessingEffectType;
}
