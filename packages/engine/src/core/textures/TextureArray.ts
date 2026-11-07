import type { TextureOptions } from "./Texture.js";
import { Texture } from "./Texture.js";
import { AssetManager } from "../../loaders/AssetManager.js";

/**
 * Represents a 2D Texture Array (`sampler2DArray` in WebGL2, `texture_2d_array` in WebGPU).
 * All images must have the exact same dimensions and format.
 */
export class TextureArray extends Texture {
  public images: (HTMLImageElement | ImageBitmap)[];
  public readonly isTextureArray: boolean = true;

  protected constructor(images: (HTMLImageElement | ImageBitmap)[], options: TextureOptions = {}) {
    super(images[0], options);
    this.images = images;
    this.isLoaded = images.length > 0;
  }

  /**
   * Creates a TextureArray from an array of existing images or bitmaps.
   * @param images Array of image or bitmap data.
   * @param options Optional configuration options.
   */
  public static fromImages(
    images: (HTMLImageElement | ImageBitmap)[],
    options?: TextureOptions,
  ): TextureArray {
    return new TextureArray(images, options);
  }

  /**
   * Loads a TextureArray from an array of URLs.
   * @param urls Array of image URLs.
   * @param options Optional configuration options.
   */
  public static async fromUrls(urls: string[], options?: TextureOptions): Promise<TextureArray> {
    const assetManager = options?.assetManager ?? new AssetManager();
    const flipY = options?.flipY ?? true;
    const images = await Promise.all(
      urls.map((url: string) => assetManager.loadImage(url, undefined, flipY)),
    );
    return new TextureArray(images, options);
  }
}
