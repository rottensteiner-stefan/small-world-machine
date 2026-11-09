import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import LUMINANCE_FRAG_GLSL from "../shaders/AutoExposureLuminance.frag.glsl?raw";
import ADAPT_FRAG_GLSL from "../shaders/AutoExposureAdapt.frag.glsl?raw";
import { tryCompileProgram } from "../../compileProgram.js";
import { pickHdrColorFormat, WebGL2FrameBuffer } from "../../WebGL2/index.js";
import type { GLPostEffectPassContext } from "./GLPostEffectPass.js";
import type { AutoExposureElement } from "../elements/AutoExposureElement.js";
import { AUTO_EXPOSURE_GRID } from "../elements/AutoExposureElement.js";
import { requireGlObject } from "../../gl/requireGlObject.js";

/**
 * Eye adaptation on WebGL2 (ADR 0061), same two steps as `AutoExposurePassGPU`: HDR frame ->
 * 16x16 log-luminance grid -> 1x1 adapted exposure, ping-ponged against the previous frame.
 * Needs float render targets (`EXT_color_buffer_float`): without them the HDR input is clamped
 * RGBA8, metering it would be meaningless, so the pass returns null and the static exposure stays.
 */
export class AutoExposurePassGL {
  private readonly _gl: WebGL2RenderingContext;
  private _lumProg?: WebGLProgram;
  private _adaptProg?: WebGLProgram;
  private _vao?: WebGLVertexArrayObject;
  private _uSource: WebGLUniformLocation | null = null;
  private _uCenterWeight: WebGLUniformLocation | null = null;
  private _uLuminance: WebGLUniformLocation | null = null;
  private _uPrevious: WebGLUniformLocation | null = null;
  private _uParamsA: WebGLUniformLocation | null = null;
  private _uParamsB: WebGLUniformLocation | null = null;

  private _luminance?: WebGL2FrameBuffer;
  private _exposure?: [WebGL2FrameBuffer, WebGL2FrameBuffer];
  private _parity: number = 0;
  private _snap: boolean = true;
  private _lastRealTime: number = -1;
  private _built: boolean = false;

  constructor(gl: WebGL2RenderingContext) {
    this._gl = gl;
  }

  /** Lazy: no programs or targets exist until the effect is first enabled. */
  private _ensure(): void {
    if (this._built) return;
    this._built = true;
    const gl = this._gl;
    const format = pickHdrColorFormat(gl);
    if (format.internalFormat !== gl.RGBA16F) return;

    const lum = tryCompileProgram(
      gl,
      FULLSCREEN_VERT_GLSL,
      LUMINANCE_FRAG_GLSL,
      "AutoExposureLuminanceGL",
    );
    const adapt = tryCompileProgram(
      gl,
      FULLSCREEN_VERT_GLSL,
      ADAPT_FRAG_GLSL,
      "AutoExposureAdaptGL",
    );
    if (!lum || !adapt) return;
    this._lumProg = lum;
    this._adaptProg = adapt;
    this._uSource = gl.getUniformLocation(lum, "u_source");
    this._uCenterWeight = gl.getUniformLocation(lum, "u_centerWeight");
    this._uLuminance = gl.getUniformLocation(adapt, "u_luminance");
    this._uPrevious = gl.getUniformLocation(adapt, "u_previous");
    this._uParamsA = gl.getUniformLocation(adapt, "u_paramsA");
    this._uParamsB = gl.getUniformLocation(adapt, "u_paramsB");
    this._vao = requireGlObject(gl.createVertexArray(), "vertex array");

    const target = (size: number): WebGL2FrameBuffer =>
      new WebGL2FrameBuffer(gl, { width: size, height: size, ...format, depth: false });
    this._luminance = target(AUTO_EXPOSURE_GRID);
    this._exposure = [target(1), target(1)];
  }

  /** Returns the 1x1 texture holding the adapted exposure (r = multiplier), or null on fallback. */
  public execute(ctx: GLPostEffectPassContext): WebGLTexture | null {
    this._ensure();
    if (!this._lumProg || !this._adaptProg || !this._luminance || !this._exposure) return null;
    const gl = this._gl;
    const element = ctx.element as unknown as AutoExposureElement;
    const deltaTime = this._lastRealTime < 0 ? 0 : Math.max(ctx.realTime - this._lastRealTime, 0);
    this._lastRealTime = ctx.realTime;
    const write = this._exposure[this._parity]!;
    const previous = this._exposure[1 - this._parity]!;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this._vao!);

    this._luminance.bind();
    gl.viewport(0, 0, AUTO_EXPOSURE_GRID, AUTO_EXPOSURE_GRID);
    gl.useProgram(this._lumProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.colorTexture);
    gl.uniform1i(this._uSource, 0);
    gl.uniform1f(this._uCenterWeight, element.centerWeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    write.bind();
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(this._adaptProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._luminance.texture);
    gl.uniform1i(this._uLuminance, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    gl.uniform1i(this._uPrevious, 1);
    gl.uniform4f(this._uParamsA, element.minEv, element.maxEv, element.compensationEv, deltaTime);
    gl.uniform4f(this._uParamsB, element.speedDark, element.speedBright, this._snap ? 1 : 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._snap = false;
    this._parity = 1 - this._parity;
    return write.texture;
  }

  /** Camera cut: the next frame jumps straight to the metered exposure. */
  public resetHistory(): void {
    this._snap = true;
  }

  public destroy(): void {
    const gl = this._gl;
    if (this._lumProg) gl.deleteProgram(this._lumProg);
    if (this._adaptProg) gl.deleteProgram(this._adaptProg);
    if (this._vao) gl.deleteVertexArray(this._vao);
    this._luminance?.destroy();
    this._exposure?.[0].destroy();
    this._exposure?.[1].destroy();
  }
}
