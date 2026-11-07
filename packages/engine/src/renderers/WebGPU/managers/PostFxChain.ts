import { PostProcessingEffectType } from "../../../enums/index.js";
import type { Scene } from "../../../core/index.js";
import { Vector3D } from "../../../math/index.js";
import type { LightDataInterface } from "../../../interfaces/index.js";
import type {
  BloomElement,
  DepthOfFieldElement,
  HbaoElement,
  LightShaftsElement,
  MotionTrailElement,
  TaaElement,
  VolumetricFogElement,
} from "../../post/elements/index.js";
import {
  AOPassGPU,
  BloomPassGPU,
  DepthOfFieldPassGPU,
  HistoryBlendPassGPU,
  LightShaftsPassGPU,
  VolumetricFogPassGPU,
} from "../../post/passes/index.js";
import type { PostEffectPass, PostEffectPassContext } from "../../post/PostEffectPass.js";
import type { PostProcessingElement } from "../../post/PostProcessingElement.js";
import type { WebGPURenderer } from "../WebGPURenderer.js";

/**
 * Single orchestration point for the whole GPU post-FX chain that used to live inline in
 * `WebGPURenderer.render()`: the chained pre-uber effect dispatches (TAA -> motion trail ->
 * depth of field -> bloom -> HBAO -> light shafts -> volumetric fog), the `Map<PostProcessingEffectType,
 * PostEffectPass>` registry behind them (see ADR 0037), the reused `PostEffectPassContext`, and
 * the resulting per-effect texture views (`taaResolvedView`/`motionTrailResolvedView`/bloom/HBAO/
 * shafts/volumetric-fog) that the final uber pass reads.
 *
 * The renderer stays the host for everything outside this subsystem and is passed in as the
 * constructor dependency; the chain reaches the rest (effect config, HDR color texture/views,
 * canvas size, opaque-depth capture, fog-volume extraction) through `WebGPURenderer`'s public
 * accessors and the per-frame arguments of `runPostEffects()`. Effect passes are created lazily
 * on first enable and destroyed in one registry sweep from `destroy()`.
 */
export class PostFxChain {
  /** Frames an effect may stay disabled before its pass (history targets, froxel volumes, ...) is
   * destroyed and its registry entry dropped; re-enabling later simply re-creates it. ~5 s at
   * 60 fps: long enough that a toggled slider does not thrash allocations. */
  public static readonly IDLE_DESTROY_FRAMES: number = 300;

