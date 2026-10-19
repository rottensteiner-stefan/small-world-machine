import type { RenderTarget } from "../../../core/textures/index.js";
import { RenderTargetCube } from "../../../core/textures/index.js";
import type { GPUTextureResourceCache } from "./GPUTextureResourceCache.js";

interface RenderTargetData {
  tex: GPUTexture;
  view: GPUTextureView;
  depth?: GPUTexture;
  depthView?: GPUTextureView;
}

interface RenderTargetCubeData {
  tex: GPUTexture;
  cubeView: GPUTextureView;
  faceViews: GPUTextureView[];
  depth?: GPUTexture;
  depthView?: GPUTextureView;
}

/**
 * Owns the cached GPU backing textures for offscreen `RenderTarget`/`RenderTargetCube`s -- the map
 * and the create/destroy flow that used to live inside `WebGPURenderer.render()`. Every offscreen
 * target gets its color (and optional depth) textures created once on first use, registered with
 * the texture cache so the target can later be sampled as an ordinary material texture, and
 * recreated whenever a caller flips `isLoaded` (a load/resize invalidation).
 *
 * The renderer stays the only caller: `getActiveTargetView()` replaces the offscreen branch of
 * `render()`, `colorTexture()`/`depthTexture()`/`depthView()` back the `active*` getters, and
 * `dispose()` replaces `destroy()`'s sweep. Allocation is not a per-frame hot path -- it only runs
 * on first use of a target or after an explicit invalidation.
 */
export class GPURenderTargetCache {
  private _renderTargetTextures = new Map<RenderTarget, RenderTargetData>();
  private _renderTargetCubeTextures = new Map<RenderTargetCube, RenderTargetCubeData>();

  constructor(
    private readonly _device: GPUDevice,
    private readonly _textures: GPUTextureResourceCache,
  ) {}

  /** Exposed for tests that inject a pre-built cache entry. */
  public get renderTargetTextures(): Map<RenderTarget, RenderTargetData> {
    return this._renderTargetTextures;
  }

  /** Exposed for tests that inject a pre-built cache entry. */
  public get renderTargetCubeTextures(): Map<RenderTargetCube, RenderTargetCubeData> {
    return this._renderTargetCubeTextures;
  }

  /** The sampleable color texture backing `target`, if it was ever (re)created. */
  public colorTexture(target: RenderTarget | RenderTargetCube): GPUTexture | undefined {
    return target instanceof RenderTargetCube
      ? this._renderTargetCubeTextures.get(target)?.tex
      : this._renderTargetTextures.get(target)?.tex;
  }

  /** The depth texture backing `target`, if present and ever (re)created. */
  public depthTexture(target: RenderTarget | RenderTargetCube): GPUTexture | undefined {
    return target instanceof RenderTargetCube
      ? this._renderTargetCubeTextures.get(target)?.depth
      : this._renderTargetTextures.get(target)?.depth;
  }

  /** The depth view backing `target`, if present and ever (re)created. */
  public depthView(target: RenderTarget | RenderTargetCube): GPUTextureView | undefined {
    return target instanceof RenderTargetCube
      ? this._renderTargetCubeTextures.get(target)?.depthView
      : this._renderTargetTextures.get(target)?.depthView;
  }

  /**
   * Ensures the (offscreen) render target has backing GPU textures and returns the view the
   * current pass should render into -- the active cube face for a `RenderTargetCube`, or the color
   * view for a 2D `RenderTarget`. First use -- or a load/resize invalidation (`isLoaded === false`,
   * set by the caller) -- (re)allocates color (and, if requested, depth) textures, destroys the
   * previous ones, registers the target with the texture cache and flips `isLoaded` back to true.
   */
  public getActiveTargetView(
    target: RenderTarget | RenderTargetCube,
    format: GPUTextureFormat,
    cubeFace: number,
  ): GPUTextureView {
    if (target instanceof RenderTargetCube) {
      let data = this._renderTargetCubeTextures.get(target);
      if (!data || !target.isLoaded) {
        if (data) {
          data.tex.destroy();
          if (data.depth) data.depth.destroy();
        }

        const tex = this._device.createTexture({
          size: {
            width: target.width,
            height: target.height,
            depthOrArrayLayers: 6,
          },
          format,
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC,
        });

        const cubeView = tex.createView({ dimension: "cube" });
        const faceViews: GPUTextureView[] = [];
        for (let i = 0; i < 6; i++) {
          faceViews.push(
            tex.createView({ dimension: "2d", baseArrayLayer: i, arrayLayerCount: 1 }),
          );
        }

        let depth: GPUTexture | undefined;
        let depthView: GPUTextureView | undefined;

        if (target.depth) {
          depth = this._device.createTexture({
            size: [target.width, target.height],
            format: "depth32float",
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT |
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_SRC,
          });
          depthView = depth.createView();
        }

        data = { tex, cubeView, faceViews };
        if (depth !== undefined) data.depth = depth;
        if (depthView !== undefined) data.depthView = depthView;
        this._renderTargetCubeTextures.set(target, data);
        this._textures.registerRenderTargetCubeTexture(target, tex, cubeView);
        target.isLoaded = true;
      }
      return data.faceViews[cubeFace]!;
    }

    let data = this._renderTargetTextures.get(target);
    if (!data || !target.isLoaded) {
      if (data) {
        data.tex.destroy();
        if (data.depth) data.depth.destroy();
      }

      const tex = this._device.createTexture({
        size: [target.width, target.height],
        format,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });
      const view = tex.createView();

      let depth: GPUTexture | undefined;
      let depthView: GPUTextureView | undefined;

      if (target.depth) {
        depth = this._device.createTexture({
          size: [target.width, target.height],
          format: "depth32float",
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC,
        });
        depthView = depth.createView();
      }

      data = { tex, view };
      if (depth !== undefined) data.depth = depth;
      if (depthView !== undefined) data.depthView = depthView;
      this._renderTargetTextures.set(target, data);
      this._textures.registerRenderTargetTexture(target, tex, view);
      target.isLoaded = true;
    }
    return data.view;
  }

  public dispose(): void {
    for (const data of this._renderTargetTextures.values()) {
      data.tex.destroy();
      data.depth?.destroy();
    }
    for (const data of this._renderTargetCubeTextures.values()) {
      data.tex.destroy();
      data.depth?.destroy();
    }
    this._renderTargetTextures.clear();
    this._renderTargetCubeTextures.clear();
  }
}
