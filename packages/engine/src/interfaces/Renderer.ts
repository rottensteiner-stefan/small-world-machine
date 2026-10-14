import { EngineOptions } from "./EngineOptions.js";
import { Scene } from "../core/index.js";
import { Color } from "../core/colors/index.js";
import { Vector3D } from "../math/index.js";
import { RendererType } from "../enums/index.js";

/**
 * Interface for all renderer implementations.
 */
export interface Renderer {
  /** The type of the renderer. */
  readonly type: RendererType;

  /** The global post-processing volume/group. */
  postProcessing: import("../renderers/post/index.js").PostProcessingGroup;

  /**
   * Initializes the renderer.
   */
  initialize(
    canvas: HTMLCanvasElement,
    attributes?: Record<string, unknown>,
    config?: EngineOptions,
  ): Promise<void>;

  /**
   * Renders a scene.
   */
  render(
    scene: Scene,
    vpMatrix: Float32Array,
    camPos?: Vector3D,
    viewMatrix?: Float32Array,
    near?: number,
    far?: number,
    /** The camera's raw projection matrix, used by HBAO to reconstruct view-space position from depth. */
    projMatrix?: Float32Array,
  ): void;

  /**
   * Sets the size of the render viewport.
   */
  setSize(width: number, height: number): void;

  /**
   * Sets the active render target for off-screen rendering.
   * If null, the renderer targets the screen/post-processing buffer.
   * @param target The target to render into.
   * @param activeCubeFace Optional. Which face (0-5) of the RenderTargetCube to render into.
   */
  setRenderTarget(
    target:
      | import("../core/textures/index.js").RenderTarget
      | import("../core/textures/index.js").RenderTargetCube
      | null,
    activeCubeFace?: number,
  ): void;

  /** The currently active off-screen render target, or null if rendering to the default framebuffer. */
  readonly activeRenderTarget?:
    | import("../core/textures/index.js").RenderTarget
    | import("../core/textures/index.js").RenderTargetCube
    | null;

  /** The currently active cube face index (0-5) if rendering to a RenderTargetCube. */
  readonly activeCubeFace?: number;

  /**
   * Sets the clear color of the renderer.
   */
  setClearColor(color: Color): void;

  /**
   * Gets the clear color of the renderer.
   */
  readonly clearColor: Color;

  /**
   * Gets the global quality settings of the renderer.
   */
  readonly quality: import("./index.js").QualityConfig;

  /**
   * Destroys the renderer and releases its resources.
   */
  destroy?(): void;

  /** Whether the underlying GPU device or context has been lost. */
  readonly isContextLost?: boolean;
  /** Optional callback triggered when the GPU context is lost. */
  onContextLost?: ((info: { reason?: string; message?: string }) => void) | undefined;
  /** WebGPU Device (only for WebGPU renderer) */
  readonly gpuDevice?: GPUDevice | undefined;
  /** WebGL Context (for WebGL1/2 renderers) */
  readonly webglContext?: WebGLRenderingContext | WebGL2RenderingContext | undefined;

  /**
   * Applies the previous frame's Hierarchical-Z occlusion culling results (if ready) by setting
   * `occlusionCulled` on the tested objects. Called once per frame, before `FrustumCuller.cull()`.
   * WebGPU-only (see docs/adr/0008-hzb-occlusion-culling-webgpu-only.md); a no-op on WebGL1/WebGL2
   * and whenever occlusion culling isn't enabled.
   */
  applyPendingOcclusionResults?(scene: Scene): void;
}
