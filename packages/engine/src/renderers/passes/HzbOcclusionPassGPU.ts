import type { Scene } from "../../core/index.js";
import type { Vector3D } from "../../math/index.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../RenderPass.js";

/**
 * Builds this frame's Hierarchical-Z (HZB) depth pyramid and dispatches the occlusion visibility
 * test against it -- see docs/adr/0008-hzb-occlusion-culling-webgpu-only.md. Sits between
 * `DepthPrePassGPU` (which just finished writing this frame's opaque depth, the pyramid's seed)
 * and `MainRenderPass`. Only constructed at all when `enableOcclusionCulling` is set --
 * `WebGPURenderer._buildHzbPyramid()`/`_dispatchHzbTest()` are themselves no-ops otherwise (and
 * for offscreen render targets), so this pass has no logic of its own beyond sequencing the two
 * calls; all the actual GPU resource management lives on the renderer, same as
 * `ClusterCullPassGPU`/`_setViewMatrix()`.
 */
export class HzbOcclusionPassGPU implements RenderPass {
  public name = "HzbOcclusionPassGPU";

  public execute(
    renderer: WebGPURenderer,
    scene: Scene,
    ce: GPUCommandEncoder,
    _targetView: GPUTextureView,
    _vp: Float32Array,
    _camPos: Vector3D,
    _vMat?: Float32Array,
  ): void {
    renderer._buildHzbPyramid(ce);
    renderer._dispatchHzbTest(ce, scene);
  }
}
