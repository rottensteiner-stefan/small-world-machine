import { requireGlObject } from "../gl/requireGlObject.js";
import { SHADOW_ARRAY_LAYERS, SPOT_SHADOW_LAYERS } from "../../core/lights/PointLightShadow.js";

/**
 * Depth texture array holding the shadow maps of the first 4 spot lights (layers 0..3, index into
 * `LightDataInterface.sLights`) and the cube faces of up to two shadowed point lights (layers
 * 4..15, `pointShadowLayer`, ADR 0052), sampled as one `sampler2DArrayShadow`. Mirrors the WebGPU
 * `texture_depth_2d_array` in SpotShadowPassGPU: one texture unit for all of them, which is what
 * keeps a fully mapped PBR program within the 16 fragment texture units WebGL2 guarantees. All
 * layers share one resolution. The point-face layers are only allocated while a point light needs
 * them, so spot-only scenes keep the 4-layer footprint.
 */
export class WebGL2SpotShadowArray {
  /** @derived layer capacity: 4 spot slots + 2 x 6 point-light faces. */
  public static readonly LAYERS = SHADOW_ARRAY_LAYERS;

  private _gl: WebGL2RenderingContext;
  private _framebuffer: WebGLFramebuffer;
  private _depthTexture: WebGLTexture;
  private _size: number;
  private _layers: number;

  constructor(gl: WebGL2RenderingContext, size: number, layers: number = SPOT_SHADOW_LAYERS) {
    this._gl = gl;
    this._size = size;
    this._layers = layers;

    this._depthTexture = requireGlObject(gl.createTexture(), "texture");
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._depthTexture);
    this._allocate();
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

    this._framebuffer = requireGlObject(gl.createFramebuffer(), "framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._framebuffer);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private _allocate(): void {
    const gl = this._gl;
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.DEPTH_COMPONENT24,
      this._size,
      this._size,
      this._layers,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
  }

  /** Attaches `layer` as the depth target, sets the viewport to it and clears it. */
  public bindLayer(layer: number): void {
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._framebuffer);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this._depthTexture, 0, layer);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[WebGL2SpotShadowArray] Framebuffer is incomplete: ${status}`);
    }
    gl.viewport(0, 0, this._size, this._size);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  public unbind(): void {
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
  }

  /** Reallocates every layer (content is lost) when the resolution or layer count changes. */
  public resize(size: number, layers: number = this._layers): void {
    if (this._size === size && this._layers === layers) return;
    this._size = size;
    this._layers = layers;
    this._gl.bindTexture(this._gl.TEXTURE_2D_ARRAY, this._depthTexture);
    this._allocate();
    this._gl.bindTexture(this._gl.TEXTURE_2D_ARRAY, null);
  }

  public get size(): number {
    return this._size;
  }

  /** Allocated layers (`SPOT_SHADOW_LAYERS`, or `LAYERS` while point-light faces are in use). */
  public get layers(): number {
    return this._layers;
  }

  public get texture(): WebGLTexture {
    return this._depthTexture;
  }

  public destroy(): void {
    this._gl.deleteFramebuffer(this._framebuffer);
    this._gl.deleteTexture(this._depthTexture);
  }
}
