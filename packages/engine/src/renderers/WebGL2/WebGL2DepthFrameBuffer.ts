import { requireGlObject } from "../gl/requireGlObject.js";

/**
 * Encapsulates a WebGL2 Framebuffer configured specifically for depth rendering (Shadow Maps).
 * It has NO color attachment and a DEPTH_COMPONENT32F texture attachment.
 */
export class WebGL2DepthFrameBuffer {
  private _gl: WebGL2RenderingContext;
  private _framebuffer: WebGLFramebuffer;
  private _depthTexture: WebGLTexture;
  private _width: number;
  private _height: number;

  /**
   * Creates a new WebGL2DepthFrameBuffer.
   * @param gl The WebGL2 context.
   * @param width The width of the buffer.
   * @param height The height of the buffer.
   */
  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this._gl = gl;
    this._width = width;
    this._height = height;

    this._framebuffer = requireGlObject(gl.createFramebuffer(), "framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._framebuffer);

    // Create a depth-only texture
    this._depthTexture = requireGlObject(gl.createTexture(), "texture");
    gl.bindTexture(gl.TEXTURE_2D, this._depthTexture);

    // We use DEPTH_COMPONENT24 for high-precision shadow mapping to avoid artifacts while maximizing compatibility
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      width,
      height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );

    // Filtering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Hardware Shadow Sampling (sampler2DShadow in GLSL)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

    // Clamp to edge to avoid shadow wrap-around at the borders
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach it to the framebuffer's DEPTH_ATTACHMENT
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      this._depthTexture,
      0,
    );

    // Tell WebGL we don't want to draw any color
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[WebGL2DepthFrameBuffer] Framebuffer is incomplete: ${status}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Binds the framebuffer for rendering depth.
   */
  public bind(): void {
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._framebuffer);
    this._gl.viewport(0, 0, this._width, this._height);
  }

  /**
   * Unbinds the framebuffer, reverting to the default screen buffer.
   */
  public unbind(): void {
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
  }

  /**
   * Resizes the depth framebuffer.
   * @param width The new width.
   * @param height The new height.
   */
  public resize(width: number, height: number): void {
    if (this._width === width && this._height === height) return;
    this._width = width;
    this._height = height;

    this._gl.bindTexture(this._gl.TEXTURE_2D, this._depthTexture);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.DEPTH_COMPONENT24,
      width,
      height,
      0,
      this._gl.DEPTH_COMPONENT,
      this._gl.UNSIGNED_INT,
      null,
    );
    this._gl.bindTexture(this._gl.TEXTURE_2D, null);
  }

  /**
   * Gets the WebGL depth texture associated with this framebuffer.
   */
  public get texture(): WebGLTexture {
    return this._depthTexture;
  }

  /**
   * Destroys the framebuffer and its resources.
   */
  public destroy(): void {
    this._gl.deleteFramebuffer(this._framebuffer);
    this._gl.deleteTexture(this._depthTexture);
  }
}
