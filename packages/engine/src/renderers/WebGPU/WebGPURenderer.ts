// Removed Fog import
import type {
  CubeTexture,
  DirectionalLight,
  Object3D,
  Scene,
  SpotLight,
  Texture,
} from "../../core/index.js";
import {
  InstancedMesh,
  MAX_CLUSTERED_LIGHTS_PER_TYPE,
  isSkinnedMesh,
  computeClipToBox,
} from "../../core/index.js";
import type { RenderTarget, RenderTargetCube } from "../../core/textures/index.js";
import type { RenderManifest } from "../shaders/index.js";
import { UniformPacker, VERTEX_COLOR_FLAG, resolveManifestFlags } from "../shaders/index.js";
import type { EngineOptions, LightDataInterface } from "../../interfaces/index.js";

import type { ClusterGridDims } from "../../math/index.js";
import {
  MathPool,
  Vector3D,
  Matrix4,
  computeClusterCounts,
  DEFAULT_CLUSTER_TILE_SIZE,
  DEFAULT_CLUSTER_Z_SLICES,
  DEFAULT_MAX_LIGHTS_PER_CLUSTER,
} from "../../math/index.js";
import clusterCullWGSL from "../shaders/source/web_gpu/compute/cluster_cull.wgsl?raw";
import hzbCopyDepthWGSL from "../shaders/source/web_gpu/compute/hzb_copy_depth.wgsl?raw";
import hzbDownsampleMaxWGSL from "../shaders/source/web_gpu/compute/hzb_downsample_max.wgsl?raw";
import hzbVisibilityTestWGSL from "../shaders/source/web_gpu/compute/hzb_visibility_test.wgsl?raw";
import {
  RendererType,
  Topology,
  PostProcessingEffectType,
  NormalTargetMode,
  WireframeMode,
} from "../../enums/index.js";
import { NORMAL_TARGET_FORMAT } from "./managers/NormalOutputWrapper.js";
import { AbstractRenderer } from "../AbstractRenderer.js";
import type { RenderPass } from "../RenderPass.js";
import { GlobalUniformWriter } from "./managers/GlobalUniformWriter.js";
import { GPUFallbackResources } from "./managers/GPUFallbackResources.js";
import { GPURenderTargetCache } from "./managers/GPURenderTargetCache.js";
import { GPUTextureResourceCache } from "./managers/GPUTextureResourceCache.js";
import { OpaqueCapture } from "./managers/OpaqueCapture.js";
import {
  GPUPipelineCache,
  getOptionalMaterialTextureBindings,
  getOptionalMaterialTextureNames,
} from "./managers/GPUPipelineCache.js";
import { GPUObjectRingBuffer } from "./managers/GPUObjectRingBuffer.js";
import { GPUGeometryCache } from "./managers/GPUGeometryCache.js";
import {
  MainRenderPass,
  PostProcessPass,
  CascadedShadowPassGPU,
  SpotShadowPassGPU,
  ClusterCullPassGPU,
  DepthPrePassGPU,
  HzbOcclusionPassGPU,
} from "../passes/index.js";
import {
  BloomPassGPU,
  AOPassGPU,
  HistoryBlendPassGPU,
  LightShaftsPassGPU,
  VolumetricFogPassGPU,
} from "../post/passes/index.js";
import type {
  BloomElement,
  HbaoElement,
  LightShaftsElement,
  MotionTrailElement,
  TaaElement,
  VolumetricFogElement,
} from "../post/elements/index.js";
import type { PostEffectPass, PostEffectPassContext } from "../post/PostEffectPass.js";
import type { PostProcessingElement } from "../post/PostProcessingElement.js";
import type { SkinnedMesh, Skeleton } from "../../core/animation/index.js";
import { MAX_SKINNED_BONES } from "../../core/animation/index.js";
import type { RenderBatch } from "../../core/Scene.js";

/**
 * Dynamic-offset slot layout for the per-draw view-projection uniform (group 3, `view.vp` in
 * structs.wgsl) -- one slot per camera that can be active mid-frame: the main camera, each
 * cascade of the (single, at most 4-cascade) directional shadow, and each of up to 4 shadow-
 * casting spot lights. Fixed capacity, no growth: hard-bounded by `cascadeMatrices`/
 * `spotShadowMatrices`'s `array<mat4x4f, 4>` sizes in structs.wgsl, same cap the existing code
 * already assumes. See `_setViewMatrix()`/`CascadedShadowPassGPU`/`SpotShadowPassGPU`.
 */
export const VIEW_SLOT_MAIN_CAMERA = 0;
export const VIEW_SLOT_CASCADE_BASE = 1;
export const VIEW_SLOT_SPOT_SHADOW_BASE = 5;
const VIEW_SLOT_COUNT = 9;

/**
 * Fixed capacity for the Hierarchical-Z occlusion visibility test's AABB/results buffers -- see
 * docs/adr/0008-hzb-occlusion-culling-webgpu-only.md. No dynamic regrowth or atomics, same
 * fixed-capacity-no-atomics reasoning ADR 0007 already uses for the cluster light buffers.
 * Objects beyond this cap (per frame, among those that passed frustum culling) are simply never
 * occlusion-tested -- they always draw, the same safe default as `occlusionCulled`'s initial
 * `false`.
 */
const MAX_HZB_TESTED_OBJECTS = 8192;

/**
 * Modern WebGPU implementation with dynamic vertex updates and memory management.
 */
export class WebGPURenderer extends AbstractRenderer {
  public override readonly type: RendererType = RendererType.WEB_GPU;
  protected _adapter: GPUAdapter | undefined = undefined;
  private _device: GPUDevice | undefined = undefined;
  private _isDeviceLost: boolean = false;
  private _isDestroyed: boolean = false;

  /** Satisfies Renderer interface */
  public override get isContextLost(): boolean {
    return this._isDeviceLost;
  }

  /** Satisfies Renderer interface */
  public get gpuDevice(): GPUDevice | undefined {
    return this._device;
  }

  private _context!: GPUCanvasContext;
  /** Satisfies `RenderPass`-consuming passes, which have no other way to reach this. */
  public get gpuCanvasContext(): GPUCanvasContext {
    return this._context;
  }

  private _format!: GPUTextureFormat;
  /** Satisfies `RenderPass`-consuming passes, which have no other way to reach this. */
  public get gpuFormat(): GPUTextureFormat {
    return this._format;
  }

  /**
   * The color-target format any RenderPipeline drawing into the CURRENTLY bound target must be
   * built for -- i.e. whatever `render()`'s own view resolution (see the `isOffscreen` block
   * around `_activeRenderTarget`) will actually bind this frame. A custom offscreen RenderTarget
   * (e.g. `PlanarReflectionNode.renderTarget`) is always backed by a `this._format` texture,
   * regardless of `postProcessing.enabled` -- only the *main* scene pass (no active render
   * target) targets the "rgba16float" HDR intermediate buffer when post-processing is on.
   * Single source of truth for this decision: anything that needs to match the pipeline format
   * `_renderSubgroup()` will request in the current context (e.g. a shadow pass's own throwaway
   * dummy color attachment) must read this getter too, rather than re-deriving the same decision
   * from `postProcessing.enabled` alone and silently drifting out of sync with it whenever
   * something renders into a custom RenderTarget (see `CascadedShadowPassGPU`/`SpotShadowPassGPU`,
   * which used to do exactly that).
   */
  public get currentColorTargetFormat(): GPUTextureFormat {
    return this._activeRenderTarget
      ? this._format
      : this.postProcessing.enabled
        ? "rgba16float"
        : this._format;
  }

  /** Per-object dynamic-offset uniform ring buffer -- see `GPUObjectRingBuffer`'s own doc
   * comment. */
  private _objectRing!: GPUObjectRingBuffer;

  /** Per-draw view-projection dynamic-offset buffer -- see `VIEW_SLOT_*`/`_setViewMatrix()`. */
  private _viewBGL!: GPUBindGroupLayout;
  private _viewUniformBuffer!: GPUBuffer;
  private _viewBindGroup!: GPUBindGroup;
  private _viewUniformStride = 256;

  protected _materialBindGroups = new Map<
    string,
    {
      bg: GPUBindGroup;
      resources: unknown[];
    }
  >();
  /** Fallback/placeholder GPU resources (default & dummy textures/buffers) -- see
   * `GPUFallbackResources`'s own doc comment. */
  private _fallback!: GPUFallbackResources;
  /** Uploaded-texture GPU state (view caches, sampler cache, mip generation) -- see
   * `GPUTextureResourceCache`'s own doc comment. */
  private _textures!: GPUTextureResourceCache;
  /** Render pipeline / shader module / material bind-group-layout caches -- see
   * `GPUPipelineCache`'s own doc comment. */
  private _pipelineCache!: GPUPipelineCache;
  public get whiteTextureView(): GPUTextureView {
    return this._fallback.whiteTextureView;
  }
  /** Read by the fragment shader's global bind group; reassigned once by
   * `CascadedShadowPassGPU` when a real cascaded shadow map first exists. */
  public get defaultDirShadowTextureView(): GPUTextureView {
    return this._fallback.defaultDirShadowTextureView;
  }
  public set defaultDirShadowTextureView(view: GPUTextureView) {
    this._fallback.defaultDirShadowTextureView = view;
  }
  public get dummyDirShadowTextureView(): GPUTextureView {
    return this._fallback.dummyDirShadowTextureView;
  }
  /** Read by the fragment shader's global bind group; reassigned once by
   * `SpotShadowPassGPU` when a real spot shadow map first exists. */
  public get defaultSpotShadowTextureView(): GPUTextureView {
    return this._fallback.defaultSpotShadowTextureView;
  }
  public set defaultSpotShadowTextureView(view: GPUTextureView) {
    this._fallback.defaultSpotShadowTextureView = view;
  }
  public get dummySpotShadowTextureView(): GPUTextureView {
    return this._fallback.dummySpotShadowTextureView;
  }
  /** Per-geometry GPU vertex/index buffer cache -- see `GPUGeometryCache`'s own doc comment. */
  private _geometryCache!: GPUGeometryCache;
  /** Frame-global uniform/light upload buffers + IBL-change detection -- see `GlobalUniformWriter`. */
  private _globalUniformWriter!: GlobalUniformWriter;
  /** Cached screen/offscreen opaque color/depth/normal snapshots -- see `OpaqueCapture`. */
  private _opaqueCapture!: OpaqueCapture;
  /** Cached offscreen RenderTarget backing textures -- see `GPURenderTargetCache`. */
  private _targetCache!: GPURenderTargetCache;
  protected _gpuInstanceBuffers: WeakMap<InstancedMesh, GPUBuffer> = new WeakMap();
  protected _gpuInstanceDataBuffers: WeakMap<InstancedMesh, GPUBuffer> = new WeakMap();
  protected _frameCount = 0;
  protected _scratchModelMatrix = new Float32Array(16);
  protected _scratchColorArray = new Float32Array(4);
  protected _scratchUniformValues: Record<string, unknown> = {};

