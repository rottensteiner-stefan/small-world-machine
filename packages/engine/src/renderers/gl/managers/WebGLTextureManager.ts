import type { Object3D, TextureArray, Texture } from "../../../core/index.js";
import { CubeTexture } from "../../../core/index.js";
import { RenderTarget, RenderTargetCube } from "../../../core/textures/index.js";
import type { QualityConfig } from "../../../interfaces/index.js";
import type { CompressedTextureFormat } from "../../../enums/index.js";
import { TextureFilter, TextureWrap } from "../../../enums/index.js";
import { applyAnisotropy } from "../../anisotropy.js";

/** GLSL dialect this texture manager uploads for -- see `GlslDialect` in `WebGLProgramCache.ts`.
 * `glsl100` (WebGL1) additionally enforces WebGL1's NPOT constraints and supports no
 * `TextureArray`/compressed/cubemap-mipmap upload; `glsl300` (WebGL2) uploads all of those. */
export type GlslDialect = "glsl100" | "glsl300";

/** Constructor options for `WebGLTextureManager`. */
export interface WebGLTextureManagerOptions {
  /** GLSL dialect to upload for -- `glsl300` (WebGL2) unless WebGL1 selects `glsl100`. */
  dialect?: GlslDialect;
}

/**
 * Uploaded-texture GPU state: 2D/cube `WebGLTexture` upload + re-upload (`needsUpdate`) for BOTH
 * WebGL dialects, and per-`Texture`/`CubeTexture` refcounting so a texture shared by multiple
 * objects is only destroyed once nothing references it anymore.
 *
 * This is the shared GL manager layer's texture half (see the thermo report 01 #25): the same
 * class is mounted by `WebGL1Renderer` (`glsl100`) and `WebGL2Renderer` (`glsl300`), which
 * previously reimplemented it against each other. The 2D texture cache (`texCache`) is passed in
 * rather than owned here: `AbstractWebGLRenderer._texCache` is shared, unmodified WebGL1/WebGL2
 * base-class state (its render-target registration, `copyToOpaqueTexture()`'s dummy-texture
 * bookkeeping -- read/write it directly), so this class mutates that same `Map` instance instead
 * of forking a second, out-of-sync copy. The cube cache has no such WebGL1 sharing, so it's owned
 * entirely by this class.
 */
export class WebGLTextureManager {
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _dialect: GlslDialect;
  private readonly _texCache: Map<Texture, WebGLTexture>;
  private readonly _defaultTexture: WebGLTexture;
  private readonly _defaultCubeTexture: WebGLTexture;

  private _texCubeCache = new Map<CubeTexture, WebGLTexture>();
  private _texRefCounts = new Map<Texture, number>();
  private _texCubeRefCounts = new Map<CubeTexture, number>();
  private _lastKnownTextures = new WeakMap<
    Object3D,
    Record<string, Texture | CubeTexture | undefined>
  >();

  constructor(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    texCache: Map<Texture, WebGLTexture>,
    defaultTexture: WebGLTexture,
    defaultCubeTexture: WebGLTexture,
    options: WebGLTextureManagerOptions = {},
  ) {
    this._gl = gl;
    this._texCache = texCache;
    this._defaultTexture = defaultTexture;
    this._defaultCubeTexture = defaultCubeTexture;
    this._dialect = options.dialect ?? "glsl300";
  }

  /** The context narrowed to WebGL2 -- only valid on the `glsl300` (WebGL2) path, where the
   * 3D/array/compressed upload helpers below are reached. */
  private get _gl2(): WebGL2RenderingContext {
    return this._gl as WebGL2RenderingContext;
  }

  /** Same early-exit logic as the (WebGL2) `_fastPath()`, minus the compressed-texture clause
   * WebGL2 adds -- WebGL1 has no compressed upload path. */
  private _fastPath100(tex: Texture, quality: QualityConfig | undefined): WebGLTexture | undefined {
    if (quality?.disableTextures) return this._defaultTexture;
    if (!tex.isLoaded) return this._defaultTexture;
    if (tex instanceof RenderTarget) {
      return this._texCache.get(tex) || this._defaultTexture;
    }
    if (!tex.image) return this._defaultTexture;
    return undefined;
  }

