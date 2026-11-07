import { CubeLayout } from "../../enums/index.js";
import { AssetManager } from "../../loaders/AssetManager.js";

/**
 * Represents a cube map texture.
 */
export class CubeTexture {
  /** The unique identifier of the texture. */
  public uuid: string = crypto.randomUUID();
  /** The six images comprising the cube map. */
  public images: (ImageBitmap | HTMLImageElement)[] = [];
  /** Explicitly pre-baked mipmap levels. Each entry is an array of 6 images. */
  public mipmaps: (ImageBitmap | HTMLImageElement)[][] = [];
  /** Whether the texture is fully loaded. */
  public isLoaded: boolean = false;

  /** The AssetManager instance used to load face images. Defaults to a fresh private instance
   * (not the deprecated process-wide singleton) -- pass one in to share caching/headers/base-URL
   * across multiple texture loads within the same engine instance. */
  private readonly _assetManager: AssetManager;

  /**
   * Creates a new CubeTexture.
   * @param urls Optional array of 6 URLs for the cube faces or a single URL for a tiled texture.
   * @param assetManager Optional AssetManager instance to use for loading. Defaults to a fresh
   * private instance.
   */
  constructor(urls?: string[], assetManager?: AssetManager) {
    this._assetManager = assetManager ?? new AssetManager();
    if (urls && 6 === urls.length) {
      this.loadFrom(urls);
    } else if (urls && 1 === urls.length) {
      const firstUrl: string = urls[0]!;
      this.loadFrom(firstUrl);
    }
  }

