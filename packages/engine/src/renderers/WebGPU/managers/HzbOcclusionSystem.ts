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
 * Readback latency is 1-3 frames (ping-pong `mapAsync`), so a test result describes the camera of
 * a few frames ago. Two conservative mitigations, both biased toward "draw it":
 * - `HZB_RADIUS_PADDING`: the tested sphere is inflated, so small camera/object motion during the
 *   latency window cannot reveal a texel the stale footprint did not cover.
 * - `HZB_OCCLUDED_FRAMES_TO_CULL`: an object is only culled after this many consecutive
 *   "occluded" results (flicker suppression); a single "visible" result un-culls it at once.
 */
const HZB_RADIUS_PADDING = 1.15;
const HZB_OCCLUDED_FRAMES_TO_CULL = 2;

/** Concrete ping-pong read handle the instance-field cull lane binds (ADR 0059) -- the
 * renderer/host surfaces it where the frozen contract's `HzbPyramidAccess.readHandle` stays
 * opaque. `slot` selects the per-slot bind-group A/B pair, `view` is the whole mip chain for the
 * cull's `textureLoad`, `mipLevelCount` bounds the mip clamp. */
export interface HzbFieldReadHandle {
  slot: 0 | 1;
  view: GPUTextureView;
  mipLevelCount: number;
}

/** Previous-frame pyramid access handed to the instance-field cull lane at the frame head.
 * Shape-compatible with the frozen contract `HzbPyramidAccess` (whose `readHandle` is `unknown`). */
export interface HzbFieldPyramidAccess {
  available: boolean;
  frameIndex: number;
  readHandle: HzbFieldReadHandle;
}

/**
 * Owns the entire Hierarchical-Z (HZB) occlusion-culling GPU subsystem that used to live inside
 * `WebGPURenderer`: the pyramid's copy/downsample/visibility-test pipelines, the depth-pyramid
 * texture, the packed-AABB/result/params buffers, the ping-pong `MAP_READ` staging pair and its
 * per-slot pending/object snapshots, plus the per-frame build/dispatch/readback flow
 * (`buildPyramid()`/`dispatchTest()`/`kickoffMapAsync()`/`applyOcclusionResults()`).
 *
 * The pyramid is a PING-PONG PAIR (`_hzbTextures`), not a single overwritten texture: the
 * instance-field cull lane (ADR 0059) tests instances against the PREVIOUS frame's pyramid at the
 * frame head, while this frame's pyramid is only built mid-frame from the just-finished depth
 * pre-pass -- both consumers read a different slot, so the pair is the only depth history that
 * persists (full-res depth is not retained). `buildPyramid()` alternates the write slot and flips
 * `_lastWriteSlot`; the per-object visibility test (`dispatchTest()`) reads the just-built slot;
 * `getPreviousFrameHzb()` hands the OTHER slot to the field cull lane. The pyramid is decoupled
 * from `enableOcclusionCulling`: it exists whenever the renderer constructs this system.
 *
 * The renderer is the only caller; to keep this manager free of a host reference, the renderer
 * passes in everything that lives outside the subsystem at call/construction time: the composed
 * visibility-test shader module code (structs chunk + screen-footprint chunk + WGSL, assembled
 * from the renderer's shader registry), the shared `GlobalUniforms` bind-group layout (group 0
 * of the test pipeline) and, per dispatch, the frame's live global bind group. The system is
 * constructed on every WebGPU renderer (the instance-field lane depends on the pyramid regardless
 * of `enableOcclusionCulling`, ADR 0059); the per-object visibility test simply never dispatches
 * while occlusion culling stays off. See docs/adr/0008-hzb-occlusion-culling-webgpu-only.md.
 */
