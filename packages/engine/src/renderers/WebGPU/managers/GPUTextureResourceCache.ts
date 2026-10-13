import { CubeTexture, Object3D, Texture, TextureArray } from "../../../core/index.js";
import { RenderTarget, RenderTargetCube } from "../../../core/textures/index.js";
import { QualityConfig } from "../../../interfaces/index.js";
import { CompressedTextureFormat, TextureFilter, TextureWrap } from "../../../enums/index.js";
import { GPUFallbackResources } from "./GPUFallbackResources.js";
import mipDownsampleWGSL from "../../post/shaders/MipDownsample.frag.wgsl?raw";
import fullscreenVertWGSL from "../../post/shaders/PostProcess.vert.wgsl?raw";

/**
 * Uploaded-texture GPU state: per-`Texture`/`CubeTexture` view caches (with refcounting so a
 * texture shared by multiple objects is only destroyed once nothing references it anymore),
 * the draw-time sampler cache, and runtime mip-chain generation (WebGPU has no
 * `generateMipmap()` equivalent to WebGL2's).
 *
 * Extracted from `WebGPURenderer` -- see .agents/collaborate/god-objects-refactoring.md Phase 4.
 * No behavior change. `RenderTarget`/`RenderTargetCube` GPU textures are NOT owned here (their
 * lifecycle belongs to `WebGPURenderer`'s own per-frame render-target logic) -- but a view of
 * each is registered here too via `registerRenderTargetTexture()`/`registerRenderTargetCubeTexture()`
 * so a render target sampled as an ordinary material texture (portals, mirrors, reflection
 * probes) resolves through the same `getTextureView()`/`getCubeTextureView()` lookup as any
 * other texture.
 *
 * KNOWN OPEN ISSUE (Showcase 29, Sponza curtains): `acquireTextures()` used to spuriously
 * release+recreate a texture still in active use because a narrower-keyed manifest (e.g. the
 * depth pre-pass's) overwrote the full snapshot a fuller-keyed one (the main pass's) had just
 * written -- see that method's doc. That per-frame churn is fixed and verified (a texture's GPU
 * view is now created once and stays stable). A separate, still-unexplained visual artifact
 * remains, though: on first upload, one curtain's `u_diffuseMap`/`u_metallicMap` sometimes
 * renders as a wrong, unrelated texture's raw content despite every JS-side manifest/bind-group
 * reference being verified correct at draw time. Ruled out live: mip-chain generation (disabling
 * it doesn't help), cross-texture upload races (fully serialized uploads with a real
 * `device.queue.onSubmittedWorkDone()` barrier between every texture don't help either), and
 * texture-view-cache aliasing (each GPUTexture maps 1:1 to its own Texture object). Root cause is
 * still open -- likely needs a real GPU capture (Chrome's WebGPU tracing, Dawn debug layers)
 * rather than further JS-level instrumentation.
 */
export class GPUTextureResourceCache {
  private readonly _device: GPUDevice;
  private readonly _fallback: GPUFallbackResources;

  private _textureViewCache = new Map<
    Texture,
    {
      texture: GPUTexture;
      view: GPUTextureView;
      mipLevelCount: number;
      width: number;
      height: number;
    }
  >();
  private _cubeTextureViewCache = new Map<
    CubeTexture,
    { texture: GPUTexture; view: GPUTextureView }
  >();
  private _texRefCounts: Map<Texture, number> = new Map();
  private _texCubeRefCounts: Map<CubeTexture, number> = new Map();
  private _lastKnownTextures: WeakMap<Object3D, Record<string, Texture | CubeTexture | undefined>> =
    new WeakMap();
  private _samplerCache: Map<string, GPUSampler> = new Map();

  /** GPU-side mip-chain generator for runtime 2D textures -- one bilinear blit per level, see
   * `_generateMipmaps()`. */
  private readonly _mipGenPipeline: GPURenderPipeline;
  private readonly _mipGenBGL: GPUBindGroupLayout;
  private readonly _mipGenSampler: GPUSampler;

