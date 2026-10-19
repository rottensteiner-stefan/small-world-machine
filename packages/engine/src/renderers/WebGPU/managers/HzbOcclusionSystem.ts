import type { Object3D, Scene } from "../../../core/index.js";
import type { GPUFallbackResources } from "./GPUFallbackResources.js";
import hzbCopyDepthWGSL from "../../shaders/source/web_gpu/compute/hzb_copy_depth.wgsl?raw";
import hzbDownsampleMaxWGSL from "../../shaders/source/web_gpu/compute/hzb_downsample_max.wgsl?raw";

/**
 * Fixed capacity for the Hierarchical-Z occlusion visibility test's AABB/results buffers -- see
 * docs/adr/0008-hzb-occlusion-culling-webgpu-only.md. No dynamic regrowth or atomics, same
 * `MAX_*` sizing pattern as the clustered-light buffers. Objects beyond this cap are simply never
 * occlusion-tested -- they always draw, the same safe default as `occlusionCulled`'s initial
 * `false`.
 */
const MAX_HZB_TESTED_OBJECTS = 8192;

/**
 * Owns the entire Hierarchical-Z (HZB) occlusion-culling GPU subsystem that used to live inside
 * `WebGPURenderer`: the pyramid's copy/downsample/visibility-test pipelines, the depth-pyramid
 * texture, the packed-AABB/result/params buffers, the ping-pong `MAP_READ` staging pair and its
 * per-slot pending/object snapshots, plus the per-frame build/dispatch/readback flow
 * (`buildPyramid()`/`dispatchTest()`/`kickoffMapAsync()`/`applyOcclusionResults()`).
 *
 * The renderer is the only caller; to keep this manager free of a host reference, the renderer
 * passes in everything that lives outside the subsystem at call/construction time: the composed
 * visibility-test shader module code (structs chunk + screen-footprint chunk + WGSL, assembled
 * from the renderer's shader registry), the shared `GlobalUniforms` bind-group layout (group 0
 * of the test pipeline) and, per dispatch, the frame's live global bind group. All of this stays
 * unallocated unless the renderer opts in (`enableOcclusionCulling`) -- the renderer simply never
 * constructs this system otherwise. See docs/adr/0008-hzb-occlusion-culling-webgpu-only.md.
 */
export class HzbOcclusionSystem {
  private _hzbTexture?: GPUTexture;
  private _hzbSampledView?: GPUTextureView; // whole mip chain, for the visibility test's textureLoad
  private _hzbMipLevelCount = 1;
  private _canvasWidth = 0;
  private _canvasHeight = 0;
  private _hzbCopyPipeline?: GPUComputePipeline;
  private _hzbCopyBGL?: GPUBindGroupLayout;
  private _hzbDownsamplePipeline?: GPUComputePipeline;
  private _hzbDownsampleBGL?: GPUBindGroupLayout;
  private _hzbTestPipeline?: GPUComputePipeline;
  private _hzbTestBGL?: GPUBindGroupLayout;
  /** Rebuilt once per `resize()` call (see `_rebuildBindGroups()`), not per frame -- every
   * resource these bind: `_hzbTexture`'s mip views and `_hzbSampledView` only change on resize;
   * the copy group's depth view is the one the renderer passed in at resize time, which is safe
   * because `buildPyramid()` (the only copy-group caller) already bails out whenever an offscreen
   * render target is active; and the HZB buffers are allocated once in the constructor and never
   * recreated. */
  private _hzbCopyBindGroup?: GPUBindGroup;
  private _hzbDownsampleBindGroups: GPUBindGroup[] = [];
  private _hzbTestBindGroup?: GPUBindGroup;
  private _hzbAabbBuffer?: GPUBuffer;
  private _hzbResultsBuffer?: GPUBuffer;
  private _hzbTestParamsBuffer?: GPUBuffer;
  /** Ping-pong `MAP_READ` staging pair: while one slot's `mapAsync()` from a prior frame is
   * still pending, the other is always free to write into -- see `dispatchTest()`'s doc comment
   * for why a single buffer can't do this without stalling. */
  private _hzbStagingBuffers?: [GPUBuffer, GPUBuffer];
  private _hzbStagingSlot: 0 | 1 = 0;
  private _hzbStagingPending: [boolean, boolean] = [false, false];
  /** Snapshot of the exact `Object3D[]` dispatched into each staging slot, so
   * `applyOcclusionResults()` can zip a resolved buffer's `u32`s back onto the right objects
   * without needing stable per-object IDs. Each slot reuses (clears + refills) its own array, so
   * a pending readback's snapshot is never clobbered by a later dispatch. */
  private _hzbSlotObjects: [Object3D[], Object3D[]] = [[], []];
  private _hzbCopyRecordedThisFrame = false;

