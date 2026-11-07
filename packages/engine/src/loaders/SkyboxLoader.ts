import { AbstractLoader } from "./AbstractLoader.js";
import { CubeTexture } from "../core/textures/index.js";
import { EventType } from "../enums/index.js";
import type { LoaderOptions } from "../interfaces/index.js";

/**
 * Loader for cube map skybox textures from a single cross-layout image.
 */
export class SkyboxLoader extends AbstractLoader<CubeTexture> {
  /**
   * Creates a new SkyboxLoader.
   * @param options Optional configuration options.
   */
  constructor(options: LoaderOptions = {}) {
    super(options);
  }

  /** @inheritdoc */
  public override async load(url: string): Promise<CubeTexture> {
    const fullUrl: string = this.basePath + url;
    this.dispatchEvent(EventType.LOADER_START, { url: fullUrl });

    try {
      const sourceImage: ImageBitmap | HTMLImageElement = await this._assetManager.loadImage(
        fullUrl,
        (loaded: number, total: number) =>
          this.dispatchEvent(EventType.LOADER_PROGRESS, { url: fullUrl, loaded, total }),
        false,
      );

      const tileSize: number = sourceImage.width / 4;
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      canvas.width = tileSize;
      canvas.height = tileSize;
      const ctx: CanvasRenderingContext2D = canvas.getContext("2d", { willReadFrequently: true })!;

      const faces: { col: number; row: number }[] = [
        { col: 2, row: 1 }, // 0: +x
        { col: 0, row: 1 }, // 1: -x
        { col: 1, row: 0 }, // 2: +y
        { col: 1, row: 2 }, // 3: -y
        { col: 1, row: 1 }, // 4: +z
        { col: 3, row: 1 }, // 5: -z
      ];

      const images: ImageBitmap[] = [];

      for (const face of faces) {
        ctx.clearRect(0, 0, tileSize, tileSize);
        ctx.drawImage(
          sourceImage as CanvasImageSource,
          face.col * tileSize,
          face.row * tileSize,
          tileSize,
          tileSize,
          0,
          0,
          tileSize,
          tileSize,
        );

        const faceBitmap: ImageBitmap = await createImageBitmap(canvas);
        images.push(faceBitmap);
      }

      const cubeTexture: CubeTexture = new CubeTexture();
      cubeTexture.images = images;
      cubeTexture.isLoaded = true;

      this.dispatchEvent(EventType.LOADER_END, { url: fullUrl, data: cubeTexture });
      return cubeTexture;
    } catch (error: unknown) {
      this.dispatchEvent(EventType.LOADER_ERROR, { url: fullUrl, error });
      throw error;
    }
  }
}
