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
export class OpaqueCapture {
  private _opaqueTextures = new WeakMap<
    object,
    { tex: GPUTexture; view: GPUTextureView; width: number; height: number }
  >();
  private _screenOpaqueTexture?:
    { tex: GPUTexture; view: GPUTextureView; width: number; height: number } | undefined;
  private _opaqueTextureView?: GPUTextureView;

  private _opaqueDepthTexture?: GPUTexture;
  private _opaqueDepthTextureView?: GPUTextureView;
  private _opaqueNormalTexture?: GPUTexture;
  private _opaqueNormalTextureView?: GPUTextureView;

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

  public captureOpaqueTexture(
    ce: GPUCommandEncoder,
    targetTex: GPUTexture,
    activeRenderTarget: RenderTarget | RenderTargetCube | null,
  ): void {
    let cacheObj = activeRenderTarget
      ? this._opaqueTextures.get(activeRenderTarget)
      : this._screenOpaqueTexture;

    if (
      !cacheObj ||
      cacheObj.width !== targetTex.width ||
      cacheObj.height !== targetTex.height ||
      cacheObj.tex.format !== targetTex.format
    ) {
      if (cacheObj) this._fallback.deferDestroyTexture(cacheObj.tex);

      const tex = this._device.createTexture({
        size: [targetTex.width, targetTex.height, 1],
        format: targetTex.format,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      cacheObj = {
        tex,
        view: tex.createView(),
        width: targetTex.width,
        height: targetTex.height,
      };

      if (activeRenderTarget) {
        this._opaqueTextures.set(activeRenderTarget, cacheObj);
      } else {
        this._screenOpaqueTexture = cacheObj;
      }
    }

    this._opaqueTextureView = cacheObj.view;

    ce.copyTextureToTexture({ texture: targetTex }, { texture: cacheObj.tex }, [
      targetTex.width,
      targetTex.height,
      1,
    ]);
  }

  /**
   * Copies the normal buffer into a sampleable texture: it cannot be read while it is still a
   * render attachment of the pass that wrote it. No-op while the buffer is off.
   */
  public captureOpaqueNormal(ce: GPUCommandEncoder, src: GPUTexture): void {
    if (!src) return;

    if (
      !this._opaqueNormalTexture ||
      this._opaqueNormalTexture.width !== src.width ||
      this._opaqueNormalTexture.height !== src.height
    ) {
      if (this._opaqueNormalTexture) this._fallback.deferDestroyTexture(this._opaqueNormalTexture);
      this._opaqueNormalTexture = this._device.createTexture({
        size: [src.width, src.height],
        format: src.format,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._opaqueNormalTextureView = this._opaqueNormalTexture.createView();
    }

    ce.copyTextureToTexture({ texture: src }, { texture: this._opaqueNormalTexture }, [
      src.width,
      src.height,
      1,
    ]);
  }

  public captureOpaqueDepth(ce: GPUCommandEncoder, srcTex: GPUTexture): void {
    if (
      !this._opaqueDepthTexture ||
      this._opaqueDepthTexture.width !== srcTex.width ||
      this._opaqueDepthTexture.height !== srcTex.height ||
      this._opaqueDepthTexture.format !== srcTex.format
    ) {
      if (this._opaqueDepthTexture) this._fallback.deferDestroyTexture(this._opaqueDepthTexture);

      const tex = this._device.createTexture({
        size: [srcTex.width, srcTex.height, 1],
        format: srcTex.format,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._opaqueDepthTexture = tex;
      this._opaqueDepthTextureView = tex.createView();
    }

    ce.copyTextureToTexture({ texture: srcTex }, { texture: this._opaqueDepthTexture }, [
      srcTex.width,
      srcTex.height,
      1,
    ]);
  }

  public dispose(): void {
    this._screenOpaqueTexture?.tex.destroy();
    this._screenOpaqueTexture = undefined;
    this._opaqueTextures = new WeakMap();
    this._opaqueDepthTexture?.destroy();
  }
}
