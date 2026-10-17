import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import FOG_FRAG_GLSL from "../shaders/VolumetricFog.frag.glsl?raw";
import BILATERAL_FRAG_GLSL from "../shaders/VolumetricFogBilateral.frag.glsl?raw";

import { WebGL2FrameBuffer } from "../../WebGL2/index.js";
import { VolumetricFogElement } from "../elements/index.js";
import { DirectionalLight } from "../../../core/lights/index.js";
import { FogVolume } from "../../../core/objects/FogVolume.js";
import { Color } from "../../../core/colors/index.js";
import { Matrix4, Vector3D } from "../../../math/index.js";

interface FogVolumeUniformLocations {
  invTransform: WebGLUniformLocation | null;
  params: WebGLUniformLocation | null;
  albedo: WebGLUniformLocation | null;
  emission: WebGLUniformLocation | null;
  size: WebGLUniformLocation | null;
}

/**
 * Executes volumetric fog on WebGL2 (Phase 2 parity fallback & Phase 3 interior carving):
 * - Pass 1: Half-resolution screen-space raymarching against depth buffer and CSM directional shadows
 *   with Schlick (1993) phase function, Interleaved Gradient Noise (IGN) jitter, Decima powder highlights,
 *   and analytical FogVolume SDF evaluation with interior carving (negative density).
 * - Pass 2: Full-resolution depth-aware cross-bilateral upsampling to preserve crisp geometric silhouettes.
 *
 * WebGL1 degrades gracefully (returns null, relying on Scene.fog analytical distance fog).
 */
/** Default ambient when the caller passes none (avoids a per-call allocation). */
const NO_AMBIENT = new Color(0, 0, 0);

export class VolumetricFogPassGL {
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _isWebGL2: boolean;

  // WebGL2 programs & VAOs
  private _progFog?: WebGLProgram | undefined;
  private _progBilateral?: WebGLProgram | undefined;
  private _vaoFog?: WebGLVertexArrayObject | undefined;
  private _vaoBilateral?: WebGLVertexArrayObject | undefined;

  // Uniform locations: Raymarching
  private _uDepthMapLoc: WebGLUniformLocation | null = null;
  private _uDirShadowMapLoc: WebGLUniformLocation | null = null;
  private _uInvViewProjLoc: WebGLUniformLocation | null = null;
  private _uCamPosLoc: WebGLUniformLocation | null = null;
  private _uSunDirLoc: WebGLUniformLocation | null = null;
  private _uSunColorLoc: WebGLUniformLocation | null = null;
  private _uFogColorLoc: WebGLUniformLocation | null = null;
  private _uAmbientLightLoc: WebGLUniformLocation | null = null;
  private _uAmbientInjectLoc: WebGLUniformLocation | null = null;
  private _uIntensityLoc: WebGLUniformLocation | null = null;
  private _uDensityLoc: WebGLUniformLocation | null = null;
  private _uAsymmetryLoc: WebGLUniformLocation | null = null;
  private _uMaxDistLoc: WebGLUniformLocation | null = null;
  private _uSamplesLoc: WebGLUniformLocation | null = null;
  private _uCascadeMatricesLoc: WebGLUniformLocation | null = null;
  private _uCascadeSplitsLoc: WebGLUniformLocation | null = null;
  private _uDirShadowInfoLoc: WebGLUniformLocation | null = null;
  private _uTimeLoc: WebGLUniformLocation | null = null;
  private _warnedVolumeLimit: boolean = false;
  private _uNumFogVolumesLoc: WebGLUniformLocation | null = null;
  private readonly _uFogVolumeLocs: FogVolumeUniformLocations[] = [];

  // Uniform locations: Bilateral upsample
  private _uLowResFogLoc: WebGLUniformLocation | null = null;
  private _uFullResDepthLoc: WebGLUniformLocation | null = null;
  private _uLowResTexelSizeLoc: WebGLUniformLocation | null = null;
  private _uNearFarLoc: WebGLUniformLocation | null = null;
  private _uDepthThresholdLoc: WebGLUniformLocation | null = null;

