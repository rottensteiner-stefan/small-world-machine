import type { Scene } from "../../core/index.js";
import type { Vector3D } from "../../math/index.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../RenderPass.js";

/**
 * Sequences the HZB pyramid build for the instance-field GPU lane (ADR 0059 step 1, P1-2) on
 * renderers where `enableOcclusionCulling` is OFF. The pyramid must exist whenever a field is
 * registered (the field cull lane consumes the PREVIOUS frame's pyramid), so `WebGPURenderer`
 * inserts this pass between `DepthPrePassGPU` (which just wrote this frame's opaque depth, the
 * pyramid's seed) and `MainRenderPass` on demand, and removes it again when no field is
 * registered. On occlusion-enabled renderers `HzbOcclusionPassGPU` already builds the pyramid,
 * so this pass never exists then.
 *
 * The build itself lives in `HzbOcclusionSystem` (constructed unconditionally since P1-2);
 * this pass has no logic of its own beyond sequencing the single call, mirroring
 * `HzbOcclusionPassGPU`'s delegation pattern.
 */
export class FieldHzbBuildPassGPU implements RenderPass {
  public name = "FieldHzbBuildPassGPU";

  public execute(
    renderer: WebGPURenderer,
    _scene: Scene,
    ce: GPUCommandEncoder,
    _targetView: GPUTextureView,
    _vp: Float32Array,
    _camPos: Vector3D,
    _vMat?: Float32Array,
  ): void {
    renderer._buildHzbPyramid(ce);
  }
}
