/**
 * Renderer-side contract a `GPUParticleSystem` consumes. Implemented by `WebGPURenderer` and
 * handed to a system via `WebGPURenderer.registerGpuParticleSystem()`. The host provides every
 * dependency a system needs: device handles, the shared global-uniform layout/bind group and the
 * fully composed WGSL module sources (the `@raw` shader imports stay inside the engine build --
 * a vfx-extras consumer never touches `?raw`), the ADR 0028 depth/normal views of the current
 * main-canvas target, and the draw-target color format.
 *
 * No `GlobalUniformLayout` change: view-projection and camera position are borrowed read-only
 * through the shared global bind group (`global.vp`, `global.viewPos`, `global.projScale`,
 * `global.resolution`) exactly like `hzb_visibility_test.wgsl` borrows them for compute.
 */
export interface GpuParticlePassHost {
  /** Live device, or `undefined` while the renderer is destroyed/device-lost. A system must
   * fail fast in `attachHost()` (never bind a missing device). Uses the renderer's canonical
   * public `gpuDevice` accessor -- no new device API is introduced. */
  readonly gpuDevice: GPUDevice | undefined;
  /** Shared `GlobalUniforms` bind group layout; group 0 of every particle pipeline. */
  readonly globalBGL: GPUBindGroupLayout;
  /** The shared `GlobalUniforms` uniform buffer itself (stable for the renderer's lifetime) -- compute
   * stages bind it through their own minimal group 0 instead of the full `globalBGL` (see
   * `GPUParticleSystem`: the full layout's storage buffers would blow the per-stage limit). */
  readonly globalUniformBuffer: GPUBuffer;
  /** Frame-live shared `GlobalUniforms` bind group; group 0 of every particle bind group set. */
  readonly globalBindGroup: GPUBindGroup;
  /** Fully composed compute module source (compute-structs chunk + `gpu_particles.wgsl`). */
  readonly particleComputeSource: string;
  /** Fully composed draw module source (compute-structs chunk + `gpu_particles_draw.wgsl`). */
  readonly particleDrawSource: string;
  /** Opaque scene depth view of the current main-canvas target (collision + draw depth-test). */
  readonly activeDepthView: GPUTextureView;
  /**
   * ADR 0028 world-normal view, or `undefined` while `quality.normalBuffer` is off or an
   * offscreen target is active -- the system substitutes its own 1x1 "world up" fallback
   * texture then (documented degradation, never a missing binding).
   */
  readonly activeNormalView: GPUTextureView | undefined;
  /** Color format of the target `GpuParticlesPassGPU` draws into; the draw pipeline keys on it. */
  readonly particleTargetFormat: GPUTextureFormat;
}

/**
 * The engine's view of a GPU particle system -- the minimal surface a worker class implements so
 * the renderer/pass orchestration never depends on the vfx-extras implementation (the
 * dependency stays one-directional: vfx-extras -> engine).
 */
export interface GpuParticleDrawable {
  /**
   * CPU-side liveness hint for the pass: false until `attachHost()` created the GPU resources.
   * The honest zero-count gate for indirect draws is GPU-native -- `drawIndexedIndirect` draws
   * nothing when the counters buffer reports zero instances -- so this flag only gates
   * *recording*, never the draw.
   */
  readonly particleActive: boolean;
  /** Binds the renderer host; idempotent. Creates all GPU resources on first call. */
  attachHost(host: GpuParticlePassHost): void;
  /** Records the 3-stage compute pipeline (emit -> simulate -> prepare) for this frame. */
  recordSimulation(ce: GPUCommandEncoder): void;
  /** Records `drawIndexedIndirect` into the caller's open render pass (already color+depth bound). */
  recordIndirectDraw(rp: GPURenderPassEncoder): void;
  /** Destroys every GPU resource and detaches the host. */
  dispose(): void;
}
