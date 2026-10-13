import { CompressedTextureFormat, TextureFilter, TextureWrap } from "../../enums/index.js";
import { AssetManager } from "../../loaders/AssetManager.js";
/**
 * Configuration options for creating a texture.
 */
export interface TextureOptions {
  /** The magnification filter. */
  magFilter?: TextureFilter;
  /** The minification filter. */
  minFilter?: TextureFilter;
  /** The wrapping mode for the U coordinate. */
  addressModeU?: TextureWrap;
  /** The wrapping mode for the V coordinate. */
  addressModeV?: TextureWrap;
  /** Whether to generate mipmaps. Defaults to true. */
  generateMipmaps?: boolean;
  /** Anisotropic filtering level for this texture. Defaults to 1, which inherits the engine-wide
   * `quality.maxAnisotropy` level; `0` disables filtering and `> 1` requests an explicit level
   * (never above the engine cap or the device limit). Only mipmapped textures are affected. */
  anisotropy?: number;
  /** Whether the image should be flipped vertically during loading. Defaults to false. */
  flipY?: boolean;
  /** The AssetManager instance to use for `fromUrl()`. Defaults to a fresh private instance
   * (not the deprecated process-wide singleton) -- pass this to share caching/headers/base-URL
   * across multiple texture loads within the same engine instance. */
  assetManager?: AssetManager;
}

/**
 * Block-compressed texture payload, uploaded to the GPU as-is (no CPU->RGBA
 * decode, no per-texel VRAM cost). The mip chain is provided explicitly since
 * compressed texture files ship their own mipmaps -- `generateMipmaps` must be
 * `false` for compressed textures so the renderer uploads exactly these levels.
 */
export interface CompressedImage {
  /** Which GPU block format these bytes use. */
  format: CompressedTextureFormat;
  /** Full-resolution width of the base level. */
  width: number;
  /** Full-resolution height of the base level. */
  height: number;
  /** Per-mip-level payloads (index 0 = base level). Each entry is the raw block data. */
  mipData: Uint8Array[];
}

/**
 * Represents a 2D texture.
 */
export class Texture {
  /** The underlying image, bitmap, or canvas data. */
  public image: HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined = undefined;
  /**
   * Optional block-compressed payload. When present, `image` is `undefined` and
   * renderers upload `compressedImage` directly via `compressedTexImage2D`
   * (WebGL2) / compressed texture formats (WebGPU) instead of sampling `image`.
   */
  public compressedImage: CompressedImage | undefined = undefined;
  /** Whether the texture is fully loaded and ready for use. */
  public isLoaded: boolean = false;
  /** Set to true after mutating `image` in place (e.g. redrawing a canvas) to force a GPU re-upload. */
  public needsUpdate: boolean = false;

  /** The magnification filter. */
  public magFilter: TextureFilter = TextureFilter.DEFAULT;
  /** The minification filter. */
  public minFilter: TextureFilter = TextureFilter.DEFAULT;
  /** The wrapping mode for the U coordinate. */
  public addressModeU: TextureWrap = TextureWrap.DEFAULT;
  /** The wrapping mode for the V coordinate. */
  public addressModeV: TextureWrap = TextureWrap.DEFAULT;
  /** Whether mipmaps should be generated for this texture. */
  public generateMipmaps: boolean = true;
  /** Desired anisotropic filtering level for this texture. Defaults to 1 (inherits the
   * engine-wide level; see `TextureOptions.anisotropy`). */
  public anisotropy: number = 1;

  /** The UV offset. */
  public offset: { x: number; y: number } = { x: 0, y: 0 };
  /** The UV repeat factors. */
  public repeat: { x: number; y: number } = { x: 1, y: 1 };