  /** Same early-exit logic as `AbstractWebGLRenderer._getWebGLTextureFastPath()`, duplicated here
   * (rather than depending on the renderer) since this class has no other reason to reference it. */
  private _fastPath(tex: Texture, quality: QualityConfig | undefined): WebGLTexture | undefined {
    if (quality?.disableTextures) return this._defaultTexture;
    if (!tex.isLoaded) return this._defaultTexture;
    if (tex instanceof RenderTarget) {
      return this._texCache.get(tex) || this._defaultTexture;
    }
    // Compressed textures are fully loaded via `compressedImage` -- never route
    // them through the (image-less) default texture fast path.
    if (!tex.image && !tex.compressedImage) return this._defaultTexture;
    return undefined;
  }

  /** Applies the texture's mag/min filter and wrap state for `target`. Kept in one place so the
   * first-upload and `needsUpdate` paths stay in lockstep -- see the `needsUpdate` branch below. */
  private _setSamplerParams(
    target: number,
    tex: Texture,
    useMipmaps: boolean,
    quality: QualityConfig | undefined,
  ): void {
    this._gl.texParameteri(
      target,
      this._gl.TEXTURE_MAG_FILTER,
      TextureFilter.NEAREST === tex.magFilter ? this._gl.NEAREST : this._gl.LINEAR,
    );

    let minFilter: number = this._gl.LINEAR;
    if (useMipmaps) {
      minFilter =
        TextureFilter.NEAREST === tex.minFilter
          ? this._gl.NEAREST_MIPMAP_LINEAR
          : this._gl.LINEAR_MIPMAP_LINEAR;
    } else {
      if (TextureFilter.NEAREST === tex.minFilter) minFilter = this._gl.NEAREST;
    }
    this._gl.texParameteri(target, this._gl.TEXTURE_MIN_FILTER, minFilter);

    const wrapS =
      TextureWrap.REPEAT === tex.addressModeU
        ? this._gl.REPEAT
        : TextureWrap.MIRRORED_REPEAT === tex.addressModeU
          ? this._gl.MIRRORED_REPEAT
          : this._gl.CLAMP_TO_EDGE;
    const wrapT =
      TextureWrap.REPEAT === tex.addressModeV
        ? this._gl.REPEAT
        : TextureWrap.MIRRORED_REPEAT === tex.addressModeV
          ? this._gl.MIRRORED_REPEAT
          : this._gl.CLAMP_TO_EDGE;
    this._gl.texParameteri(target, this._gl.TEXTURE_WRAP_S, wrapS);
    this._gl.texParameteri(target, this._gl.TEXTURE_WRAP_T, wrapT);

    // Anisotropic filtering requires a bound target and only sharpens mip-selected sampling --
    // same gating (mipmaps on) as the min filter above.
    applyAnisotropy(this._gl, target, tex, quality, useMipmaps);
  }