  // Reused across every _renderBatch() call (cleared via .length = 0) instead of allocating two
  // fresh arrays per batch -- same pattern as CascadedShadowPassGPU's _scratchInstanced/_scratchStandard.
  private _scratchInstancedObjects: Object3D[] = [];
  private _scratchStandardObjects: Object3D[] = [];

  /** Reused every frame (never reallocated) -- see `GlobalUniformWriter`. */
  public get scratchGlobalBufferData(): Float32Array {
    return this._globalUniformWriter.scratchGlobalBufferData;
  }
  protected _scratchObjBufferData = new Float32Array(512 / 4); // 512 bytes (32 vec4), see docs/adr/0027-object-uniforms-512-byte-expansion.md

  /** Clustered light grid dimensions for the current canvas size, see `setSize()`. */
  private _clusterDims: ClusterGridDims = { x: 1, y: 1, z: 1 };
  public get clusterDims(): ClusterGridDims {
    return this._clusterDims;
  }
  private _clusterMaxLightsPerCluster = 1;
  /** Read by `GlobalUniformWriter.update()` for the clustered-culling metadata block. */
  public get clusterMaxLightsPerCluster(): number {
    return this._clusterMaxLightsPerCluster;
  }
  private _pointClusterGridBuffer!: GPUBuffer;
  private _pointClusterIndexBuffer!: GPUBuffer;
  private _spotClusterGridBuffer!: GPUBuffer;
  private _spotClusterIndexBuffer!: GPUBuffer;
  private _clusterCullPipeline!: GPUComputePipeline;
  public get clusterCullPipeline(): GPUComputePipeline {
    return this._clusterCullPipeline;
  }

  private _depthTexture!: GPUTexture;

  // Hierarchical-Z occlusion culling -- see docs/adr/0008-hzb-occlusion-culling-webgpu-only.md.
  // All of this stays unallocated (fields left undefined) unless `enableOcclusionCulling` was
  // set at init, so an app that never opts in pays nothing.
  private _occlusionCullingEnabled = false;
  private _hzbTexture?: GPUTexture;
  private _hzbSampledView?: GPUTextureView; // whole mip chain, for the visibility test's textureLoad
  private _hzbMipLevelCount = 1;
  private _hzbCopyPipeline?: GPUComputePipeline;
  private _hzbCopyBGL?: GPUBindGroupLayout;
  private _hzbDownsamplePipeline?: GPUComputePipeline;
  private _hzbDownsampleBGL?: GPUBindGroupLayout;
  private _hzbTestPipeline?: GPUComputePipeline;
  private _hzbTestBGL?: GPUBindGroupLayout;
  /** Rebuilt once per `setSize()` call (see `_rebuildHzbBindGroups()`), not per frame -- every
   * resource these bind: `_hzbTexture`'s mip views and `_hzbSampledView` only change on resize;
   * `activeDepthView` resolves to `_depthTexture.createView()` here specifically, since
   * `_buildHzbPyramid()` (the only caller) already bails out whenever an offscreen render target
   * is active; and the HZB buffers (`_hzbAabbBuffer` etc.) are allocated once in
   * `_initGlobalBuffers()` and never recreated. */
  private _hzbCopyBindGroup?: GPUBindGroup;
  private _hzbDownsampleBindGroups: GPUBindGroup[] = [];
  private _hzbTestBindGroup?: GPUBindGroup;
  private _hzbAabbBuffer?: GPUBuffer;
  private _hzbResultsBuffer?: GPUBuffer;
  private _hzbTestParamsBuffer?: GPUBuffer;
  /** Ping-pong `MAP_READ` staging pair: while one slot's `mapAsync()` from a prior frame is
   * still pending, the other is always free to write into -- see `_dispatchHzbTest()`'s doc
   * comment for why a single buffer can't do this without stalling. */
  private _hzbStagingBuffers?: [GPUBuffer, GPUBuffer];
  private _hzbStagingSlot: 0 | 1 = 0;
  private _hzbStagingPending: [boolean, boolean] = [false, false];
  /** Snapshot of the exact `Object3D[]` dispatched into each staging slot, so
   * `applyPendingOcclusionResults()` can zip a resolved buffer's `u32`s back onto the right
   * objects without needing stable per-object IDs. */
  private _hzbSlotObjects: [Object3D[], Object3D[]] = [[], []];
  private _hzbCopyRecordedThisFrame = false;

  private _shadowMaps = new Map<DirectionalLight | SpotLight, GPUTexture>();
  /** Same Map instance every frame -- shadow passes `.get()`/`.set()` on it directly. */
  public get shadowMaps(): Map<DirectionalLight | SpotLight, GPUTexture> {
    return this._shadowMaps;
  }

  private _hdrTexture: GPUTexture | undefined = undefined;
  public get hdrTexture(): GPUTexture | undefined {
    return this._hdrTexture;
  }
  private _normalTexture: GPUTexture | undefined = undefined;
  private _normalTextureView: GPUTextureView | undefined = undefined;
  private _hdrTextureView: GPUTextureView | undefined = undefined;
  public get hdrTextureView(): GPUTextureView | undefined {
    return this._hdrTextureView;
  }
  // Single orchestration point for every GPU post-effect pass -- see `_getOrCreatePostEffectPass`
  // and the `PostEffectPass` contract (ADR 0037). Replaces the former per-effect `_xxxPassGPU`
  // fields and their separate `?.destroy()` lists. Passes are created lazily on first enable and
  // destroyed in one registry sweep from `destroy()`.
  private readonly _postEffectPasses = new Map<PostProcessingEffectType, PostEffectPass>();
  /** Reused every frame (zero allocation on the hot path); fields are repopulated right before
   * each dispatch -- see the `PostEffectPassContext` reuse contract. */
  private readonly _postEffectCtx: PostEffectPassContext = {
    renderer: this,
    ce: undefined as unknown as GPUCommandEncoder,
    element: undefined as unknown as PostProcessingElement,
    colorTexture: undefined,
    colorView: undefined as unknown as GPUTextureView,
    depthView: undefined as unknown as GPUTextureView,
    width: 0,
    height: 0,
    vp: new Float32Array(16),
    vMat: undefined,
    camPos: Vector3D.ZERO,
    near: 0.1,
    far: 1000,
    projMatrix: undefined,
    lights: undefined as unknown as LightDataInterface,
    fogVolumes: [],
  };

  private _bloomTextureView: GPUTextureView | undefined = undefined;
  public get bloomTextureView(): GPUTextureView | undefined {
    return this._bloomTextureView;
  }
  private _hbaoTextureView: GPUTextureView | undefined = undefined;
  public get hbaoTextureView(): GPUTextureView | undefined {
    return this._hbaoTextureView;
  }
  private _lightShaftsTextureView: GPUTextureView | undefined = undefined;
  public get lightShaftsTextureView(): GPUTextureView | undefined {
    return this._lightShaftsTextureView;
  }
  private _volumetricFogTextureView: GPUTextureView | undefined = undefined;
  /** Full-screen in-scattering target of the volumetric-fog raymarch pass, consumed additively
   * (before tonemapping) by PostProcessPass. Recomputed fresh every frame; undefined when the
   * `VolumetricFogElement` is disabled or inputs are missing. */
  public get volumetricFogTextureView(): GPUTextureView | undefined {
    return this._volumetricFogTextureView;
  }
  /** This frame's TAA-resolved color view, if TAA is enabled -- read by PostProcessPass instead
   * of `_hdrTextureView` for its color input. Recomputed fresh every frame; `_hdrTextureView`
   * itself is never overwritten so TAA keeps reading the raw per-frame render as "current".
   * (TAA's `HistoryBlendPassGPU` instance lives in `_postEffectPasses`, its own separate history
   * buffer from Motion Trail's. */
  private _taaResolvedView: GPUTextureView | undefined = undefined;
  public get taaResolvedView(): GPUTextureView | undefined {
    return this._taaResolvedView;
  }
  private _motionTrailResolvedView: GPUTextureView | undefined = undefined;
  public get motionTrailResolvedView(): GPUTextureView | undefined {
    return this._motionTrailResolvedView;
  }

  private _activeRenderTarget: RenderTarget | RenderTargetCube | null = null;
  protected _activeCubeFace: number = 0;

  // Render Pass System
  protected _passes: RenderPass[] = [];

  /** Frame-global uniform/light upload buffers live in `GlobalUniformWriter`; this getter keeps
   * their single public consumer (`SpotShadowPassGPU`/`CascadedShadowPassGPU`) working unchanged. */
  public get globalUniformBuffer(): GPUBuffer {
    return this._globalUniformWriter.globalUniformBuffer;
  }
  private _globalBindGroup!: GPUBindGroup;
  private _globalResourcesVersion = 0;
  /** The scene IBL textures currently held through `retainTexture()` for the global bind group. */
  private _pinnedIblTextures: (Texture | CubeTexture)[] = [];

  /** Bumped whenever a buffer bound by the global bind group is replaced; passes that cache their
   * own copy of that bind group must rebuild it when this changes. */
  public get globalResourcesVersion(): number {
    return this._globalResourcesVersion;
  }
  /** Rebuilt once (not per-frame) by a shadow pass, the first time a real shadow map for that
   * light type exists -- see `CascadedShadowPassGPU`/`SpotShadowPassGPU`. */
  public get globalBindGroup(): GPUBindGroup {
    return this._globalBindGroup;
  }
  public set globalBindGroup(bindGroup: GPUBindGroup) {
    this._globalBindGroup = bindGroup;
  }
  /**
   * Shared bind-group layout behind `globalBindGroup` -- exposed so additional compute passes
   * (e.g. the volumetric-fog froxel injection) can declare the engine's bind group 0 alongside
   * their own bindings without duplicating the layout. Read-only; see `globalBindGroup`.
   */
  public get globalBGL(): GPUBindGroupLayout {
    return this._globalBGL;
  }
  private _globalBGL!: GPUBindGroupLayout;
  private _objectBGL!: GPUBindGroupLayout;
  private _boneMatricesBuffer!: GPUBuffer;
  private _gpuBoneMatricesOffset: number = 0;
  private _boneSlotMap: Map<Skeleton, number> = new Map();

  /** @inheritdoc */
  public override setRenderTarget(
    target: RenderTarget | RenderTargetCube | null,
    activeCubeFace?: number,
  ): void {
    this._activeRenderTarget = target;
    this._activeCubeFace = activeCubeFace ?? 0;
  }

  /** The currently active off-screen render target, or null if rendering to the default framebuffer. */
  public get activeRenderTarget(): RenderTarget | RenderTargetCube | null {
    return this._activeRenderTarget;
  }