  private readonly _passes = new Map<PostProcessingEffectType, PostEffectPass>();
  /** Frame counter (increments once per `runPostEffects`) and the last frame each pass was used. */
  private _frame: number = 0;
  private readonly _lastUsedFrame = new Map<PostProcessingEffectType, number>();
  /** Pre-bound so the per-frame sweep allocates no closure. */
  private readonly _sweepEntry = (pass: PostEffectPass, type: PostProcessingEffectType): void => {
    const last = this._lastUsedFrame.get(type) ?? this._frame;
    if (this._frame - last > PostFxChain.IDLE_DESTROY_FRAMES) {
      pass.destroy();
      this._passes.delete(type);
      this._lastUsedFrame.delete(type);
    }
  };
  /** Reused every frame (zero allocation on the hot path); fields are repopulated right before
   * each dispatch -- see the `PostEffectPassContext` reuse contract. */
  private readonly _ctx: PostEffectPassContext = {
    renderer: undefined as unknown as WebGPURenderer,
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

  private _taaResolvedView: GPUTextureView | undefined = undefined;
  private _motionTrailResolvedView: GPUTextureView | undefined = undefined;
  private _depthOfFieldResolvedView: GPUTextureView | undefined = undefined;
  private _bloomTextureView: GPUTextureView | undefined = undefined;
  private _hbaoTextureView: GPUTextureView | undefined = undefined;
  private _lightShaftsTextureView: GPUTextureView | undefined = undefined;
  private _volumetricFogTextureView: GPUTextureView | undefined = undefined;

  constructor(private readonly _host: WebGPURenderer) {
    // Parameter properties are assigned *after* field initializers run (ES2022
    // `useDefineForClassFields`), so `renderer` must be wired here in the constructor body --
    // referencing `this._host` from the `_ctx` initializer above would capture `undefined`.
    this._ctx.renderer = this._host;
  }

  /** This frame's TAA-resolved color view, if TAA is enabled -- read by PostProcessPass instead of
   * `_hdrTextureView` for its color input. Recomputed fresh every frame; `_hdrTextureView` itself
   * is never overwritten so TAA keeps reading the raw per-frame render as "current". (TAA's
   * `HistoryBlendPassGPU` instance lives in this registry, its own separate history buffer from
   * Motion Trail's. */
  public get taaResolvedView(): GPUTextureView | undefined {
    return this._taaResolvedView;
  }

  public get motionTrailResolvedView(): GPUTextureView | undefined {
    return this._motionTrailResolvedView;
  }

  /** This frame's defocused HDR color view, if depth of field ran -- the final chained color the
   * uber pass reads ahead of the motion-trail / TAA / raw HDR views. */
  public get depthOfFieldResolvedView(): GPUTextureView | undefined {
    return this._depthOfFieldResolvedView;
  }

  public get bloomTextureView(): GPUTextureView | undefined {
    return this._bloomTextureView;
  }

  public get hbaoTextureView(): GPUTextureView | undefined {
    return this._hbaoTextureView;
  }

  public get lightShaftsTextureView(): GPUTextureView | undefined {
    return this._lightShaftsTextureView;
  }

  /** Full-screen in-scattering target of the volumetric-fog raymarch pass, consumed additively
   * (before tonemapping) by PostProcessPass. Recomputed fresh every frame; undefined when the
   * `VolumetricFogElement` is disabled or inputs are missing. */
  public get volumetricFogTextureView(): GPUTextureView | undefined {
    return this._volumetricFogTextureView;
  }

  /** Lazily creates (once) or returns the effect pass registered under `type`. The same pass
   * instance is reused across frames so its history buffers survive; `destroy()` tears every
   * registry entry down in one sweep. */
  private _getOrCreatePass(
    type: PostProcessingEffectType,
    ctor: new (device: GPUDevice) => PostEffectPass,
  ): PostEffectPass {
    let pass = this._passes.get(type);
    if (!pass) {
      pass = new ctor(this._host.gpuDevice!);
      this._passes.set(type, pass);
    }
    this._lastUsedFrame.set(type, this._frame);
    return pass;
  }

  /**
   * Drives this frame's chained pre-uber GPU post effects, in the fixed order TAA -> motion trail
   * -> depth of field -> bloom -> HBAO -> light shafts -> volumetric fog, each step feeding its resolved view into
   * the next. Runs only while the final `PostProcessPass` will actually execute (the renderer
   * skips both for offscreen render targets). The reused `PostEffectPassContext` is repopulated
   * here once per frame -- fields that vary per effect are rewired right before each dispatch.
   *
   * @param ce The frame's shared command encoder (passes record into it).
   * @param scene The scene being rendered (fog volumes for volumetric fog).
   * @param vp The frame's view-projection matrix.
   * @param vMat The frame's view matrix, when available.
   * @param camPos The frame's camera position.
   * @param near The frame's near plane distance.
   * @param far The frame's far plane distance.
   * @param projMatrix The frame's camera projection matrix (depth-based effects such as HBAO).
   * @param lights This frame's extracted lights.
   */
  public runPostEffects(
    ce: GPUCommandEncoder,
    scene: Scene,
    vp: Float32Array,
    vMat: Float32Array | undefined,
    camPos: Vector3D,
    near: number,
    far: number,
    projMatrix: Float32Array | undefined,
    lights: LightDataInterface,
  ): void {
    this._frame++;
    const renderer = this._host;
    const group = renderer.postProcessing;
    const bloomNode = group.get<BloomElement>(PostProcessingEffectType.BLOOM);
    const hbaoNode = group.get<HbaoElement>(PostProcessingEffectType.HBAO);
    const taaNode = group.get<TaaElement>(PostProcessingEffectType.TAA);
    const motionTrailNode = group.get<MotionTrailElement>(PostProcessingEffectType.MOTION_TRAIL);

    // Reused per frame -- see the `PostEffectPassContext` reuse contract. Fields that vary per
    // effect (`colorView`, `element`, `fogVolumes`) are repopulated immediately before each
    // dispatch below; everything else is refreshed once here.
    const ctx = this._ctx;
    ctx.ce = ce;
    ctx.width = renderer.gpuCanvasContext.canvas.width;
    ctx.height = renderer.gpuCanvasContext.canvas.height;
    ctx.vp = vp;
    ctx.vMat = vMat;
    ctx.camPos = camPos;
    ctx.near = near;
    ctx.far = far;
    ctx.projMatrix = projMatrix;
    ctx.lights = lights;
    ctx.colorTexture = renderer.hdrTexture;
    ctx.depthView = renderer.opaqueDepthView ?? renderer.dummyDepthTextureView;

    // TAA resolves first, if enabled: Bloom and the final uber pass should react to the
    // temporally-smoothed color, not the raw per-frame jittered one. `_hdrTextureView` itself
    // is never reassigned, so this pass keeps reading fresh input every subsequent frame.
    if (taaNode && taaNode.enabled && renderer.hdrTextureView) {
      ctx.colorView = renderer.hdrTextureView;
      ctx.element = taaNode;
      const p = this._getOrCreatePass(PostProcessingEffectType.TAA, HistoryBlendPassGPU);
      this._taaResolvedView = p.execute(ctx) ?? undefined;
    } else {
      this._taaResolvedView = undefined;
    }

    // Motion Trail: a deliberate ghost/afterimage look, not anti-aliasing -- reuses the same
    // history-blend pass as TAA (its own separate instance/history buffer), chained after TAA.
    const taaOrRawView = this._taaResolvedView ?? renderer.hdrTextureView;
    if (motionTrailNode && motionTrailNode.enabled && taaOrRawView) {
      ctx.colorView = taaOrRawView;
      ctx.element = motionTrailNode;
      const p = this._getOrCreatePass(PostProcessingEffectType.MOTION_TRAIL, HistoryBlendPassGPU);
      this._motionTrailResolvedView = p.execute(ctx) ?? undefined;
    } else {
      this._motionTrailResolvedView = undefined;
    }

    const trailOrTaaView = this._motionTrailResolvedView ?? taaOrRawView;

    // Depth of field defocuses the resolved HDR radiance before bloom and tone mapping: a lens
    // integrates linear radiance over its aperture, so bright highlights must become bokeh discs
    // first and only then glow. AO / light shafts / volumetric fog are composited later by the
    // uber pass and stay unblurred -- acceptable, they are low-frequency terms.
    const dofNode = group.get<DepthOfFieldElement>(PostProcessingEffectType.DEPTH_OF_FIELD);
    if (dofNode && dofNode.enabled && renderer.opaqueDepthView && trailOrTaaView) {
      ctx.colorView = trailOrTaaView;
      ctx.element = dofNode;
      const p = this._getOrCreatePass(PostProcessingEffectType.DEPTH_OF_FIELD, DepthOfFieldPassGPU);
      this._depthOfFieldResolvedView = p.execute(ctx) ?? undefined;
    } else {
      this._depthOfFieldResolvedView = undefined;
    }

    const colorTextureView = this._depthOfFieldResolvedView ?? trailOrTaaView;

    if (bloomNode && bloomNode.enabled && renderer.hdrTexture && colorTextureView) {
      ctx.colorView = colorTextureView;
      ctx.element = bloomNode;
      const p = this._getOrCreatePass(PostProcessingEffectType.BLOOM, BloomPassGPU);
      this._bloomTextureView = p.execute(ctx) ?? undefined;
    } else {
      this._bloomTextureView = undefined;
    }

    if (hbaoNode && hbaoNode.enabled && renderer.opaqueDepthView && projMatrix) {
      ctx.element = hbaoNode;
      const p = this._getOrCreatePass(PostProcessingEffectType.HBAO, AOPassGPU);
      this._hbaoTextureView = p.execute(ctx) ?? undefined;
    } else {
      this._hbaoTextureView = undefined;
    }

    const shaftsNode = group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
    if (shaftsNode && shaftsNode.enabled && renderer.opaqueDepthView && lights.dLight) {
      ctx.element = shaftsNode;
      const p = this._getOrCreatePass(PostProcessingEffectType.LIGHT_SHAFTS, LightShaftsPassGPU);
      this._lightShaftsTextureView = p.execute(ctx) ?? undefined;
    } else {
      this._lightShaftsTextureView = undefined;
    }

    // Volumetric fog: froxel inject -> temporal reprojection -> in-register integration (incl.
    // directional/CSM sunlight) -> single-tap composite; PostProcessPass attenuates the scene by
    // the transmittance and adds the in-scattering before tonemapping (ADR 0031).
    const volFogNode = group.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
    if (volFogNode && volFogNode.enabled && renderer.opaqueDepthView) {
      ctx.element = volFogNode;
      ctx.fogVolumes = renderer.extractFogVolumes(scene);
      const p = this._getOrCreatePass(
        PostProcessingEffectType.VOLUMETRIC_FOG,
        VolumetricFogPassGPU,
      );
      this._volumetricFogTextureView = p.execute(ctx) ?? undefined;
    } else {
      this._volumetricFogTextureView = undefined;
    }

    // A disabled effect used to keep its pass (and all GPU memory) forever: free passes that have
    // been unused for IDLE_DESTROY_FRAMES frames.
    this._passes.forEach(this._sweepEntry);
  }

  /** Tears down every GPU post-effect pass in the registry, in one sweep -- replaces the former
   * per-effect `?.destroy()` lists (see `_getOrCreatePostEffectPass` / the `PostEffectPass`
   * contract). */
  public destroy(): void {
    for (const pass of this._passes.values()) pass.destroy();
    this._passes.clear();
    this._lastUsedFrame.clear();
  }

  /**
   * Discards the temporal history of every owned pass that keeps one (S3 DP-4A): iterates the
   * registry and calls each pass' optional `resetHistory()`. Only the history-blend passes
   * (`HistoryBlendPassGPU` for TAA/MotionTrail) and `VolumetricFogPassGPU` implement it; the
   * non-temporal passes simply have no history to drop, so this stays a cheap, idempotent loop.
   * Called by `SmallWorldMachine.notifyCameraTeleport()` (via the `WebGPURenderer` delegate) on
   * camera cuts -- never on the per-frame hot path. A pass that was never created (effect disabled)
   * has no history and needs no reset.
   */
  public resetHistory(): void {
    for (const pass of this._passes.values()) {
      pass.resetHistory?.();
    }
  }
}
