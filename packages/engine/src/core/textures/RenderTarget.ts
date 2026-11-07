import type { TextureOptions } from "./Texture.js";
import { Texture } from "./Texture.js";

/**
 * Configuration options for creating a RenderTarget.
 */
export interface RenderTargetOptions extends TextureOptions {
  /** The width of the render target in pixels. */
  width: number;
  /** The height of the render target in pixels. */
  height: number;
  /** Whether to include a depth/stencil buffer. Defaults to true. */
  depth?: boolean;
}

/**
 * A specialized texture that can be rendered to by a Renderer.
 */
export class RenderTarget extends Texture {
  /** The width of the render target in pixels. */
  public width: number;
  /** The height of the render target in pixels. */
  public height: number;
  /** Whether this render target includes a depth buffer. */
  public depth: boolean;

  protected constructor(options: RenderTargetOptions) {
    super(undefined, options);
    this.width = options.width;
    this.height = options.height;
    this.depth = options.depth ?? true;

    // Override defaults for render targets to ensure they don't mipmap automatically
    // during rendering unless explicitly updated, and default to CLAMP_TO_EDGE
    this.generateMipmaps = options.generateMipmaps ?? false;
  }

  /**
   * Resizes the render target.
   * Note: The underlying renderer will recreate the GPU resources on the next frame.
   * @param width The new width.
   * @param height The new height.
   */
  public resize(width: number, height: number): void {
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      // Mark as needing update so the renderer recreates the FBO
      this.isLoaded = false;
    }
  }

  /**
   * Creates a new RenderTarget.
   * @param options Configuration options.
   * @returns A new RenderTarget instance.
   */
  public static create(options: RenderTargetOptions): RenderTarget {
    return new RenderTarget(options);
  }
}
