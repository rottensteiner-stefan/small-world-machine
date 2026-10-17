import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import FOG_FRAG_GLSL from "../shaders/VolumetricFog.frag.glsl?raw";
import BILATERAL_FRAG_GLSL from "../shaders/VolumetricFogBilateral.frag.glsl?raw";

import { WebGL2FrameBuffer } from "../../WebGL2/index.js";
import { VolumetricFogElement } from "../elements/index.js";
import { DirectionalLight, PointLight, SpotLight } from "../../../core/lights/index.js";
import { FogVolume } from "../../../core/objects/FogVolume.js";
import { Color } from "../../../core/colors/index.js";
import type { VolumetricTexture } from "../../../core/textures/index.js";
import { TextureFilter, TextureWrap } from "../../../enums/index.js";
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
  private _uFogHeightLoc: WebGLUniformLocation | null = null;
  private _uFogHeightFalloffLoc: WebGLUniformLocation | null = null;
  private _uIrradianceMapLoc: WebGLUniformLocation | null = null;
  private _uEnvIntensityLoc: WebGLUniformLocation | null = null;
  /** 1x1 black cube bound when the scene has no irradiance map (an unbound cube sampler is invalid). */
  private _blackCube: WebGLTexture | null = null;
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

  // Local lights uniform locations
  private _uNumPointLightsLoc: WebGLUniformLocation | null = null;
  private _uPointLightPosLoc: WebGLUniformLocation | null = null;
  private _uPointLightColorLoc: WebGLUniformLocation | null = null;
  private _uNumSpotLightsLoc: WebGLUniformLocation | null = null;
  private _uSpotLightPosLoc: WebGLUniformLocation | null = null;
  private _uSpotLightDirLoc: WebGLUniformLocation | null = null;
  private _uSpotLightColorLoc: WebGLUniformLocation | null = null;
  private _uSpotLightParamsLoc: WebGLUniformLocation | null = null;
  private _uSpotShadowMapLoc: WebGLUniformLocation | null = null;
  private _uSpotShadowMatrixLoc: WebGLUniformLocation | null = null;
  private _uSpotShadowInfoLoc: WebGLUniformLocation | null = null;

  // Uniform locations: 3D density masks
  private _uElementMaskLoc: WebGLUniformLocation | null = null;
  private _uElementMaskBoxLoc: WebGLUniformLocation | null = null;
  private _uElementMaskSizeLoc: WebGLUniformLocation | null = null;
  private _uElementMaskEnabledLoc: WebGLUniformLocation | null = null;
  private _uElementMaskAlbedoLoc: WebGLUniformLocation | null = null;
  private _uFogVolumeMasksLoc: WebGLUniformLocation | null = null;
  private _uFogVolumeMaskInfoLoc: WebGLUniformLocation | null = null;

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
  private readonly _scratchPointLightPos: Float32Array = new Float32Array(16 * 4);
  private readonly _scratchPointLightColor: Float32Array = new Float32Array(16 * 4);
  private readonly _scratchSpotLightPos: Float32Array = new Float32Array(16 * 4);
  private readonly _scratchSpotLightDir: Float32Array = new Float32Array(16 * 4);
  private readonly _scratchSpotLightColor: Float32Array = new Float32Array(16 * 4);
  private readonly _scratchSpotLightParams: Float32Array = new Float32Array(16 * 4);
  private readonly _scratchSpotShadowMatrix: Float32Array = new Float32Array(4 * 16);
  private readonly _scratchSpotShadowInfo: Float32Array = new Float32Array(4 * 4);
  private readonly _scratchElementMaskBox: Float32Array = new Float32Array(4);
  private readonly _scratchElementMaskSize: Float32Array = new Float32Array(4);
  private readonly _scratchFogVolumeMaskInfo: Float32Array = new Float32Array(16 * 4);
  private readonly _scratchMaskedVolumeIndices: Int32Array = new Int32Array(8);
  /** Texture units of the 4 spot shadow samplers (0 = depth, 1 = sun shadow, 2 = irradiance). */
  private readonly _spotShadowUnits: Int32Array = new Int32Array([3, 4, 5, 6]);

  // 3D density-mask texture units. WebGL2 guarantees at least 16 fragment texture units; 0..6 are
  // taken by the depth/shadow/IBL/spot-shadow samplers above and the bilateral pass uses its own 0/1.
  /** Unit of the element-global density mask. */
  private static readonly _ELEMENT_MASK_UNIT: number = 7;
  /** Number of per-FogVolume mask slots on units 8..15. */
  private static readonly _VOLUME_MASK_SLOTS: number = 8;
  /** Texture units of the per-FogVolume mask slots. */
  private readonly _fogVolumeMaskUnits: Int32Array = new Int32Array([8, 9, 10, 11, 12, 13, 14, 15]);

  private _warnedMaskCapacity: boolean = false;
  private _identityMask3D: WebGLTexture | null = null;
  /** GPU copies of the VolumetricTextures this pass has uploaded, keyed by their CPU object. */
  private readonly _maskTextures = new Map<VolumetricTexture, WebGLTexture>();

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
      this._uFogHeightLoc = gl.getUniformLocation(this._progFog, "u_fogHeight");
      this._uFogHeightFalloffLoc = gl.getUniformLocation(this._progFog, "u_fogHeightFalloff");
      this._uIrradianceMapLoc = gl.getUniformLocation(this._progFog, "u_irradianceMap");
      this._uEnvIntensityLoc = gl.getUniformLocation(this._progFog, "u_envIntensity");
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

      this._uNumPointLightsLoc = gl.getUniformLocation(this._progFog, "u_numPointLights");
      this._uPointLightPosLoc = gl.getUniformLocation(this._progFog, "u_pointLightPos");
      this._uPointLightColorLoc = gl.getUniformLocation(this._progFog, "u_pointLightColor");
      this._uNumSpotLightsLoc = gl.getUniformLocation(this._progFog, "u_numSpotLights");
      this._uSpotLightPosLoc = gl.getUniformLocation(this._progFog, "u_spotLightPos");
      this._uSpotLightDirLoc = gl.getUniformLocation(this._progFog, "u_spotLightDir");
      this._uSpotLightColorLoc = gl.getUniformLocation(this._progFog, "u_spotLightColor");
      this._uSpotLightParamsLoc = gl.getUniformLocation(this._progFog, "u_spotLightParams");
      this._uSpotShadowMapLoc = gl.getUniformLocation(this._progFog, "u_spotShadowMap");
      this._uSpotShadowMatrixLoc = gl.getUniformLocation(this._progFog, "u_spotShadowMatrix");
      this._uSpotShadowInfoLoc = gl.getUniformLocation(this._progFog, "u_spotShadowInfo");

      this._uElementMaskLoc = gl.getUniformLocation(this._progFog, "u_elementMask");
      this._uElementMaskBoxLoc = gl.getUniformLocation(this._progFog, "u_elementMaskBox");
      this._uElementMaskSizeLoc = gl.getUniformLocation(this._progFog, "u_elementMaskSize");
      this._uElementMaskEnabledLoc = gl.getUniformLocation(this._progFog, "u_elementMaskEnabled");
      this._uElementMaskAlbedoLoc = gl.getUniformLocation(this._progFog, "u_elementMaskAlbedo");
      this._uFogVolumeMasksLoc = gl.getUniformLocation(this._progFog, "u_fogVolumeMasks");
      this._uFogVolumeMaskInfoLoc = gl.getUniformLocation(this._progFog, "u_fogVolumeMaskInfo");

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
    irradianceMap: WebGLTexture | null = null,
    envIntensity: number = 0,
    pointLights: PointLight[] = [],
    spotLights: SpotLight[] = [],
    spotShadowTextures: readonly (WebGLTexture | null)[] = [],
    fallbackShadowTexture: WebGLTexture | null = null,
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

    // IBL irradiance cube -> Unit 2
    gl2.activeTexture(gl2.TEXTURE2);
    gl2.bindTexture(gl2.TEXTURE_CUBE_MAP, irradianceMap ?? this._getBlackCube(gl2));
    if (this._uIrradianceMapLoc) gl2.uniform1i(this._uIrradianceMapLoc, 2);
    if (this._uEnvIntensityLoc) gl2.uniform1f(this._uEnvIntensityLoc, envIntensity);

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

    const albedo = Math.min(Math.max(element.scatteringAlbedo, 0.0), 1.0);
    // While an element mask is bound the per-cell albedo is applied inside the shader, so the CPU
    // bake keeps the albedo factor out (1.0) and the mask re-applies it per box cell; without a mask
    // the bake stays exactly the pre-mask value (regression invariant).
    const hasElementMask = element.densityMask !== undefined && element.densityMask.isLoaded;
    const bakedAlbedo = hasElementMask ? 1.0 : albedo;
    const sunScale = sunActive
      ? dirLight!.intensity * dirLight!.volumetricIntensity * bakedAlbedo
      : 0.0;
    if (this._uSunColorLoc) {
      gl2.uniform3f(
        this._uSunColorLoc,
        sunActive ? dirLight!.color.r * element.color.r * sunScale : 0.0,
        sunActive ? dirLight!.color.g * element.color.g * sunScale : 0.0,
        sunActive ? dirLight!.color.b * element.color.b * sunScale : 0.0,
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
    if (this._uAmbientInjectLoc)
      gl2.uniform1f(this._uAmbientInjectLoc, element.ambientInject * bakedAlbedo);

    if (this._uIntensityLoc) gl2.uniform1f(this._uIntensityLoc, element.intensity);
    if (this._uDensityLoc) gl2.uniform1f(this._uDensityLoc, element.density);
    if (this._uFogHeightLoc) gl2.uniform1f(this._uFogHeightLoc, element.height);
    if (this._uFogHeightFalloffLoc) {
      gl2.uniform1f(this._uFogHeightFalloffLoc, element.heightFalloff);
    }
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

    // Upload local point lights
    const numPts = Math.min(pointLights.length, 16);
    if (this._uNumPointLightsLoc) gl2.uniform1i(this._uNumPointLightsLoc, numPts);
    for (let i = 0; i < 16; i++) {
      const base = i * 4;
      if (i < numPts) {
        const pl = pointLights[i]!;
        const mat = pl.worldMatrix.data;
        this._scratchPointLightPos[base] = mat[12]!;
        this._scratchPointLightPos[base + 1] = mat[13]!;
        this._scratchPointLightPos[base + 2] = mat[14]!;
        this._scratchPointLightPos[base + 3] = pl.distance;

        const pScale = pl.intensity * pl.volumetricIntensity * bakedAlbedo;
        this._scratchPointLightColor[base] = pl.color.r * pScale * element.color.r;
        this._scratchPointLightColor[base + 1] = pl.color.g * pScale * element.color.g;
        this._scratchPointLightColor[base + 2] = pl.color.b * pScale * element.color.b;
        this._scratchPointLightColor[base + 3] = pl.decay;
      } else {
        this._scratchPointLightPos.fill(0, base, base + 4);
        this._scratchPointLightColor.fill(0, base, base + 4);
      }
    }
    if (this._uPointLightPosLoc)
      gl2.uniform4fv(this._uPointLightPosLoc, this._scratchPointLightPos);
    if (this._uPointLightColorLoc)
      gl2.uniform4fv(this._uPointLightColorLoc, this._scratchPointLightColor);

    // Upload local spot lights
    const numSpots = Math.min(spotLights.length, 16);
    if (this._uNumSpotLightsLoc) gl2.uniform1i(this._uNumSpotLightsLoc, numSpots);
    for (let i = 0; i < 16; i++) {
      const base = i * 4;
      if (i < numSpots) {
        const sl = spotLights[i]!;
        const mat = sl.worldMatrix.data;
        const dir = sl.direction;
        const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1.0;
        this._scratchSpotLightPos[base] = mat[12]!;
        this._scratchSpotLightPos[base + 1] = mat[13]!;
        this._scratchSpotLightPos[base + 2] = mat[14]!;
        this._scratchSpotLightPos[base + 3] = sl.distance;

        this._scratchSpotLightDir[base] = dir.x / dirLen;
        this._scratchSpotLightDir[base + 1] = dir.y / dirLen;
        this._scratchSpotLightDir[base + 2] = dir.z / dirLen;
        this._scratchSpotLightDir[base + 3] = sl.decay;

        const sScale = sl.intensity * sl.volumetricIntensity * bakedAlbedo;
        this._scratchSpotLightColor[base] = sl.color.r * sScale * element.color.r;
        this._scratchSpotLightColor[base + 1] = sl.color.g * sScale * element.color.g;
        this._scratchSpotLightColor[base + 2] = sl.color.b * sScale * element.color.b;
        this._scratchSpotLightColor[base + 3] = 0.0;

        this._scratchSpotLightParams[base] = Math.cos(sl.angle);
        this._scratchSpotLightParams[base + 1] = Math.cos(sl.angle * (1.0 - sl.penumbra));
        this._scratchSpotLightParams[base + 2] = sl.distance;
        this._scratchSpotLightParams[base + 3] = sl.decay;
      } else {
        this._scratchSpotLightPos.fill(0, base, base + 4);
        this._scratchSpotLightDir.fill(0, base, base + 4);
        this._scratchSpotLightColor.fill(0, base, base + 4);
        this._scratchSpotLightParams.fill(0, base, base + 4);
      }
    }
    if (this._uSpotLightPosLoc) gl2.uniform4fv(this._uSpotLightPosLoc, this._scratchSpotLightPos);
    if (this._uSpotLightDirLoc) gl2.uniform4fv(this._uSpotLightDirLoc, this._scratchSpotLightDir);
    if (this._uSpotLightColorLoc)
      gl2.uniform4fv(this._uSpotLightColorLoc, this._scratchSpotLightColor);
    if (this._uSpotLightParamsLoc)
      gl2.uniform4fv(this._uSpotLightParamsLoc, this._scratchSpotLightParams);

    // Spot shadow maps of the first 4 spots -> units 3..6. A slot without a (shadow-casting) spot
    // binds the fallback depth texture and is switched off in the shader via its info.z flag.
    for (let i = 0; i < 4; i++) {
      const sl = i < numSpots ? spotLights[i] : undefined;
      const tex = spotShadowTextures[i] ?? null;
      const active =
        element.localLightShadows &&
        tex !== null &&
        sl !== undefined &&
        sl.castShadow &&
        sl.shadowCamera !== undefined;
      gl2.activeTexture(gl2.TEXTURE0 + 3 + i);
      gl2.bindTexture(gl2.TEXTURE_2D, active ? tex : fallbackShadowTexture);
      const info = i * 4;
      if (active) {
        this._scratchSpotShadowMatrix.set(sl.shadowCamera!.viewProjectionMatrix, i * 16);
        this._scratchSpotShadowInfo[info] = sl.shadowBias;
        this._scratchSpotShadowInfo[info + 2] = 1.0;
      } else {
        this._scratchSpotShadowMatrix.fill(0, i * 16, i * 16 + 16);
        this._scratchSpotShadowInfo[info] = 0.0;
        this._scratchSpotShadowInfo[info + 2] = 0.0;
      }
    }
    gl2.activeTexture(gl2.TEXTURE0);
    if (this._uSpotShadowMapLoc) gl2.uniform1iv(this._uSpotShadowMapLoc, this._spotShadowUnits);
    if (this._uSpotShadowMatrixLoc) {
      gl2.uniformMatrix4fv(this._uSpotShadowMatrixLoc, false, this._scratchSpotShadowMatrix);
    }
    if (this._uSpotShadowInfoLoc) {
      gl2.uniform4fv(this._uSpotShadowInfoLoc, this._scratchSpotShadowInfo);
    }

    // Bind the 3D density masks (element-global + per-FogVolume) on units 7..15 and upload the
    // uniforms that drive their sampling. A pure no-mask scene performs no 3D-texture GL work here.
    this._prepareMasks(gl2, element, fogVolumes, numVols, hasElementMask);

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

  /** Maps a `VolumetricTexture` to its WebGL 3D texture, uploading on first use and re-uploading
   * when the author flagged `.needsUpdate` (the flag is cleared here, after the GPU upload). */
  private _uploadMask(gl2: WebGL2RenderingContext, mask: VolumetricTexture): WebGLTexture {
    let glTex = this._maskTextures.get(mask);
    if (!glTex) {
      glTex = gl2.createTexture()!;
      this._maskTextures.set(mask, glTex);
      this._uploadMaskData(gl2, mask, glTex);
    } else if (mask.needsUpdate) {
      this._uploadMaskData(gl2, mask, glTex);
    }
    return glTex;
  }

  private _uploadMaskData(
    gl2: WebGL2RenderingContext,
    mask: VolumetricTexture,
    glTex: WebGLTexture,
  ): void {
    gl2.bindTexture(gl2.TEXTURE_3D, glTex);
    // RGBA8 unflipped upload: row 0 stays at v = 0, matching the bottom-up convention of the data.
    gl2.texImage3D(
      gl2.TEXTURE_3D,
      0,
      gl2.RGBA8,
      mask.width,
      mask.height,
      mask.depth,
      0,
      gl2.RGBA,
      gl2.UNSIGNED_BYTE,
      mask.data,
    );
    gl2.texParameteri(
      gl2.TEXTURE_3D,
      gl2.TEXTURE_MIN_FILTER,
      this._glMinFilter(gl2, mask.minFilter),
    );
    gl2.texParameteri(
      gl2.TEXTURE_3D,
      gl2.TEXTURE_MAG_FILTER,
      this._glMagFilter(gl2, mask.magFilter),
    );
    gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_S, this._glWrap(gl2, mask.addressModeU));
    gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_T, this._glWrap(gl2, mask.addressModeV));
    gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_R, this._glWrap(gl2, mask.addressModeW));
    if (this._requiresMipmaps(mask.minFilter)) gl2.generateMipmap(gl2.TEXTURE_3D);
    mask.needsUpdate = false;
  }

  private _glMinFilter(gl2: WebGL2RenderingContext, filter: TextureFilter): number {
    switch (filter) {
      case TextureFilter.NEAREST:
        return gl2.NEAREST;
      case TextureFilter.NEAREST_MIPMAP_NEAREST:
        return gl2.NEAREST_MIPMAP_NEAREST;
      case TextureFilter.NEAREST_MIPMAP_LINEAR:
        return gl2.NEAREST_MIPMAP_LINEAR;
      case TextureFilter.LINEAR_MIPMAP_NEAREST:
        return gl2.LINEAR_MIPMAP_NEAREST;
      case TextureFilter.LINEAR_MIPMAP_LINEAR:
        return gl2.LINEAR_MIPMAP_LINEAR;
      default:
        return gl2.LINEAR; // LINEAR / DEFAULT
    }
  }

  private _glMagFilter(gl2: WebGL2RenderingContext, filter: TextureFilter): number {
    return TextureFilter.NEAREST === filter ? gl2.NEAREST : gl2.LINEAR;
  }

  private _requiresMipmaps(filter: TextureFilter): boolean {
    switch (filter) {
      case TextureFilter.NEAREST_MIPMAP_NEAREST:
      case TextureFilter.NEAREST_MIPMAP_LINEAR:
      case TextureFilter.LINEAR_MIPMAP_NEAREST:
      case TextureFilter.LINEAR_MIPMAP_LINEAR:
        return true;
      default:
        return false;
    }
  }

  private _glWrap(gl2: WebGL2RenderingContext, wrap: TextureWrap): number {
    if (TextureWrap.REPEAT === wrap) return gl2.REPEAT;
    if (TextureWrap.MIRRORED_REPEAT === wrap) return gl2.MIRRORED_REPEAT;
    return gl2.CLAMP_TO_EDGE;
  }

  private _getIdentityMask3D(gl2: WebGL2RenderingContext): WebGLTexture {
    if (!this._identityMask3D) {
      const tex = gl2.createTexture()!;
      gl2.bindTexture(gl2.TEXTURE_3D, tex);
      gl2.texImage3D(
        gl2.TEXTURE_3D,
        0,
        gl2.RGBA8,
        1,
        1,
        1,
        0,
        gl2.RGBA,
        gl2.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255]),
      );
      gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
      gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
      gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_R, gl2.CLAMP_TO_EDGE);
      this._identityMask3D = tex;
    }
    return this._identityMask3D!;
  }

  /**
   * Uploads the element-global and per-volume 3D density masks (units 7..15) and the uniforms that
   * drive their in-shader sampling. Returns without touching the 3D texture units when no mask is
   * bound, so the no-mask path performs exactly the GL work it did before the mask feature.
   */
  private _prepareMasks(
    gl2: WebGL2RenderingContext,
    element: VolumetricFogElement,
    fogVolumes: FogVolume[],
    numVols: number,
    hasElementMask: boolean,
  ): void {
    this._scratchFogVolumeMaskInfo.fill(0, 0, 16 * 4);

    // Compact masked volumes onto the available slots; overflow beyond the slot budget is dropped
    // (with a one-time warning) instead of silently rendering wrong.
    let maskedCount = 0;
    for (let i = 0; i < numVols; i++) {
      const volMask = fogVolumes[i]!.densityMask;
      if (volMask !== null && volMask.isLoaded) {
        if (maskedCount < VolumetricFogPassGL._VOLUME_MASK_SLOTS) {
          this._scratchMaskedVolumeIndices[maskedCount] = i;
        }
        maskedCount++;
      }
    }
    if (maskedCount > VolumetricFogPassGL._VOLUME_MASK_SLOTS && !this._warnedMaskCapacity) {
      this._warnedMaskCapacity = true;
      console.warn(
        `[VolumetricFog] ${maskedCount} FogVolumes have density masks, only the first ${VolumetricFogPassGL._VOLUME_MASK_SLOTS} are evaluated.`,
      );
    }

    if (this._uElementMaskEnabledLoc) {
      gl2.uniform1f(this._uElementMaskEnabledLoc, hasElementMask ? 1.0 : 0.0);
    }

    const boundMaskCount =
      (hasElementMask ? 1 : 0) + Math.min(maskedCount, VolumetricFogPassGL._VOLUME_MASK_SLOTS);
    if (boundMaskCount === 0) {
      if (this._uFogVolumeMaskInfoLoc) {
        gl2.uniform4fv(this._uFogVolumeMaskInfoLoc, this._scratchFogVolumeMaskInfo);
      }
      return;
    }

    // Keep every mask unit bound to a valid texture (an unused slot must not sample stale state).
    const identity = this._getIdentityMask3D(gl2);
    for (let u = 0; u < 1 + VolumetricFogPassGL._VOLUME_MASK_SLOTS; u++) {
      gl2.activeTexture(gl2.TEXTURE0 + VolumetricFogPassGL._ELEMENT_MASK_UNIT + u);
      gl2.bindTexture(gl2.TEXTURE_3D, identity);
    }

    if (this._uElementMaskLoc) {
      gl2.uniform1i(this._uElementMaskLoc, VolumetricFogPassGL._ELEMENT_MASK_UNIT);
    }
    if (this._uFogVolumeMasksLoc) {
      gl2.uniform1iv(this._uFogVolumeMasksLoc, this._fogVolumeMaskUnits);
    }

    if (hasElementMask) {
      const mask = element.densityMask!;
      gl2.activeTexture(gl2.TEXTURE0 + VolumetricFogPassGL._ELEMENT_MASK_UNIT);
      gl2.bindTexture(gl2.TEXTURE_3D, this._uploadMask(gl2, mask));
      const pos = element.maskPosition;
      this._scratchElementMaskBox[0] = pos.x;
      this._scratchElementMaskBox[1] = pos.y;
      this._scratchElementMaskBox[2] = pos.z;
      const size = element.maskSize;
      this._scratchElementMaskSize[0] = size.x;
      this._scratchElementMaskSize[1] = size.y;
      this._scratchElementMaskSize[2] = size.z;
      if (this._uElementMaskBoxLoc) {
        gl2.uniform4fv(this._uElementMaskBoxLoc, this._scratchElementMaskBox);
      }
      if (this._uElementMaskSizeLoc) {
        gl2.uniform4fv(this._uElementMaskSizeLoc, this._scratchElementMaskSize);
      }
      if (this._uElementMaskAlbedoLoc) {
        gl2.uniform1f(
          this._uElementMaskAlbedoLoc,
          Math.min(Math.max(element.scatteringAlbedo, 0.0), 1.0),
        );
      }
    }

    const numSlots = Math.min(maskedCount, VolumetricFogPassGL._VOLUME_MASK_SLOTS);
    for (let s = 0; s < numSlots; s++) {
      const index = this._scratchMaskedVolumeIndices[s]!;
      const vol = fogVolumes[index]!;
      gl2.activeTexture(gl2.TEXTURE0 + this._fogVolumeMaskUnits[s]!);
      gl2.bindTexture(gl2.TEXTURE_3D, this._uploadMask(gl2, vol.densityMask!));
      const base = index * 4;
      this._scratchFogVolumeMaskInfo[base] = 1.0;
      this._scratchFogVolumeMaskInfo[base + 1] = s;
    }
    if (this._uFogVolumeMaskInfoLoc) {
      gl2.uniform4fv(this._uFogVolumeMaskInfoLoc, this._scratchFogVolumeMaskInfo);
    }
  }

  private _getBlackCube(gl2: WebGL2RenderingContext): WebGLTexture {
    if (!this._blackCube) {
      const tex = gl2.createTexture();
      gl2.bindTexture(gl2.TEXTURE_CUBE_MAP, tex);
      for (let face = 0; face < 6; face++) {
        gl2.texImage2D(
          gl2.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          0,
          gl2.RGBA8,
          1,
          1,
          0,
          gl2.RGBA,
          gl2.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 255]),
        );
      }
      gl2.texParameteri(gl2.TEXTURE_CUBE_MAP, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_CUBE_MAP, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
      this._blackCube = tex;
    }
    return this._blackCube!;
  }

  public destroy(): void {
    if (!this._isWebGL2) return;
    const gl = this._gl;
    const gl2 = gl as WebGL2RenderingContext;
    if (this._blackCube) {
      gl2.deleteTexture(this._blackCube);
      this._blackCube = null;
    }
    if (this._identityMask3D) {
      gl2.deleteTexture(this._identityMask3D);
      this._identityMask3D = null;
    }
    for (const tex of this._maskTextures.values()) gl2.deleteTexture(tex);
    this._maskTextures.clear();
    this._halfColorFbo?.destroy();
    this._fullFogFbo?.destroy();
    if (this._vaoFog) gl2.deleteVertexArray(this._vaoFog);
    if (this._vaoBilateral) gl2.deleteVertexArray(this._vaoBilateral);
    if (this._progFog) gl.deleteProgram(this._progFog);
    if (this._progBilateral) gl.deleteProgram(this._progBilateral);
  }
}
