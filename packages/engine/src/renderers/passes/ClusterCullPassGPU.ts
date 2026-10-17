import type { Scene } from "../../core/index.js";
import type { Vector3D } from "../../math/index.js";
import type { WebGPURenderer } from "../WebGPU/WebGPURenderer.js";
import type { RenderPass } from "../RenderPass.js";

/**
 * Builds the clustered light grid (point/spot lights, fixed-capacity-per-cluster, no atomics)
 * via a compute pass, before any other pass reads it -- see
 * docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md. Relies on `_updateGlobalBuffers()`
 * (called earlier in `WebGPURenderer.render()`, before the command encoder loop) having already
 * written this frame's light data and cluster grid metadata into the global uniform/storage
 * buffers referenced by `renderer.globalBindGroup`.
 */
export class ClusterCullPassGPU implements RenderPass {
  public name = "ClusterCullPassGPU";

  public execute(
    renderer: WebGPURenderer,
    _scene: Scene,
    ce: GPUCommandEncoder,
    _targetView: GPUTextureView,
    _vp: Float32Array,
    _camPos: Vector3D,
    _vMat?: Float32Array,
  ): void {
    const dims = renderer.clusterDims;
    const pass = ce.beginComputePass({ label: "ClusterCullPassGPU" });
    pass.setPipeline(renderer.clusterCullPipeline);
    pass.setBindGroup(0, renderer.globalBindGroup);
    pass.dispatchWorkgroups(Math.ceil(dims.x / 4), Math.ceil(dims.y / 4), Math.ceil(dims.z / 4));
    pass.end();
  }
}
