import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import { tryCompileProgram } from "../../compileProgram.js";
import AO_FRAG_GLSL from "../shaders/AO.frag.glsl?raw";

import { WebGL2FrameBuffer } from "../../WebGL2/index.js";
import type { HbaoElement } from "../elements/index.js";
import type { GLPostEffectPassContext } from "./GLPostEffectPass.js";

/**
 * Generates the HBAO texture for WebGL2 -- reconstructs view-space position/normal from the
 * already-captured opaque depth buffer and estimates per-direction horizon angles, in a single
 * full-resolution pass (no separate blur/denoise pass; see AO.frag.glsl for the trade-off).
 * WebGL1 has no sampleable depth texture to reconstruct from, so this is WebGL2-only.
 */
export class AOPassGL {
  private _gl: WebGL2RenderingContext;

  private _prog?: WebGLProgram;
  private _vao?: WebGLVertexArrayObject;

  private _uDepthMap: WebGLUniformLocation | null = null;
  private _uNear: WebGLUniformLocation | null = null;
  private _uFar: WebGLUniformLocation | null = null;
  private _uProjScale: WebGLUniformLocation | null = null;
  private _uRadius: WebGLUniformLocation | null = null;
  private _uIntensity: WebGLUniformLocation | null = null;
  private _uTexelSize: WebGLUniformLocation | null = null;

  private _target?: WebGL2FrameBuffer;
  private _width: number = 0;
  private _height: number = 0;

  constructor(gl: WebGL2RenderingContext) {
    this._gl = gl;
    this._build();
  }

  private _build(): void {
    const gl = this._gl;

    const prog = tryCompileProgram(gl, FULLSCREEN_VERT_GLSL, AO_FRAG_GLSL, "AOPassGL");
    if (!prog) return;
    this._prog = prog;

    this._uDepthMap = gl.getUniformLocation(this._prog, "u_opaqueDepthMap");
    this._uNear = gl.getUniformLocation(this._prog, "u_near");
    this._uFar = gl.getUniformLocation(this._prog, "u_far");
    this._uProjScale = gl.getUniformLocation(this._prog, "u_projScale");
    this._uRadius = gl.getUniformLocation(this._prog, "u_radius");
    this._uIntensity = gl.getUniformLocation(this._prog, "u_intensity");
    this._uTexelSize = gl.getUniformLocation(this._prog, "u_texelSize");

    this._vao = gl.createVertexArray()!;
  }

  private _resizeTarget(width: number, height: number): void {
    if (this._target && this._width === width && this._height === height) return;
    this._target?.destroy();
    this._width = width;
    this._height = height;
    this._target = new WebGL2FrameBuffer(this._gl, {
      width,
      height,
      internalFormat: this._gl.R8,
      format: this._gl.RED,
      type: this._gl.UNSIGNED_BYTE,
    });
  }

  /**
   * Renders the HBAO texture from the opaque depth buffer.
   * @param depthTexture The already-captured opaque (pre-transparent) depth texture.
   * @param width Canvas width in pixels.
   * @param height Canvas height in pixels.
   * @param near Camera near plane.
   * @param far Camera far plane.
   * @param projMatrixData The camera's raw perspective projection matrix.
   * @param hbao The HBAO effect parameters (radius, intensity).
   * @returns The single-channel AO texture (R = occlusion factor, 1.0 = fully lit), or null if unavailable.
   */
  public execute(ctx: GLPostEffectPassContext): WebGLTexture | null {
    const depthTexture = ctx.depthTexture!;
    const width = ctx.width;
    const height = ctx.height;
    const near = ctx.near;
    const far = ctx.far;
    const projMatrixData = ctx.projMatrixData!;
    const hbao = ctx.element as HbaoElement;
    if (!this._prog) return null;

    this._resizeTarget(width, height);
    if (!this._target) return null;

    const gl = this._gl;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    this._target.bind();
    gl.viewport(0, 0, width, height);

    gl.useProgram(this._prog);
    gl.bindVertexArray(this._vao!);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.uniform1i(this._uDepthMap, 0);

    gl.uniform1f(this._uNear, near);
    gl.uniform1f(this._uFar, far);
    // Perspective matrix diagonal scale terms (see Matrix4.perspective): data[0]=A, data[5]=B.
    gl.uniform2f(this._uProjScale, projMatrixData[0]!, projMatrixData[5]!);
    gl.uniform1f(this._uRadius, hbao.radius);
    gl.uniform1f(this._uIntensity, hbao.intensity);
    gl.uniform2f(this._uTexelSize, 1.0 / width, 1.0 / height);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return this._target.texture;
  }

  /** Releases GPU resources. */
  public destroy(): void {
    const gl = this._gl;
    if (this._prog) gl.deleteProgram(this._prog);
    if (this._vao) gl.deleteVertexArray(this._vao);
    this._target?.destroy();
  }
}
