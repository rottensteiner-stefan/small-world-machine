import type { Scene } from "../../core/Scene.js";
import type { Vector3D } from "../../math/index.js";
import type { RenderPass } from "../RenderPass.js";
import type { WebGPURenderer } from "../WebGPU/index.js";

/**
 * GPU-resident particle pass (WebGPU-only, Bob T5/G2). Registered systems are NOT scene objects --
 * they are handed to the renderer via `WebGPURenderer.registerGpuParticleSystem()`, so this pass
 * runs between `MainRenderPass` (opaque + transparents, which population the screen depth) and
 * `PostProcessPass` (which reads the color target back), and is a complete no-op -- zero pipeline
 * state, zero render-pass begin/end -- while no system is registered.
 *
 * Ordering inside `execute()`:
 *   1. `recordSimulation(ce)` per system -- the 3-stage compute pipeline (csEmit -> csSimulate ->
 *      csPrepareIndirect) runs as plain compute passes on the same command encoder, sampling the
 *      NOW-COMPLETE opaque screen depth + ADR 0028 normal views for collision (the host hands the
 *      frame-live views over; each dispatch boundary is a full memory barrier).
 *   2. `beginRenderPass` with COLOR `loadOp: "load"` (loads the just-finished frame, additive
 *      output composites on top) and DEPTH `loadOp: "load"` + `depthWriteEnabled: false`
 *      (occlusion by the opaque scene only -- the same depth-reject pattern the transparent
 *      pass uses; the indirect draw is a native GPU no-op when the counters buffer reports 0).
 *   3. `recordIndirectDraw(rp)` per system -- `drawIndexedIndirect(counters, 0)`, 0 CPU readback
 *      (see `gpu_particles.wgsl`, `CountersAndIndirectArgs`).
 *
 * Reused attachment descriptors (no per-frame allocation) -- same discipline as `MainRenderPass`.
 */
export class GpuParticlesPassGPU implements RenderPass {
  public name = "GpuParticlesPassGPU";

  private readonly _colorAttachment: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: "load",
    storeOp: "store",
  };
  private readonly _depthAttachment: GPURenderPassDepthStencilAttachment = {
    view: undefined as unknown as GPUTextureView,
    // Read-only depth: WebGPU validation REJECTS depthLoadOp/depthStoreOp when depthReadOnly is
    // true ("must not be set"), so neither is declared. The buffer is left untouched by the
    // additive billboards (depthCompare "less-equal" test only).
    depthReadOnly: true,
  };
  private readonly _attachments: GPURenderPassColorAttachment[] = [this._colorAttachment];
  private readonly _renderPassDescriptor: GPURenderPassDescriptor = {
    colorAttachments: this._attachments,
    depthStencilAttachment: this._depthAttachment,
  };

  public execute(
    renderer: WebGPURenderer,
    _scene: Scene,
    ce: GPUCommandEncoder,
    targetView: GPUTextureView,
    _vp: Float32Array,
    _camPos: Vector3D,
    _vMat?: Float32Array,
  ): void {
    if (renderer.gpuParticleSystemCount === 0) return;
    // Simulation advances once per frame, on the main canvas only: offscreen sub-renders (planar
    // reflection, probes) would otherwise age particles N times and burn their emit counts.
    if (renderer.activeRenderTarget) return;

    // Stage 1: compute simulation against the completed opaque depth/normals.
    renderer._recordGpuParticleSimulations(ce);

    // Stage 2: additive billboards on top of the finished frame, occluded by scene depth.
    this._colorAttachment.view = targetView;
    this._depthAttachment.view = renderer.activeDepthView;
    const rp = ce.beginRenderPass(this._renderPassDescriptor);
    renderer._recordGpuParticleDraws(rp);
    rp.end();
  }
}