export class HzbOcclusionSystem {
  /** Ping-pong pyramid PAIR -- see the class doc / `getPreviousFrameHzb()`. Index 0 and 1 are
   * the same pyramid dimensions; the write slot alternates per `buildPyramid()` call and the
   * previous-frame slot is exposed to the instance-field cull lane. */
  private _hzbTextures: GPUTexture[] = [];
  /** Whole mip chain per slot, for the visibility test's / field cull's `textureLoad`. */
  private _hzbSampledViews: GPUTextureView[] = [];
  /** Pyramid slot written by the most recent successful `buildPyramid()` (0 = none yet after
   * resize/invalidate, so the first build writes slot 1 -- the "previous" slot is then the never-
   * written slot 0 and stays unavailable until the second build). */
  private _lastWriteSlot: 0 | 1 = 0;
  /** Monotone count of builds since the last resize/invalidate; `_slotWriteCount[s] > 0` means
   * slot s holds real pyramid data (stale previous-frame reads are the IF-CAMERA-CUT-HZB-SKIP /
   * availability hazard this guards). */
  private _slotWriteCount: [number, number] = [0, 0];
  /** Build counter at which each slot was last written (the `HzbPyramidAccess.frameIndex` value). */
  private _slotBuiltFrame: [number, number] = [0, 0];
  private _buildCounter = 0;
  /** False after `resize()`/`invalidatePyramid()` until the next `buildPyramid()` succeeds;
   * `getPreviousFrameHzb().available` additionally requires the other slot to have data. */
  private _hzbAvailable = false;
  private _hzbMipLevelCount = 1;
  private _canvasWidth = 0;
  private _canvasHeight = 0;
  private _hzbCopyPipeline?: GPUComputePipeline;
  private _hzbCopyBGL?: GPUBindGroupLayout;
  private _hzbDownsamplePipeline?: GPUComputePipeline;
  private _hzbDownsampleBGL?: GPUBindGroupLayout;
  private _hzbTestPipeline?: GPUComputePipeline;
  private _hzbTestBGL?: GPUBindGroupLayout;
  /** Per-slot copies of everything `buildPyramid()`/`dispatchTest()` bind -- see `_rebuildBindGroups()`.
   * Rebuilt once per `resize()` call, not per frame: every resource they bind (the per-slot mip
   * views and the renderer-passed main-depth view) only changes on resize, the buffers are
   * allocated once in the constructor, and `buildPyramid()` (the only copy-group caller) already
   * bails out for offscreen render targets. */
  private _hzbCopyBindGroups: (GPUBindGroup | undefined)[] = [undefined, undefined];
  private _hzbDownsampleBindGroups: GPUBindGroup[][] = [[], []];
  private _hzbTestBindGroups: (GPUBindGroup | undefined)[] = [undefined, undefined];
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
  /**
   * Consecutive "occluded" readbacks per object (absent = 0); per-system, not global. Mutable on
   * purpose: `WeakMap` is not iterable, so the only way to fully clear it is to replace the
   * instance -- see `resetOcclusionStreak()` (S3 DP-4A / E2).
   */
  private _occludedStreak = new WeakMap<Object3D, number>();

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

