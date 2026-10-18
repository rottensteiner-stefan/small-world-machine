import type { PostProcessingEffectType } from "../../enums/index.js";

/**
 * Base class for a post-processing element (effect).
 */
export abstract class PostProcessingElement {
  /** If false, the effect will be bypassed (cheap). */
  public enabled: boolean = true;
  /** Unique string identifier for the effect. */
  public abstract readonly type: PostProcessingEffectType;

  /**
   * Optional hot-path hook: writes this element's continuous tuning values into the WebGPU
   * `DynUniforms` block starting at `offset` (float index). The element owns its own slice and its
   * defaults -- the post-process pass calls this once per element that feeds the block instead of
   * re-assembling the layout. Continuous values must NEVER appear in `structuralKey()`.
   * @param out Float32Array large enough for `offset + slice length` (the DynUniforms block is 52 floats).
   * @param offset Absolute float index the element's slice starts at (0 in the uber pass).
   */
  public packUniforms?(out: Float32Array, offset: number): void;

  /**
   * Optional compile-key fragment: the structural settings (enabled flag, mode) that force a shader
   * rebuild when they change. Continuous tuning values must NOT appear here -- the pass must be able
   * to move a slider every frame without rebuilding.
   * @returns A stable string fragment that is part of the pass' rebuild signature.
   */
  public structuralKey?(): string;
}