  /** Reused every frame -- see `dispatchTest()`. */
  private readonly _hzbAabbScratch = new Float32Array(MAX_HZB_TESTED_OBJECTS * 4);
  private readonly _hzbParamsScratch = new Uint32Array(4);

  constructor(
    private readonly _device: GPUDevice,
    private readonly _fallback: GPUFallbackResources,
    testShaderCode: string,
    globalBGL: GPUBindGroupLayout,
    private readonly _computeMipLevelCount: (width: number, height: number) => number,
  ) {
    // Mip 0 seed: this frame's `_depthTexture` (depth32float, not storage-bindable) copied
    // into the HZB pyramid's own r32float storage texture.
    this._hzbCopyBGL = this._device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "depth" } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "r32float" },
        },
      ],
    });
    this._hzbCopyPipeline = this._device.createComputePipeline({
      layout: this._device.createPipelineLayout({ bindGroupLayouts: [this._hzbCopyBGL] }),
      compute: {
        module: this._device.createShaderModule({ code: hzbCopyDepthWGSL }),
        entryPoint: "copyDepthToHzb",
      },
    });

    // Rest of the pyramid: max-reduce mip L-1 into mip L, one dispatch per level (see
    // `buildPyramid()`).
    this._hzbDownsampleBGL = this._device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "r32float" },
        },
      ],
    });
    this._hzbDownsamplePipeline = this._device.createComputePipeline({
      layout: this._device.createPipelineLayout({ bindGroupLayouts: [this._hzbDownsampleBGL] }),
      compute: {
        module: this._device.createShaderModule({ code: hzbDownsampleMaxWGSL }),
        entryPoint: "downsampleMax",
      },
    });

    // Visibility test: group 0 is the same shared `GlobalUniforms` bind group every material
    // shader uses (for `global.vp`/`global.viewPos`/`global.projScale`/`global.resolution`),
    // group 1 is this test's own AABB/HZB-texture/results/params bindings.
    this._hzbTestBGL = this._device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const hzbTestModule = this._device.createShaderModule({ code: testShaderCode });
    this._hzbTestPipeline = this._device.createComputePipeline({
      layout: this._device.createPipelineLayout({
        bindGroupLayouts: [globalBGL, this._hzbTestBGL],
      }),
      compute: { module: hzbTestModule, entryPoint: "testVisibility" },
    });

    this._hzbAabbBuffer = this._device.createBuffer({
      size: MAX_HZB_TESTED_OBJECTS * 16, // vec4f (center.xyz, radius) per object
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._hzbResultsBuffer = this._device.createBuffer({
      size: MAX_HZB_TESTED_OBJECTS * 4, // one u32 per object
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this._hzbTestParamsBuffer = this._device.createBuffer({
      size: 16, // HzbTestParams: objectCount/mipCount/pad0/pad1, 4x u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._hzbStagingBuffers = [
      this._device.createBuffer({
        size: MAX_HZB_TESTED_OBJECTS * 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      this._device.createBuffer({
        size: MAX_HZB_TESTED_OBJECTS * 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    ];
  }

  /** (Re)allocates the pyramid texture for the new canvas dimensions and (re)builds every bind
   * group that references it or `activeDepthView` -- called once per `setSize()`, not per frame
   * (see `_hzbCopyBindGroup`'s doc comment). The old texture is freed through the renderer's
   * deferred-destroy queue, which `setSize()` drains before allocating fresh resources. */
  public resize(canvasWidth: number, canvasHeight: number, activeDepthView: GPUTextureView): void {
    if (this._hzbTexture) this._fallback.deferDestroyTexture(this._hzbTexture);
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    this._hzbMipLevelCount = this._computeMipLevelCount(canvasWidth, canvasHeight);
    this._hzbTexture = this._device.createTexture({
      size: [canvasWidth, canvasHeight],
      format: "r32float",
      mipLevelCount: this._hzbMipLevelCount,
      // STORAGE_BINDING: each mip is written once, individually, by buildPyramid().
      // TEXTURE_BINDING: the whole chain is then read back (any mip) by the visibility test.
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this._hzbSampledView = this._hzbTexture.createView();
    this._rebuildBindGroups(activeDepthView);
  }

  /** (Re)builds the bind groups `buildPyramid()`/`dispatchTest()` use, once per resize (see
   * `_hzbCopyBindGroup`'s doc comment). Called from `resize()` right after `_hzbTexture` /
   * `_hzbSampledView` are (re)allocated there. */
  private _rebuildBindGroups(activeDepthView: GPUTextureView): void {
    if (this._hzbCopyBGL && this._hzbTexture) {
      this._hzbCopyBindGroup = this._device.createBindGroup({
        layout: this._hzbCopyBGL,
        entries: [
          { binding: 0, resource: activeDepthView },
          {
            binding: 1,
            resource: this._hzbTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
          },
        ],
      });
    }

    this._hzbDownsampleBindGroups = [];
    if (this._hzbDownsampleBGL && this._hzbTexture) {
      for (let level = 1; level < this._hzbMipLevelCount; level++) {
        this._hzbDownsampleBindGroups.push(
          this._device.createBindGroup({
            layout: this._hzbDownsampleBGL,
            entries: [
              {
                binding: 0,
                resource: this._hzbTexture.createView({
                  baseMipLevel: level - 1,
                  mipLevelCount: 1,
                }),
              },
              {
                binding: 1,
                resource: this._hzbTexture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
              },
            ],
          }),
        );
      }
    }

    if (
      this._hzbTestBGL &&
      this._hzbAabbBuffer &&
      this._hzbSampledView &&
      this._hzbResultsBuffer &&
      this._hzbTestParamsBuffer
    ) {
      this._hzbTestBindGroup = this._device.createBindGroup({
        layout: this._hzbTestBGL,
        entries: [
          { binding: 0, resource: { buffer: this._hzbAabbBuffer } },
          { binding: 1, resource: this._hzbSampledView },
          { binding: 2, resource: { buffer: this._hzbResultsBuffer } },
          { binding: 3, resource: { buffer: this._hzbTestParamsBuffer } },
        ],
      });
    }
  }

  /**
   * Builds this frame's HZB pyramid: mip 0 seeded from the renderer's just-finished opaque depth
   * (already written by `DepthPrePassGPU` earlier in `_passes`), then mips 1..N max-reduced from
   * the level below, one dispatch per level -- see hzb_copy_depth.wgsl/hzb_downsample_max.wgsl.
   * Recorded into the frame's shared command encoder: unlike `GPUTextureResourceCache`'s texture
   * mip generation (which needs its own throwaway encoder+submit since callers run it mid-frame
   * while a render pass may already be open), this runs between two whole passes, never inside
   * one. No-ops for offscreen render targets -- see
   * docs/adr/0008-hzb-occlusion-culling-webgpu-only.md's main-canvas-only scope.
   */
  public buildPyramid(ce: GPUCommandEncoder, offscreen: boolean): void {
    if (offscreen) return;
    if (!this._hzbTexture || !this._hzbCopyPipeline || !this._hzbCopyBindGroup) return;

    const w0 = this._canvasWidth;
    const h0 = this._canvasHeight;
    const copyPass = ce.beginComputePass({ label: "HzbCopyDepth" });
    copyPass.setPipeline(this._hzbCopyPipeline);
    copyPass.setBindGroup(0, this._hzbCopyBindGroup);
    copyPass.dispatchWorkgroups(Math.ceil(w0 / 8), Math.ceil(h0 / 8));
    copyPass.end();

    if (!this._hzbDownsamplePipeline) return;
    for (let level = 1; level < this._hzbMipLevelCount; level++) {
      const bg = this._hzbDownsampleBindGroups[level - 1];
      if (!bg) continue;
      const w = Math.max(1, w0 >> level);
      const h = Math.max(1, h0 >> level);
      const pass = ce.beginComputePass({ label: `HzbDownsample_${level}` });
      pass.setPipeline(this._hzbDownsamplePipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      pass.end();
    }
  }

  /** Filters `scene.lastFrustumVisibleObjects` (a byproduct of the `isVisible && inFrustum` walk
   * `Scene._collectVisible()` already performed for `DepthPrePassGPU`'s `getVisibleObjectsSorted()`
   * call earlier this same frame -- see that field's doc comment) down to the ones with a usable
   * `bounds` sphere, appending onto `out` up to `MAX_HZB_TESTED_OBJECTS` total. A linear scan over
   * that already-collected list, NOT a second scene-tree walk -- see `dispatchTest()`'s doc
   * comment for why this doesn't read one of `FrustumCuller`'s output fields instead, and why
   * relying on `DepthPrePassGPU` having already run this frame is safe (it's fixed earlier than
   * `HzbOcclusionPassGPU` in `WebGPURenderer`'s `_passes` array).
   *
   * `obj.bounds` is only kept current by `Scene.updateDynamicOctree()`/`updateStaticOctree()`,
   * which don't run unless the scene actually has octrees enabled -- otherwise the only thing
   * that ever populates it is a one-off `computeBounds()` call (e.g. `GadgetInspector`'s
   * constructor-time overview refresh, which runs before the object's first
   * `updateMatrixWorld()`), leaving every candidate's world-space bounds frozen wherever it was
   * at that moment. Recomputing here against the object's already-current-for-this-frame
   * `worldMatrix` (updated earlier in `Scene.update()`) keeps the HZB test correct regardless of
   * whether octrees are in use.
   */
  private _collectHzbCandidates(scene: Scene, out: Object3D[]): number {
    const candidates = scene.lastFrustumVisibleObjects;
    let count = 0;
    for (let i = 0; i < candidates.length && count < MAX_HZB_TESTED_OBJECTS; i++) {
      const obj = candidates[i]!;
      if (obj.geometry) obj.computeBounds();
      if (obj.bounds) {
        out.push(obj);
        count++;
      }
    }
    return count;
  }

  /**
   * Packs this frame's frustum-visible objects into `_hzbAabbBuffer` as world-space bounding
   * spheres, dispatches the visibility test compute shader against the pyramid `buildPyramid()`
   * just built, and copies the results into whichever staging buffer slot isn't still waiting on a
   * previous `mapAsync()`.
   *
   * The candidate list is derived from `scene.lastFrustumVisibleObjects` (`isVisible && inFrustum`,
   * same condition `FrustumCuller`'s own fallback path uses -- see `_collectHzbCandidates()`)
   * rather than reading any of `FrustumCuller`'s output fields: the renderer only holds a `scene`,
   * not the owning `SmallWorldMachine`'s private culler instance. Reading `scene`'s own
   * per-instance list keeps the candidate list scoped to the scene actually being rendered, without
   * coupling the renderer to whichever culler instance drove this frame.
   *
   * Only one slot is ever in flight at a time (the two alternate every frame -- see
   * `_hzbStagingBuffers`'s doc comment); if THAT slot is still pending, this frame's test is
   * skipped entirely rather than stalling on it. Objects simply keep last frame's `occlusionCulled`
   * value one frame longer -- never blocking, matches the same "skip and self-correct next frame"
   * pattern `_getObjectSlotOffset()`'s ring-buffer overflow clamp uses.
   */
  public dispatchTest(
    ce: GPUCommandEncoder,
    scene: Scene,
    globalBindGroup: GPUBindGroup,
    offscreen: boolean,
  ): void {
    if (offscreen) return;
    if (
      !this._hzbTestPipeline ||
      !this._hzbTestBindGroup ||
      !this._hzbAabbBuffer ||
      !this._hzbResultsBuffer ||
      !this._hzbTestParamsBuffer ||
      !this._hzbStagingBuffers
    ) {
      return;
    }

    const slot = this._hzbStagingSlot;
    if (this._hzbStagingPending[slot]) return;

    const objects = this._hzbSlotObjects[slot];
    objects.length = 0;
    const count = this._collectHzbCandidates(scene, objects);
    for (let i = 0; i < count; i++) {
      const obj = objects[i]!;
      const c = obj.bounds!.center;
      this._hzbAabbScratch[i * 4 + 0] = c.x;
      this._hzbAabbScratch[i * 4 + 1] = c.y;
      this._hzbAabbScratch[i * 4 + 2] = c.z;
      this._hzbAabbScratch[i * 4 + 3] = obj.bounds!.getBroadRadius();
    }
    if (count === 0) return;

    this._device.queue.writeBuffer(this._hzbAabbBuffer, 0, this._hzbAabbScratch, 0, count * 4);
    this._hzbParamsScratch[0] = count;
    this._hzbParamsScratch[1] = this._hzbMipLevelCount;
    this._hzbParamsScratch[2] = 0;
    this._hzbParamsScratch[3] = 0;
    this._device.queue.writeBuffer(this._hzbTestParamsBuffer, 0, this._hzbParamsScratch);

    const pass = ce.beginComputePass({ label: "HzbVisibilityTest" });
    pass.setPipeline(this._hzbTestPipeline);
    pass.setBindGroup(0, globalBindGroup);
    pass.setBindGroup(1, this._hzbTestBindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();

    ce.copyBufferToBuffer(this._hzbResultsBuffer, 0, this._hzbStagingBuffers[slot], 0, count * 4);
    this._hzbCopyRecordedThisFrame = true;
  }

  /** Fires off `mapAsync()` on whichever staging slot this frame's `dispatchTest()` just copied
   * into, then flips to the other slot for next frame. Fire-and-forget -- the promise itself is
   * never awaited or chained here. `applyOcclusionResults()` doesn't rely on it either: it polls
   * `buffer.mapState` directly every frame instead of waiting on the promise to resolve (see that
   * method's doc comment for why). Called once, right after `queue.submit()`, so the copy is
   * guaranteed to have actually happened before mapping is requested. */
  public kickoffMapAsync(): void {
    if (!this._hzbCopyRecordedThisFrame || !this._hzbStagingBuffers) return;
    this._hzbCopyRecordedThisFrame = false;

    const slot = this._hzbStagingSlot;
    this._hzbStagingPending[slot] = true;
    const buffer = this._hzbStagingBuffers[slot];
    buffer.mapAsync(GPUMapMode.READ).catch(() => {
      // Device lost / buffer destroyed mid-map -- drop this slot's pending state instead of
      // leaving the ping-pong stuck forever; occlusionCulled flags just keep their last value.
      this._hzbStagingPending[slot] = false;
    });

    this._hzbStagingSlot = slot === 0 ? 1 : 0;
  }

  /** Polls `buffer.mapState === "mapped"` on each pending slot directly, rather than reacting to
   * `mapAsync()`'s own promise resolving -- deliberately, not as a simplification. That promise
   * is only guaranteed to resolve *eventually*; nothing requires it to fire within any bounded
   * number of frames, and if it's ever delayed or dropped (slow GPU, a throttled/backgrounded
   * tab, or any other reason) a promise-driven design gets stuck: `_hzbStagingSlot` only ever
   * advances on a *new* successful dispatch, and dispatch itself refuses to touch a slot that's
   * still marked pending -- so a lost callback wedges that slot, and therefore the whole
   * ping-pong, forever. Reading `mapState` (the GPU's own ground truth for whether the buffer is
   * actually readable right now) sidesteps that dependency entirely: whichever slot's mapping
   * has genuinely completed gets consumed on the very next call, no matter what happened to its
   * promise. */
  public applyOcclusionResults(): void {
    if (!this._hzbStagingBuffers) return;

    for (let slot = 0; slot < 2; slot++) {
      if (!this._hzbStagingPending[slot]) continue;
      const buffer = this._hzbStagingBuffers[slot]!;
      if ("mapped" !== buffer.mapState) continue;

      const mapped = new Uint32Array(buffer.getMappedRange());
      const objects = this._hzbSlotObjects[slot]!;
      for (let i = 0; i < objects.length; i++) {
        objects[i]!.occlusionCulled = 0 === mapped[i];
      }
      buffer.unmap();
      this._hzbStagingPending[slot] = false;
    }
  }

  /** Tears down every GPU resource this system created. `destroy()` implicitly unmaps a
   * still-mapped buffer per spec -- safe even if a `mapAsync()` from a not-yet-applied readback
   * is still pending on one of the staging pair. */
  public dispose(): void {
    this._hzbTexture?.destroy();
    this._hzbAabbBuffer?.destroy();
    this._hzbResultsBuffer?.destroy();
    this._hzbTestParamsBuffer?.destroy();
    if (this._hzbStagingBuffers) {
      this._hzbStagingBuffers[0].destroy();
      this._hzbStagingBuffers[1].destroy();
    }
  }
}