  /** The currently active cube face index (0-5) if rendering to a RenderTargetCube. */
  public get activeCubeFace(): number {
    return this._activeCubeFace;
  }

  /**
   * The normal buffer (ADR 0028) the main pass writes alongside its color target, or undefined
   * while `quality.normalBuffer` is off or a custom RenderTarget is active (offscreen passes
   * keep their single color target).
   */
  public get activeNormalView(): GPUTextureView | undefined {
    return this._activeRenderTarget ? undefined : this._normalTextureView;
  }

  public get activeDepthView(): GPUTextureView {
    if (this._activeRenderTarget) {
      const view = this._targetCache.depthView(this._activeRenderTarget);
      if (view) return view;
    }
    return this._depthTexture.createView();
  }

  public get activeDepthTexture(): GPUTexture {
    if (this._activeRenderTarget) {
      const tex = this._targetCache.depthTexture(this._activeRenderTarget);
      if (tex) return tex;
    }
    return this._depthTexture;
  }

  public get activeColorTexture(): GPUTexture {
    if (this._activeRenderTarget) {
      const tex = this._targetCache.colorTexture(this._activeRenderTarget);
      if (tex) return tex;
    }
    return this.postProcessing.enabled && this._hdrTexture
      ? this._hdrTexture
      : this._context.getCurrentTexture();
  }

  /** @inheritdoc */
  public async initialize(
    canvas: HTMLCanvasElement,
    attributes?: Record<string, unknown>,
    config?: EngineOptions,
  ): Promise<void> {
    this._adapter = (await navigator.gpu.requestAdapter(attributes)) ?? undefined;
    if (!this._adapter) throw new Error("[WebGPURenderer] No adapter found.");

    const requiredLimits: Record<string, number> = {};

    if (this._adapter.limits.maxSampledTexturesPerShaderStage) {
      requiredLimits["maxSampledTexturesPerShaderStage"] =
        this._adapter.limits.maxSampledTexturesPerShaderStage;
    }
    if (this._adapter.limits.maxUniformBuffersPerShaderStage) {
      requiredLimits["maxUniformBuffersPerShaderStage"] =
        this._adapter.limits.maxUniformBuffersPerShaderStage;
    }
    if (this._adapter.limits.maxStorageBuffersPerShaderStage) {
      requiredLimits["maxStorageBuffersPerShaderStage"] =
        this._adapter.limits.maxStorageBuffersPerShaderStage;
    }
    if (this._adapter.limits.maxStorageBufferBindingSize) {
      requiredLimits["maxStorageBufferBindingSize"] =
        this._adapter.limits.maxStorageBufferBindingSize;
    }
    if (this._adapter.limits.maxComputeWorkgroupStorageSize) {
      requiredLimits["maxComputeWorkgroupStorageSize"] =
        this._adapter.limits.maxComputeWorkgroupStorageSize;
    }
    if (this._adapter.limits.maxBindGroups) {
      requiredLimits["maxBindGroups"] = this._adapter.limits.maxBindGroups;
    }
    if (this._adapter.limits.maxBindingsPerBindGroup) {
      requiredLimits["maxBindingsPerBindGroup"] = this._adapter.limits.maxBindingsPerBindGroup;
    }
    if (this._adapter.limits.maxTextureDimension2D) {
      requiredLimits["maxTextureDimension2D"] = this._adapter.limits.maxTextureDimension2D;
    }
    if (this._adapter.limits.maxUniformBufferBindingSize) {
      requiredLimits["maxUniformBufferBindingSize"] =
        this._adapter.limits.maxUniformBufferBindingSize;
    }
    // Without this, `maxBufferSize` silently defaults to the spec minimum of 256MB even when
    // `maxStorageBufferBindingSize` was requested (and granted) much higher above -- so a large
    // enough clustered-lighting index buffer (see `_allocateClusterBuffers()`, sized from canvas
    // width/height) can pass that guard yet still exceed this separate, unrequested ceiling.
    if (this._adapter.limits.maxBufferSize) {
      requiredLimits["maxBufferSize"] = this._adapter.limits.maxBufferSize;
    }

    this._device = await this._adapter.requestDevice({
      requiredLimits,
      // Block-compressed texture upload (`Texture.compressedImage`) needs the device's
      // texture-compression feature. Each is optional at renderer level: the loader may
      // still produce compressed textures in formats the current renderer cannot upload,
      // so the upload path (`GPUTextureResourceCache`) validates availability at use time.
      requiredFeatures: (
        ["texture-compression-bc", "texture-compression-etc2", "texture-compression-astc"] as const
      ).filter((feature) => this._adapter!.features.has(feature)),
    });
    this._isDeviceLost = false;
    this._isDestroyed = false;

    // Listen for device lost (GPU hangs, driver resets, device destruction).
    this._device.lost.then((info: GPUDeviceLostInfo) => {
      this._isDeviceLost = true;
      if (!this._isDestroyed) {
        console.error(`[WebGPU Device Lost] Reason: ${info.reason}, Message: ${info.message}`);
        this.onContextLost?.({ reason: info.reason, message: info.message });
      }
    });

    // Update DeviceCaps with actual WebGPU limits. `maxSampledTexturesPerShaderStage` deliberately
    // goes into its own `webgpuMaxSampledTexturesPerStage` field, NOT the shared
    // `maxTextureImageUnits` -- that field is `Math.max()`'d against WebGL1/WebGL2 probes taken
    // unconditionally at `DeviceCaps.init()`, so a higher WebGL number could mask a lower real
    // WebGPU one (exactly how a 20-texture WebGPU bind group went undetected on a device whose
    // WebGL2 context happened to report more texture units than this API actually allows).
    this.context.deviceCaps.updateLimits({
      maxTextureSize: this._device.limits.maxTextureDimension2D,
      maxUniformBufferSize: this._device.limits.maxUniformBufferBindingSize,
      webgpuMaxSampledTexturesPerStage: this._device.limits.maxSampledTexturesPerShaderStage,
      webgpuMaxSamplersPerStage: this._device.limits.maxSamplersPerShaderStage,
      webgpuMaxBindGroups: this._device.limits.maxBindGroups,
      webgpuMaxBindingsPerBindGroup: this._device.limits.maxBindingsPerBindGroup,
      webgpuMaxUniformBufferBindingSize: this._device.limits.maxUniformBufferBindingSize,
      webgpuMaxStorageBufferBindingSize: this._device.limits.maxStorageBufferBindingSize,
      webgpuMaxComputeWorkgroupStorageSize: this._device.limits.maxComputeWorkgroupStorageSize,
      webgpuMaxTextureDimension2D: this._device.limits.maxTextureDimension2D,
    });

    // Add uncapturederror listener
    this._device.onuncapturederror = (event: GPUUncapturedErrorEvent): void => {
      console.error("[WebGPU Error]:", event.error.message);
    };

    if (config?.quality) {
      this._quality = { ...this._quality, ...config.quality };
    }
    this._resolveNormalBufferOption();
    if (config?.postProcessing) {
      this.postProcessing.loadConfig(config.postProcessing);
    }
    this._occlusionCullingEnabled = config?.enableOcclusionCulling === true;

    this._context = canvas.getContext("webgpu") as GPUCanvasContext;
    this._format = navigator.gpu.getPreferredCanvasFormat();
    this._context.configure({
      device: this._device,
      format: this._format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: "premultiplied",
    });

    this._initDefaultResources();
    this._initGlobalBuffers();
    this.setSize(canvas.clientWidth, canvas.clientHeight);

    this._passes = [
      new ClusterCullPassGPU(),
      new CascadedShadowPassGPU(),
      new SpotShadowPassGPU(),
      new DepthPrePassGPU(),
      ...(this._occlusionCullingEnabled ? [new HzbOcclusionPassGPU()] : []),
      new MainRenderPass(),
      new PostProcessPass(),
    ];
  }

  /**
   * Adds a render pass to the pipeline.
   * @param pass The pass to add.
   */
  public addPass(pass: RenderPass): void {
    this._passes.push(pass);
  }

  /**
   * Lazily creates (once) or returns the effect pass registered under `type` -- the renderer's
   * single orchestration point for GPU post-effect passes (see `_postEffectPasses` and the
   * `PostEffectPass` contract in ADR 0037). The same pass instance is reused across frames so its
   * history buffers survive; `destroy()` tears every registry entry down in one sweep.
   */
  private _getOrCreatePostEffectPass(
    type: PostProcessingEffectType,
    ctor: new (device: GPUDevice) => PostEffectPass,
  ): PostEffectPass {
    let pass = this._postEffectPasses.get(type);
    if (!pass) {
      pass = new ctor(this._device!);
      this._postEffectPasses.set(type, pass);
    }
    return pass;
  }

  private _initDefaultResources(): void {
    this._fallback = new GPUFallbackResources(this._device!);
    this._textures = new GPUTextureResourceCache(this._device!, this._fallback);
    this._targetCache = new GPURenderTargetCache(this._device!, this._textures);
    this._geometryCache = new GPUGeometryCache(this._device!);
    this._opaqueCapture = new OpaqueCapture(this._device!, this._fallback);

    this._boneMatricesBuffer = this._device!.createBuffer({
      size: 2048 * 64, // 2048 mat4x4f = 131072 bytes
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private _initGlobalBuffers(): void {
    this._globalUniformWriter = new GlobalUniformWriter(this);
    this._globalUniformWriter.init(this._device!);

    this._globalBGL = this._device!.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          texture: { viewDimension: "cube" },
        },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "cube" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d" } },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          sampler: { type: "filtering" },
        },
        {
          binding: 8,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d-array", sampleType: "depth" },
        },
        // Spot shadow map + comparison sampler: also read by the volumetric fog injection (compute).
        {
          binding: 9,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          texture: { viewDimension: "2d-array", sampleType: "depth" },
        },
        {
          binding: 10,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          sampler: { type: "comparison" },
        },
        // Clustered light culling (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md):
        // ClusterCullPassGPU (compute) writes these, the main fragment shader only reads them.
        {
          binding: 11,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 12,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 13,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 14,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 15,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    // _allocateClusterBuffers() below already creates the initial _globalBindGroup.
    this._allocateClusterBuffers({ x: 1, y: 1, z: 1 }, 1);

    const clusterCullModule = this._device!.createShaderModule({
      code:
        this._computeStructsChunk() +
        "\n" +
        (this.context.shaderRegistry.getChunk("WGSL_SCREEN_FOOTPRINT", "wgsl") ?? "") +
        "\n" +
        clusterCullWGSL,
    });
    this._clusterCullPipeline = this._device!.createComputePipeline({
      layout: this._device!.createPipelineLayout({ bindGroupLayouts: [this._globalBGL] }),
      compute: { module: clusterCullModule, entryPoint: "cullLights" },
    });

    this._objectBGL = this._device!.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
      ],
    });
    this._objectRing = new GPUObjectRingBuffer(this._device!, this._objectBGL);