  /**
   * Protected constructor. Use static factory methods to create instances.
   * @param image Optional initial image data.
   * @param options Optional configuration options.
   */
  protected constructor(
    image?: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
    options: TextureOptions = {},
  ) {
    if (image) {
      this.image = image;
      this.isLoaded = true;
    }
    const {
      magFilter = TextureFilter.DEFAULT,
      minFilter = TextureFilter.DEFAULT,
      addressModeU = TextureWrap.DEFAULT,
      addressModeV = TextureWrap.DEFAULT,
      generateMipmaps = true,
      anisotropy = 1,
    } = options;

    this.magFilter = magFilter;
    this.minFilter = minFilter;
    this.addressModeU = addressModeU;
    this.addressModeV = addressModeV;
    this.generateMipmaps = generateMipmaps;
    this.anisotropy = anisotropy;
  }

  /**
   * Releases the CPU-side pixel data: closes an `ImageBitmap`, shrinks a canvas' backing store to
   * zero and drops the references. GPU copies are owned by the renderers and are freed when the
   * objects/materials using the texture are removed from the scene; this only frees what the
   * texture itself holds (e.g. a procedural canvas). Call it after the scene using the texture is
   * destroyed: a disposed texture reads as not loaded, so renderers sample their white fallback.
   */
  public dispose(): void {
    const image = this.image;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      image.close();
    } else if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) {
      image.width = 0;
      image.height = 0;
    }
    this.image = undefined;
    this.compressedImage = undefined;
    this.isLoaded = false;
  }

  /**
   * Flips the texture horizontally by modifying the UV offset and repeat.
   * @returns This texture instance for chaining.
   */
  public flipX(): this {
    this.repeat.x *= -1;
    this.offset.x = this.repeat.x < 0 ? 1 : 0;
    return this;
  }

  /**
   * Flips the texture vertically by modifying the UV offset and repeat.
   * @returns This texture instance for chaining.
   */
  public flipY(): this {
    this.repeat.y *= -1;
    this.offset.y = this.repeat.y < 0 ? 1 : 0;
    return this;
  }

  /**
   * Creates a texture from an existing image or bitmap.
   * @param image The image or bitmap data.
   * @param options Optional configuration options.
   * @returns A new Texture instance.
   */
  public static fromImage(
    image: HTMLImageElement | ImageBitmap,
    options?: TextureOptions,
  ): Texture {
    return new Texture(image, options);
  }

  /**
   * Creates a texture backed directly by a canvas. Redraw the canvas and set `needsUpdate = true`
   * to push the new pixels to the GPU on the next frame.
   * @param canvas The canvas to use as the texture's pixel source.
   * @param options Optional configuration options.
   * @returns A new Texture instance.
   */
  public static fromCanvas(canvas: HTMLCanvasElement, options?: TextureOptions): Texture {
    return new Texture(canvas, options);
  }

  /**
   * Creates a texture backed by an explicit block-compressed mip chain
   * (e.g. decoded from a KTX2 `KHR_texture_basisu` payload). The renderer uploads
   * the bytes as-is, keeping the data GPU-compressed.
   * @param compressedImage The compressed payload (format + mip chain).
   * @param options Optional configuration options -- `generateMipmaps` must be
   * `false`, since every level is supplied explicitly.
   * @returns A new Texture instance.
   */
  public static fromCompressed(
    compressedImage: CompressedImage,
    options?: TextureOptions,
  ): Texture {
    const tex = new Texture(undefined, { ...options, generateMipmaps: false });
    tex.compressedImage = compressedImage;
    tex.isLoaded = true;
    return tex;
  }

  /**
   * Creates an empty texture placeholder.
   * @param options Optional configuration options.
   * @returns A new empty Texture instance.
   */
  public static empty(options?: TextureOptions): Texture {
    return new Texture(undefined, options);
  }

  /**
   * Loads a texture from a URL.
   * @param url The URL of the image.
   * @param options Optional configuration options.
   * @returns A promise that resolves to a new Texture instance.
   */
  public static async fromUrl(url: string, options?: TextureOptions): Promise<Texture> {
    const assetManager = options?.assetManager ?? new AssetManager();
    const image = await assetManager.loadImage(url, undefined, options?.flipY);
    return new Texture(image, options);
  }
}