  /** (Re)allocates BOTH pyramid textures for the new canvas dimensions and (re)builds every
   * per-slot bind group that references them or `activeDepthView` -- called once per `setSize()`,
   * not per frame (see `_hzbCopyBindGroups`'s doc comment). The old pair is freed through the
   * renderer's deferred-destroy queue, which `setSize()` drains before allocating fresh
   * resources. A degenerate 0/1px size (initialization order, hidden tab) keeps the previous
   * pair: WebGPU textures cannot be created at size 0, and wiping a usable pyramid for a
   * transient resize would silently lose the previous-frame slot the field lane consumes. */
  public resize(canvasWidth: number, canvasHeight: number, activeDepthView: GPUTextureView): void {
    if (canvasWidth < 1 || canvasHeight < 1) return;
    for (const t of this._hzbTextures) {
      if (t) this._fallback.deferDestroyTexture(t);
    }
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    this._hzbMipLevelCount = this._computeMipLevelCount(canvasWidth, canvasHeight);
    for (let slot = 0; slot < 2; slot++) {
      this._hzbTextures[slot] = this._device.createTexture({
        size: [canvasWidth, canvasHeight],
        format: "r32float",
        mipLevelCount: this._hzbMipLevelCount,
        // STORAGE_BINDING: each mip is written once, individually, by buildPyramid().
        // TEXTURE_BINDING: the whole chain is then read back (any mip) by the visibility test.
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._hzbSampledViews[slot] = this._hzbTextures[slot]!.createView();
    }
    // Fresh pair: neither slot holds data, so the first build writes slot 1 (`_lastWriteSlot`
    // stays 0) and the previous-frame slot only becomes available after the SECOND build.
    this._lastWriteSlot = 0;
    this._slotWriteCount = [0, 0];
    this._slotBuiltFrame = [0, 0];
    this._buildCounter = 0;
    this._hzbAvailable = false;
    this._rebuildBindGroups(activeDepthView);
  }

  /** (Re)builds the per-slot bind groups `buildPyramid()`/`dispatchTest()` use, once per resize
   * (see `_hzbCopyBindGroups`'s doc comment). Called from `resize()` right after both slots'
   * textures/views are (re)allocated there. Every resource the groups bind is either per-slot
   * (mip views) or allocated once in the constructor (AABB/results/params buffers, the renderer-
   * passed active depth view), so no `createBindGroup` ever happens per frame. */
  private _rebuildBindGroups(activeDepthView: GPUTextureView): void {
    for (let slot = 0; slot < 2; slot++) {
      const pyramid = this._hzbTextures[slot];

      if (this._hzbCopyBGL && pyramid) {
        this._hzbCopyBindGroups[slot] = this._device.createBindGroup({
          layout: this._hzbCopyBGL,
          entries: [
            { binding: 0, resource: activeDepthView },
            {
              binding: 1,
              resource: pyramid.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
            },
          ],
        });
      } else {
        this._hzbCopyBindGroups[slot] = undefined;
      }

      const levelGroups: GPUBindGroup[] = [];
      if (this._hzbDownsampleBGL && pyramid) {
        for (let level = 1; level < this._hzbMipLevelCount; level++) {
          levelGroups.push(
            this._device.createBindGroup({
              layout: this._hzbDownsampleBGL,
              entries: [
                {
                  binding: 0,
                  resource: pyramid.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
                },
                {
                  binding: 1,
                  resource: pyramid.createView({ baseMipLevel: level, mipLevelCount: 1 }),
                },
              ],
            }),
          );
        }
      }
      this._hzbDownsampleBindGroups[slot] = levelGroups;

      if (
        this._hzbTestBGL &&
        pyramid &&
        this._hzbAabbBuffer &&
        this._hzbResultsBuffer &&
        this._hzbTestParamsBuffer
      ) {
        this._hzbTestBindGroups[slot] = this._device.createBindGroup({
          layout: this._hzbTestBGL,
          entries: [
            { binding: 0, resource: { buffer: this._hzbAabbBuffer } },
            { binding: 1, resource: this._hzbSampledViews[slot]! },
            { binding: 2, resource: { buffer: this._hzbResultsBuffer } },
            { binding: 3, resource: { buffer: this._hzbTestParamsBuffer } },
          ],
        });
      } else {
        this._hzbTestBindGroups[slot] = undefined;
      }
    }
  }

  /**
   * Builds this frame's HZB pyramid into the PING-PONG slot the previous build did NOT write:
   * mip 0 seeded from the renderer's just-finished opaque depth (already written by
   * `DepthPrePassGPU` earlier in `_passes`), then mips 1..N max-reduced from the level below,
   * one dispatch per level inside a single compute pass -- see hzb_copy_depth.wgsl/hzb_downsample_max.wgsl.
   * Recorded into the frame's shared command encoder: unlike `GPUTextureResourceCache`'s texture
   * mip generation (which needs its own throwaway encoder+submit since callers run it mid-frame
   * while a render pass may already be open), this runs between two whole passes, never inside
   * one. No-ops for offscreen render targets -- see
   * docs/adr/0008-hzb-occlusion-culling-webgpu-only.md's main-canvas-only scope.
   *
   * After the chain is recorded, the write slot flips (`_lastWriteSlot`) and the slot's build
   * timestamp advances -- both consumers key off that ordering: `dispatchTest()` reads the
   * just-built slot, `getPreviousFrameHzb()` hands the OTHER slot to the instance-field cull lane.
   */
  public buildPyramid(ce: GPUCommandEncoder, offscreen: boolean): void {
    if (offscreen) return;
    const slot = this._lastWriteSlot === 0 ? 1 : 0;
    const copyGroup = this._hzbCopyBindGroups[slot];
    if (!copyGroup || !this._hzbCopyPipeline) return;

    const w0 = this._canvasWidth;
    const h0 = this._canvasHeight;
    // One compute pass for the whole chain (copy + every downsample level): each dispatch is its
    // own usage scope in WebGPU, so a level's storage writes are visible to the next dispatch's
    // texture read without ending the pass. Saves N pass begin/end pairs per frame.
    const pass = ce.beginComputePass({ label: "HzbBuildPyramid" });
    pass.setPipeline(this._hzbCopyPipeline);
    pass.setBindGroup(0, copyGroup);
    pass.dispatchWorkgroups(Math.ceil(w0 / 8), Math.ceil(h0 / 8));

    if (this._hzbDownsamplePipeline) {
      pass.setPipeline(this._hzbDownsamplePipeline);
      const levelGroups = this._hzbDownsampleBindGroups[slot]!;
      for (let level = 1; level < this._hzbMipLevelCount; level++) {
        const bg = levelGroups[level - 1];
        if (!bg) continue;
        const w = Math.max(1, w0 >> level);
        const h = Math.max(1, h0 >> level);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      }
    }
    pass.end();

    // The write is committed on the encoder; flip the slot and stamp the generation so the two
    // consumers resolve the just-built vs. previous-frame slot without an extra flag.
    this._buildCounter++;
    this._slotWriteCount[slot]++;
    this._slotBuiltFrame[slot] = this._buildCounter;
    this._lastWriteSlot = slot;
    this._hzbAvailable = true;
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
   * Only objects whose `computeBounds()` yields bounds are tested. `isCollidable = false` objects
   * (decals, fog volumes, purely visual helpers) deliberately get none and therefore always draw:
   * that is the conservative default (a fog volume or decal must never be culled by opaque depth),
   * see the `Object3D.isCollidable` contract. The per-candidate `computeBounds()` is an in-place
   * recycle (no allocation) against the current `worldMatrix`.
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
      !this._hzbTestBindGroups[this._lastWriteSlot] ||
      !this._hzbAabbBuffer ||
      !this._hzbResultsBuffer ||
      !this._hzbTestParamsBuffer ||
      !this._hzbStagingBuffers
    ) {
      return;
    }
    // The visibility test reads the JUST-BUILT pyramid slot (`_lastWriteSlot`); the previous-
    // frame slot is exclusively the instance-field cull lane's (`getPreviousFrameHzb()`).
    const testBindGroup = this._hzbTestBindGroups[this._lastWriteSlot]!;

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
      this._hzbAabbScratch[i * 4 + 3] = obj.bounds!.getBroadRadius() * HZB_RADIUS_PADDING;
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
    pass.setBindGroup(1, testBindGroup);
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

  /**
   * Clears the per-object occlusion streak so no stale count survives a camera cut (S3 DP-4A /
   * E2, MANDATORY): after a teleport the readback latency means the *next* HZB apply would
   * otherwise restore `occlusionCulled` on an object that was occluded for the pre-cut camera after
   * as little as one more "occluded" readback. WeakMap has no `clear()`, hence the instance
   * replacement. It does NOT touch the per-object `occlusionCulled` flags -- the scene-wide reset
   * lives in `SmallWorldMachine.notifyCameraTeleport()`/`Scene.resetOcclusionCulled()`. Pending
   * staging readbacks are unaffected and simply re-apply on their next `applyOcclusionResults()`
   * call against a zeroed streak. Idempotent.
   */
  public resetOcclusionStreak(): void {
    this._occludedStreak = new WeakMap<Object3D, number>();
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
        const obj = objects[i]!;
        if (0 === mapped[i]) {
          const streak = (this._occludedStreak.get(obj) ?? 0) + 1;
          this._occludedStreak.set(obj, streak);
          if (streak >= HZB_OCCLUDED_FRAMES_TO_CULL) obj.occlusionCulled = true;
        } else {
          if (obj.occlusionCulled || this._occludedStreak.has(obj))
            this._occludedStreak.delete(obj);
          obj.occlusionCulled = false;
        }
      }
      buffer.unmap();
      this._hzbStagingPending[slot] = false;
    }
  }

