import { CubeTexture } from "./CubeTexture.js";
import type { RenderTargetOptions } from "./RenderTarget.js";

/**
 * A specialized cube texture that can be rendered to by a Renderer.
 * Represents an environment probe map with 6 faces.
 */
export class RenderTargetCube extends CubeTexture {
  /** The width of each face in pixels. */
  public width: number;
  /** The height of each face in pixels. */
  public height: number;
  /** Whether this render target includes a depth buffer. */
  public depth: boolean;
  /** Whether mipmaps should be generated. */
  public generateMipmaps: boolean;

  protected constructor(options: RenderTargetOptions) {
    super();
    this.width = options.width;
    this.height = options.height;
    this.depth = options.depth ?? true;
    this.generateMipmaps = options.generateMipmaps ?? false;

    // For a render target cube, we start loaded as it has no external image source
    this.isLoaded = false;
  }

  /**
   * Resizes the render target cube.
   * @param width The new width.
   * @param height The new height.
   */
  public resize(width: number, height: number): void {
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.isLoaded = false;
    }
  }

  /**
   * Creates a new RenderTargetCube.
   * @param options Configuration options.
   * @returns A new RenderTargetCube instance.
   */
  public static create(options: RenderTargetOptions): RenderTargetCube {
    return new RenderTargetCube(options);
  }
}
