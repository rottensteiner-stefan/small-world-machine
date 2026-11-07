import { AbstractLoader } from "./AbstractLoader.js";
import { EventType } from "../enums/index.js";
import type { ImageLoaderOptions } from "../interfaces/index.js";

/**
 * Loader for image assets.
 */
export class ImageLoader extends AbstractLoader<ImageBitmap | HTMLImageElement> {
  /** Whether the image should be flipped vertically during loading. Defaults to true. */
  public flipY: boolean = true;

  /**
   * Creates a new ImageLoader.
   * @param options Optional configuration options.
   */
  constructor(options: ImageLoaderOptions = {}) {
    super(options);
    this.flipY = options.flipY ?? true;
  }

  /** @inheritdoc */
  public override async load(url: string): Promise<ImageBitmap | HTMLImageElement> {
    const fullUrl: string = this.basePath + url;
    this.dispatchEvent(EventType.LOADER_START, { url: fullUrl });

    try {
      const image: ImageBitmap | HTMLImageElement = await this._assetManager.loadImage(
        fullUrl,
        (loaded: number, total: number) => {
          this.dispatchEvent(EventType.LOADER_PROGRESS, { url: fullUrl, loaded, total });
        },
        this.flipY,
      );

      this.dispatchEvent(EventType.LOADER_END, { url: fullUrl, data: image });
      return image;
    } catch (error: unknown) {
      this.dispatchEvent(EventType.LOADER_ERROR, { url: fullUrl, error });
      throw error;
    }
  }
}