    // Per-draw view-projection dynamic-offset buffer -- vertex-stage only (position transform),
    // unlike `_objectBGL` which the fragment shader also reads.
    this._viewBGL = this._device!.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
      ],
    });
    const viewAlignment = this._device!.limits.minUniformBufferOffsetAlignment;
    this._viewUniformStride = Math.ceil(64 / viewAlignment) * viewAlignment; // 64B = one mat4x4f
    this._viewUniformBuffer = this._device!.createBuffer({
      size: VIEW_SLOT_COUNT * this._viewUniformStride,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._viewBindGroup = this._device!.createBindGroup({
      layout: this._viewBGL,
      entries: [
        {
          binding: 0,
          resource: { buffer: this._viewUniformBuffer, offset: 0, size: this._viewUniformStride },
        },
      ],
    });

    this._pipelineCache = new GPUPipelineCache(
      this._device!,
      this.context.deviceCaps,
      this._globalBGL,
      this._objectBGL,
      this._viewBGL,
      this.context.shaderRegistry,
    );

    // Hierarchical-Z occlusion culling -- see docs/adr/0008-hzb-occlusion-culling-webgpu-only.md.
    // Everything here is opt-in: skipped entirely (zero pipelines/buffers created) unless
    // `enableOcclusionCulling` was set at init. `_hzbTexture` itself is allocated in `setSize()`,
    // once the canvas's real dimensions are known.
    if (this._occlusionCullingEnabled) {
      // Mip 0 seed: this frame's `_depthTexture` (depth32float, not storage-bindable) copied
      // into the HZB pyramid's own r32float storage texture.
      this._hzbCopyBGL = this._device!.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "depth" } },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: "write-only", format: "r32float" },
          },
        ],
      });
      this._hzbCopyPipeline = this._device!.createComputePipeline({
        layout: this._device!.createPipelineLayout({ bindGroupLayouts: [this._hzbCopyBGL] }),
        compute: {
          module: this._device!.createShaderModule({ code: hzbCopyDepthWGSL }),
          entryPoint: "copyDepthToHzb",
        },
      });

      // Rest of the pyramid: max-reduce mip L-1 into mip L, one dispatch per level (see
      // `_buildHzbPyramid()`).
      this._hzbDownsampleBGL = this._device!.createBindGroupLayout({
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
      this._hzbDownsamplePipeline = this._device!.createComputePipeline({
        layout: this._device!.createPipelineLayout({ bindGroupLayouts: [this._hzbDownsampleBGL] }),
        compute: {
          module: this._device!.createShaderModule({ code: hzbDownsampleMaxWGSL }),
          entryPoint: "downsampleMax",
        },
      });

      // Visibility test: group 0 is the same shared `GlobalUniforms` bind group every material
      // shader uses (for `global.vp`/`global.viewPos`/`global.projScale`/`global.resolution`),
      // group 1 is this test's own AABB/HZB-texture/results/params bindings.
      this._hzbTestBGL = this._device!.createBindGroupLayout({
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
      const hzbTestModule = this._device!.createShaderModule({
        code:
          this._computeStructsChunk() +
          "\n" +
          (this.context.shaderRegistry.getChunk("WGSL_SCREEN_FOOTPRINT", "wgsl") ?? "") +
          "\n" +
          hzbVisibilityTestWGSL,
      });
      this._hzbTestPipeline = this._device!.createComputePipeline({
        layout: this._device!.createPipelineLayout({
          bindGroupLayouts: [this._globalBGL, this._hzbTestBGL],
        }),
        compute: { module: hzbTestModule, entryPoint: "testVisibility" },
      });

      this._hzbAabbBuffer = this._device!.createBuffer({
        size: MAX_HZB_TESTED_OBJECTS * 16, // vec4f (center.xyz, radius) per object
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this._hzbResultsBuffer = this._device!.createBuffer({
        size: MAX_HZB_TESTED_OBJECTS * 4, // one u32 per object
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      this._hzbTestParamsBuffer = this._device!.createBuffer({
        size: 16, // HzbTestParams: objectCount/mipCount/pad0/pad1, 4x u32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this._hzbStagingBuffers = [
        this._device!.createBuffer({
          size: MAX_HZB_TESTED_OBJECTS * 4,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
        this._device!.createBuffer({
          size: MAX_HZB_TESTED_OBJECTS * 4,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
      ];
    }
  }

  /** Writes an already ZO-corrected view-projection matrix into `slot`'s bytes. Called by
   * `GlobalUniformWriter` for the once-per-frame main-camera slot 0 write, and by `_setViewMatrix`. */
  public _writeViewSlot(slot: number, correctedVpData: Float32Array): number {
    const offset = slot * this._viewUniformStride;
    this._device!.queue.writeBuffer(this._viewUniformBuffer, offset, correctedVpData);
    return offset;
  }

  /** Writes `rawVp` (a raw, not-yet-ZO-corrected view-projection matrix) into the per-draw view
   * buffer at `slot` and returns the byte offset to pass as `setBindGroup(3, viewBindGroup,
   * [offset])`. Used by `CascadedShadowPassGPU`/`SpotShadowPassGPU` for their shadow cameras --
   * the main camera's slot 0 is kept up to date by `GlobalUniformWriter.update()` instead, once
   * per frame, since every draw needs it regardless of pass. */
  public _setViewMatrix(slot: number, rawVp: Float32Array): number {
    const raw = MathPool.acquireMatrix();
    const corrected = MathPool.acquireMatrix();
    raw.data.set(rawVp);
    Matrix4.multiply(Matrix4.ZO_CORRECTION, raw, corrected);
    const offset = this._writeViewSlot(slot, corrected.data);
    MathPool.releaseMatrix(raw);
    MathPool.releaseMatrix(corrected);
    return offset;
  }

  /** Reused every frame -- see `_dispatchHzbTest()`. */
  private _hzbAabbScratch = new Float32Array(MAX_HZB_TESTED_OBJECTS * 4);
  private _hzbParamsScratch = new Uint32Array(4);

  /** (Re)builds the bind groups `_buildHzbPyramid()`/`_dispatchHzbTest()` use, once per
   * `setSize()` call instead of once per frame -- every resource they bind only ever changes on
   * resize (see `_hzbCopyBindGroup`'s doc comment). Called from `setSize()` right after
   * `_hzbTexture`/`_hzbSampledView` are (re)allocated there. */
  private _rebuildHzbBindGroups(): void {
    if (!this._device) return;

    if (this._hzbCopyBGL && this._hzbTexture) {
      this._hzbCopyBindGroup = this._device.createBindGroup({
        layout: this._hzbCopyBGL,
        entries: [
          { binding: 0, resource: this.activeDepthView },
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
   * Builds this frame's HZB pyramid: mip 0 seeded from `_depthTexture` (this frame's
   * just-finished opaque depth, already written by `DepthPrePassGPU` earlier in `_passes`), then
   * mips 1..N max-reduced from the level below, one dispatch per level -- see
   * hzb_copy_depth.wgsl/hzb_downsample_max.wgsl. Recorded into the frame's shared command
   * encoder: unlike `GPUTextureResourceCache`'s texture mip generation (which needs its own
   * throwaway encoder+submit since
   * callers run it mid-frame while a render pass may already be open), this runs between two
   * whole passes, never inside one. No-ops for offscreen render targets -- see
   * docs/adr/0008-hzb-occlusion-culling-webgpu-only.md's main-canvas-only scope.
   */
  public _buildHzbPyramid(ce: GPUCommandEncoder): void {
    if (this._activeRenderTarget) return;
    if (!this._hzbTexture || !this._hzbCopyPipeline || !this._hzbCopyBindGroup) return;

    const w0 = this._context.canvas.width;
    const h0 = this._context.canvas.height;
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
   * that already-collected list, NOT a second scene-tree walk -- see `_dispatchHzbTest()`'s doc
   * comment for why this doesn't read one of `FrustumCuller`'s output fields instead, and
   * why relying on `DepthPrePassGPU` having already run this frame is safe (it's fixed earlier
   * than `HzbOcclusionPassGPU` in `WebGPURenderer`'s `_passes` array).
   *
   * `obj.bounds` is only kept current by `Scene.updateDynamicOctree()`/`updateStaticOctree()`,
   * which don't run unless the scene actually has octrees enabled -- otherwise the only thing
   * that ever populates it is a one-off `computeBounds()` call (e.g. `GadgetInspector`'s
   * constructor-time overview refresh, which runs before the object's first
   * `updateMatrixWorld()`), leaving every candidate's world-space bounds frozen wherever it was
   * at that moment. Recomputing here against the object's already-current-for-this-frame
   * `worldMatrix` (updated earlier in `Scene.update()`) keeps the HZB test correct regardless of
   * whether octrees are in use. */
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
   * spheres, dispatches the visibility test compute shader against the pyramid
   * `_buildHzbPyramid()` just built, and copies the results into whichever staging buffer slot
   * isn't still waiting on a previous `mapAsync()`.
   *
   * The candidate list is derived from `scene.lastFrustumVisibleObjects` (`isVisible && inFrustum`,
   * same condition `FrustumCuller`'s own fallback path uses -- see `_collectHzbCandidates()`)
   * rather than reading any of `FrustumCuller`'s output fields: this renderer only holds a
   * `scene`, not the owning `SmallWorldMachine`'s private culler instance. Reading `scene`'s own
   * per-instance list keeps the candidate list scoped to the scene actually being rendered, without
   * coupling the renderer to whichever culler instance drove this frame.
   *
   * Only one slot is ever in flight at a time (the two alternate every frame -- see
   * `_hzbStagingBuffers`'s doc comment); if THAT slot is still pending, this frame's test is
   * skipped entirely rather than stalling on it. Objects simply keep last frame's
   * `occlusionCulled` value one frame longer -- never blocking, matches the same "skip and
   * self-correct next frame" pattern `_getObjectSlotOffset()`'s ring-buffer overflow clamp uses.
   */
  public _dispatchHzbTest(ce: GPUCommandEncoder, scene: Scene): void {
    if (this._activeRenderTarget) return;
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

    const objects: Object3D[] = [];
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

    this._device!.queue.writeBuffer(this._hzbAabbBuffer, 0, this._hzbAabbScratch, 0, count * 4);
    this._hzbParamsScratch[0] = count;
    this._hzbParamsScratch[1] = this._hzbMipLevelCount;
    this._hzbParamsScratch[2] = 0;
    this._hzbParamsScratch[3] = 0;
    this._device!.queue.writeBuffer(this._hzbTestParamsBuffer, 0, this._hzbParamsScratch);

    const pass = ce.beginComputePass({ label: "HzbVisibilityTest" });
    pass.setPipeline(this._hzbTestPipeline);
    pass.setBindGroup(0, this._globalBindGroup);
    pass.setBindGroup(1, this._hzbTestBindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();

    ce.copyBufferToBuffer(this._hzbResultsBuffer, 0, this._hzbStagingBuffers[slot], 0, count * 4);
    this._hzbSlotObjects[slot] = objects;
    this._hzbCopyRecordedThisFrame = true;
  }

  /** Fires off `mapAsync()` on whichever staging slot this frame's `_dispatchHzbTest()` just
   * copied into, then flips to the other slot for next frame. Fire-and-forget -- the promise
   * itself is never awaited or chained here. `applyPendingOcclusionResults()` doesn't rely on it
   * either: it polls `buffer.mapState` directly every frame instead of waiting on the promise to
   * resolve (see that method's doc comment for why). Called once, right after `queue.submit()`,
   * so the copy is guaranteed to have actually happened before mapping is requested. */
  private _kickoffHzbMapAsync(): void {
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
  public override applyPendingOcclusionResults(_scene: Scene): void {
    if (!this._occlusionCullingEnabled || !this._hzbStagingBuffers) return;

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

  public _createGlobalBindGroup(scene?: Scene): GPUBindGroup {
    const irrView = scene?.irradianceMap
      ? this._textures.getCubeTextureView(scene.irradianceMap, this._quality)
      : this._fallback.blackCubeTextureView!;
    const prefView = scene?.prefilterMap
      ? this._textures.getCubeTextureView(scene.prefilterMap, this._quality)
      : this._fallback.blackCubeTextureView!;
    const brdfView = scene?.brdfLUT
      ? this._textures.getTextureView(scene.brdfLUT, this._quality)
      : this._fallback.defaultBrdfTextureView!;
    const sampler = this._textures.getSampler(scene?.brdfLUT, undefined); // Use default sampler for global maps

    return this._device!.createBindGroup({
      layout: this._globalBGL,
      entries: [
        { binding: 0, resource: { buffer: this._globalUniformWriter.globalUniformBuffer } },
        { binding: 1, resource: { buffer: this._globalUniformWriter.pointLightBuffer } },
        { binding: 2, resource: { buffer: this._globalUniformWriter.spotLightBuffer } },
        { binding: 3, resource: { buffer: this._globalUniformWriter.areaLightBuffer } },
        { binding: 4, resource: irrView },
        { binding: 5, resource: prefView },
        { binding: 6, resource: brdfView },
        { binding: 7, resource: sampler },
        { binding: 8, resource: this._fallback.defaultDirShadowTextureView },
        { binding: 9, resource: this._fallback.defaultSpotShadowTextureView },
        { binding: 10, resource: this._fallback.shadowSampler },
        { binding: 11, resource: { buffer: this._pointClusterGridBuffer } },
        { binding: 12, resource: { buffer: this._pointClusterIndexBuffer } },
        { binding: 13, resource: { buffer: this._spotClusterGridBuffer } },
        { binding: 14, resource: { buffer: this._spotClusterIndexBuffer } },
        { binding: 15, resource: { buffer: this._boneMatricesBuffer } },
      ],
    });
  }

  /**
   * (Re)allocates the clustered-light-culling storage buffers for the given grid size and
   * rebuilds the global bind group to reference them -- see
   * docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md. Resetting `_currentIrradianceMap`
   * etc. (via `GlobalUniformWriter.resetSceneTextures()`) forces `GlobalUniformWriter.update()`
   * to rebuild the bind group again on the next frame with
   * the scene's real IBL textures (this method has no `Scene` to pull them from itself).
   * @param dims Cluster grid dimensions.
   * @param maxLightsPerCluster Maximum number of lights a single cluster cell can reference.
   */
  private _allocateClusterBuffers(dims: ClusterGridDims, maxLightsPerCluster: number): void {
    const numClusters = Math.max(1, dims.x * dims.y * dims.z);
    let safeMaxLights = Math.max(1, maxLightsPerCluster);

    // Guard against driver limits (e.g. on mobile/integrated GPUs): a buffer this size must fit
    // under BOTH `maxStorageBufferBindingSize` (the storage-binding-specific cap) AND the
    // separate, general-purpose `maxBufferSize` -- `initialize()` requests both as high as the
    // adapter allows, but a large enough canvas can still exceed even a generous `maxBufferSize`.
    const maxStorageSize = this._device?.limits.maxStorageBufferBindingSize ?? 134217728;
    const maxBufferSize = this._device?.limits.maxBufferSize ?? 268435456;
    const maxAllowedSize = Math.min(maxStorageSize, maxBufferSize);
    let gridByteLength = numClusters * 8; // vec2u
    let indexByteLength = numClusters * safeMaxLights * 4; // u32

    if (indexByteLength > maxAllowedSize && numClusters > 0) {
      safeMaxLights = Math.max(1, Math.floor(maxAllowedSize / (numClusters * 4)));
      indexByteLength = numClusters * safeMaxLights * 4;
      console.warn(
        `[WebGPURenderer] Clustered lights buffer exceeded this device's buffer size limits. Clamped maxLightsPerCluster to ${safeMaxLights}.`,
      );
    }

    if (gridByteLength > maxAllowedSize) {
      gridByteLength = maxAllowedSize;
      console.warn(
        `[WebGPURenderer] Clustered grid buffer exceeded this device's buffer size limits. Clamping buffer size.`,
      );
    }

    // Commands recorded earlier this frame may still reference the replaced buffers, so they are
    // destroyed after the frame's `queue.submit()` (see `drainPendingDestroy()`). Bind groups that
    // copied the old buffers (the shadow passes' caster groups) rebuild on `globalResourcesVersion`.
    for (const old of [
      this._pointClusterGridBuffer,
      this._pointClusterIndexBuffer,
      this._spotClusterGridBuffer,
      this._spotClusterIndexBuffer,
    ]) {
      if (old) this._fallback.deferDestroyBuffer(old);
    }

    this._pointClusterGridBuffer = this._device!.createBuffer({
      size: gridByteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._pointClusterIndexBuffer = this._device!.createBuffer({
      size: indexByteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._spotClusterGridBuffer = this._device!.createBuffer({
      size: gridByteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._spotClusterIndexBuffer = this._device!.createBuffer({
      size: indexByteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this._clusterDims = dims;
    this._clusterMaxLightsPerCluster = safeMaxLights;
    this._globalResourcesVersion++;

    if (this._globalBGL) {
      this._globalBindGroup = this._createGlobalBindGroup();
      // Resetting the IBL-change detection forces `GlobalUniformWriter.update()` to rebuild the
      // bind group again on the next frame with the scene's real IBL textures (this method has no
      // `Scene` to pull them from itself).
      this._globalUniformWriter.resetSceneTextures();
    }
  }

  private _releaseObjectResources(obj: Object3D): void {
    this._geometryCache.releaseGeometryFor(obj);
    this._pipelineCache.releasePipelineFor(obj);
    this._textures.releaseObjectTextures(obj);
  }

  /**
   * Tracks that `obj` currently depends on the textures in `textures` (typically
   * `material.getRenderManifest().textures`). Called once per object per frame from
   * the render loop. `textures` is diffed key-by-key against `obj`'s last-known
   * snapshot rather than by container reference, since a material's manifest object
   * is created once and mutated in place on every `getRenderManifest()` call.
   */
  public render(
    scene: Scene,
    vp: Float32Array,
    camPos: Vector3D = Vector3D.ZERO,
    vMat?: Float32Array,
    near: number = 0.1,
    far: number = 1000,
    projMatrix?: Float32Array,
  ): void {
    if (!this._device || this._isDeviceLost) return;

    for (const obj of scene.consumeRemovedObjects()) {
      this._releaseObjectResources(obj);
    }

    this._frameCount++;

    this._objectRing.beginFrame();
    this._gpuBoneMatricesOffset = 0;
    this._boneSlotMap.clear();

    this._registerRenderListProviders(scene.getVisibleObjectsSorted(vp, camPos));
    const lights = this.extractLights(scene);
    this._globalUniformWriter.update(vp, camPos, lights, scene, near, far, projMatrix);
    const ce = this._device.createCommandEncoder();

    if (
      this.postProcessing.enabled &&
      !this._hdrTexture &&
      this._context.canvas.width > 0 &&
      this._context.canvas.height > 0
    ) {
      // Guarded the same way as setSize() -- if this fires before the canvas has its real size
      // (e.g. the first frame, before the ResizeObserver's initial callback lands), creating a
      // degenerate 0/1px _hdrTexture here would make BloomPassGPU build an invalid mip chain on
      // it. Skipping keeps postProcessing off for that one frame; the next frame retries once
      // the canvas has a real size.
      this._hdrTexture = this._device.createTexture({
        size: [this._context.canvas.width, this._context.canvas.height],
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });
      this._hdrTextureView = this._hdrTexture.createView();
    } else if (!this.postProcessing.enabled && this._hdrTexture) {
      this._fallback.deferDestroyTexture(this._hdrTexture);
      this._hdrTexture = undefined;
      this._hdrTextureView = undefined;
    }

    if (!this._activeRenderTarget && scene.getVisibleObjectsSorted(vp, camPos).decals.length > 0) {
      this.requestNormalBuffer();
    }
    this._syncNormalTexture();

    let renderTargetView: GPUTextureView;
    let isOffscreen = false;

    if (this._activeRenderTarget) {
      isOffscreen = true;
      renderTargetView = this._targetCache.getActiveTargetView(
        this._activeRenderTarget,
        this._format,
        this._activeCubeFace,
      );
    } else {
      renderTargetView =
        this.postProcessing.enabled && this._hdrTextureView
          ? this._hdrTextureView
          : this._context.getCurrentTexture().createView();
    }

    const bloomNode = this.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    const hbaoNode = this.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    const taaNode = this.postProcessing.get<TaaElement>(PostProcessingEffectType.TAA);
    const motionTrailNode = this.postProcessing.get<MotionTrailElement>(
      PostProcessingEffectType.MOTION_TRAIL,
    );

    // Reused per frame -- see the `PostEffectPassContext` reuse contract. Fields that vary per
    // effect (`colorView`, `element`, `fogVolumes`) are repopulated immediately before each
    // dispatch below; everything else is refreshed once here.
    const ctx = this._postEffectCtx;
    ctx.ce = ce;
    ctx.width = this._context.canvas.width;
    ctx.height = this._context.canvas.height;
    ctx.vp = vp;
    ctx.vMat = vMat;
    ctx.camPos = camPos;
    ctx.near = near;
    ctx.far = far;
    ctx.projMatrix = projMatrix;
    ctx.lights = lights;
    ctx.colorTexture = this._hdrTexture;
    ctx.depthView = this._opaqueCapture.opaqueDepthView ?? this._fallback.dummyDepthTextureView;

    for (const pass of this._passes) {
      const isPostProcessPass = pass instanceof PostProcessPass;

      if (isPostProcessPass && isOffscreen) {
        continue;
      }

      // The entire effect orchestration lives in the renderer's single `PostEffectPass` registry
      // (`Map<PostProcessingEffectType, PostEffectPass>`, see `_getOrCreatePostEffectPass` /
      // ADR 0037) -- one create/execute/destroy path for every GPU effect pass, no per-effect
      // `_xxxPassGPU` fields.
      if (isPostProcessPass) {
        // TAA resolves first, if enabled: Bloom and the final uber pass should react to the
        // temporally-smoothed color, not the raw per-frame jittered one. `_hdrTextureView` itself
        // is never reassigned, so this pass keeps reading fresh input every subsequent frame.
        if (taaNode && taaNode.enabled && this._hdrTextureView) {
          ctx.colorView = this._hdrTextureView;
          ctx.element = taaNode;
          const p = this._getOrCreatePostEffectPass(
            PostProcessingEffectType.TAA,
            HistoryBlendPassGPU,
          );
          this._taaResolvedView = p.execute(ctx) ?? undefined;
        } else {
          this._taaResolvedView = undefined;
        }

        // Motion Trail: a deliberate ghost/afterimage look, not anti-aliasing -- reuses the same
        // history-blend pass as TAA (its own separate instance/history buffer), chained after TAA.
        const taaOrRawView = this._taaResolvedView ?? this._hdrTextureView;
        if (motionTrailNode && motionTrailNode.enabled && taaOrRawView) {
          ctx.colorView = taaOrRawView;
          ctx.element = motionTrailNode;
          const p = this._getOrCreatePostEffectPass(
            PostProcessingEffectType.MOTION_TRAIL,
            HistoryBlendPassGPU,
          );
          this._motionTrailResolvedView = p.execute(ctx) ?? undefined;
        } else {
          this._motionTrailResolvedView = undefined;
        }

        const colorTextureView = this._motionTrailResolvedView ?? taaOrRawView;

        if (bloomNode && bloomNode.enabled && this._hdrTexture && colorTextureView) {
          ctx.colorView = colorTextureView;
          ctx.element = bloomNode;
          const p = this._getOrCreatePostEffectPass(PostProcessingEffectType.BLOOM, BloomPassGPU);
          this._bloomTextureView = p.execute(ctx) ?? undefined;
        } else {
          this._bloomTextureView = undefined;
        }

        if (hbaoNode && hbaoNode.enabled && this._opaqueCapture.opaqueDepthView && projMatrix) {
          ctx.element = hbaoNode;
          const p = this._getOrCreatePostEffectPass(PostProcessingEffectType.HBAO, AOPassGPU);
          this._hbaoTextureView = p.execute(ctx) ?? undefined;
        } else {
          this._hbaoTextureView = undefined;
        }

        const shaftsNode = this.postProcessing.get<LightShaftsElement>(
          PostProcessingEffectType.LIGHT_SHAFTS,
        );
        if (
          shaftsNode &&
          shaftsNode.enabled &&
          this._opaqueCapture.opaqueDepthView &&
          lights.dLight
        ) {
          ctx.element = shaftsNode;
          const p = this._getOrCreatePostEffectPass(
            PostProcessingEffectType.LIGHT_SHAFTS,
            LightShaftsPassGPU,
          );
          this._lightShaftsTextureView = p.execute(ctx) ?? undefined;
        } else {
          this._lightShaftsTextureView = undefined;
        }

        // Volumetric fog: froxel inject -> temporal reprojection -> in-register integration (incl.
        // directional/CSM sunlight) -> single-tap composite; PostProcessPass attenuates the scene by
        // the transmittance and adds the in-scattering before tonemapping (ADR 0031).
        const volFogNode = this.postProcessing.get<VolumetricFogElement>(
          PostProcessingEffectType.VOLUMETRIC_FOG,
        );
        if (volFogNode && volFogNode.enabled && this._opaqueCapture.opaqueDepthView) {
          ctx.element = volFogNode;
          ctx.fogVolumes = this.extractFogVolumes(scene);
          const p = this._getOrCreatePostEffectPass(
            PostProcessingEffectType.VOLUMETRIC_FOG,
            VolumetricFogPassGPU,
          );
          this._volumetricFogTextureView = p.execute(ctx) ?? undefined;
        } else {
          this._volumetricFogTextureView = undefined;
        }
      }

      // Re-widen to the RenderPass interface: TS's control-flow analysis narrows `pass` towards
      // `PostProcessPass` from the `isPostProcessPass` checks above, which would otherwise
      // resolve this call against PostProcessPass's own (shorter, vMat-less) execute() overload
      // instead of the interface's.
      const nextPass: RenderPass = pass;
      nextPass.execute(this, scene, ce, renderTargetView, vp, camPos, vMat);
    }

    this._device.queue.submit([ce.finish()]);

    this._objectRing.endFrame();
    this._fallback.drainPendingDestroy();
    if (this._occlusionCullingEnabled) this._kickoffHzbMapAsync();
  }

  public captureOpaqueTexture(ce: GPUCommandEncoder, targetTex: GPUTexture): void {
    this._opaqueCapture.captureOpaqueTexture(ce, targetTex, this._activeRenderTarget);
  }

  private readonly _scratchClipToBox: Matrix4 = new Matrix4();
  private readonly _decalColumns: Float32Array[] = [
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
  ];
  private readonly _decalFlags: Float32Array = new Float32Array(4);

  /** Decals read the opaque depth beneath them, which only exists for the main camera target. */
  public get canDrawDecals(): boolean {
    return !this._activeRenderTarget;
  }

  /**
   * Copies the normal buffer into a sampleable texture (delegated to `OpaqueCapture`): it cannot
   * be read while it is still a render attachment of the pass that wrote it. No-op while the
   * buffer is off.
   */
  public captureOpaqueNormal(ce: GPUCommandEncoder): void {
    const src = this._normalTexture;
    if (!src) return; // normal buffer off
    this._opaqueCapture.captureOpaqueNormal(ce, src);
  }

  public captureOpaqueDepth(ce: GPUCommandEncoder): void {
    this._opaqueCapture.captureOpaqueDepth(ce, this.activeDepthTexture);
  }

  /**
   * The shared structs chunk for the compute shaders that include it directly (cluster culling, HZB
   * visibility test). Render pipelines get their per-pipeline constants from `GPUPipelineCache`;
   * the chunk's sampling helpers reference `USE_DECAL_GRADIENTS`, so compute modules declare it too.
   */
  private _computeStructsChunk(): string {
    const raw = this.context.shaderRegistry.getChunk("WGSL_STRUCTS", "wgsl") ?? "";
    const group0Only = raw.split("@group(1)")[0] ?? raw;
    return "const USE_DECAL_GRADIENTS: bool = false;\n" + group0Only;
  }

  /** Public access to the shared compute-structs chunk (global bindings + structs), for
   * renderer-owned extra compute passes such as the volumetric-fog injection. */
  public get computeStructsChunk(): string {
    return this._computeStructsChunk();
  }

  private _syncNormalTexture(): void {
    const width = this._context.canvas.width;
    const height = this._context.canvas.height;
    const wanted = this._quality.normalBuffer === true && width > 0 && height > 0;

    if (!wanted) {
      if (this._normalTexture) this._fallback.deferDestroyTexture(this._normalTexture);
      this._normalTexture = undefined;
      this._normalTextureView = undefined;
      return;
    }
    if (
      this._normalTexture &&
      this._normalTexture.width === width &&
      this._normalTexture.height === height
    ) {
      return;
    }

    if (this._normalTexture) this._fallback.deferDestroyTexture(this._normalTexture);
    this._normalTexture = this._device!.createTexture({
      size: [width, height],
      format: NORMAL_TARGET_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this._normalTextureView = this._normalTexture.createView();
  }

  public _renderBatch(
    rp: GPURenderPassEncoder,
    batch: RenderBatch,
    vMat?: Float32Array,
    normalMode: NormalTargetMode = NormalTargetMode.DEFAULT,
  ): void {
    const objects = batch.objects;
    if (objects.length === 0) return;

    rp.setBindGroup(0, this._globalBindGroup);

    const instancedObjects = this._scratchInstancedObjects;
    const standardObjects = this._scratchStandardObjects;
    instancedObjects.length = 0;
    standardObjects.length = 0;

    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (o instanceof InstancedMesh) {
        instancedObjects.push(o!);
      } else {
        standardObjects.push(o!);
      }
    }

    const mat = objects[0]?.material;
    if (!mat) return;
    const manifest = mat.getRenderManifest();
    const resolvedFlags = resolveManifestFlags(manifest.flags, this._quality.disableTextures);
    if (resolvedFlags) manifest.flags = resolvedFlags;

    let topologyStr: GPUPrimitiveTopology = Topology.DEFAULT;
    if (batch.topology === Topology.POINT_LIST) topologyStr = Topology.POINT_LIST;
    else if (batch.topology === Topology.LINE_LIST) topologyStr = Topology.LINE_LIST;
    else if (batch.topology === Topology.LINE_STRIP) topologyStr = Topology.LINE_STRIP;

    // Slot 0 = main camera, always offset 0 -- see VIEW_SLOT_MAIN_CAMERA.
    const viewOffset = VIEW_SLOT_MAIN_CAMERA * this._viewUniformStride;

    if (standardObjects.length > 0) {
      this._renderSubgroup(
        rp,
        standardObjects,
        false,
        batch.matUuid,
        manifest,
        viewOffset,
        vMat,
        topologyStr,
        batch.wireframeMode,
        normalMode,
      );
    }

    if (instancedObjects.length > 0) {
      this._renderSubgroup(
        rp,
        instancedObjects,
        true,
        batch.matUuid,
        manifest,
        viewOffset,
        vMat,
        topologyStr,
        batch.wireframeMode,
        normalMode,
      );
    }
  }

  public _renderSubgroup(
    rp: GPURenderPassEncoder,
    objects: Object3D[],
    isInstanced: boolean,
    matUuid: string,
    manifest: RenderManifest,
    viewOffset: number,
    vMat?: Float32Array,
    topology: GPUPrimitiveTopology = Topology.DEFAULT,
    wireframeMode?: WireframeMode,
    normalMode: NormalTargetMode = NormalTargetMode.DEFAULT,
  ): void {
    // Per-instance RGBA color (e.g. particle tint) is a mesh opt-in; the generic `instanceData`
    // semantics (texture-array index) stay untouched for other meshes. It is injected on a local
    // manifest copy so the shared material manifest is not polluted for other batches.
    const useInstanceColor =
      isInstanced && objects[0] instanceof InstancedMesh && objects[0].useInstanceDataAsColor;
    let effManifest = manifest;
    if (useInstanceColor && !manifest.flags?.includes("USE_INSTANCE_COLOR")) {
      effManifest = {
        ...manifest,
        flags: [...(manifest.flags ?? []), "USE_INSTANCE_COLOR"],
      };
    }

    const targetFormat = this.currentColorTargetFormat;
    const cache = this._pipelineCache.getPipeline(
      effManifest,
      topology,
      isInstanced,
      targetFormat,
      normalMode,
    );
    const pipelineKey = this._pipelineCache.pipelineCacheKey(
      effManifest,
      topology,
      isInstanced,
      targetFormat,
      normalMode,
    );
    rp.setPipeline(cache.pipeline);

    const matBindGroup = this._getMaterialBindGroup(matUuid, manifest, cache.bgLayouts[1]!);
    rp.setBindGroup(1, matBindGroup);
    rp.setBindGroup(3, this._viewBindGroup, [viewOffset]);

    const usesVertexColor = effManifest.flags?.includes(VERTEX_COLOR_FLAG) === true;

    for (const obj of objects) {
      if (!obj.geometry) continue;

      this._pipelineCache.acquirePipeline(obj, pipelineKey);
      this._textures.acquireTextures(obj, manifest.textures);

      const objOffset = this._getObjectSlotOffset(obj, manifest, matUuid, vMat);
      rp.setBindGroup(2, this._objectRing.bindGroup, [objOffset]);

      const gCache = this._geometryCache.getGeoCache(obj, obj.geometry!);
      this._fallback.ensureDummyBufferSize(gCache.vertexCount);
      rp.setVertexBuffer(0, gCache.vb);
      rp.setVertexBuffer(1, gCache.nb || this._fallback.dummyNormalBuffer);
      rp.setVertexBuffer(2, gCache.uvb || this._fallback.dummyUvBuffer);
      rp.setVertexBuffer(3, gCache.tb || this._fallback.dummyTangentBuffer);
      rp.setVertexBuffer(4, gCache.jb || this._fallback.dummyJointsBuffer);
      rp.setVertexBuffer(5, gCache.wb || this._fallback.dummyWeightsBuffer);
      if (usesVertexColor) rp.setVertexBuffer(6, gCache.cb || this._fallback.dummyColorBuffer);

      if (isInstanced) {
        const instMesh = obj as InstancedMesh;
        if (instMesh.instanceCount < 0) {
          throw new Error(`[WebGPURenderer] Invalid instanceCount: ${instMesh.instanceCount}`);
        }
        if (instMesh.instanceMatrices.byteLength < instMesh.instanceCount * 64) {
          throw new Error(
            `[WebGPURenderer] InstancedMesh matrix buffer too small: required at least ${instMesh.instanceCount * 64} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceMatrices.byteLength} bytes.`,
          );
        }

        let instanceBuf = this._gpuInstanceBuffers.get(instMesh);
        const matrixByteLength = instMesh.instanceMatrices.byteLength;

        if (!instanceBuf || instanceBuf.size < matrixByteLength) {
          // Shadow and depth passes recorded earlier this frame may still use the old buffer.
          if (instanceBuf) this._fallback.deferDestroyBuffer(instanceBuf);
          instanceBuf = this._device!.createBuffer({
            size: matrixByteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          this._gpuInstanceBuffers.set(instMesh, instanceBuf);
          instMesh.instanceMatrixNeedsUpdate = true;
        }

        if (instMesh.instanceMatrixNeedsUpdate) {
          this._device!.queue.writeBuffer(instanceBuf, 0, instMesh.instanceMatrices);
          instMesh.instanceMatrixNeedsUpdate = false;
        }

        rp.setVertexBuffer(6, instanceBuf);

        // Instance Data
        if (instMesh.instanceData) {
          if (instMesh.instanceData.byteLength < instMesh.instanceCount * 16) {
            throw new Error(
              `[WebGPURenderer] InstancedMesh instanceData buffer too small: required at least ${instMesh.instanceCount * 16} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceData.byteLength} bytes.`,
            );
          }
          let instanceDataBuf = this._gpuInstanceDataBuffers.get(instMesh);
          const dataByteLength = instMesh.instanceData.byteLength;

          if (!instanceDataBuf || instanceDataBuf.size < dataByteLength) {
            if (instanceDataBuf) this._fallback.deferDestroyBuffer(instanceDataBuf);
            instanceDataBuf = this._device!.createBuffer({
              size: dataByteLength,
              usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this._gpuInstanceDataBuffers.set(instMesh, instanceDataBuf);
            instMesh.instanceDataNeedsUpdate = true;
          }

          if (instMesh.instanceDataNeedsUpdate) {
            this._device!.queue.writeBuffer(instanceDataBuf, 0, instMesh.instanceData);
            instMesh.instanceDataNeedsUpdate = false;
          }
          rp.setVertexBuffer(7, instanceDataBuf);
        } else {
          this._fallback.ensureDummyBufferSize(instMesh.instanceCount);
          rp.setVertexBuffer(7, this._fallback.dummyUvBuffer);
        }

        if (topology === Topology.LINE_LIST) {
          if (wireframeMode === WireframeMode.STRUCTURAL && gCache.wib) {
            rp.setIndexBuffer(gCache.wib, gCache.format!);
            rp.drawIndexed(gCache.wireframeIndexCount, instMesh.instanceCount);
          } else if (gCache.ib) {
            rp.setIndexBuffer(gCache.ib, gCache.format!);
            rp.drawIndexed(gCache.indexCount, instMesh.instanceCount);
          } else {
            rp.draw(gCache.vertexCount, instMesh.instanceCount);
          }
        } else {
          if (gCache.ib) {
            rp.setIndexBuffer(gCache.ib, gCache.format!);
            rp.drawIndexed(gCache.indexCount, instMesh.instanceCount);
          } else {
            rp.draw(gCache.vertexCount, instMesh.instanceCount);
          }
        }
      } else {
        if (topology === Topology.LINE_LIST) {
          if (wireframeMode === WireframeMode.STRUCTURAL && gCache.wib) {
            rp.setIndexBuffer(gCache.wib, gCache.format!);
            rp.drawIndexed(gCache.wireframeIndexCount);
          } else if (gCache.ib) {
            rp.setIndexBuffer(gCache.ib, gCache.format!);
            rp.drawIndexed(gCache.indexCount);
          } else {
            rp.draw(gCache.vertexCount);
          }
        } else if (gCache.ib) {
          rp.setIndexBuffer(gCache.ib, gCache.format!);
          rp.drawIndexed(gCache.indexCount);
        } else {
          rp.draw(gCache.vertexCount);
        }
      }
    }
  }

  /** Returns the byte offset into the object ring buffer holding `obj`'s `ObjectUniforms` for
   * this draw. Packs + uploads at most once per (object, material) per frame -- e.g. the same
   * shadow caster drawn across 4 CSM cascades (all sharing one `DepthMaterial` `matUuid`) reuses
   * the same slot instead of repacking. Sprites are excluded: their model matrix is billboarded
   * towards `vMat` (camera vs. light view differ per pass), so they always get a fresh slot. */
  protected _getObjectSlotOffset(
    obj: Object3D,
    m: RenderManifest,
    matUuid: string,
    vMat?: Float32Array,
  ): number {
    const isSprite = m.state?.isSprite === true;
    const key = isSprite ? undefined : `${obj.uuid}:${matUuid}`;
    const { offset, cached } = this._objectRing.acquireSlot(key);
    if (!cached && this._packObjectUniforms(obj, m, vMat)) {
      this._objectRing.write(offset, this._scratchObjBufferData);
    }
    return offset;
  }

  /** Packs `obj`'s `ObjectUniforms` into `_scratchObjBufferData`. Returns false (leaving the
   * scratch buffer untouched) if `m.shaderId` isn't registered -- caller then skips the upload,
   * matching the previous per-object-buffer behavior of leaving the slot's prior contents alone. */
  protected _packObjectUniforms(o: Object3D, m: RenderManifest, vMat?: Float32Array): boolean {
    const shaderDef = this.context.shaderRegistry.get(m.shaderId);
    if (!shaderDef) return false;

    this._scratchModelMatrix.set(o.worldMatrix.data);
    const state = m.state;
    if (state?.isSprite && vMat) {
      const sx = Math.sqrt(
        this._scratchModelMatrix[0]! ** 2 +
          this._scratchModelMatrix[1]! ** 2 +
          this._scratchModelMatrix[2]! ** 2,
      );
      const sy = Math.sqrt(
        this._scratchModelMatrix[4]! ** 2 +
          this._scratchModelMatrix[5]! ** 2 +
          this._scratchModelMatrix[6]! ** 2,
      );
      const sz = Math.sqrt(
        this._scratchModelMatrix[8]! ** 2 +
          this._scratchModelMatrix[9]! ** 2 +
          this._scratchModelMatrix[10]! ** 2,
      );
      this._scratchModelMatrix[0] = vMat[0]! * sx;
      this._scratchModelMatrix[1] = vMat[4]! * sx;
      this._scratchModelMatrix[2] = vMat[8]! * sx;
      this._scratchModelMatrix[4] = vMat[1]! * sy;
      this._scratchModelMatrix[5] = vMat[5]! * sy;
      this._scratchModelMatrix[6] = vMat[9]! * sy;
      this._scratchModelMatrix[8] = vMat[2]! * sz;
      this._scratchModelMatrix[9] = vMat[6]! * sz;
      this._scratchModelMatrix[10] = vMat[10]! * sz;
    }

    const values = this._scratchUniformValues;
    // Clear old values to avoid leaking without modifying the hidden class shape
    for (const k in values) {
      values[k] = undefined;
    }

    // Copy properties
    for (const k in m.properties) {
      values[k] = m.properties[k];
    }

    values["u_model"] = this._scratchModelMatrix;
    if (values["u_color"] === undefined && o.material) {
      this._scratchColorArray[0] = o.material.color?.r ?? 1.0;
      this._scratchColorArray[1] = o.material.color?.g ?? 1.0;
      this._scratchColorArray[2] = o.material.color?.b ?? 1.0;
      this._scratchColorArray[3] = o.material.color?.a ?? 1.0;
      values["u_color"] = this._scratchColorArray;
    }

    if (state?.isDecal) this._packDecalUniforms(o, values);

    if (isSkinnedMesh(o) && o.skeleton) {
      values["u_isSkinned"] = 1.0;
      values["u_boneOffset"] = this._getBoneMatrixOffset(o);
    } else {
      values["u_isSkinned"] = 0.0;
      values["u_boneOffset"] = 0.0;
    }

    UniformPacker.packInto(shaderDef.layout, values, this._scratchObjBufferData);
    return true;
  }

  /** Decal-only per-object values: the clip-space -> box-space matrix (as four vec4 columns) in
   * matParam0..3 and the "normal buffer copy is bound" flag in matParam5.y. */
  private _packDecalUniforms(o: Object3D, values: Record<string, unknown>): void {
    const clipToBox = this._scratchClipToBox;
    if (computeClipToBox(o.worldMatrix, this._globalUniformWriter.frameInvViewProj, clipToBox)) {
      for (let c = 0; c < 4; c++) {
        const column = this._decalColumns[c]!;
        for (let r = 0; r < 4; r++) column[r] = clipToBox.data[c * 4 + r]!;
        values[`u_matParam${c}`] = column;
      }
    }
    this._decalFlags[1] = this._opaqueCapture.opaqueNormalView && this.activeNormalView ? 1 : 0;
    values["u_matParam5"] = this._decalFlags;
  }

  protected _getBoneMatrixOffset(skinnedMesh: SkinnedMesh): number {
    const skel = skinnedMesh.skeleton;
    if (!skel || !skel.boneMatrices || skel.boneMatrices.length === 0) return 0;

    const cached = this._boneSlotMap.get(skel);
    if (cached !== undefined) return cached;

    const numMatrices = Math.min(skel.bones.length, MAX_SKINNED_BONES);
    if (this._gpuBoneMatricesOffset + numMatrices > 2048) {
      throw new Error(
        `[WebGPURenderer] Bone matrices buffer capacity exceeded: cannot allocate ${numMatrices} matrices (offset ${this._gpuBoneMatricesOffset}, capacity 2048)`,
      );
    }
    const offset = this._gpuBoneMatricesOffset;

    const floatsToCopy = Math.min(skel.boneMatrices.length, numMatrices * 16);
    this._device!.queue.writeBuffer(
      this._boneMatricesBuffer,
      offset * 64,
      skel.boneMatrices.buffer,
      skel.boneMatrices.byteOffset,
      floatsToCopy * 4,
    );

    this._gpuBoneMatricesOffset += numMatrices;
    this._boneSlotMap.set(skel, offset);
    return offset;
  }

  /** Resolves the GPU resource for one of `getOptionalMaterialTextureBindings()`'s texture names. */
  private _resolveOptionalMaterialTexture(name: string, m: RenderManifest): GPUBindingResource {
    if ("u_opaqueMap" === name) {
      return m.textures["u_opaqueMap"]
        ? this._textures.getTextureView(m.textures["u_opaqueMap"] as Texture, this._quality)
        : this._opaqueCapture.opaqueTextureView || this._fallback.whiteTextureView;
    }
    if ("u_opaqueDepthMap" === name) {
      return m.textures["u_opaqueDepthMap"]
        ? this._textures.getTextureView(m.textures["u_opaqueDepthMap"] as Texture, this._quality)
        : this._opaqueCapture.opaqueDepthView || this._fallback.dummyDepthTextureView;
    }
    if ("u_normalBufferMap" === name) {
      return this._opaqueCapture.opaqueNormalView || this._fallback.whiteTextureView;
    }
    return this._textures.getTextureView(m.textures[name] as Texture, this._quality);
  }

  protected _getMaterialBindGroup(
    matUuid: string,
    m: RenderManifest,
    layout: GPUBindGroupLayout,
  ): GPUBindGroup {
    const envOrSkybox = m.textures["u_skybox"] || m.textures["u_envMap"];
    const bindings: number[] = [1, 3, 11, 12];
    const resources: GPUBindingResource[] = [
      this._textures.getSampler(m.textures["u_diffuseMap"] as Texture, this._quality),
      this._textures.getNormalTextureView(m.textures["u_normalMap"] as Texture),
      this._textures.getCubeTextureView(envOrSkybox as CubeTexture, this._quality),
      this._textures.getTextureView(m.textures["u_emissiveMap"] as Texture, this._quality),
    ];
    const bindingInfo = getOptionalMaterialTextureBindings();
    for (const name of getOptionalMaterialTextureNames(m.shaderId, this.context.shaderRegistry)) {
      bindings.push(bindingInfo[name]!.binding);
      resources.push(this._resolveOptionalMaterialTexture(name, m));
    }

    const cache = this._materialBindGroups.get(matUuid);
    if (
      cache &&
      cache.resources.length === resources.length &&
      cache.resources.every((r, i) => r === resources[i])
    ) {
      return cache.bg;
    }

    const bg = this._device!.createBindGroup({
      layout,
      entries: bindings.map((binding, i) => ({ binding, resource: resources[i]! })),
    });

    this._materialBindGroups.set(matUuid, { bg, resources });
    return bg;
  }

  /**
   * Rebuilds the global bind group for the scene's current IBL maps. The GPU textures behind those
   * maps are reference-counted per object, so this takes its own reference first (the new set,
   * then drops the old one) -- otherwise removing an object that shares a map destroys it under
   * the bind group. Passes that copied the old bind group rebuild on the version bump. Called by
   * `GlobalUniformWriter.update()` when it detects a scene IBL change. */
  public _rebuildGlobalBindGroupForScene(scene: Scene): void {
    const next: (Texture | CubeTexture)[] = [];
    for (const tex of [scene.irradianceMap, scene.prefilterMap, scene.brdfLUT]) {
      if (tex) next.push(tex);
    }
    for (const tex of next) this._textures.retainTexture(tex);
    for (const tex of this._pinnedIblTextures) this._textures.releaseRetainedTexture(tex);
    this._pinnedIblTextures = next;

    this._globalBindGroup = this._createGlobalBindGroup(scene);
    this._globalResourcesVersion++;
  }

  public override setSize(width: number, height: number): void {
    if (!this._device || width <= 0 || height <= 0) return;
    const maxRatio = this._quality.maxPixelRatio ?? 2;
    const d = Math.min(devicePixelRatio, maxRatio);
    this._context.canvas.width = width * d;
    this._context.canvas.height = height * d;
    // setSize() runs between frames, so textures replaced by earlier resizes are safe to free now;
    // without this, repeated resizes without a render (hidden tab) pile up full-screen textures.
    this._fallback.drainPendingDestroy();
    if (this._depthTexture) this._fallback.deferDestroyTexture(this._depthTexture);
    this._depthTexture = this._device.createTexture({
      size: [this._context.canvas.width, this._context.canvas.height],
      format: "depth32float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });

    if (this._occlusionCullingEnabled) {
      if (this._hzbTexture) this._fallback.deferDestroyTexture(this._hzbTexture);
      this._hzbMipLevelCount = this._textures.computeMipLevelCount(
        this._context.canvas.width,
        this._context.canvas.height,
      );
      this._hzbTexture = this._device.createTexture({
        size: [this._context.canvas.width, this._context.canvas.height],
        format: "r32float",
        mipLevelCount: this._hzbMipLevelCount,
        // STORAGE_BINDING: each mip is written once, individually, by _buildHzbPyramid().
        // TEXTURE_BINDING: the whole chain is then read back (any mip) by the visibility test.
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._hzbSampledView = this._hzbTexture.createView();
      this._rebuildHzbBindGroups();
    }

    if (this.postProcessing.enabled) {
      if (this._hdrTexture) this._fallback.deferDestroyTexture(this._hdrTexture);
      this._hdrTexture = this._device.createTexture({
        size: [this._context.canvas.width, this._context.canvas.height],
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });
      this._hdrTextureView = this._hdrTexture.createView();
    } else if (this._hdrTexture) {
      this._fallback.deferDestroyTexture(this._hdrTexture);
      this._hdrTexture = undefined;
      this._hdrTextureView = undefined;
    }

    // Clustered light culling grid depends on canvas resolution -- see
    // docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md. `enabled: false` collapses the
    // grid to a single cluster covering the whole frustum, which is equivalent to the old
    // unclustered "iterate every light" behavior without needing a separate shader code path.
    const clusterConfig = this._quality.clusteredLighting;
    const dims =
      clusterConfig?.enabled === false
        ? { x: 1, y: 1, z: 1 }
        : computeClusterCounts(
            this._context.canvas.width,
            this._context.canvas.height,
            clusterConfig?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE,
            clusterConfig?.zSlices ?? DEFAULT_CLUSTER_Z_SLICES,
          );
    const maxLightsPerCluster =
      clusterConfig?.enabled === false
        ? MAX_CLUSTERED_LIGHTS_PER_TYPE
        : (clusterConfig?.maxLightsPerCluster ?? DEFAULT_MAX_LIGHTS_PER_CLUSTER);
    if (
      dims.x !== this._clusterDims.x ||
      dims.y !== this._clusterDims.y ||
      dims.z !== this._clusterDims.z ||
      maxLightsPerCluster !== this._clusterMaxLightsPerCluster
    ) {
      this._allocateClusterBuffers(dims, maxLightsPerCluster);
    }
  }

  /** @inheritdoc */
  public override destroy(): void {
    this._objectRing?.dispose();
    this._geometryCache?.dispose();
    for (const tex of this._shadowMaps.values()) tex.destroy();
    this._targetCache?.dispose();

    if (this._textures) {
      for (const tex of this._pinnedIblTextures) this._textures.releaseRetainedTexture(tex);
    }
    this._pinnedIblTextures = [];

    this._fallback?.dispose();
    this._textures?.dispose();
    this._pipelineCache?.dispose();
    this._globalUniformWriter?.dispose();
    this._depthTexture?.destroy();
    this._hdrTexture?.destroy();
    this._normalTexture?.destroy();
    this._normalTexture = undefined;
    this._normalTextureView = undefined;
    this._hzbTexture?.destroy();
    this._hzbAabbBuffer?.destroy();
    this._hzbResultsBuffer?.destroy();
    this._hzbTestParamsBuffer?.destroy();
    if (this._hzbStagingBuffers) {
      // destroy() implicitly unmaps a still-mapped buffer per spec -- safe even if a
      // mapAsync() from a not-yet-applied readback is still pending on one of these.
      this._hzbStagingBuffers[0].destroy();
      this._hzbStagingBuffers[1].destroy();
    }
    // Every GPU post-effect pass in the registry, in one sweep -- replaces the former per-effect
    // `?.destroy()` lists (see `_getOrCreatePostEffectPass` / the `PostEffectPass` contract).
    for (const pass of this._postEffectPasses.values()) pass.destroy();
    this._postEffectPasses.clear();

    this._opaqueCapture?.dispose();

    this._materialBindGroups.clear();
    this._shadowMaps.clear();

    this._hdrTexture = undefined;
    this._hdrTextureView = undefined;

    // Tears down the whole GPU context; all buffers/textures/pipelines created
    // from this device become invalid, freeing their underlying GPU memory.
    this._isDestroyed = true;
    this._isDeviceLost = true;
    this._device?.destroy();
    this._device = undefined;
  }
}