  /**
   * Loads the cube map from one or more URLs.
   * @param urls A single URL or an array of URLs.
   * @param layout Optional layout hint for single images (e.g. 6x1 strip, 3x2 grid, or crosses).
   */
  public async loadFrom(urls: string | string[], layout?: CubeLayout): Promise<void> {
    try {
      if (
        Array.isArray(urls) &&
        6 === urls.length &&
        (undefined === layout || CubeLayout.DEFAULT === layout)
      ) {
        this.images = await Promise.all(
          urls.map((url: string) => this._assetManager.loadImage(url, undefined, false)),
        );
        this.isLoaded = true;
        return;
      }

      const url: string = Array.isArray(urls) ? urls[0]! : urls;
      const fullImage: ImageBitmap | HTMLImageElement = await this._assetManager.loadImage(
        url,
        undefined,
        false,
      );
      const w: number = fullImage.width;
      const h: number = fullImage.height;

      // Clear existing images
      this.images = [];

      // Determine layout
      let effectiveLayout: CubeLayout | undefined = layout;
      if (undefined === effectiveLayout) {
        if (w > h) {
          if (Math.round(w / 6) === h) {
            effectiveLayout = CubeLayout.STRIP_HORIZONTAL;
          } else if (Math.round(w / 3) === Math.round(h / 2)) {
            effectiveLayout = CubeLayout.GRID_3X2;
          } else if (Math.round(w / 4) === Math.round(h / 3)) {
            effectiveLayout = CubeLayout.CROSS_HORIZONTAL;
          }
        } else {
          if (Math.round(h / 6) === w) {
            effectiveLayout = CubeLayout.STRIP_VERTICAL;
          } else if (Math.round(h / 4) === Math.round(w / 3)) {
            effectiveLayout = CubeLayout.CROSS_VERTICAL;
          }
        }
      }

      switch (effectiveLayout) {
        case CubeLayout.STRIP_HORIZONTAL: {
          const faceSize: number = Math.round(w / 6);
          for (let i: number = 0; 6 > i; i++) {
            this.images.push(
              await createImageBitmap(fullImage, i * faceSize, 0, faceSize, faceSize),
            );
          }
          break;
        }
        case CubeLayout.STRIP_VERTICAL: {
          const faceSize: number = Math.round(h / 6);
          for (let i: number = 0; 6 > i; i++) {
            this.images.push(
              await createImageBitmap(fullImage, 0, i * faceSize, faceSize, faceSize),
            );
          }
          break;
        }
        case CubeLayout.GRID_3X2: {
          const gridSize: number = Math.round(w / 3);
          for (let y: number = 0; 2 > y; y++) {
            for (let x: number = 0; 3 > x; x++) {
              this.images.push(
                await createImageBitmap(fullImage, x * gridSize, y * gridSize, gridSize, gridSize),
              );
            }
          }
          break;
        }
        case CubeLayout.CROSS_HORIZONTAL: {
          const crossSize: number = Math.round(w / 4);
          // +X: (2, 1)
          this.images.push(
            await createImageBitmap(fullImage, 2 * crossSize, crossSize, crossSize, crossSize),
          );
          // -X: (0, 1)
          this.images.push(await createImageBitmap(fullImage, 0, crossSize, crossSize, crossSize));
          // +Y: (1, 0)
          this.images.push(await createImageBitmap(fullImage, crossSize, 0, crossSize, crossSize));
          // -Y: (1, 2)
          this.images.push(
            await createImageBitmap(fullImage, crossSize, 2 * crossSize, crossSize, crossSize),
          );
          // +Z: (1, 1)
          this.images.push(
            await createImageBitmap(fullImage, crossSize, crossSize, crossSize, crossSize),
          );
          // -Z: (3, 1)
          this.images.push(
            await createImageBitmap(fullImage, 3 * crossSize, crossSize, crossSize, crossSize),
          );
          break;
        }
        case CubeLayout.CROSS_VERTICAL: {
          const crossSize: number = Math.round(h / 4);
          // +X: (2, 1)
          this.images.push(
            await createImageBitmap(fullImage, 2 * crossSize, crossSize, crossSize, crossSize),
          );
          // -X: (0, 1)
          this.images.push(await createImageBitmap(fullImage, 0, crossSize, crossSize, crossSize));
          // +Y: (1, 0)
          this.images.push(await createImageBitmap(fullImage, crossSize, 0, crossSize, crossSize));
          // -Y: (1, 2)
          this.images.push(
            await createImageBitmap(fullImage, crossSize, 2 * crossSize, crossSize, crossSize),
          );
          // +Z: (1, 1)
          this.images.push(
            await createImageBitmap(fullImage, crossSize, crossSize, crossSize, crossSize),
          );
          // -Z: (1, 3)
          this.images.push(
            await createImageBitmap(fullImage, crossSize, 3 * crossSize, crossSize, crossSize),
          );
          break;
        }
        default:
          // Fallback: just use it 6 times
          for (let i: number = 0; 6 > i; i++) {
            this.images.push(fullImage);
          }
          break;
      }

      this.isLoaded = true;
    } catch (e: unknown) {
      console.error(`Error loading CubeTexture: ${urls}`, e);
    }
  }

  /**
   * Loads explicit mipmap levels for this CubeTexture.
   * Useful for prefiltered IBL maps (e.g. mip0, mip1, mip2...).
   * @param urls Array of URLs, one per mip level (typically horizontal cross maps).
   * @param layout Optional layout hint.
   */
  public async loadMipmapsFrom(urls: string[], layout?: CubeLayout): Promise<void> {
    try {
      this.mipmaps = [];
      const cubes = await Promise.all(
        urls.map(async (url: string) => {
          const tempCube = new CubeTexture(undefined, this._assetManager);
          await tempCube.loadFrom(url, layout);
          return tempCube;
        }),
      );
      for (const tempCube of cubes) {
        if (tempCube.images.length === 6) {
          this.mipmaps.push(tempCube.images);
        }
      }
      if (this.mipmaps.length > 0) {
        this.isLoaded = true;
      }
    } catch (e: unknown) {
      console.error(`Error loading CubeTexture mipmaps`, e);
    }
  }
}
