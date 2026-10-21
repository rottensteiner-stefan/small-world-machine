import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import { tryCompileProgram } from "../../compileProgram.js";
import HISTORY_BLEND_FRAG_GLSL from "../shaders/HistoryBlend.frag.glsl?raw";

import { pickHdrColorFormat, WebGL2FrameBuffer } from "../../WebGL2/index.js";
import type { GLPostEffectPassContext } from "./GLPostEffectPass.js";
import { requireGlObject } from "../../gl/requireGlObject.js";

/**
 * Generic exponential history blend for WebGL2: blends the current frame with a ping-ponged
 * history buffer holding the previous frame's resolved result. Shared by two different
 * effects that both reduce to "blend with last frame's output" -- TAA (`TaaElement`, current
 * frame is jittered, low feedback) and the deliberate `MotionTrailElement` ghost/afterimage
 * look (current frame is not jittered, high feedback). No motion vectors either way, so this
 * only reads as clean anti-aliasing in static/slow scenes for the TAA case.
 */
export class HistoryBlendPassGL {
  private _gl: WebGL2RenderingContext;

  private _prog?: WebGLProgram;
  private _vao?: WebGLVertexArrayObject;

  private _uCurrentTexture: WebGLUniformLocation | null = null;
  private _uHistoryTexture: WebGLUniformLocation | null = null;
  private _uFeedback: WebGLUniformLocation | null = null;
  private _uHasHistory: WebGLUniformLocation | null = null;

  private _pingPong: [WebGL2FrameBuffer, WebGL2FrameBuffer] | undefined;
  private _parity: number = 0;
  private _width: number = 0;
  private _height: number = 0;
  private _hasHistory: boolean = false;

  constructor(gl: WebGL2RenderingContext) {
    this._gl = gl;
    this._build();
  }

  private _build(): void {
    const gl = this._gl;

    const prog = tryCompileProgram(
      gl,
      FULLSCREEN_VERT_GLSL,
      HISTORY_BLEND_FRAG_GLSL,
      "HistoryBlendPassGL",
    );
    if (!prog) return;
    this._prog = prog;

    this._uCurrentTexture = gl.getUniformLocation(this._prog, "u_currentTexture");
    this._uHistoryTexture = gl.getUniformLocation(this._prog, "u_historyTexture");
    this._uFeedback = gl.getUniformLocation(this._prog, "u_feedback");
    this._uHasHistory = gl.getUniformLocation(this._prog, "u_hasHistory");

    this._vao = requireGlObject(gl.createVertexArray(), "vertex array");
  }

  private _resize(width: number, height: number): void {
    if (this._pingPong && this._width === width && this._height === height) return;

    this._pingPong?.[0].destroy();
    this._pingPong?.[1].destroy();
    this._width = width;
    this._height = height;
    this._hasHistory = false;
    this._parity = 0;

    const makeTarget = (): WebGL2FrameBuffer =>
      new WebGL2FrameBuffer(this._gl, {
        width,
        height,
        ...pickHdrColorFormat(this._gl),
        depth: false,
      });
    this._pingPong = [makeTarget(), makeTarget()];
  }

  /**
   * Resolves the current frame against history.
   * @returns This frame's resolved HDR texture (becomes history for the next call), or null if unavailable.
   */
  public execute(ctx: GLPostEffectPassContext): WebGLTexture | null {
    const currentTexture = ctx.colorTexture;
    const width = ctx.width;
    const height = ctx.height;
    const config = ctx.element as unknown as { feedback: number };
    if (!this._prog) return null;

    this._resize(width, height);
    if (!this._pingPong) return null;

    const gl = this._gl;
    const writeTarget = this._pingPong[this._parity]!;
    const historyTarget = this._pingPong[1 - this._parity]!;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    writeTarget.bind();
    gl.viewport(0, 0, width, height);

    gl.useProgram(this._prog);
    gl.bindVertexArray(this._vao!);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);
    gl.uniform1i(this._uCurrentTexture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, historyTarget.texture);
    gl.uniform1i(this._uHistoryTexture, 1);

    gl.uniform1f(this._uFeedback, config.feedback);
    gl.uniform1i(this._uHasHistory, this._hasHistory ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._hasHistory = true;
    this._parity = 1 - this._parity;

    return writeTarget.texture;
  }

  /** Releases GPU resources. */
  public destroy(): void {
    const gl = this._gl;
    if (this._prog) gl.deleteProgram(this._prog);
    if (this._vao) gl.deleteVertexArray(this._vao);
    this._pingPong?.[0].destroy();
    this._pingPong?.[1].destroy();
  }
}
