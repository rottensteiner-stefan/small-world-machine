import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import FULLSCREEN_VERT_100 from "../shaders/PostProcess100.vert.glsl?raw";
import COC_FRAG_GLSL from "../shaders/DepthOfFieldCoc.frag.glsl?raw";
import GATHER_FRAG_GLSL from "../shaders/DepthOfFieldGather.frag.glsl?raw";
import COMPOSITE_FRAG_GLSL from "../shaders/DepthOfFieldComposite.frag.glsl?raw";
import TILT_SHIFT_100_FRAG_GLSL from "../shaders/DepthOfFieldTiltShift100.frag.glsl?raw";
import { tryCompileProgram } from "../../compileProgram.js";

import { WebGL2FrameBuffer } from "../../WebGL2/index.js";
import type { DepthOfFieldElement } from "../elements/index.js";
import type { GLPostEffectPass, GLPostEffectPassContext } from "./GLPostEffectPass.js";

/** Uniform locations of the thin-lens CoC evaluation shared by the CoC and composite programs. */
interface LensUniformLocations {
  near: WebGLUniformLocation | null;
  far: WebGLUniformLocation | null;
  focusDistance: WebGLUniformLocation | null;
  cocScale: WebGLUniformLocation | null;
  maxCoc: WebGLUniformLocation | null;
}

/**
 * Thin-lens depth of field across WebGL2 and WebGL1:
 * - WebGL2: half-res CoC prefilter -> 32-tap Vogel scatter-as-gather bokeh -> full-res
 *   composite with CoC-aware bilateral upsample (same algorithm as `DepthOfFieldPassGPU`).
 * - WebGL1: no opaque depth on this tier, so a single full-res screen-space tilt-shift pass
 *   driven by `focusScreenY` and the lens' far-field CoC.
 */
export class DepthOfFieldPassGL implements GLPostEffectPass {
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _isWebGL2: boolean;

  // WebGL2
  private _progCoc: WebGLProgram | undefined = undefined;
  private _progGather: WebGLProgram | undefined = undefined;
  private _progComposite: WebGLProgram | undefined = undefined;
  private _vao: WebGLVertexArrayObject | undefined = undefined;
  private _cocSceneLoc: WebGLUniformLocation | null = null;
  private _cocDepthLoc: WebGLUniformLocation | null = null;
  private _cocLens: LensUniformLocations | undefined = undefined;
  private _gatherCocLoc: WebGLUniformLocation | null = null;
  private _gatherMaxCocLoc: WebGLUniformLocation | null = null;
  private _compSceneLoc: WebGLUniformLocation | null = null;
  private _compDepthLoc: WebGLUniformLocation | null = null;
  private _compCocLoc: WebGLUniformLocation | null = null;
  private _compGatherLoc: WebGLUniformLocation | null = null;
  private _compLens: LensUniformLocations | undefined = undefined;
  private _cocFbo: WebGL2FrameBuffer | undefined = undefined;
  private _gatherFbo: WebGL2FrameBuffer | undefined = undefined;
  private _outputFbo: WebGL2FrameBuffer | undefined = undefined;

  // WebGL1
  private _prog100: WebGLProgram | undefined = undefined;
  private _scene100Loc: WebGLUniformLocation | null = null;
  private _texelSize100Loc: WebGLUniformLocation | null = null;
  private _focusScreenY100Loc: WebGLUniformLocation | null = null;
  private _farCoc100Loc: WebGLUniformLocation | null = null;
  private _aPos100: number = -1;
  private _vb100: WebGLBuffer | undefined = undefined;
  private _gl1Fbo: WebGLFramebuffer | undefined = undefined;
  private _gl1Texture: WebGLTexture | undefined = undefined;