  // Render targets
  private _width: number = 0;
  private _height: number = 0;
  private _halfColorFbo?: WebGL2FrameBuffer | undefined;
  private _fullFogFbo?: WebGL2FrameBuffer | undefined;

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
      console.error("[VolumetricFogPassGL] Shader Compile Error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private _createProgram(vertSrc: string, fragSrc: string, name: string): WebGLProgram | null {
    const gl = this._gl;
    const vert = this._compileShader(gl.VERTEX_SHADER, vertSrc);
    if (!vert) return null;
    const frag = this._compileShader(gl.FRAGMENT_SHADER, fragSrc);
    if (!frag) {
      gl.deleteShader(vert);
      return null;
    }
    const prog = gl.createProgram();
    if (!prog) {
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      return null;
    }
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(
        `[VolumetricFogPassGL] Program Link Error (${name}):`,
        gl.getProgramInfoLog(prog),
      );
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  private _build(): void {
    if (!this._isWebGL2) return;
    const gl = this._gl;
    const gl2 = gl as WebGL2RenderingContext;

    // 1. Raymarching program
    this._progFog =
      this._createProgram(FULLSCREEN_VERT_GLSL, FOG_FRAG_GLSL, "FogRaymarch") ?? undefined;
    if (this._progFog) {
      this._uDepthMapLoc = gl.getUniformLocation(this._progFog, "u_opaqueDepthMap");
      this._uDirShadowMapLoc = gl.getUniformLocation(this._progFog, "u_dirShadowMap");
      this._uInvViewProjLoc = gl.getUniformLocation(this._progFog, "u_invViewProj");
      this._uCamPosLoc = gl.getUniformLocation(this._progFog, "u_camPos");
      this._uSunDirLoc = gl.getUniformLocation(this._progFog, "u_sunDir");
      this._uSunColorLoc = gl.getUniformLocation(this._progFog, "u_sunColor");
      this._uFogColorLoc = gl.getUniformLocation(this._progFog, "u_fogColor");
      this._uAmbientLightLoc = gl.getUniformLocation(this._progFog, "u_ambientLight");
      this._uAmbientInjectLoc = gl.getUniformLocation(this._progFog, "u_ambientInject");
      this._uIntensityLoc = gl.getUniformLocation(this._progFog, "u_intensity");
      this._uDensityLoc = gl.getUniformLocation(this._progFog, "u_density");
      this._uAsymmetryLoc = gl.getUniformLocation(this._progFog, "u_asymmetry");
      this._uMaxDistLoc = gl.getUniformLocation(this._progFog, "u_maxDistance");
      this._uSamplesLoc = gl.getUniformLocation(this._progFog, "u_samples");
      this._uCascadeMatricesLoc = gl.getUniformLocation(this._progFog, "u_cascadeMatrices");
      this._uCascadeSplitsLoc = gl.getUniformLocation(this._progFog, "u_cascadeSplits");
      this._uDirShadowInfoLoc = gl.getUniformLocation(this._progFog, "u_dirShadowInfo");
      this._uTimeLoc = gl.getUniformLocation(this._progFog, "u_time");
      this._uNumFogVolumesLoc = gl.getUniformLocation(this._progFog, "u_numFogVolumes");

      this._uFogVolumeLocs.length = 0;
      for (let i = 0; i < 16; i++) {
        this._uFogVolumeLocs.push({
          invTransform: gl.getUniformLocation(this._progFog, `u_fogVolumes[${i}].invTransform`),
          params: gl.getUniformLocation(this._progFog, `u_fogVolumes[${i}].params`),
          albedo: gl.getUniformLocation(this._progFog, `u_fogVolumes[${i}].albedo`),
          emission: gl.getUniformLocation(this._progFog, `u_fogVolumes[${i}].emission`),
          size: gl.getUniformLocation(this._progFog, `u_fogVolumes[${i}].size`),
        });
      }

      this._vaoFog = gl2.createVertexArray()!;
    }

    // 2. Bilateral upsampling program
    this._progBilateral =
      this._createProgram(FULLSCREEN_VERT_GLSL, BILATERAL_FRAG_GLSL, "FogBilateral") ?? undefined;
    if (this._progBilateral) {
      this._uLowResFogLoc = gl.getUniformLocation(this._progBilateral, "u_lowResFogMap");
      this._uFullResDepthLoc = gl.getUniformLocation(this._progBilateral, "u_fullResDepthMap");
      this._uLowResTexelSizeLoc = gl.getUniformLocation(this._progBilateral, "u_lowResTexelSize");
      this._uNearFarLoc = gl.getUniformLocation(this._progBilateral, "u_nearFar");
      this._uDepthThresholdLoc = gl.getUniformLocation(this._progBilateral, "u_depthThreshold");

      this._vaoBilateral = gl2.createVertexArray()!;
    }
  }

  private _resizeTargets(width: number, height: number): void {
    if (this._width === width && this._height === height) return;
    this._width = width;
    this._height = height;

    if (!this._isWebGL2) return;
    const gl2 = this._gl as WebGL2RenderingContext;
    const halfW = Math.max(Math.floor(width / 2), 1);
    const halfH = Math.max(Math.floor(height / 2), 1);

    this._halfColorFbo?.destroy();
    this._fullFogFbo?.destroy();

    this._halfColorFbo = new WebGL2FrameBuffer(gl2, {
      width: halfW,
      height: halfH,
      internalFormat: gl2.RGBA16F,
      format: gl2.RGBA,
      type: gl2.HALF_FLOAT,
    });

    this._fullFogFbo = new WebGL2FrameBuffer(gl2, {
      width,
      height,
      internalFormat: gl2.RGBA16F,
      format: gl2.RGBA,
      type: gl2.HALF_FLOAT,
    });
  }

  /**
   * Executes the volumetric fog pass.
   * @returns The generated full-resolution fog texture ready for additive composite before tonemapping, or null.
   */
  public execute(
    depthTexture: WebGLTexture | null,
    width: number,
    height: number,
    viewProjMatrix: Float32Array,
    camPos: Vector3D,
    near: number,
    far: number,
    dirLight: DirectionalLight | undefined,
    dirShadowTexture: WebGLTexture | null,
    element: VolumetricFogElement,
    fogVolumes: FogVolume[] = [],
    time: number = 0,
    ambientColor: Color = NO_AMBIENT,
    ambientIntensity: number = 0,
  ): WebGLTexture | null {
    if (!this._isWebGL2 || !element.enabled || width <= 0 || height <= 0) {
      return null;
    }

    if (!this._progFog || !this._progBilateral || !depthTexture) {
      return null;
    }

    this._resizeTargets(width, height);
    const gl2 = this._gl as WebGL2RenderingContext;
    const halfW = Math.max(Math.floor(width / 2), 1);
    const halfH = Math.max(Math.floor(height / 2), 1);

    // --- PASS 1: Half-Resolution Raymarching ---
    this._halfColorFbo!.bind();
    gl2.viewport(0, 0, halfW, halfH);
    gl2.disable(gl2.DEPTH_TEST);
    gl2.depthMask(false);
    gl2.disable(gl2.BLEND);

    gl2.useProgram(this._progFog);

    // Depth map -> Unit 0
    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, depthTexture);
    if (this._uDepthMapLoc) gl2.uniform1i(this._uDepthMapLoc, 0);

    // Directional Shadow Map -> Unit 1
    gl2.activeTexture(gl2.TEXTURE1);
    if (dirShadowTexture) {
      gl2.bindTexture(gl2.TEXTURE_2D, dirShadowTexture);
    }
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

    // Sun direction
    const sunActive = dirLight !== undefined && dirLight.intensity > 0.0;
    if (sunActive) {
      this._scratchSunDir.set(
        -dirLight!.direction.x,
        -dirLight!.direction.y,
        -dirLight!.direction.z,
      );
      this._scratchSunDir.normalize();
    } else {
      this._scratchSunDir.set(0.0, -1.0, 0.0);
    }

    if (this._uSunDirLoc) {
      gl2.uniform3f(
        this._uSunDirLoc,
        this._scratchSunDir.x,
        this._scratchSunDir.y,
        this._scratchSunDir.z,
      );
    }

    const sunScale = sunActive ? dirLight!.intensity * dirLight!.volumetricIntensity : 0.0;
    if (this._uSunColorLoc) {
      gl2.uniform3f(
        this._uSunColorLoc,
        sunActive ? element.color.r * sunScale : 0.0,
        sunActive ? element.color.g * sunScale : 0.0,
        sunActive ? element.color.b * sunScale : 0.0,
      );
    }

    if (this._uFogColorLoc) {
      gl2.uniform3f(this._uFogColorLoc, element.color.r, element.color.g, element.color.b);
    }

    if (this._uAmbientLightLoc) {
      gl2.uniform3f(
        this._uAmbientLightLoc,
        ambientColor.r * ambientIntensity,
        ambientColor.g * ambientIntensity,
        ambientColor.b * ambientIntensity,
      );
    }
    if (this._uAmbientInjectLoc) gl2.uniform1f(this._uAmbientInjectLoc, element.ambientInject);

    if (this._uIntensityLoc) gl2.uniform1f(this._uIntensityLoc, element.intensity);
    if (this._uDensityLoc) gl2.uniform1f(this._uDensityLoc, element.density);
    if (this._uAsymmetryLoc) gl2.uniform1f(this._uAsymmetryLoc, element.asymmetry);
    if (this._uMaxDistLoc) {
      gl2.uniform1f(this._uMaxDistLoc, Math.min(element.maxDistance, far));
    }
    if (this._uSamplesLoc) gl2.uniform1i(this._uSamplesLoc, 24);

    // Shadow cascades
    const numCascades = Math.min(dirLight?.numCascades ?? 0, 4);
    for (let i = 0; i < numCascades; i++) {
      const cam = dirLight?.cascadeCameras[i];
      if (cam) {
        this._scratchCascadeMatrices.set(cam.viewProjectionMatrix, i * 16);
        this._scratchCascadeSplits[i] = dirLight?.cascadeSplits[i] ?? 100.0;
      }
    }
    this._scratchDirShadowInfo[0] = dirLight?.shadowBias ?? 0.001;
    this._scratchDirShadowInfo[1] = dirLight?.shadowNormalBias ?? 0.0;
    this._scratchDirShadowInfo[2] =
      dirLight?.castShadow && element.castDirectionalShadow && dirShadowTexture ? 1.0 : 0.0;
    this._scratchDirShadowInfo[3] = numCascades;

    if (this._uCascadeMatricesLoc) {
      gl2.uniformMatrix4fv(this._uCascadeMatricesLoc, false, this._scratchCascadeMatrices);
    }
    if (this._uCascadeSplitsLoc) {
      gl2.uniform4fv(this._uCascadeSplitsLoc, this._scratchCascadeSplits);
    }
    if (this._uDirShadowInfoLoc) {
      gl2.uniform4fv(this._uDirShadowInfoLoc, this._scratchDirShadowInfo);
    }

    if (this._uTimeLoc) {
      gl2.uniform1f(this._uTimeLoc, time);
    }

    if (fogVolumes.length > 16 && !this._warnedVolumeLimit) {
      this._warnedVolumeLimit = true;
      console.warn(
        `[VolumetricFog] ${fogVolumes.length} FogVolumes in the scene, only the first 16 are evaluated.`,
      );
    }
    const numVols = Math.min(fogVolumes.length, 16);
    if (this._uNumFogVolumesLoc) gl2.uniform1i(this._uNumFogVolumesLoc, numVols);

    for (let i = 0; i < 16; i++) {
      const loc = this._uFogVolumeLocs[i];
      if (!loc) continue;
      if (i < numVols) {
        const vol = fogVolumes[i]!;
        const invMat = vol.getInverseWorldMatrix();
        if (loc.invTransform) gl2.uniformMatrix4fv(loc.invTransform, false, invMat.data);
        if (loc.params)
          gl2.uniform4f(loc.params, vol.shape, vol.density, vol.edgeFade, vol.emissionIntensity);
        if (loc.albedo)
          gl2.uniform4f(loc.albedo, vol.albedo.r, vol.albedo.g, vol.albedo.b, vol.noiseScale);
        if (loc.emission)
          gl2.uniform4f(
            loc.emission,
            vol.emission.r,
            vol.emission.g,
            vol.emission.b,
            vol.noiseAmount,
          );
        if (loc.size) gl2.uniform4f(loc.size, vol.size.x, vol.size.y, vol.size.z, vol.noiseSpeed);
      }
    }

    gl2.bindVertexArray(this._vaoFog!);
    gl2.drawArrays(gl2.TRIANGLES, 0, 3);
    gl2.bindVertexArray(null);

    // --- PASS 2: Bilateral Depth-Aware Upsample ---
    this._fullFogFbo!.bind();
    gl2.viewport(0, 0, width, height);

    gl2.useProgram(this._progBilateral);

    // Low-res fog texture -> Unit 0
    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, this._halfColorFbo!.texture);
    if (this._uLowResFogLoc) gl2.uniform1i(this._uLowResFogLoc, 0);

