import type { LightDataInterface } from "../../../interfaces/index.js";
import type { FogVolume } from "../../../core/objects/FogVolume.js";
import type { PointLight, SpotLight } from "../../../core/lights/index.js";
import { Vector3D } from "../../../math/index.js";
import type { PostProcessingElement } from "../PostProcessingElement.js";
import type { PostProcessingGroup } from "../PostProcessingGroup.js";

/**
 * Per-frame execution context handed to every GL post-effect pass.
 *
 * GL-typed counterpart of the GPU-side `PostEffectPassContext` (ADR 0037): WebGL has no
 * `GPUCommandEncoder`/`GPUTextureView`, so the GL post passes follow the same execute/destroy
 * lifecycle but exchange GL-typed resources through this context. One reusable context object
 * lives on the renderer and is repopulated once per frame before the post dispatches (zero
 * allocation on the hot path -- see the coding-guide "reused scratch" contract). Passes MUST read
 * it synchronously inside `execute()` and never retain a reference past the call: the very next
 * dispatch overwrites the fields (`colorTexture`, `element`, `lights`, ...) that vary per effect.
 */
export interface GLPostEffectPassContext {
  /** The GL context of the owning renderer (WebGL1 or WebGL2 surface). */
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  /** The post-processing group; the terminal uber pass reads the whole group signature. */
  group: PostProcessingGroup;
  /** The effect element for the current dispatch, set by the orchestrator right before
   * `execute()`. Per-effect passes read the config they need from it. Undefined for the terminal
   * uber pass. */
  element: PostProcessingElement | undefined;
  /** Canvas size in pixels. */
  width: number;
  height: number;
  /** Current chained color texture. Starts at the renderer's HDR target and is re-pointed by the
   * TAA / motion-trail passes before any downstream pass reads it (same rewire contract as the
   * GPU-side `colorView`). */
  colorTexture: WebGLTexture;
  /** Captured opaque (pre-transparent) depth texture, when available (WebGL2 only; WebGL1 leaves
   * this undefined and the consumers degrade gracefully). */
  depthTexture: WebGLTexture | undefined;
  /** Frame view-projection matrix data. */
  viewProjMatrix: Float32Array;
  /** Frame camera position. */
  camPos: Vector3D;
  /** Frame near / far clip distances. */
  near: number;
  far: number;
  /** Frame projection matrix data (HBAO samples it to reconstruct view-space positions). */
  projMatrixData: Float32Array | undefined;
  /** Extracted per-frame lights, when a light list was provided this frame. */
  lights: LightDataInterface | undefined;
  /** Directional-light shadow texture matching `lights.dLight`, if any. */
  dirShadowTexture: WebGLTexture | null;
  /** Spot-light shadow textures for the volumetric fog pass. */
  spotShadowTextures: readonly (WebGLTexture | null)[];
  /** Fallback (dummy) shadow texture. */
  fallbackShadowTexture: WebGLTexture | null;
  /** Fog volumes of the current frame. */
  fogVolumes: FogVolume[];
  /** Point / spot lights of the current frame (volumetric fog local lighting + shadows). */
  pointLights: PointLight[];
  spotLights: SpotLight[];
  /** Frame time (seconds) and real wall-clock time, for animated effects. */
  time: number;
  realTime: number;
  /** Scene environment lighting state. */
  irradianceMap: WebGLTexture | null;
  envIntensity: number;
  /** Chained effect outputs produced by the orchestrator for the terminal uber pass. */
  bloomTexture: WebGLTexture | null;
  hbaoTexture: WebGLTexture | null;
  lightShaftsTexture: WebGLTexture | null;
  volumetricFogTexture: WebGLTexture | null;
}

/**
 * GL-typed lifecycle contract of a per-effect post pass: the shape-only GL analog of the GPU
 * `PostEffectPass` (ADR 0037, ADR 0038 §4). WebGL has no `GPUCommandEncoder`, so the passes
 * exchange GL-typed resources through a `GLPostEffectPassContext` and tear down without
 * arguments -- the owning renderer routes every effect through a single registry instead of
 * holding per-pass fields and ad-hoc `?.destroy()` lists.
 */
export interface GLPostEffectPass {
  execute(ctx: GLPostEffectPassContext): WebGLTexture | null;
  destroy(): void;
}

/**
 * Allocates the reusable per-frame post context of a renderer. Every field is overwritten by the
 * renderer before each dispatch; this factory only guarantees a fully-defined scratch object, so
 * the per-frame hot path never allocates.
 */
export function createGLPostEffectContext(): GLPostEffectPassContext {
  return {
    gl: undefined as unknown as WebGLRenderingContext | WebGL2RenderingContext,
    group: undefined as unknown as PostProcessingGroup,
    element: undefined,
    width: 0,
    height: 0,
    colorTexture: undefined as unknown as WebGLTexture,
    depthTexture: undefined,
    viewProjMatrix: new Float32Array(16),
    camPos: Vector3D.ZERO,
    near: 0,
    far: 0,
    projMatrixData: undefined,
    lights: undefined,
    dirShadowTexture: null,
    spotShadowTextures: [],
    fallbackShadowTexture: null,
    fogVolumes: [],
    pointLights: [],
    spotLights: [],
    time: 0,
    realTime: 0,
    irradianceMap: null,
    envIntensity: 0,
    bloomTexture: null,
    hbaoTexture: null,
    lightShaftsTexture: null,
    volumetricFogTexture: null,
  };
}