  /** Tears down every GPU resource this system created. `destroy()` implicitly unmaps a
   * still-mapped buffer per spec -- safe even if a `mapAsync()` from a not-yet-applied readback
   * is still pending on one of the staging pair. */
  public dispose(): void {
    for (const texture of this._hzbTextures) texture?.destroy();
    this._hzbAabbBuffer?.destroy();
    this._hzbResultsBuffer?.destroy();
    this._hzbTestParamsBuffer?.destroy();
    if (this._hzbStagingBuffers) {
      this._hzbStagingBuffers[0].destroy();
      this._hzbStagingBuffers[1].destroy();
    }
  }

  /**
   * Hands the instance-field cull lane (ADR 0059) read access to the PREVIOUS frame's pyramid
   * slot -- the one `buildPyramid()` did NOT just write. The field cull runs at the frame head,
   * before this frame's depth pre-pass, so it can only ever consume last frame's depth.
   *
   * `available` requires BOTH a successful prior build (`_hzbAvailable`) AND the other slot to
   * have been written at least once (`_slotWriteCount[other] > 0`): the very first build writes
   * slot 1 while `_lastWriteSlot` stays 0, so the never-written slot 0 only becomes available
   * after the SECOND build -- the first frame after resize/invalidate therefore keeps the field
   * lane on frustum-only culling (fail-closed, no stale pyramid). `frameIndex` is the unique
   * generation stamp of the slot; the cull coordinator compares it against the last culled frame
   * to detect one-frame-stale previous-frame data independently of the telement flag. The
   * returned handle MUST be read within the same frame: the next `buildPyramid()` flips the
   * write slot and this handle becomes the just-built one.
   */
  public getPreviousFrameHzb(): HzbFieldPyramidAccess {
    const other: 0 | 1 = this._lastWriteSlot === 0 ? 1 : 0;
    const otherCulled = this._slotWriteCount[other]! > 0;
    return {
      available: this._hzbAvailable && otherCulled,
      frameIndex: this._slotBuiltFrame[other]!,
      readHandle: {
        slot: other,
        view: this._hzbSampledViews[other]!,
        mipLevelCount: this._hzbMipLevelCount,
      },
    };
  }

  /**
   * Marks the whole pyramid pair stale (camera cut / teleport). Without this the field cull lane
   * would consume the PRE-CUT camera's previous-frame slot in the very frame after
   * `notifyCameraTeleport()` -- the exact wrong-cull hazard `IF-CAMERA-CUT-HZB-SKIP` guards.
   * `getPreviousFrameHzb()` then returns `available: false` until the next `buildPyramid()`
   * succeeds, and `_slotBuiltFrame` keeps counting so a stale slot's `frameIndex` can never be
   * mistaken for a fresh one. The readback chain and the per-object `occlusionCulled` flags are
   * untouched (`resetOcclusionStreak()` is the sibling the renderer already fans out). Besides
   * this system-wide invalidation, each field additionally consumes its field-scoped one-frame
   * cull skip (`InstanceFieldSystem.notifyCameraTeleport`, defense in depth). Idempotent. */
  public invalidatePyramid(): void {
    this._hzbAvailable = false;
  }
}
