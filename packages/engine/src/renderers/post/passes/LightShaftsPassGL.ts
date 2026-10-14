import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import FULLSCREEN_VERT_100 from "../shaders/PostProcess100.vert.glsl?raw";
import SHAFTS_FRAG_GLSL from "../shaders/LightShafts.frag.glsl?raw";
import BILATERAL_FRAG_GLSL from "../shaders/LightShaftsBilateral.frag.glsl?raw";
import SHAFTS_100_FRAG_GLSL from "../shaders/LightShafts100.frag.glsl?raw";

import { WebGL2FrameBuffer } from "../../WebGL2/index.js";
import { LightShaftsElement } from "../elements/index.js";
import { DirectionalLight } from "../../../core/lights/index.js";
import { Matrix4, Vector3D } from "../../../math/index.js";

/**
 * Executes atmospheric light shafts across WebGL1 and WebGL2:
 * - WebGL2 (Tier 2): Half-resolution raymarching against Cascaded Shadow Maps (CSM)
 *   followed by a 2x2 depth-aware cross-bilateral upsample pass.
 * - WebGL1 (Tier 1): 2D screen-space radial pull-blur with sky/depth luminance mask
 *   and camera-Z inversion falloff guard.
 */
export class LightShaftsPassGL {
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _isWebGL2: boolean;

  // WebGL2 programs & VAOs
  private _progShafts?: WebGLProgram;
  private _progBilateral?: WebGLProgram;
  private _vaoSrafts?: WebGLVertexArrayObject;
  private _vaoBilateral?: WebGLVertexArrayObject;

  // Uniform locations: Raymarching
  private _uDepthMapLoc: WebGLUniformLocation | null = null;
  private _uDirShadowMapLoc: WebGLUniformLocation | null = null;
  private _uInvViewProjLoc: WebGLUniformLocation | null = null;
  private _uCamPosLoc: WebGLUniformLocation | null = null;
  private _uSunDirLoc: WebGLUniformLocation | null = null;
  private _uSunColorLoc: WebGLUniformLocation | null = null;
  private _uIntensityLoc: WebGLUniformLocation | null = null;
  private _uDensityLoc: WebGLUniformLocation | null = null;
  private _uAsymmetryLoc: WebGLUniformLocation | null = null;
  private _uMaxDistLoc: WebGLUniformLocation | null = null;
  private _uSamplesLoc: WebGLUniformLocation | null = null;
  private _uCascadeMatricesLoc: WebGLUniformLocation | null = null;
  private _uCascadeSplitsLoc: WebGLUniformLocation | null = null;
  private _uDirShadowInfoLoc: WebGLUniformLocation | null = null;

  // Uniform locations: Bilateral upsample
  private _uLowResShaftsLoc: WebGLUniformLocation | null = null;
  private _uFullResDepthLoc: WebGLUniformLocation | null = null;
  private _uLowResDepthLoc: WebGLUniformLocation | null = null;
  private _uLowResTexelSizeLoc: WebGLUniformLocation | null = null;
  private _uDepthThresholdLoc: WebGLUniformLocation | null = null;

  // WebGL1 program & locations
  private _prog100?: WebGLProgram;
  private _uSceneColor100Loc: WebGLUniformLocation | null = null;
  private _uSunScreenPos100Loc: WebGLUniformLocation | null = null;
  private _uSunCameraZ100Loc: WebGLUniformLocation | null = null;
  private _uDensity100Loc: WebGLUniformLocation | null = null;
  private _uWeight100Loc: WebGLUniformLocation | null = null;
  private _uDecay100Loc: WebGLUniformLocation | null = null;
  private _uIntensity100Loc: WebGLUniformLocation | null = null;
  private _uShaftColor100Loc: WebGLUniformLocation | null = null;
  private _aPos100: number = -1;
  private _vb100?: WebGLBuffer;

  // Render targets
  private _width: number = 0;
  private _height: number = 0;
  private _halfColorFbo?: WebGL2FrameBuffer;
  private _fullShaftsFbo?: WebGL2FrameBuffer;

  private _gl1Fbo?: WebGLFramebuffer;
  private _gl1Texture?: WebGLTexture;