  /** WebGL1-only sampler state (previously WebGL1Renderer._setWebGL1SamplerParams): WebGL1 only
   * supports mipmaps and REPEAT/MIRRORED_REPEAT wrapping for power-of-two textures -- generating
   * mipmaps on an NPOT texture throws GL_INVALID_OPERATION, and leaving wrap at the REPEAT default
   * makes an NPOT texture "incomplete" (silently samples black). Matches the cube-texture fix in
   * `_uploadCubeTexture100`. Kept in one place so the first-upload and `needsUpdate` paths of the
   * `glsl100` branch stay in lockstep. */
  private _setSamplerParams100(
    img: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
    tex: Texture,
    quality: QualityConfig | undefined,
  ): void {
    const isPOT = 0 === (img.width & (img.width - 1)) && 0 === (img.height & (img.height - 1));
    const useMipmaps = quality?.mipmapping && tex.generateMipmaps && isPOT;
    if (useMipmaps) this._gl.generateMipmap(this._gl.TEXTURE_2D);
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_MAG_FILTER,
      TextureFilter.NEAREST === tex.magFilter ? this._gl.NEAREST : this._gl.LINEAR,
    );
    // Same filter/wrap semantics as the WebGL2 path (`_setSamplerParams`); only NPOT textures are
    // forced to CLAMP_TO_EDGE without mipmaps, because WebGL1 cannot do anything else with them.
    let minFilter: number = this._gl.LINEAR;
    if (useMipmaps) {
      minFilter =
        TextureFilter.NEAREST === tex.minFilter
          ? this._gl.NEAREST_MIPMAP_LINEAR
          : this._gl.LINEAR_MIPMAP_LINEAR;
    } else if (TextureFilter.NEAREST === tex.minFilter) {
      minFilter = this._gl.NEAREST;
    }
    this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, minFilter);

    const wrapOf = (mode: TextureWrap): number =>
      TextureWrap.REPEAT === mode
        ? this._gl.REPEAT
        : TextureWrap.MIRRORED_REPEAT === mode
          ? this._gl.MIRRORED_REPEAT
          : this._gl.CLAMP_TO_EDGE;
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_WRAP_S,
      isPOT ? wrapOf(tex.addressModeU) : this._gl.CLAMP_TO_EDGE,
    );
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_WRAP_T,
      isPOT ? wrapOf(tex.addressModeV) : this._gl.CLAMP_TO_EDGE,
    );
    // Anisotropic filtering sharpens mip-selected sampling -- same mipmap gate as the min filter.
    applyAnisotropy(this._gl, this._gl.TEXTURE_2D, tex, quality, Boolean(useMipmaps));
  }

  /** Uploads (or re-uploads, on `needsUpdate`) every layer of a `TextureArray` into `glTex`.
   * Shared by the first-upload and `needsUpdate` branches of `getWebGLTexture()` so both stay in
   * lockstep -- previously `needsUpdate` skipped `TextureArray` entirely (it never got new pixel
   * or sampler data after the initial upload). WebGL2 only. */
  private _uploadTextureArray(
    texArray: TextureArray,
    glTex: WebGLTexture,
    quality: QualityConfig | undefined,
  ): void {
    this._gl.bindTexture(this._gl2.TEXTURE_2D_ARRAY, glTex);
    const width = texArray.image!.width;
    const height = texArray.image!.height;
    const depth = texArray.images.length;

    this._gl2.texImage3D(
      this._gl2.TEXTURE_2D_ARRAY,
      0,
      this._gl.RGBA,
      width,
      height,
      depth,
      0,
      this._gl.RGBA,
      this._gl.UNSIGNED_BYTE,
      null,
    );
    for (let i = 0; i < depth; i++) {
      this._gl2.texSubImage3D(
        this._gl2.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        i,
        width,
        height,
        1,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        texArray.images[i] as TexImageSource,
      );
    }

    const useMipmaps = quality?.mipmapping && texArray.generateMipmaps;
    if (useMipmaps) this._gl.generateMipmap(this._gl2.TEXTURE_2D_ARRAY);

    this._setSamplerParams(this._gl2.TEXTURE_2D_ARRAY, texArray, Boolean(useMipmaps), quality);
  }

  /**
   * Uploads a block-compressed texture (`tex.compressedImage`) via
   * `compressedTexImage2D`, one call per mip level. The GL block enum depends on
   * the context's extended capabilities (S3TC/BPTC/ASTC), so these are looked up
   * lazily. WebGL2 has ETC2 core (no extension), hence it needs no lookup.
   */
  private _uploadCompressedTexture(tex: Texture, glTex: WebGLTexture): void {
    const compressed = tex.compressedImage!;
    this._gl.bindTexture(this._gl.TEXTURE_2D, glTex);

    for (let level = 0; level < compressed.mipData.length; level++) {
      const levelWidth = Math.max(1, compressed.width >> level);
      const levelHeight = Math.max(1, compressed.height >> level);
      this._gl.compressedTexImage2D(
        this._gl.TEXTURE_2D,
        level,
        this._glInternalBlockFormat(compressed.format),
        levelWidth,
        levelHeight,
        0,
        compressed.mipData[level]!,
      );
    }

    // The full mip pyramid is supplied explicitly -- WebGL must not expect extra
    // levels beyond what we uploaded.
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl2.TEXTURE_MAX_LEVEL,
      compressed.mipData.length - 1,
    );
  }

  /** Resolves a `CompressedTextureFormat` to its GL block-compressed internal format for this
   * context, requesting the owning extension on demand. Throws if the device does not expose the
   * required extension (callers with fallbacks should pre-check `supportsCompressedFormat`). */
  private _glInternalBlockFormat(format: CompressedTextureFormat): number {
    switch (format) {
      case "bc3_rgba": {
        const ext = this._gl.getExtension("WEBGL_compressed_texture_s3tc");
        if (!ext)
          throw new Error(`[WebGLTextureManager] No S3TC support for compressed format ${format}`);
        return ext.COMPRESSED_RGBA_S3TC_DXT5_EXT;
      }
      case "bc1_rgb": {
        const ext = this._gl.getExtension("WEBGL_compressed_texture_s3tc");
        if (!ext)
          throw new Error(`[WebGLTextureManager] No S3TC support for compressed format ${format}`);
        return ext.COMPRESSED_RGB_S3TC_DXT1_EXT;
      }
      case "bc7_rgba": {
        const ext =
          this._gl.getExtension("EXT_texture_compression_bptc") ??
          this._gl.getExtension("WEBGL_compressed_texture_bptc");
        if (!ext)
          throw new Error(`[WebGLTextureManager] No BPTC support for compressed format ${format}`);
        return ext.COMPRESSED_RGBA_BPTC_UNORM_EXT;
      }
      case "astc_4x4_rgba": {
        const ext = this._gl.getExtension("WEBGL_compressed_texture_astc");
        if (!ext)
          throw new Error(`[WebGLTextureManager] No ASTC support for compressed format ${format}`);
        return ext.COMPRESSED_RGBA_ASTC_4x4_KHR;
      }
      case "etc2_rgba8": {
        // ETC2/EAC is mandatory in WebGL2 (guaranteed present), but the format enum is only
        // reachable through the `WEBGL_compressed_texture_etc` extension object -- the constants
        // are not exposed on the context itself.
        const ext = this._gl.getExtension("WEBGL_compressed_texture_etc");
        if (!ext) {
          throw new Error(`[WebGLTextureManager] No ETC2 support for compressed format ${format}`);
        }
        return ext.COMPRESSED_RGBA8_ETC2_EAC;
      }
      default: {
        const exhaustive: never = format;
        throw new Error(`[WebGLTextureManager] Unknown compressed format ${exhaustive}`);
      }
    }
  }

  private _getWebGLTexture100(tex: Texture, quality: QualityConfig | undefined): WebGLTexture {
    const fastPath = this._fastPath100(tex, quality);
    if (fastPath) return fastPath;
    let glTex: WebGLTexture | undefined = this._texCache.get(tex);
    if (!glTex) {
      // Guaranteed defined here: `_fastPath100()` already returned early for a
      // texture with no `.image` (TS can't carry that narrowing across the method call).
      const img = tex.image!;
      glTex = this._gl.createTexture()!;
      this._gl.bindTexture(this._gl.TEXTURE_2D, glTex);
      this._gl.texImage2D(
        this._gl.TEXTURE_2D,
        0,
        this._gl.RGBA,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        img,
      );

      this._setSamplerParams100(img, tex, quality);
      this._texCache.set(tex, glTex);
    } else if (tex.needsUpdate) {
      // Guaranteed defined here: `_fastPath100()` already returned early for a
      // texture with no `.image` (TS can't carry that narrowing across the method call).
      const img = tex.image!;
      this._gl.bindTexture(this._gl.TEXTURE_2D, glTex);
      this._gl.texImage2D(
        this._gl.TEXTURE_2D,
        0,
        this._gl.RGBA,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        img,
      );
      this._setSamplerParams100(img, tex, quality);
      tex.needsUpdate = false;
    }
    return glTex;
  }

  public getWebGLTexture(tex: Texture, quality: QualityConfig | undefined): WebGLTexture {
    if (this._dialect === "glsl100") return this._getWebGLTexture100(tex, quality);
    const fastPath = this._fastPath(tex, quality);
    if (fastPath) return fastPath;
    let glTex: WebGLTexture | undefined = this._texCache.get(tex);
    if (!glTex) {
      glTex = this._gl.createTexture()!;

      if ("isTextureArray" in tex && (tex as TextureArray).isTextureArray) {
        this._uploadTextureArray(tex as TextureArray, glTex, quality);
      } else if (tex.compressedImage) {
        try {
          this._uploadCompressedTexture(tex, glTex);
        } catch (error) {
          // Unsupported block format: do not leak the half-created texture (it is never cached).
          this._gl.deleteTexture(glTex);
          throw error;
        }
        this._setSamplerParams(this._gl.TEXTURE_2D, tex, false, quality);
      } else {
        this._gl.bindTexture(this._gl.TEXTURE_2D, glTex);
        this._gl.texImage2D(
          this._gl.TEXTURE_2D,
          0,
          this._gl.RGBA,
          this._gl.RGBA,
          this._gl.UNSIGNED_BYTE,
          // Guaranteed defined here: `_fastPath()` already returned early for a texture with no
          // `.image` (TS can't carry that narrowing across the method call).
          tex.image!,
        );

        const useMipmaps = quality?.mipmapping && tex.generateMipmaps;
        if (useMipmaps) this._gl.generateMipmap(this._gl.TEXTURE_2D);

        this._setSamplerParams(this._gl.TEXTURE_2D, tex, Boolean(useMipmaps), quality);
      }

      this._texCache.set(tex, glTex);
    } else if (tex.needsUpdate && !tex.compressedImage) {
      if ("isTextureArray" in tex && (tex as TextureArray).isTextureArray) {
        this._uploadTextureArray(tex as TextureArray, glTex, quality);
      } else {
        this._gl.bindTexture(this._gl.TEXTURE_2D, glTex);
        this._gl.texImage2D(
          this._gl.TEXTURE_2D,
          0,
          this._gl.RGBA,
          this._gl.RGBA,
          this._gl.UNSIGNED_BYTE,
          // Guaranteed defined here: `_fastPath()` already returned early for a texture with no
          // `.image` (TS can't carry that narrowing across the method call).
          tex.image!,
        );
        if (quality?.mipmapping && tex.generateMipmaps) {
          this._gl.generateMipmap(this._gl.TEXTURE_2D);
        }
        this._setSamplerParams(
          this._gl.TEXTURE_2D,
          tex,
          Boolean(quality?.mipmapping && tex.generateMipmaps),
          quality,
        );
      }
      tex.needsUpdate = false;
    }
    return glTex;
  }

  /** WebGL1-only cube upload (previously WebGL1Renderer._getWebGLCubeTexture): no prefiltered
   * mip levels, and CLAMP_TO_EDGE is mandatory -- the default REPEAT wrap makes an NPOT cubemap
   * "incomplete" per spec, which silently samples as solid black (no GL error). */
  private _getWebGLCubeTexture100(
    tex: CubeTexture,
    quality: QualityConfig | undefined,
  ): WebGLTexture {
    const gl = this._gl;
    if (quality?.disableTextures) return this._defaultCubeTexture;
    // A RenderTargetCube's GL texture is allocated/populated by bindMainRenderTarget() (it has no
    // CPU-side images to upload here) -- just return whatever it has already produced.
    if (tex instanceof RenderTargetCube) {
      const glTex = this._texCubeCache.get(tex);
      return glTex ?? this._defaultCubeTexture;
    }
    if (!tex.isLoaded || tex.images.length !== 6) return this._defaultCubeTexture;
    let glTex: WebGLTexture | undefined = this._texCubeCache.get(tex);
    if (!glTex) {
      glTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, glTex);
      for (let i: number = 0; i < 6; i++) {
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          tex.images[i] as ImageBitmap,
        );
      }
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // WebGL1 requires CLAMP_TO_EDGE for any non-power-of-two texture -- the default wrap mode
      // is REPEAT, and leaving that in place makes an NPOT cubemap "incomplete" per spec, which
      // silently samples as solid black (no GL error). Skybox/reflection cubemaps are rarely POT.
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._texCubeCache.set(tex, glTex);
    }
    return glTex;
  }

  public getWebGLCubeTexture(tex: CubeTexture, quality: QualityConfig | undefined): WebGLTexture {
    if (this._dialect === "glsl100") return this._getWebGLCubeTexture100(tex, quality);
    if (quality?.disableTextures) return this._defaultCubeTexture;
    if (!tex.isLoaded) return this._defaultCubeTexture;
    if (tex instanceof RenderTargetCube) {
      const glTex = this._texCubeCache.get(tex);
      return glTex || this._defaultCubeTexture;
    }
    if (tex.images.length !== 6 && tex.mipmaps.length === 0) return this._defaultCubeTexture;
    let glTex: WebGLTexture | undefined = this._texCubeCache.get(tex);
    if (!glTex) {
      glTex = this._gl.createTexture()!;
      this._gl.bindTexture(this._gl.TEXTURE_CUBE_MAP, glTex);

      const baseImages = tex.mipmaps.length > 0 ? tex.mipmaps[0]! : tex.images;
      for (let i: number = 0; i < 6; i++) {
        this._gl.texImage2D(
          this._gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          this._gl.RGBA,
          this._gl.RGBA,
          this._gl.UNSIGNED_BYTE,
          baseImages[i] as ImageBitmap,
        );
      }

      if (tex.mipmaps.length > 1) {
        for (let m = 1; m < tex.mipmaps.length; m++) {
          const mipImages = tex.mipmaps[m]!;
          for (let i = 0; i < 6; i++) {
            this._gl.texImage2D(
              this._gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
              m,
              this._gl.RGBA,
              this._gl.RGBA,
              this._gl.UNSIGNED_BYTE,
              mipImages[i] as ImageBitmap,
            );
          }
        }
        this._gl.texParameteri(
          this._gl.TEXTURE_CUBE_MAP,
          this._gl.TEXTURE_MIN_FILTER,
          this._gl.LINEAR_MIPMAP_LINEAR,
        );
        // Prefiltered IBL maps intentionally stop at a handful of levels (e.g. 128px down to
        // 8px, not all the way to 1x1) -- without an explicit TEXTURE_MAX_LEVEL, WebGL still
        // expects the full pyramid down to 1x1 before considering the texture mipmap-complete,
        // and silently samples it as solid black (per spec, not a driver bug) until it is. This
        // is exactly what made real IBL specular ambient render pitch-black despite every other
        // part of the pipeline (data, binding, shader flags) checking out.
        this._gl.texParameteri(
          this._gl.TEXTURE_CUBE_MAP,
          this._gl2.TEXTURE_MAX_LEVEL,
          tex.mipmaps.length - 1,
        );
      } else {
        this._gl.texParameteri(
          this._gl.TEXTURE_CUBE_MAP,
          this._gl.TEXTURE_MIN_FILTER,
          this._gl.LINEAR,
        );
      }
      this._gl.texParameteri(
        this._gl.TEXTURE_CUBE_MAP,
        this._gl.TEXTURE_MAG_FILTER,
        this._gl.LINEAR,
      );
      this._gl.texParameteri(
        this._gl.TEXTURE_CUBE_MAP,
        this._gl.TEXTURE_WRAP_S,
        this._gl.CLAMP_TO_EDGE,
      );
      this._gl.texParameteri(
        this._gl.TEXTURE_CUBE_MAP,
        this._gl.TEXTURE_WRAP_T,
        this._gl.CLAMP_TO_EDGE,
      );
      this._texCubeCache.set(tex, glTex);
    }
    return glTex;
  }

  /** Registers an externally-created `WebGLTexture` for `tex` (render-target FBO textures, and
   * `WebGL*Renderer.copyToOpaqueTexture()`'s dummy-key bookkeeping) so `getWebGLTexture()` finds
   * it via the fast path instead of trying to upload it. */
  public registerTexture(tex: Texture, glTex: WebGLTexture): void {
    this._texCache.set(tex, glTex);
  }

  /** Cube counterpart of `registerTexture()`, for `RenderTargetCube` FBO textures. */
  public registerCubeTexture(tex: CubeTexture, glTex: WebGLTexture): void {
    this._texCubeCache.set(tex, glTex);
  }

  /** Forgets (without deleting) the texture registered for `tex`; the owner has already freed it. */
  public unregisterTexture(tex: Texture): void {
    this._texCache.delete(tex);
  }

  /** Cube counterpart of `unregisterTexture()`. */
  public unregisterCubeTexture(tex: CubeTexture): void {
    this._texCubeCache.delete(tex);
  }

  /** Raw cube-cache lookup without the default-texture fallback, for render-target bookkeeping
   * (re-pointing cube faces / releasing re-allocated FBO textures). */
  public getCubeTexture(tex: CubeTexture): WebGLTexture | undefined {
    return this._texCubeCache.get(tex);
  }

  /** Deletes and forgets an externally-owned cube texture registered for `tex` (WebGL1's
   * render-target re-allocation path). */
  public deleteCubeTexture(tex: CubeTexture): void {
    const glTex = this._texCubeCache.get(tex);
    if (glTex) this._gl.deleteTexture(glTex);
    this._texCubeCache.delete(tex);
  }

  /**
   * Tracks that `obj` currently depends on the textures in `textures` (typically
   * `material.getRenderManifest().textures`). Called once per object per frame from
   * the render loop. `textures` is diffed key-by-key against `obj`'s last-known
   * snapshot rather than by container reference, since a material's manifest object
   * is created once and mutated in place on every `getRenderManifest()` call.
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
    // it, never delete the underlying WebGLTexture here.
    if (tex instanceof RenderTarget || tex instanceof RenderTargetCube) return;

    if (tex instanceof CubeTexture) {
      const count = (this._texCubeRefCounts.get(tex) ?? 1) - 1;
      if (count <= 0) {
        const glTex = this._texCubeCache.get(tex);
        if (glTex) this._gl.deleteTexture(glTex);
        this._texCubeCache.delete(tex);
        this._texCubeRefCounts.delete(tex);
      } else {
        this._texCubeRefCounts.set(tex, count);
      }
    } else {
      const count = (this._texRefCounts.get(tex) ?? 1) - 1;
      if (count <= 0) {
        const glTex = this._texCache.get(tex);
        if (glTex) this._gl.deleteTexture(glTex);
        this._texCache.delete(tex);
        this._texRefCounts.delete(tex);
      } else {
        this._texRefCounts.set(tex, count);
      }
    }
  }

  public dispose(): void {
    for (const tex of this._texCubeCache.values()) this._gl.deleteTexture(tex);
    this._texCubeCache.clear();
    this._texCubeRefCounts.clear();

    for (const tex of this._texCache.values()) this._gl.deleteTexture(tex);
    this._texCache.clear();
    this._texRefCounts.clear();
  }
}
