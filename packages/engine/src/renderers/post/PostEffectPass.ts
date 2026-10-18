import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import type { PostProcessingElement } from "./PostProcessingElement.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { FogVolume } from "../../core/objects/FogVolume.js";
import type { Vector3D } from "../../math/index.js";

/**
 * Per-frame execution context handed to every GPU post-effect pass.
 *
 * One reusable context object lives on the renderer and is repopulated once per frame before the
 * post-effect dispatches (zero allocation on the hot path -- see the coding-guide "reused scratch"
 * contract). Passes MUST read it synchronously inside `execute()` and never retain a reference past
 * the call: the very next dispatch overwrites the fields (`colorView`, `element`, `fogVolumes`,
 * `depthView`) that vary per effect.
 */
export interface PostEffectPassContext {
  /** The renderer that owns this pass. Type-only reference; passes read renderer-owned resources
   * (shadow map views, cluster dims, frame info) through it. */
  renderer: WebGPURenderer;
  /** The frame's shared command encoder -- the pass records its work here. */
  ce: GPUCommandEncoder;
  /**
   * The effect element this execution is for, typed to the pass' specific element via a narrow cast
   * at the top of `execute()` (e.g. `ctx.element as HbaoElement`). The renderer sets this right
   * before each dispatch, so a pass is never handed another effect's element.
   */
  element: PostProcessingElement;
  /** This frame's HDR scene color texture (the forward-pass output), or undefined when
   * post-processing did not produce an HDR target this frame. */
  colorTexture: GPUTexture | undefined;
  /** The color view the pass must consume as its "current" input. Chained passes rewire this
   * (e.g. after TAA resolved, the motion-trail pass consumes TAA's view, not the raw HDR). */
  colorView: GPUTextureView;
  /** The captured opaque depth view (see `requiresOpaqueDepth`), or a safe dummy when no effect
   * that consumes opaque depth is active this frame. Only ever non-dummy for depth-consuming
   * effects -- their dispatch in the renderer is guarded on a real capture. */
  depthView: GPUTextureView;
  width: number;
  height: number;
  /** The frame's (already ZO-corrected) view-projection matrix. */
  vp: Float32Array;
  vMat: Float32Array | undefined;
  camPos: Vector3D;
  near: number;
  far: number;
  /** The camera projection matrix (needed by depth-based effects such as HBAO). */
  projMatrix: Float32Array | undefined;
  /** This frame's extracted lights -- directional/spot/point consumed by light-shaft and
   * volumetric-fog passes. */
  lights: LightDataInterface;
  /** This frame's scene fog volumes (volumetric fog only; empty otherwise). */
  fogVolumes: FogVolume[];
}

/**
 * One GPU post-processing effect stage (HBAO, Bloom, TAA/MotionTrail, light shafts, volumetric
 * fog). The renderer owns a single `Map<PostProcessingEffectType, PostEffectPass>` registry and
 * routes creation, per-frame execution and teardown of every effect pass through it -- the
 * pass-specific `_xxxPassGPU` fields and their `?.destroy()` lists are gone.
 *
 * Contract:
 *  - `execute(ctx)` runs the effect for the CURRENT frame, recording into `ctx.ce`. It returns the
 *    resulting texture view (consumed by the next chained effect or the uber pass) or `null` when
 *    the effect could not produce output this frame (e.g. disabled element, missing inputs).
 *  - `destroy()` releases every GPU resource the pass allocated. It must be safe to call at most
 *    once, after the owning renderer's device is no longer rendering; the renderer calls it for all
 *    registry entries during `WebGPURenderer.destroy()`.
 *  - `requiresOpaqueDepth` (on `PostProcessingGroup`) is how an effect signals it needs the opaque
 *    depth capture -- the renderer uses it, NOT per-effect ad-hoc OR-chains, to decide whether to
 *    capture. Implementing a pass does NOT imply it consumes opaque depth.
 *
 * The WebGL2/WebGL1 side (`PostProcessPassGL` and the GL effect passes) consumes this contract by
 * SHAPE, not by type: GL has no `GPUCommandEncoder`/`GPUTextureView`, so the GL passes follow the
 * same `execute`/`destroy` lifecycle with GL-typed resources (see ADR 0037 draft).
 */
export interface PostEffectPass {
  /** Runs the effect for the current frame. See the contract above. */
  execute(ctx: PostEffectPassContext): GPUTextureView | null;
  /** Releases all GPU resources allocated by the pass. See the contract above. */
  destroy(): void;
}