  // Scratch memory for zero allocations during render loop
  private readonly _scratchInvViewProj: Matrix4 = new Matrix4();
  private readonly _scratchCascadeMatrices: Float32Array = new Float32Array(64);
  private readonly _scratchCascadeSplits: Float32Array = new Float32Array(4);
  private readonly _scratchDirShadowInfo: Float32Array = new Float32Array(4);
  private readonly _scratchSunDir: Vector3D = new Vector3D();

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, isWebGL2: boolean) {
    this._gl = gl;
    this._isWebGL2 = isWebGL2;
    this._build();
  }

  private _compileShader(type: number, src: string): WebGLShader | null {
    const gl = this._gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[LightShaftsPassGL] Shader Compile Error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private _build(): void {
    const gl = this._gl;

    if (this._isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      // 1. Raymarching program
      const vert = this._compileShader(gl.VERTEX_SHADER, FULLSCREEN_VERT_GLSL);
      const fragShafts = this._compileShader(gl.FRAGMENT_SHADER, SHAFTS_FRAG_GLSL);
      if (vert && fragShafts) {
        this._progShafts = gl.createProgram()!;
        gl.attachShader(this._progShafts, vert);
        gl.attachShader(this._progShafts, fragShafts);
        gl.linkProgram(this._progShafts);
        gl.deleteShader(fragShafts);

        this._uDepthMapLoc = gl.getUniformLocation(this._progShafts, "u_opaqueDepthMap");
        this._uDirShadowMapLoc = gl.getUniformLocation(this._progShafts, "u_dirShadowMap");
        this._uInvViewProjLoc = gl.getUniformLocation(this._progShafts, "u_invViewProj");
        this._uCamPosLoc = gl.getUniformLocation(this._progShafts, "u_camPos");
        this._uSunDirLoc = gl.getUniformLocation(this._progShafts, "u_sunDir");
        this._uSunColorLoc = gl.getUniformLocation(this._progShafts, "u_sunColor");
        this._uIntensityLoc = gl.getUniformLocation(this._progShafts, "u_intensity");
        this._uDensityLoc = gl.getUniformLocation(this._progShafts, "u_density");
        this._uAsymmetryLoc = gl.getUniformLocation(this._progShafts, "u_asymmetry");
        this._uMaxDistLoc = gl.getUniformLocation(this._progShafts, "u_maxDistance");
        this._uSamplesLoc = gl.getUniformLocation(this._progShafts, "u_samples");
        this._uCascadeMatricesLoc = gl.getUniformLocation(this._progShafts, "u_cascadeMatrices");
        this._uCascadeSplitsLoc = gl.getUniformLocation(this._progShafts, "u_cascadeSplits");
        this._uDirShadowInfoLoc = gl.getUniformLocation(this._progShafts, "u_dirShadowInfo");

        this._vaoSrafts = gl2.createVertexArray()!;
      }

      // 2. Bilateral upsampling program
      const fragBilateral = this._compileShader(gl.FRAGMENT_SHADER, BILATERAL_FRAG_GLSL);
      if (vert && fragBilateral) {
        this._progBilateral = gl.createProgram()!;
        gl.attachShader(this._progBilateral, vert);
        gl.attachShader(this._progBilateral, fragBilateral);
        gl.linkProgram(this._progBilateral);
        gl.deleteShader(vert);
        gl.deleteShader(fragBilateral);

        this._uLowResShaftsLoc = gl.getUniformLocation(this._progBilateral, "u_lowResShaftsMap");
        this._uFullResDepthLoc = gl.getUniformLocation(this._progBilateral, "u_fullResDepthMap");
        this._uLowResDepthLoc = gl.getUniformLocation(this._progBilateral, "u_lowResDepthMap");
        this._uLowResTexelSizeLoc = gl.getUniformLocation(this._progBilateral, "u_lowResTexelSize");
        this._uDepthThresholdLoc = gl.getUniformLocation(this._progBilateral, "u_depthThreshold");

        this._vaoBilateral = gl2.createVertexArray()!;
      }
    } else {
      // WebGL1 radial blur program
      const vert100 = this._compileShader(gl.VERTEX_SHADER, FULLSCREEN_VERT_100);
      const frag100 = this._compileShader(gl.FRAGMENT_SHADER, SHAFTS_100_FRAG_GLSL);
      if (vert100 && frag100) {
        this._prog100 = gl.createProgram()!;
        gl.attachShader(this._prog100, vert100);
        gl.attachShader(this._prog100, frag100);
        gl.linkProgram(this._prog100);
        gl.deleteShader(vert100);
        gl.deleteShader(frag100);

        this._uSceneColor100Loc = gl.getUniformLocation(this._prog100, "u_sceneColor");
        this._uSunScreenPos100Loc = gl.getUniformLocation(this._prog100, "u_sunScreenPos");
        this._uSunCameraZ100Loc = gl.getUniformLocation(this._prog100, "u_sunCameraZ");
        this._uDensity100Loc = gl.getUniformLocation(this._prog100, "u_density");
        this._uWeight100Loc = gl.getUniformLocation(this._prog100, "u_weight");
        this._uDecay100Loc = gl.getUniformLocation(this._prog100, "u_decay");
        this._uIntensity100Loc = gl.getUniformLocation(this._prog100, "u_intensity");
        this._uShaftColor100Loc = gl.getUniformLocation(this._prog100, "u_shaftColor");

        this._aPos100 = gl.getAttribLocation(this._prog100, "a_pos");
        this._vb100 = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vb100);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    }
  }

  private _resizeTargets(width: number, height: number): void {
    if (this._width === width && this._height === height) return;
    this._width = width;
    this._height = height;

    const gl = this._gl;
    const halfW = Math.max(Math.floor(width / 2), 1);
    const halfH = Math.max(Math.floor(height / 2), 1);

    if (this._isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this._halfColorFbo?.destroy();
      this._fullShaftsFbo?.destroy();

      this._halfColorFbo = new WebGL2FrameBuffer(gl2, {
        width: halfW,
        height: halfH,
        internalFormat: gl2.RGBA16F,
        format: gl2.RGBA,
        type: gl2.HALF_FLOAT,
      });

      this._fullShaftsFbo = new WebGL2FrameBuffer(gl2, {
        width,
        height,
        internalFormat: gl2.RGBA16F,
        format: gl2.RGBA,
        type: gl2.HALF_FLOAT,
      });
    } else {
      if (this._gl1Fbo) gl.deleteFramebuffer(this._gl1Fbo);
      if (this._gl1Texture) gl.deleteTexture(this._gl1Texture);

      this._gl1Texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this._gl1Texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, halfW, halfH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

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
  }

  /**
   * Executes the light shafts pass.
   * @returns The generated light shafts texture ready for additive composite before tonemapping, or null.
   */
  public execute(
    depthTexture: WebGLTexture | null,
    sceneColorTexture: WebGLTexture,
    width: number,
    height: number,
    viewProjMatrix: Float32Array,
    camPos: Vector3D,
    dirLight: DirectionalLight | undefined,
    dirShadowTexture: WebGLTexture | null,
    element: LightShaftsElement,
  ): WebGLTexture | null {
    if (!element.enabled || width <= 0 || height <= 0 || !dirLight) {
      return null;
    }

    this._resizeTargets(width, height);
    const gl = this._gl;

    if (this._isWebGL2) {
      if (!this._progShafts || !this._progBilateral || !depthTexture || !dirShadowTexture) {
        return null;
      }
      const gl2 = gl as WebGL2RenderingContext;
      const halfW = Math.max(Math.floor(width / 2), 1);
      const halfH = Math.max(Math.floor(height / 2), 1);

      // --- PASS 1: Half-Resolution Raymarching ---
      this._halfColorFbo!.bind();
      gl2.viewport(0, 0, halfW, halfH);
      gl2.disable(gl2.DEPTH_TEST);
      gl2.depthMask(false);
      gl2.disable(gl2.BLEND);

      gl2.useProgram(this._progShafts);

      // Depth map -> Unit 0
      gl2.activeTexture(gl2.TEXTURE0);
      gl2.bindTexture(gl2.TEXTURE_2D, depthTexture);
      if (this._uDepthMapLoc) gl2.uniform1i(this._uDepthMapLoc, 0);

      // Directional Shadow Map -> Unit 1
      gl2.activeTexture(gl2.TEXTURE1);
      gl2.bindTexture(gl2.TEXTURE_2D, dirShadowTexture);
      if (this._uDirShadowMapLoc) gl2.uniform1i(this._uDirShadowMapLoc, 1);

      // Inverse View Projection Matrix
      this._scratchInvViewProj.data.set(viewProjMatrix);
      Matrix4.invert(this._scratchInvViewProj, this._scratchInvViewProj);
      if (this._uInvViewProjLoc) {
        gl2.uniformMatrix4fv(this._uInvViewProjLoc, false, this._scratchInvViewProj.data);
      }

      if (this._uCamPosLoc) {
        gl2.uniform3f(this._uCamPosLoc, camPos.x, camPos.y, camPos.z);
      }

      // Sun direction (direction toward light source: -direction)
      this._scratchSunDir.set(-dirLight.direction.x, -dirLight.direction.y, -dirLight.direction.z);
      this._scratchSunDir.normalize();
      if (this._uSunDirLoc) {
        gl2.uniform3f(
          this._uSunDirLoc,
          this._scratchSunDir.x,
          this._scratchSunDir.y,
          this._scratchSunDir.z,
        );
      }

      if (this._uSunColorLoc) {
        gl2.uniform3f(
          this._uSunColorLoc,
          element.color.r * dirLight.intensity,
          element.color.g * dirLight.intensity,
          element.color.b * dirLight.intensity,
        );
      }

      if (this._uIntensityLoc) gl2.uniform1f(this._uIntensityLoc, element.intensity);
      if (this._uDensityLoc) gl2.uniform1f(this._uDensityLoc, element.density);
      if (this._uAsymmetryLoc) gl2.uniform1f(this._uAsymmetryLoc, element.asymmetry);
      if (this._uMaxDistLoc) gl2.uniform1f(this._uMaxDistLoc, element.maxDistance);
      if (this._uSamplesLoc) gl2.uniform1i(this._uSamplesLoc, element.samples);

      // Shadow cascades
      const numCascades = Math.min(dirLight.numCascades, 4);
      for (let i = 0; i < numCascades; i++) {
        const cam = dirLight.cascadeCameras[i];
        if (cam) {
          this._scratchCascadeMatrices.set(cam.viewProjectionMatrix, i * 16);
          this._scratchCascadeSplits[i] = dirLight.cascadeSplits[i] ?? 100.0;
        }
      }
      this._scratchDirShadowInfo[0] = dirLight.shadowBias;
      this._scratchDirShadowInfo[1] = dirLight.shadowNormalBias;
      this._scratchDirShadowInfo[2] = dirLight.castShadow ? 1.0 : 0.0;
      this._scratchDirShadowInfo[3] = numCascades;

      if (this._uCascadeMatricesLoc)
        gl2.uniformMatrix4fv(this._uCascadeMatricesLoc, false, this._scratchCascadeMatrices);
      if (this._uCascadeSplitsLoc)
        gl2.uniform4fv(this._uCascadeSplitsLoc, this._scratchCascadeSplits);
      if (this._uDirShadowInfoLoc)
        gl2.uniform4fv(this._uDirShadowInfoLoc, this._scratchDirShadowInfo);

      gl2.bindVertexArray(this._vaoSrafts!);
      gl2.drawArrays(gl2.TRIANGLES, 0, 3);
      gl2.bindVertexArray(null);

      // --- PASS 2: Bilateral Depth-Aware Upsample ---
      this._fullShaftsFbo!.bind();
      gl2.viewport(0, 0, width, height);

      gl2.useProgram(this._progBilateral);

      // Low-res shafts texture -> Unit 0
      gl2.activeTexture(gl2.TEXTURE0);
      gl2.bindTexture(gl2.TEXTURE_2D, this._halfColorFbo!.texture);
      if (this._uLowResShaftsLoc) gl2.uniform1i(this._uLowResShaftsLoc, 0);

      // Full-res depth map -> Unit 1
      gl2.activeTexture(gl2.TEXTURE1);
      gl2.bindTexture(gl2.TEXTURE_2D, depthTexture);
      if (this._uFullResDepthLoc) gl2.uniform1i(this._uFullResDepthLoc, 1);

      // Low-res depth map -> Unit 2 (sampling depthTexture at low-res UVs)
      gl2.activeTexture(gl2.TEXTURE2);
      gl2.bindTexture(gl2.TEXTURE_2D, depthTexture);
      if (this._uLowResDepthLoc) gl2.uniform1i(this._uLowResDepthLoc, 2);

      if (this._uLowResTexelSizeLoc) {
        gl2.uniform2f(this._uLowResTexelSizeLoc, 1.0 / halfW, 1.0 / halfH);
      }
      if (this._uDepthThresholdLoc) {
        gl2.uniform1f(this._uDepthThresholdLoc, 0.05);
      }

      gl2.bindVertexArray(this._vaoBilateral!);
      gl2.drawArrays(gl2.TRIANGLES, 0, 3);
      gl2.bindVertexArray(null);
      this._fullShaftsFbo!.unbind();

      return this._fullShaftsFbo!.texture;
    } else {
      // --- WebGL1 Tier: 2D Screen-Space Radial Blur ---
      if (!this._prog100 || !this._gl1Fbo || !this._gl1Texture) return null;
      const halfW = Math.max(Math.floor(width / 2), 1);
      const halfH = Math.max(Math.floor(height / 2), 1);

      // Project sun direction into camera view space and NDC
      this._scratchSunDir.set(-dirLight.direction.x, -dirLight.direction.y, -dirLight.direction.z);
      this._scratchSunDir.normalize();

      // Transform sun point (camPos + sunDir * 1000) by viewProjMatrix
      const sunWorldX = camPos.x + this._scratchSunDir.x * 1000.0;
      const sunWorldY = camPos.y + this._scratchSunDir.y * 1000.0;
      const sunWorldZ = camPos.z + this._scratchSunDir.z * 1000.0;

      const vp = viewProjMatrix;
      const clipW = vp[3]! * sunWorldX + vp[7]! * sunWorldY + vp[11]! * sunWorldZ + vp[15]!;
      const clipX = vp[0]! * sunWorldX + vp[4]! * sunWorldY + vp[8]! * sunWorldZ + vp[12]!;
      const clipY = vp[1]! * sunWorldX + vp[5]! * sunWorldY + vp[9]! * sunWorldZ + vp[13]!;

      const sunScreenU = (clipX / clipW) * 0.5 + 0.5;
      const sunScreenV = (clipY / clipW) * 0.5 + 0.5;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this._gl1Fbo);
      gl.viewport(0, 0, halfW, halfH);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);

      gl.useProgram(this._prog100);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneColorTexture);
      if (this._uSceneColor100Loc) gl.uniform1i(this._uSceneColor100Loc, 0);

      if (this._uSunScreenPos100Loc)
        gl.uniform2f(this._uSunScreenPos100Loc, sunScreenU, sunScreenV);
      if (this._uSunCameraZ100Loc) gl.uniform1f(this._uSunCameraZ100Loc, clipW > 0.0 ? 1.0 : -1.0);
      if (this._uDensity100Loc) gl.uniform1f(this._uDensity100Loc, element.density * 10.0);
      if (this._uWeight100Loc) gl.uniform1f(this._uWeight100Loc, element.weight);
      if (this._uDecay100Loc) gl.uniform1f(this._uDecay100Loc, element.decay);
      if (this._uIntensity100Loc) gl.uniform1f(this._uIntensity100Loc, element.intensity);
      if (this._uShaftColor100Loc) {
        gl.uniform3f(
          this._uShaftColor100Loc,
          element.color.r * dirLight.intensity,
          element.color.g * dirLight.intensity,
          element.color.b * dirLight.intensity,
        );
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this._vb100!);
      gl.enableVertexAttribArray(this._aPos100);
      gl.vertexAttribPointer(this._aPos100, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.disableVertexAttribArray(this._aPos100);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      return this._gl1Texture;
    }
  }

  public destroy(): void {
    const gl = this._gl;
    if (this._isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this._halfColorFbo?.destroy();
      this._fullShaftsFbo?.destroy();
      if (this._vaoSrafts) gl2.deleteVertexArray(this._vaoSrafts);
      if (this._vaoBilateral) gl2.deleteVertexArray(this._vaoBilateral);
      if (this._progShafts) gl.deleteProgram(this._progShafts);
      if (this._progBilateral) gl.deleteProgram(this._progBilateral);
    } else {
      if (this._gl1Fbo) gl.deleteFramebuffer(this._gl1Fbo);
      if (this._gl1Texture) gl.deleteTexture(this._gl1Texture);
      if (this._vb100) gl.deleteBuffer(this._vb100);
      if (this._prog100) gl.deleteProgram(this._prog100);
    }
  }
}