  constructor(device: GPUDevice, fallback: GPUFallbackResources) {
    this._device = device;
    this._fallback = fallback;

    this._mipGenBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    this._mipGenPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._mipGenBGL] }),
      vertex: {
        module: device.createShaderModule({ code: fullscreenVertWGSL }),
        entryPoint: "vs_main",
      },
      fragment: {
        module: device.createShaderModule({ code: mipDownsampleWGSL }),
        entryPoint: "fs_main",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    // Always clamp-to-edge, independent of the texture's own wrap mode -- prevents edge
    // bleeding while downsampling. Separate from `getSampler()`'s draw-time sampler cache.
    this._mipGenSampler = device.createSampler({
      magFilter: TextureFilter.LINEAR,
      minFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
  }

  public getSampler(tex: Texture | undefined): GPUSampler {
    const mag =
      tex?.magFilter === TextureFilter.NEAREST ? TextureFilter.NEAREST : TextureFilter.LINEAR;
    const min =
      tex?.minFilter === TextureFilter.NEAREST ? TextureFilter.NEAREST : TextureFilter.LINEAR;
    const mapWrap = (w: TextureWrap | undefined): GPUAddressMode => {
      if (w === TextureWrap.REPEAT) return TextureWrap.REPEAT;
      if (w === TextureWrap.MIRRORED_REPEAT) return TextureWrap.MIRRORED_REPEAT;
      return TextureWrap.CLAMP_TO_EDGE;
    };
    const u = mapWrap(tex?.addressModeU);
    const v = mapWrap(tex?.addressModeV);
    const key = mag + "_" + min + "_" + u + "_" + v;
    let s = this._samplerCache.get(key);
    if (!s) {
      s = this._device.createSampler({
        magFilter: mag,
        minFilter: min,
        addressModeU: u,
        addressModeV: v,
        mipmapFilter: TextureFilter.LINEAR,
      });
      this._samplerCache.set(key, s);
    }
    // Anisotropic filtering is intentionally not applied here: WebGPU's core `GPUSamplerDescriptor`
    // has no `maxAnisotropy` field (the API dropped WebGL's AF extension), so this backend stays at
    // level 1. The WebGL backends enforce `Texture.anisotropy`/`quality.maxAnisotropy` instead.
    return s;
  }

  public getTextureView(
    tex: Texture | undefined,
    quality: QualityConfig | undefined,
  ): GPUTextureView {
    if (quality?.disableTextures) return this._fallback.whiteTextureView;
    if (!tex || !tex.isLoaded) return this._fallback.whiteTextureView;
    // A `RenderTarget` (e.g. `PlanarReflectionNode.renderTarget`, or a `bakeImposter()` output)
    // has no `.image` -- its GPU texture already exists from being rendered into (populated via
    // `registerRenderTargetTexture()`), so it's looked up instead of uploaded. Mirrors
    // `getCubeTextureView()`'s identical `RenderTargetCube` branch just below.
    if (tex instanceof RenderTarget) {
      const rtEntry = this._textureViewCache.get(tex);
      return rtEntry?.view || this._fallback.whiteTextureView;
    }
    // Block-compressed textures carry no `.image` -- they are uploaded from their
    // explicit mip chain instead of from a source image.
    if (tex.compressedImage) {
      const entry = this._getOrCreateCompressedEntry(tex);
      return entry.view;
    }
    if (!tex.image) return this._fallback.whiteTextureView;
    let entry = this._textureViewCache.get(tex);
    if (!entry) {
      let t: GPUTexture;
      let v: GPUTextureView;
      if ("isTextureArray" in tex && (tex as TextureArray).isTextureArray) {
        const texArray = tex as TextureArray;
        const width = texArray.image!.width;
        const height = texArray.image!.height;
        const depth = texArray.images.length;

        t = this._device.createTexture({
          size: [width, height, depth],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });

        for (let i = 0; i < depth; i++) {
          this._device.queue.copyExternalImageToTexture(
            {
              source: texArray.images[i] as
                ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas,
            },
            { texture: t, origin: [0, 0, i] },
            [width, height],
          );
        }
        v = t.createView({ dimension: "2d-array" });
        entry = { texture: t, view: v, mipLevelCount: 1, width, height };
      } else {
        const mipLevelCount =
          quality?.mipmapping && tex.generateMipmaps
            ? this.computeMipLevelCount(tex.image.width, tex.image.height)
            : 1;
        t = this._device.createTexture({
          size: [tex.image.width, tex.image.height],
          format: "rgba8unorm",
          mipLevelCount,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this._device.queue.copyExternalImageToTexture({ source: tex.image }, { texture: t }, [
          tex.image.width,
          tex.image.height,
        ]);
        if (mipLevelCount > 1) this._generateMipmaps(t, mipLevelCount);
        v = t.createView();
        entry = {
          texture: t,
          view: v,
          mipLevelCount,
          width: tex.image.width,
          height: tex.image.height,
        };
      }
      this._textureViewCache.set(tex, entry);
    } else if (
      tex.needsUpdate &&
      !("isTextureArray" in tex && (tex as TextureArray).isTextureArray)
    ) {
      // The source image may have been resized since first upload (e.g. a `TextTexture` whose
      // canvas grows/shrinks on `setText`). Copying the full current bounds into the original,
      // differently-sized GPU texture would exceed its dimensions and trigger a WebGPU validation
      // error ("Texture copy range ... touches outside of [Texture ...]"). Detect that and re-create
      // the GPU texture at the new size instead of re-uploading into the stale one.
      const width = tex.image.width;
      const height = tex.image.height;
      if (width !== entry.width || height !== entry.height) {
        const mipLevelCount =
          quality?.mipmapping && tex.generateMipmaps ? this.computeMipLevelCount(width, height) : 1;
        const t = this._device.createTexture({
          size: [width, height],
          format: "rgba8unorm",
          mipLevelCount,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this._device.queue.copyExternalImageToTexture({ source: tex.image }, { texture: t }, [
          width,
          height,
        ]);
        if (mipLevelCount > 1) this._generateMipmaps(t, mipLevelCount);
        entry = {
          texture: t,
          view: t.createView(),
          mipLevelCount,
          width,
          height,
        };
        this._textureViewCache.set(tex, entry);
      } else {
        this._device.queue.copyExternalImageToTexture(
          { source: tex.image },
          { texture: entry.texture },
          [width, height],
        );
        if (entry.mipLevelCount > 1) this._generateMipmaps(entry.texture, entry.mipLevelCount);
      }
      tex.needsUpdate = false;
    }
    return entry.view;
  }

  /**
   * Resolves and caches a block-compressed texture's GPU texture + view, uploading each mip
   * level's bytes directly via `queue.writeTexture` (WebGPU requires block-formatted data, so
   * `copyExternalImageToTexture` cannot be used). The device must expose the matching
   * texture-compression feature -- callers pre-check device support before assigning
   * `Texture.compressedImage`.
   */
  private _getOrCreateCompressedEntry(tex: Texture): {
    texture: GPUTexture;
    view: GPUTextureView;
    mipLevelCount: number;
    width: number;
    height: number;
  } {
    const existing = this._textureViewCache.get(tex);
    if (existing) return existing;

    const compressed = tex.compressedImage!;
    const format = this._webgpuFormat(compressed.format);
    const requiredFeature = this._featureForFormat(compressed.format);
    if (requiredFeature && !this._device.features.has(requiredFeature)) {
      throw new Error(
        `[GPUTextureResourceCache] Device lacks "${requiredFeature}" feature required to upload compressed format ${compressed.format}`,
      );
    }
    const mipLevelCount = compressed.mipData.length;

    const texture = this._device.createTexture({
      size: [compressed.width, compressed.height],
      format,
      mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    for (let level = 0; level < mipLevelCount; level++) {
      const levelWidth = Math.max(1, compressed.width >> level);
      const levelHeight = Math.max(1, compressed.height >> level);
      const layout = this._blockLayout(compressed.format, levelWidth, levelHeight);
      this._device.queue.writeTexture(
        { texture, mipLevel: level },
        compressed.mipData[level]!,
        { offset: 0, bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rowsPerImage },
        [levelWidth, levelHeight],
      );
    }

    const view = texture.createView();
    const entry = {
      texture,
      view,
      mipLevelCount,
      width: compressed.width,
      height: compressed.height,
    };
    this._textureViewCache.set(tex, entry);
    return entry;
  }

  /**
   * Texel-block stride for `queue.writeTexture` on block-compressed formats. For these formats
   * the source is a flat array of 4x4 texel blocks; `bytesPerRow` is the byte stride between
   * successive *block rows* (columns across × bytes-per-block) and `rowsPerImage` is the number
   * of block rows per image. WebGPU validates block-compressed uploads against exactly these
   * block-aligned strides (the 256-byte `bytesPerRow` rule only applies to buffer copies).
   */
  private _blockLayout(
    format: CompressedTextureFormat,
    width: number,
    height: number,
  ): { bytesPerRow: number; rowsPerImage: number } {
    const blocksX = Math.max(1, Math.ceil(width / 4));
    const rowsPerImage = Math.max(1, Math.ceil(height / 4));
    switch (format) {
      case "bc1_rgb":
        return { bytesPerRow: blocksX * 8, rowsPerImage };
      case "bc3_rgba":
      case "bc7_rgba":
      case "astc_4x4_rgba":
      case "etc2_rgba8":
        return { bytesPerRow: blocksX * 16, rowsPerImage };
      default: {
        const exhaustive: never = format;
        throw new Error(`[GPUTextureResourceCache] Unknown compressed format ${exhaustive}`);
      }
    }
  }

  private _webgpuFormat(format: CompressedTextureFormat): GPUTextureFormat {
    switch (format) {
      case "bc1_rgb":
        return "bc1-rgba-unorm";
      case "bc3_rgba":
        return "bc3-rgba-unorm";
      case "bc7_rgba":
        return "bc7-rgba-unorm";
      case "astc_4x4_rgba":
        return "astc-4x4-unorm";
      case "etc2_rgba8":
        return "etc2-rgba8unorm";
      default: {
        const exhaustive: never = format;
        throw new Error(`[GPUTextureResourceCache] Unknown compressed format ${exhaustive}`);
      }
    }
  }

  /** WebGPU feature required to upload the given compressed format, if any. */
  private _featureForFormat(format: CompressedTextureFormat): GPUFeatureName | undefined {
    switch (format) {
      case "bc1_rgb":
      case "bc3_rgba":
      case "bc7_rgba":
        return "texture-compression-bc";
      case "astc_4x4_rgba":
        return "texture-compression-astc";
      case "etc2_rgba8":
        return "texture-compression-etc2";
      default: {
        const exhaustive: never = format;
        throw new Error(`[GPUTextureResourceCache] Unknown compressed format ${exhaustive}`);
      }
    }
  }

  public getNormalTextureView(tex: Texture | undefined): GPUTextureView {
    if (!tex || !tex.isLoaded || !tex.image) return this._fallback.flatNormalTextureView;
    return this.getTextureView(tex, undefined);
  }

  public getCubeTextureView(
    tex: CubeTexture | undefined,
    quality: QualityConfig | undefined,
  ): GPUTextureView {
    if (quality?.disableTextures) return this._fallback.defaultCubeTextureView;
    if (!tex || !tex.isLoaded) return this._fallback.defaultCubeTextureView;
    if (tex instanceof RenderTargetCube) {
      const entry = this._cubeTextureViewCache.get(tex);
      return entry?.view || this._fallback.defaultCubeTextureView;
    }
    if (tex.images.length !== 6 && tex.mipmaps.length === 0)
      return this._fallback.defaultCubeTextureView;
    let entry = this._cubeTextureViewCache.get(tex);
    if (!entry) {
      const img = tex.mipmaps.length > 0 ? tex.mipmaps[0]![0]! : tex.images[0]!;
      const mipLevelCount = tex.mipmaps.length > 0 ? tex.mipmaps.length : 1;
      const t = this._device.createTexture({
        size: [img.width, img.height, 6],
        format: "rgba8unorm",
        mipLevelCount,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const baseImages = tex.mipmaps.length > 0 ? tex.mipmaps[0]! : tex.images;
      for (let i = 0; i < 6; i++) {
        this._device.queue.copyExternalImageToTexture(
          { source: baseImages[i]! },
          { texture: t, mipLevel: 0, origin: [0, 0, i] },
          [img.width, img.height],
        );
      }

      for (let m = 1; m < mipLevelCount; m++) {
        const mipImages = tex.mipmaps[m]!;
        const mipSize = Math.max(1, Math.floor(img.width / Math.pow(2, m)));
        for (let i = 0; i < 6; i++) {
          this._device.queue.copyExternalImageToTexture(
            { source: mipImages[i]! },
            { texture: t, mipLevel: m, origin: [0, 0, i] },
            [mipSize, mipSize],
          );
        }
      }
      entry = { texture: t, view: t.createView({ dimension: "cube" }) };
      this._cubeTextureViewCache.set(tex, entry);
    }
    return entry.view;
  }

  /** Called from `WebGPURenderer.render()`'s offscreen-render-target branch once a
   * `RenderTarget`'s GPU texture (re)exists, so `getTextureView()` can find it when the render
   * target is later sampled as an ordinary material texture. */
  public registerRenderTargetTexture(
    rt: RenderTarget,
    texture: GPUTexture,
    view: GPUTextureView,
  ): void {
    this._textureViewCache.set(rt, {
      texture,
      view,
      mipLevelCount: 1,
      width: rt.width,
      height: rt.height,
    });
  }

  /** Cube counterpart of `registerRenderTargetTexture()`. */
  public registerRenderTargetCubeTexture(
    rt: RenderTargetCube,
    texture: GPUTexture,
    view: GPUTextureView,
  ): void {
    this._cubeTextureViewCache.set(rt, { texture, view });
  }

  /**
   * Tracks that `obj` currently depends on the textures in `textures` (typically
   * `material.getRenderManifest().textures`). Called once per object per frame from
   * the render loop -- but not always from the same pass: `MainRenderPass`,
   * `DepthPrePassGPU`, `CascadedShadowPassGPU` and `SpotShadowPassGPU` all call this for the
   * same `obj` with DIFFERENT manifests (the depth/shadow passes use a single shared
   * depth-only material, so their manifest only carries the texture keys that material
   * actually declares -- e.g. no `u_normalMap`/`u_metallicMap`/`u_roughnessMap`/`u_emissiveMap`).
   * `textures` is diffed key-by-key against `obj`'s last-known snapshot rather than by
   * container reference, since a material's manifest object is created once and mutated in
   * place on every `getRenderManifest()` call. Keys absent from THIS call's `textures` are left
   * untouched in the stored snapshot (merged, not replaced) -- otherwise a narrower-keyed call
   * (e.g. the depth pass's) would wipe out keys a fuller-keyed call (e.g. the main pass's) had
   * just acquired, making every subsequent pass see a spurious "newly changed" key and
   * needlessly release+reacquire (and thus destroy+recreate) a texture that's still in active use.
   */
  public acquireTextures(
    obj: Object3D,
    textures: Record<string, Texture | CubeTexture | undefined>,
  ): void {
    let lastTextures = this._lastKnownTextures.get(obj);
    if (!lastTextures) {
      lastTextures = {};
      this._lastKnownTextures.set(obj, lastTextures);
    }

    for (const key in textures) {
      const current = textures[key];
      const last = lastTextures[key];
      if (current !== last) {
        if (last) this._releaseTexture(last);
        if (current) this._acquireTexture(current);
        lastTextures[key] = current;
      }
    }
  }

  /**
   * Holds a reference on a texture that is bound outside any object's material -- the scene's IBL
   * maps inside the global bind group. Without it, the last object that also uses the same texture
   * (say a skybox sharing the prefilter cube) drops the count to zero when it is removed, the
   * texture is destroyed, and every later submit fails with "Destroyed texture used in a submit".
   */
  public retainTexture(tex: Texture | CubeTexture): void {
    this._acquireTexture(tex);
  }

  /** Releases a reference taken with `retainTexture()`; destroys the texture if it was the last. */
  public releaseRetainedTexture(tex: Texture | CubeTexture): void {
    this._releaseTexture(tex);
  }

  public releaseObjectTextures(obj: Object3D): void {
    const textures = this._lastKnownTextures.get(obj);
    if (!textures) return;
    this._lastKnownTextures.delete(obj);
    for (const key in textures) {
      const tex = textures[key];
      if (tex) this._releaseTexture(tex);
    }
  }

  private _acquireTexture(tex: Texture | CubeTexture): void {
    if (tex instanceof CubeTexture) {
      this._texCubeRefCounts.set(tex, (this._texCubeRefCounts.get(tex) ?? 0) + 1);
    } else {
      this._texRefCounts.set(tex, (this._texRefCounts.get(tex) ?? 0) + 1);
    }
  }

  private _releaseTexture(tex: Texture | CubeTexture): void {
    // Render targets are backed by the same Texture/CubeTexture base classes (so they
    // can be assigned directly to a material, e.g. for portals/mirrors/reflection
    // probes) but are re-rendered into and reused across frames independently of any
    // one object's material reference -- their lifecycle belongs to whoever owns the
    // render target, not to this per-object refcount. Only untrack our reference to
    // it, never destroy the underlying GPUTexture here.
    if (tex instanceof RenderTarget || tex instanceof RenderTargetCube) return;

    if (tex instanceof CubeTexture) {
      const count = (this._texCubeRefCounts.get(tex) ?? 1) - 1;
      if (count <= 0) {
        this._cubeTextureViewCache.get(tex)?.texture.destroy();
        this._cubeTextureViewCache.delete(tex);
        this._texCubeRefCounts.delete(tex);
      } else {
        this._texCubeRefCounts.set(tex, count);
      }
    } else {
      const count = (this._texRefCounts.get(tex) ?? 1) - 1;
      if (count <= 0) {
        this._textureViewCache.get(tex)?.texture.destroy();
        this._textureViewCache.delete(tex);
        this._texRefCounts.delete(tex);
      } else {
        this._texRefCounts.set(tex, count);
      }
    }
  }

  /** `1 + floor(log2(max(w, h)))` -- the standard (and WebGPU-max-valid) full mip chain length
   * down to a 1x1 level. Texture minification wants the complete chain (unlike e.g.
   * `BloomPassGPU`'s capped chain, a performance choice for a per-frame blur). Also reused by
   * `WebGPURenderer.setSize()` to size the (unrelated) HZB occlusion pyramid -- same formula,
   * one owner. */
  public computeMipLevelCount(width: number, height: number): number {
    return 1 + Math.floor(Math.log2(Math.max(width, height)));
  }

  /** Renders `texture`'s mip chain (levels `1..mipLevelCount-1`) from the already-uploaded
   * level 0, one bilinear fullscreen blit per level -- WebGPU has no `generateMipmap()`
   * equivalent to WebGL2's `gl.generateMipmap()` (same technique as Toji's `webgpu-utils`
   * `generateMips`). Runs on its own throwaway `GPUCommandEncoder` with an immediate
   * `queue.submit()`, decoupled from the frame's main encoder: callers (`getTextureView()`) run
   * mid-frame, while the main render pass may already be open, and WebGPU only allows one open
   * render pass per encoder at a time. `queue` operations are ordered, so this submit is
   * guaranteed visible to the main pass's later sampling of this texture. */
  private _generateMipmaps(texture: GPUTexture, mipLevelCount: number): void {
    const ce = this._device.createCommandEncoder();
    for (let level = 1; level < mipLevelCount; level++) {
      const srcView = texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 });
      const dstView = texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
      const bg = this._device.createBindGroup({
        layout: this._mipGenBGL,
        entries: [
          { binding: 0, resource: this._mipGenSampler },
          { binding: 1, resource: srcView },
        ],
      });
      const rp = ce.beginRenderPass({
        colorAttachments: [
          {
            view: dstView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      rp.setPipeline(this._mipGenPipeline);
      rp.setBindGroup(0, bg);
      rp.draw(3);
      rp.end();
    }
    this._device.queue.submit([ce.finish()]);
  }

  public dispose(): void {
    for (const entry of this._textureViewCache.values()) entry.texture.destroy();
    this._textureViewCache.clear();
    this._texRefCounts.clear();
    this._samplerCache.clear();
    for (const entry of this._cubeTextureViewCache.values()) entry.texture.destroy();
    this._cubeTextureViewCache.clear();
    this._texCubeRefCounts.clear();
  }
}