  private _width: number = 0;
  private _height: number = 0;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, isWebGL2: boolean) {
    this._gl = gl;
    this._isWebGL2 = isWebGL2;
    if (isWebGL2) {
      this._buildWebGL2(gl as WebGL2RenderingContext);
    } else {
      this._buildWebGL1(gl);
    }
  }

  private _lensLocations(program: WebGLProgram): LensUniformLocations {
    const gl = this._gl;
    return {
      near: gl.getUniformLocation(program, "u_near"),
      far: gl.getUniformLocation(program, "u_far"),
      focusDistance: gl.getUniformLocation(program, "u_focusDistance"),
      cocScale: gl.getUniformLocation(program, "u_cocScale"),
      maxCoc: gl.getUniformLocation(program, "u_maxCoc"),
    };
  }

  private _buildWebGL2(gl: WebGL2RenderingContext): void {
    this._progCoc =
      tryCompileProgram(gl, FULLSCREEN_VERT_GLSL, COC_FRAG_GLSL, "DepthOfFieldPassGL (CoC)") ??
      undefined;
    this._progGather =
      tryCompileProgram(
        gl,
        FULLSCREEN_VERT_GLSL,
        GATHER_FRAG_GLSL,
        "DepthOfFieldPassGL (Gather)",
      ) ?? undefined;
    this._progComposite =
      tryCompileProgram(
        gl,
        FULLSCREEN_VERT_GLSL,
        COMPOSITE_FRAG_GLSL,
        "DepthOfFieldPassGL (Composite)",
      ) ?? undefined;
    if (!this._progCoc || !this._progGather || !this._progComposite) return;

    this._cocSceneLoc = gl.getUniformLocation(this._progCoc, "u_sceneColor");
    this._cocDepthLoc = gl.getUniformLocation(this._progCoc, "u_opaqueDepthMap");
    this._cocLens = this._lensLocations(this._progCoc);

    this._gatherCocLoc = gl.getUniformLocation(this._progGather, "u_cocMap");
    this._gatherMaxCocLoc = gl.getUniformLocation(this._progGather, "u_maxCoc");

    this._compSceneLoc = gl.getUniformLocation(this._progComposite, "u_sceneColor");
    this._compDepthLoc = gl.getUniformLocation(this._progComposite, "u_opaqueDepthMap");
    this._compCocLoc = gl.getUniformLocation(this._progComposite, "u_cocMap");
    this._compGatherLoc = gl.getUniformLocation(this._progComposite, "u_gatherMap");
    this._compLens = this._lensLocations(this._progComposite);

    this._vao = gl.createVertexArray()!;
  }

  private _buildWebGL1(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this._prog100 =
      tryCompileProgram(
        gl,
        FULLSCREEN_VERT_100,
        TILT_SHIFT_100_FRAG_GLSL,
        "DepthOfFieldPassGL (TiltShift100)",
      ) ?? undefined;
    if (!this._prog100) return;

    this._scene100Loc = gl.getUniformLocation(this._prog100, "u_sceneColor");
    this._texelSize100Loc = gl.getUniformLocation(this._prog100, "u_texelSize");
    this._focusScreenY100Loc = gl.getUniformLocation(this._prog100, "u_focusScreenY");
    this._farCoc100Loc = gl.getUniformLocation(this._prog100, "u_farCoc");
    this._aPos100 = gl.getAttribLocation(this._prog100, "a_pos");
    this._vb100 = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vb100);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private _resizeTargets(width: number, height: number): void {
    if (this._width === width && this._height === height) return;
    this._width = width;
    this._height = height;
    const gl = this._gl;

    if (this._isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this._cocFbo?.destroy();
      this._gatherFbo?.destroy();
      this._outputFbo?.destroy();
      const halfW = Math.max(Math.floor(width / 2), 1);
      const halfH = Math.max(Math.floor(height / 2), 1);
      const makeTarget = (w: number, h: number): WebGL2FrameBuffer =>
        new WebGL2FrameBuffer(gl2, {
          width: w,
          height: h,
          internalFormat: gl2.RGBA16F,
          format: gl2.RGBA,
          type: gl2.HALF_FLOAT,
        });
      this._cocFbo = makeTarget(halfW, halfH);
      this._gatherFbo = makeTarget(halfW, halfH);
      this._outputFbo = makeTarget(width, height);
      return;
    }

    if (this._gl1Fbo) gl.deleteFramebuffer(this._gl1Fbo);
    if (this._gl1Texture) gl.deleteTexture(this._gl1Texture);
    // 8-bit like the WebGL1 HDR target it replaces in the chain (see WebGL1Renderer).
    this._gl1Texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this._gl1Texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this._gl1Fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._gl1Fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this._gl1Texture,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private _setLens(
    loc: LensUniformLocations,
    ctx: GLPostEffectPassContext,
    element: DepthOfFieldElement,
    cocScale: number,
  ): void {
    const gl = this._gl;
    gl.uniform1f(loc.near, ctx.near);
    gl.uniform1f(loc.far, ctx.far);
    gl.uniform1f(loc.focusDistance, element.focusDistance);
    gl.uniform1f(loc.cocScale, cocScale);
    gl.uniform1f(loc.maxCoc, element.maxCocPx(ctx.height));
  }

  /**
   * Runs depth of field on `ctx.colorTexture`.
   * @returns The defocused HDR colour texture that replaces the chained colour, or null when the
   *   pass could not run (WebGL2 additionally requires the opaque depth capture).
   */
  public execute(ctx: GLPostEffectPassContext): WebGLTexture | null {
    const element = ctx.element as DepthOfFieldElement;
    const width = ctx.width;
    const height = ctx.height;
    if (!element.enabled || width <= 0 || height <= 0) return null;

    this._resizeTargets(width, height);
    const cocScale = element.cocScalePx(height);
    const gl = this._gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);

    if (!this._isWebGL2) {
      return this._executeTiltShift(ctx, element, cocScale);
    }

    const depthTexture = ctx.depthTexture;
    if (!depthTexture || !this._progCoc || !this._progGather || !this._progComposite) return null;
    const gl2 = gl as WebGL2RenderingContext;
    const cocFbo = this._cocFbo!;
    const gatherFbo = this._gatherFbo!;
    const outputFbo = this._outputFbo!;
    const halfW = Math.max(Math.floor(width / 2), 1);
    const halfH = Math.max(Math.floor(height / 2), 1);
    gl2.bindVertexArray(this._vao!);

    cocFbo.bind();
    gl2.viewport(0, 0, halfW, halfH);
    gl2.useProgram(this._progCoc);
    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, ctx.colorTexture);
    gl2.uniform1i(this._cocSceneLoc, 0);
    gl2.activeTexture(gl2.TEXTURE1);
    gl2.bindTexture(gl2.TEXTURE_2D, depthTexture);
    gl2.uniform1i(this._cocDepthLoc, 1);
    this._setLens(this._cocLens!, ctx, element, cocScale);
    gl2.drawArrays(gl2.TRIANGLES, 0, 3);

    gatherFbo.bind();
    gl2.useProgram(this._progGather);
    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, cocFbo.texture);
    gl2.uniform1i(this._gatherCocLoc, 0);
    gl2.uniform1f(this._gatherMaxCocLoc, element.maxCocPx(height));
    gl2.drawArrays(gl2.TRIANGLES, 0, 3);

    outputFbo.bind();
    gl2.viewport(0, 0, width, height);
    gl2.useProgram(this._progComposite);
    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, ctx.colorTexture);
    gl2.uniform1i(this._compSceneLoc, 0);
    gl2.activeTexture(gl2.TEXTURE1);
    gl2.bindTexture(gl2.TEXTURE_2D, depthTexture);
    gl2.uniform1i(this._compDepthLoc, 1);
    gl2.activeTexture(gl2.TEXTURE2);
    gl2.bindTexture(gl2.TEXTURE_2D, cocFbo.texture);
    gl2.uniform1i(this._compCocLoc, 2);
    gl2.activeTexture(gl2.TEXTURE3);
    gl2.bindTexture(gl2.TEXTURE_2D, gatherFbo.texture);
    gl2.uniform1i(this._compGatherLoc, 3);
    this._setLens(this._compLens!, ctx, element, cocScale);
    gl2.drawArrays(gl2.TRIANGLES, 0, 3);

    gl2.bindVertexArray(null);
    outputFbo.unbind();
    gl2.activeTexture(gl2.TEXTURE0);
    return outputFbo.texture;
  }

  private _executeTiltShift(
    ctx: GLPostEffectPassContext,
    element: DepthOfFieldElement,
    cocScale: number,
  ): WebGLTexture | null {
    if (!this._prog100 || !this._gl1Fbo || !this._gl1Texture) return null;
    const gl = this._gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._gl1Fbo);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this._prog100);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.colorTexture);
    gl.uniform1i(this._scene100Loc, 0);
    gl.uniform2f(this._texelSize100Loc, 1.0 / ctx.width, 1.0 / ctx.height);
    gl.uniform1f(this._focusScreenY100Loc, element.focusScreenY);
    gl.uniform1f(this._farCoc100Loc, Math.min(cocScale, element.maxCocPx(ctx.height)));

    gl.bindBuffer(gl.ARRAY_BUFFER, this._vb100!);
    gl.enableVertexAttribArray(this._aPos100);
    gl.vertexAttribPointer(this._aPos100, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(this._aPos100);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return this._gl1Texture;
  }

  public destroy(): void {
    const gl = this._gl;
    if (this._isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this._cocFbo?.destroy();
      this._gatherFbo?.destroy();
      this._outputFbo?.destroy();
      if (this._vao) gl2.deleteVertexArray(this._vao);
      if (this._progCoc) gl.deleteProgram(this._progCoc);
      if (this._progGather) gl.deleteProgram(this._progGather);
      if (this._progComposite) gl.deleteProgram(this._progComposite);
      return;
    }
    if (this._gl1Fbo) gl.deleteFramebuffer(this._gl1Fbo);
    if (this._gl1Texture) gl.deleteTexture(this._gl1Texture);
    if (this._vb100) gl.deleteBuffer(this._vb100);
    if (this._prog100) gl.deleteProgram(this._prog100);
  }
}
