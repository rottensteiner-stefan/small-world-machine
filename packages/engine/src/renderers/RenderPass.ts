import type { AbstractRenderer } from "./AbstractRenderer.js";
import type { Scene } from "../core/Scene.js";
import type { Vector3D } from "../math/index.js";

/**
 * Interface for a render pass that can be executed by a renderer.
 */
export interface RenderPass {
  /** Name of the pass for debugging. */
  name: string;
  /**
   * Executes the pass.
   * @param renderer The renderer executing the pass.
   * @param scene The scene to render.
   * @param ce The command encoder to use.
   * @param targetView The target texture view.
   * @param vp Matrix for view-projection.
   * @param camPos Camera position.
   * @param vMat View matrix.
   */
  execute(
    renderer: AbstractRenderer,
    scene: Scene,
    ce: GPUCommandEncoder,
    targetView: GPUTextureView,
    vp: Float32Array,
    camPos: Vector3D,
    vMat?: Float32Array,
  ): void;
}
