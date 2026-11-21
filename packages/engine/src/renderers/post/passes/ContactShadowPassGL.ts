import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import { tryCompileProgram } from "../../compileProgram.js";
import CONTACT_SHADOW_FRAG_GLSL from "../shaders/ContactShadow.frag.glsl?raw";
import { WebGL2FrameBuffer } from "../../WebGL2/index.js";
import type { ContactShadowsElement } from "../elements/index.js";
import type { GLPostEffectPassContext } from "./GLPostEffectPass.js";
import { requireGlObject } from "../../gl/requireGlObject.js";

/**
 * Generates the Screen-Space Contact Shadow texture for WebGL2.
 * Reconstructs view-space position from opaque depth and raymarches along the directional light vector.
 */
export class ContactShadowPassGL {
  private _gl: WebGL2RenderingContext;

  private _prog?: WebGLProgram;
  private _vao?: WebGLVertexArrayObject;

  private _uDepthMap: WebGLUniformLocation | null = null;
  private _uNear: WebGLUniformLocation | null = null;
  private _uFar: WebGLUniformLocation | null = null;
  private _uProjScale: WebGLUniformLocation | null = null;
  private _uLightDirView: WebGLUniformLocation | null = null;
  private _uParams: WebGLUniformLocation | null = null;
  private _uSettings: WebGLUniformLocation | null = null;

  private _target?: WebGL2FrameBuffer;
  private _width: number = 0;
  private _height: number = 0;

  constructor(gl: WebGL2RenderingContext) {
    this._gl = gl;
    this._build();
  }

  private _build(): void {
    const gl = this._gl;

    const prog = tryCompileProgram(
      gl,
      FULLSCREEN_VERT_GLSL,
      CONTACT_SHADOW_FRAG_GLSL,
      "ContactShadowPassGL",
    );
    if (!prog) return;
    this._prog = prog;

    this._uDepthMap = gl.getUniformLocation(this._prog, "u_opaqueDepthMap");
    this._uNear = gl.getUniformLocation(this._prog, "u_near");
    this._uFar = gl.getUniformLocation(this._prog, "u_far");
    this._uProjScale = gl.getUniformLocation(this._prog, "u_projScale");
    this._uLightDirView = gl.getUniformLocation(this._prog, "u_lightDirView");
    this._uParams = gl.getUniformLocation(this._prog, "u_params");
    this._uSettings = gl.getUniformLocation(this._prog, "u_settings");

    this._vao = requireGlObject(gl.createVertexArray(), "vertex array");
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
      depth: false,
    });
  }

  public execute(ctx: GLPostEffectPassContext): WebGLTexture | null {
    const depthTexture = ctx.depthTexture;
    const projMatrixData = ctx.projMatrixData;
    const viewMatrixData = ctx.viewMatrixData;
    const lights = ctx.lights;
    if (!this._prog || !depthTexture || !projMatrixData || !viewMatrixData || !lights?.dLight) {
      return null;
    }

    const width = ctx.width;
    const height = ctx.height;
    const near = ctx.near;
    const far = ctx.far;
    const cs = ctx.element as ContactShadowsElement;

    this._resizeTarget(width, height);
    if (!this._target) return null;

    // Directional light direction points along ray; towards light is negated:
    const dLight = lights.dLight;
    const lxW = -dLight.direction.x;
    const lyW = -dLight.direction.y;
    const lzW = -dLight.direction.z;

    // Transform towards-light vector into view space (3x3 rotation):
    let lxV = viewMatrixData[0]! * lxW + viewMatrixData[4]! * lyW + viewMatrixData[8]! * lzW;
    let lyV = viewMatrixData[1]! * lxW + viewMatrixData[5]! * lyW + viewMatrixData[9]! * lzW;
    let lzV = viewMatrixData[2]! * lxW + viewMatrixData[6]! * lyW + viewMatrixData[10]! * lzW;
    const len = Math.hypot(lxV, lyV, lzV) || 1.0;
    lxV /= len;
    lyV /= len;
    lzV /= len;

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
    gl.uniform2f(this._uProjScale, projMatrixData[0]!, projMatrixData[5]!);
    gl.uniform4f(this._uLightDirView, lxV, lyV, lzV, cs.intensity);
    gl.uniform4f(this._uParams, cs.maxDistance, cs.thickness, cs.fadeDistance, cs.bias);
    gl.uniform4f(this._uSettings, cs.raySteps, 0.0, 0.0, 0.0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return this._target.texture;
  }

  public destroy(): void {
    const gl = this._gl;
    if (this._prog) gl.deleteProgram(this._prog);
    if (this._vao) gl.deleteVertexArray(this._vao);
    this._target?.destroy();
  }
}
