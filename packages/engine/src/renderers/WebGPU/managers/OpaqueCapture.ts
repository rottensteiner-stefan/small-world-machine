import type { RenderTarget, RenderTargetCube } from "../../../core/textures/index.js";
import type { GPUFallbackResources } from "./GPUFallbackResources.js";

/**
 * Owns the opaque-scene-snapshot capture path that used to live inside `WebGPURenderer`: the
 * per-target (screen vs. offscreen) cached copies of the just-rendered opaque color, depth and
 * normal buffers, so they stay sampleable after the pass that wrote them as render attachments
 * ends. Consumed via `opaqueTextureView`/`opaqueDepthView`/`opaqueNormalView` (decals, optional
 * material textures, and the GPU post-effect pass contexts).
 *
 * The renderer passes the living source textures in (`activeRenderTarget`, its `_normalTexture`,
 * `activeDepthTexture`); this manager holds no reference back.
 */
interface Snapshot {
  tex: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
}

export class OpaqueCapture {
  private _opaqueTextures = new WeakMap<object, Snapshot>();
  private _screenOpaqueTexture?: Snapshot | undefined;
  private _opaqueTextureView?: GPUTextureView | undefined;

  // Depth/normal snapshots are cached per target exactly like the color one: a single shared slot
  // was reallocated twice per frame (offscreen size, then screen size) and handed the post passes
  // a fresh view every frame, invalidating all of their cached bind groups.
  private _opaqueDepths = new WeakMap<object, Snapshot>();
  private _screenOpaqueDepth?: Snapshot | undefined;
  private _opaqueDepthTextureView?: GPUTextureView | undefined;
  private _opaqueNormals = new WeakMap<object, Snapshot>();
  private _screenOpaqueNormal?: Snapshot | undefined;
  private _opaqueNormalTextureView?: GPUTextureView | undefined;

  constructor(
    private readonly _device: GPUDevice,
    private readonly _fallback: GPUFallbackResources,
  ) {}

  public get opaqueTextureView(): GPUTextureView | undefined {
    return this._opaqueTextureView;
  }

  public get opaqueDepthView(): GPUTextureView | undefined {
    return this._opaqueDepthTextureView;
  }

  public get opaqueNormalView(): GPUTextureView | undefined {
    return this._opaqueNormalTextureView;
  }

  /** Returns the (re)allocated-if-needed snapshot of `src`, then records the copy into it. */
  private _snapshot(
    ce: GPUCommandEncoder,
    src: GPUTexture,
    target: object | null,
    perTarget: WeakMap<object, Snapshot>,
    screen: Snapshot | undefined,
  ): Snapshot {
    let cacheObj = target ? perTarget.get(target) : screen;
    if (
      !cacheObj ||
      cacheObj.width !== src.width ||
      cacheObj.height !== src.height ||
      cacheObj.tex.format !== src.format
    ) {
      if (cacheObj) this._fallback.deferDestroyTexture(cacheObj.tex);
      const tex = this._device.createTexture({
        size: [src.width, src.height, 1],
        format: src.format,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      cacheObj = { tex, view: tex.createView(), width: src.width, height: src.height };
      if (target) perTarget.set(target, cacheObj);
    }
    ce.copyTextureToTexture({ texture: src }, { texture: cacheObj.tex }, [
      src.width,
      src.height,
      1,
    ]);
    return cacheObj;
  }

  public captureOpaqueTexture(
    ce: GPUCommandEncoder,
    targetTex: GPUTexture,
    activeRenderTarget: RenderTarget | RenderTargetCube | null,
  ): void {
    const snap = this._snapshot(
      ce,
      targetTex,
      activeRenderTarget,
      this._opaqueTextures,
      this._screenOpaqueTexture,
    );
    if (!activeRenderTarget) this._screenOpaqueTexture = snap;
    this._opaqueTextureView = snap.view;
  }

  /**
   * Copies the normal buffer into a sampleable texture: it cannot be read while it is still a
   * render attachment of the pass that wrote it. The normal buffer only exists for the screen
   * target, so this slot is the screen one.
   */
  public captureOpaqueNormal(ce: GPUCommandEncoder, src: GPUTexture): void {
    if (!src) return;
    const snap = this._snapshot(ce, src, null, this._opaqueNormals, this._screenOpaqueNormal);
    this._screenOpaqueNormal = snap;
    this._opaqueNormalTextureView = snap.view;
  }

  public captureOpaqueDepth(
    ce: GPUCommandEncoder,
    srcTex: GPUTexture,
    activeRenderTarget: RenderTarget | RenderTargetCube | null = null,
  ): void {
    const snap = this._snapshot(
      ce,
      srcTex,
      activeRenderTarget,
      this._opaqueDepths,
      this._screenOpaqueDepth,
    );
    if (!activeRenderTarget) this._screenOpaqueDepth = snap;
    this._opaqueDepthTextureView = snap.view;
  }

  /** Frees the snapshots of a removed offscreen target (WeakMap alone would leak the GPU texture
   * until GC, since GPUTexture memory is not GC-driven). */
  public releaseTarget(target: object): void {
    for (const map of [this._opaqueTextures, this._opaqueDepths, this._opaqueNormals]) {
      const snap = map.get(target);
      if (snap) {
        this._fallback.deferDestroyTexture(snap.tex);
        map.delete(target);
      }
    }
  }

  public dispose(): void {
    this._screenOpaqueTexture?.tex.destroy();
    this._screenOpaqueDepth?.tex.destroy();
    this._screenOpaqueNormal?.tex.destroy();
    this._screenOpaqueTexture = undefined;
    this._screenOpaqueDepth = undefined;
    this._screenOpaqueNormal = undefined;
    this._opaqueTextures = new WeakMap();
    this._opaqueDepths = new WeakMap();
    this._opaqueNormals = new WeakMap();
    this._opaqueTextureView = undefined;
    this._opaqueDepthTextureView = undefined;
    this._opaqueNormalTextureView = undefined;
  }
}