    // Full-res depth map -> Unit 1
    gl2.activeTexture(gl2.TEXTURE1);
    gl2.bindTexture(gl2.TEXTURE_2D, depthTexture);
    if (this._uFullResDepthLoc) gl2.uniform1i(this._uFullResDepthLoc, 1);

    if (this._uLowResTexelSizeLoc) {
      gl2.uniform2f(this._uLowResTexelSizeLoc, 1.0 / halfW, 1.0 / halfH);
    }
    if (this._uNearFarLoc) {
      gl2.uniform2f(this._uNearFarLoc, near, far);
    }
    if (this._uDepthThresholdLoc) {
      gl2.uniform1f(this._uDepthThresholdLoc, 0.05);
    }

    gl2.bindVertexArray(this._vaoBilateral!);
    gl2.drawArrays(gl2.TRIANGLES, 0, 3);
    gl2.bindVertexArray(null);
    this._fullFogFbo!.unbind();

    return this._fullFogFbo!.texture;
  }

  public destroy(): void {
    if (!this._isWebGL2) return;
    const gl = this._gl;
    const gl2 = gl as WebGL2RenderingContext;
    this._halfColorFbo?.destroy();
    this._fullFogFbo?.destroy();
    if (this._vaoFog) gl2.deleteVertexArray(this._vaoFog);
    if (this._vaoBilateral) gl2.deleteVertexArray(this._vaoBilateral);
    if (this._progFog) gl.deleteProgram(this._progFog);
    if (this._progBilateral) gl.deleteProgram(this._progBilateral);
  }
}
