import type { WebGL2FrameBufferOptions } from "./WebGL2FrameBuffer.js";
import { requireGlObject } from "../gl/requireGlObject.js";

/**
 * Encapsulates a WebGL2 Framebuffer with a cube map color texture and depth/stencil renderbuffer.
 */
export class WebGL2CubeFrameBuffer {
  private _gl: WebGL2RenderingContext;
  private readonly _framebuffer: WebGLFramebuffer;
  private readonly _renderbuffer: WebGLRenderbuffer;
  private readonly _texture: WebGLTexture;
  private _width: number;
  private _height: number;
  private readonly _internalFormat: number;
  private _format: number;
  private _type: number;

  /**
   * Creates a new WebGL2CubeFrameBuffer.
   * @param gl The WebGL2 context.
   * @param options Width, height, and optional format overrides.
   */
  constructor(gl: WebGL2RenderingContext, options: WebGL2FrameBufferOptions) {
    this._gl = gl;
    this._width = options.width;
    this._height = options.height;
    this._internalFormat = options.internalFormat ?? gl.RGBA;
    this._format = options.format ?? gl.RGBA;
    this._type = options.type ?? gl.UNSIGNED_BYTE;

    this._framebuffer = requireGlObject(gl.createFramebuffer(), "framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._framebuffer);

    // Color texture (Cube Map)
    this._texture = requireGlObject(gl.createTexture(), "texture");
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this._texture);
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        0,
        this._internalFormat,
        this._width,
        this._height,
        0,
        this._format,
        this._type,
        null,
      );
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    // Default to Positive X
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X,
      this._texture,
      0,
    );

    // Depth and stencil renderbuffer
    this._renderbuffer = requireGlObject(gl.createRenderbuffer(), "renderbuffer");
    gl.bindRenderbuffer(gl.RENDERBUFFER, this._renderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, this._width, this._height);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      this._renderbuffer,
    );

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[WebGL2CubeFrameBuffer] Framebuffer is incomplete: ${status}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  }

  public get width(): number {
    return this._width;
  }

  public get height(): number {
    return this._height;
  }

  /**
   * Binds a specific face of the cube map to the framebuffer for rendering.
   * @param faceIndex 0-5 for Positive X to Negative Z.
   */
  public bindFace(faceIndex: number): void {
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._framebuffer);
    this._gl.framebufferTexture2D(
      this._gl.FRAMEBUFFER,
      this._gl.COLOR_ATTACHMENT0,
      this._gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex,
      this._texture,
      0,
    );
    this._gl.viewport(0, 0, this._width, this._height);
  }

  /**
   * Unbinds the framebuffer, reverting to the default screen buffer.
   */
  public unbind(): void {
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
  }

  /**
   * Resizes the framebuffer.
   * @param width The new width.
   * @param height The new height.
   */
  public resize(width: number, height: number): void {
    this._width = width;
    this._height = height;

    this._gl.bindTexture(this._gl.TEXTURE_CUBE_MAP, this._texture);
    for (let i = 0; i < 6; i++) {
      this._gl.texImage2D(
        this._gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        0,
        this._internalFormat,
        width,
        height,
        0,
        this._format,
        this._type,
        null,
      );
    }
    this._gl.bindTexture(this._gl.TEXTURE_CUBE_MAP, null);

    this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, this._renderbuffer);
    this._gl.renderbufferStorage(this._gl.RENDERBUFFER, this._gl.DEPTH24_STENCIL8, width, height);
  }

  /**
   * Gets the WebGL texture associated with this framebuffer.
   */
  public get texture(): WebGLTexture {
    return this._texture;
  }

  /**
   * Destroys the framebuffer and its resources.
   */
  public destroy(): void {
    this._gl.deleteFramebuffer(this._framebuffer);
    this._gl.deleteRenderbuffer(this._renderbuffer);
    this._gl.deleteTexture(this._texture);
  }
}
