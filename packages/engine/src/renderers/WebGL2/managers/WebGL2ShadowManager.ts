import type { Color } from "../../../core/colors/index.js";
import type { Object3D, RenderBatch } from "../../../core/index.js";
import type { AbstractLight, DirectionalLight } from "../../../core/lights/index.js";
import {
  CUBE_FACE_COUNT,
  MAX_SHADOWED_POINT_LIGHTS,
  SPOT_SHADOW_LAYERS,
  pointShadowLayer,
} from "../../../core/lights/PointLightShadow.js";
import { DepthMaterial } from "../../../core/materials/index.js";
import { EvsmMomentMaterial } from "../../../core/materials/EvsmMomentMaterial.js";
import { MaterialType, ShadowMode } from "../../../enums/index.js";
import type { LightDataInterface, QualityConfig } from "../../../interfaces/index.js";
import type { Matrix4 } from "../../../math/index.js";
import { Vector3D } from "../../../math/index.js";
import { Color as ColorClass } from "../../../core/colors/index.js";
import { WebGL2GlobalUniformLayout } from "../../GlobalUniformLayout.js";
import type { WebGLProgramCacheEntry } from "../../gl/managers/WebGLProgramCache.js";
import { requireGlObject } from "../../gl/requireGlObject.js";
import { WebGL2DepthFrameBuffer } from "../WebGL2DepthFrameBuffer.js";
import { WebGL2PointShadows } from "../WebGL2PointShadows.js";
import { WebGL2SpotShadowArray } from "../WebGL2SpotShadowArray.js";
import type { WebGL2UniformBuffer } from "../WebGL2UniformBuffer.js";

/** Narrow host contract passed by `WebGL2Renderer` during shadow-map rendering. */
export interface WebGL2ShadowHost {
  readonly gl: WebGL2RenderingContext;
  readonly quality: QualityConfig;
  readonly targetClearColor: Color;
  readonly frameViewProj: Matrix4;
  readonly frameCamPos: Vector3D;
  readonly frameSceneRoot: Object3D | undefined;
  readonly globalUBO: WebGL2UniformBuffer;
  updateGlobalUBO(vp: Float32Array, camPos: Vector3D, lights: LightDataInterface): void;
  renderShadowScene(
    shaderId: string,
    lineShaderId: string,
    texelNdc: number,
    sortedGroups: RenderBatch[],
  ): void;
  drawFieldShadowView(
    shaderId: string,
    vp: Float32Array,
    pass: "shadow" | "evsm",
    slotOverride?: number,
  ): void;
}

/**
 * Owns WebGL2 directional CSM, EVSM moment atlas (ADR 0043), spot shadow array, and point-light
 * cube-face shadow resources (ADR 0052), plus their per-program uniform/sampler bindings.
 */
export class WebGL2ShadowManager {
  /** Dedicated unit 13 for PCSS raw (non-comparison) depth blocker search. */
  public static readonly RAW_DEPTH_UNIT = 13;
  /** Fixed unit of the spot shadow depth array (`u_spotShadowMap`, sampler2DArrayShadow). */
  public static readonly SPOT_SHADOW_UNIT = 11;
  /** Defensive fallback unit for the EVSM moment atlas sampler (ADR 0043). */
  private static readonly _EVSM_MAP_UNIT = 14;
  /** EVSM tuning lanes, byte-identical to the WebGPU side (GlobalUniformWriter lanes 217-219). */
  private static readonly _EVSM_VARIANCE_FLOOR = 0.002;
  private static readonly _EVSM_LIGHT_BLEED = 0.12;
  private static readonly _EVSM_RECEIVE_BIAS = 0.0002;

  private _rawDepthSampler!: WebGLSampler;
  private _dummyShadowMap!: WebGL2DepthFrameBuffer;
  private _spotShadowArray!: WebGL2SpotShadowArray;
  private _dummySpotShadowArray!: WebGL2SpotShadowArray;
  private readonly _spotShadowSlots: boolean[] = [false, false, false, false];
  private readonly _pointShadows: WebGL2PointShadows = new WebGL2PointShadows();
  private _shadowMaps: Map<AbstractLight, WebGL2DepthFrameBuffer> = new Map();
  private readonly _shadowMapsUsed: Set<AbstractLight> = new Set();
  private readonly _fogSpotShadowTextures: (WebGLTexture | null)[] = [null, null, null, null];
  private readonly _pointFaceMatrix: Float32Array = new Float32Array(16);
  private readonly _scratchFloat4: Float32Array = new Float32Array(4);

  /** Reused "no lights" payload for the depth-only shadow programs. */
  private readonly _emptyLights: LightDataInterface = {
    aCol: new ColorClass(0, 0, 0, 1),
    aIntensity: 0,
    dCol: new ColorClass(0, 0, 0, 1),
    dDir: Vector3D.ZERO,
    dIntensity: 0,
    aLights: [],
    pLights: [],
    sLights: [],
  };

  private _evsmFarClear: [number, number, number, number] = [0, 0, 0, 0];
  private _evsmAtlasFbo: WebGLFramebuffer | null = null;
  private _evsmAtlasTexture: WebGLTexture | null = null;
  private _evsmDummyTexture: WebGLTexture | null = null;
  private _evsmSupported = false;
  private _evsmSupportChecked = false;

  public get fallbackShadowTexture(): WebGLTexture {
    return this._dummyShadowMap.texture;
  }

  public get fallbackSpotShadowArray(): WebGLTexture {
    return this._dummySpotShadowArray.texture;
  }

  public getDirectionalShadowTexture(light: AbstractLight | undefined): WebGLTexture | null {
    return light ? (this._shadowMaps.get(light)?.texture ?? null) : null;
  }

  /** Allocates dummy shadow targets, spot shadow array, and raw-depth comparison-free sampler. */
  public createResources(gl: WebGL2RenderingContext): void {
    this._dummyShadowMap = new WebGL2DepthFrameBuffer(gl, 1, 1);
    this._dummyShadowMap.bind();
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this._dummyShadowMap.unbind();

    this._spotShadowArray = new WebGL2SpotShadowArray(gl, 1);
    this._dummySpotShadowArray = new WebGL2SpotShadowArray(gl, 1, WebGL2SpotShadowArray.LAYERS);
    for (let i = 0; i < WebGL2SpotShadowArray.LAYERS; i++) this._dummySpotShadowArray.bindLayer(i);
    this._dummySpotShadowArray.unbind();
    this._spotShadowSlots.fill(false);

    // Sampler object overriding TEXTURE_COMPARE_MODE to NONE for PCSS blocker search.
    this._rawDepthSampler = requireGlObject(gl.createSampler(), "sampler");
    gl.samplerParameteri(this._rawDepthSampler, gl.TEXTURE_COMPARE_MODE, gl.NONE);
    gl.samplerParameteri(this._rawDepthSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(this._rawDepthSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this._rawDepthSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this._rawDepthSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindSampler(WebGL2ShadowManager.RAW_DEPTH_UNIT, this._rawDepthSampler);
  }

  /** Per spot slot the fog samples: the spot shadow array when that slot holds this frame's shadow. */
  public collectFogSpotShadowTextures(
    lights: LightDataInterface | undefined,
  ): readonly (WebGLTexture | null)[] {
    const spots = lights?.sLights ?? [];
    for (let i = 0; i < 4; i++) {
      const light = spots[i];
      this._fogSpotShadowTextures[i] =
        light !== undefined &&
        light.castShadow &&
        light.shadowCamera !== undefined &&
        this._spotShadowSlots[i]
          ? this._spotShadowArray.texture
          : null;
    }
    return this._fogSpotShadowTextures;
  }

  /** Renders directional CSM, optional EVSM moments, spot shadow layers, and point shadow faces. */
  public renderShadowMaps(
    host: WebGL2ShadowHost,
    lights: LightDataInterface,
    sortedGroups: RenderBatch[],
  ): void {
    const gl = host.gl;
    const emptyLights = this._emptyLights;
    this._shadowMapsUsed.clear();

    this._spotShadowSlots.fill(false);
    const spotSlots = Math.min(lights.sLights.length, SPOT_SHADOW_LAYERS);
    const pointShadows = this._pointShadows;
    const pointSlots = pointShadows.prepare(
      lights.pLights,
      host.frameViewProj,
      host.frameCamPos,
      host.quality.maxShadowedPointLights ?? MAX_SHADOWED_POINT_LIGHTS,
      host.frameSceneRoot,
      sortedGroups,
    );
    let arraySize = 0;
    for (let i = 0; i < spotSlots; i++) {
      const light = lights.sLights[i]!;
      if (light.castShadow) arraySize = Math.max(arraySize, light.shadowResolution || 1024);
    }
    for (let s = 0; s < pointSlots; s++) {
      arraySize = Math.max(arraySize, pointShadows.lights[s]!.shadowResolution || 256);
    }
    const spotArray = this._spotShadowArray;
    if (arraySize > 0) {
      spotArray.resize(
        arraySize,
        pointSlots > 0 ? WebGL2SpotShadowArray.LAYERS : SPOT_SHADOW_LAYERS,
      );
    }

    // DirectionalLight (CSM Atlas) runs BEFORE spot/point so field shadow view slots `1..C` match EVSM.
    if (lights.dLight && lights.dLight.castShadow && lights.dLight.numCascades > 0) {
      const light = lights.dLight;
      const res = light.shadowResolution;
      const cols = Math.ceil(Math.sqrt(light.numCascades));
      const rows = Math.ceil(light.numCascades / cols);
      const atlasWidth = cols * res;
      const atlasHeight = rows * res;

      let fbo = this._shadowMaps.get(light);
      if (!fbo) {
        fbo = new WebGL2DepthFrameBuffer(gl, atlasWidth, atlasHeight);
        this._shadowMaps.set(light, fbo);
      } else {
        fbo.resize(atlasWidth, atlasHeight);
      }
      this._shadowMapsUsed.add(light);

      fbo.bind();
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      for (let i = 0; i < light.numCascades; i++) {
        const cascadeCam = light.cascadeCameras[i];
        if (!cascadeCam) continue;

        const col = i % cols;
        const row = Math.floor(i / cols);
        gl.viewport(col * res, row * res, res, res);

        host.updateGlobalUBO(cascadeCam.viewProjectionMatrix, cascadeCam.position, emptyLights);
        host.renderShadowScene(
          MaterialType.DEPTH,
          DepthMaterial.LINE_QUADS_SHADER_ID,
          2 / res,
          sortedGroups,
        );
        host.drawFieldShadowView(MaterialType.DEPTH, cascadeCam.viewProjectionMatrix, "shadow");
      }

      if (host.quality.shadowMode === ShadowMode.EVSM) {
        this._renderEvsmMoments(host, light, fbo, cols, res, atlasWidth, atlasHeight, sortedGroups);
      }

      gl.cullFace(gl.BACK);
      fbo.unbind();
    }

    for (let i = 0; i < spotSlots; i++) {
      const light = lights.sLights[i]!;
      if (!light.castShadow) continue;
      light.updateShadowCamera();
      const shadowCamera = light.shadowCamera;
      if (!shadowCamera) continue;

      this._spotShadowSlots[i] = true;
      spotArray.bindLayer(i);
      host.updateGlobalUBO(shadowCamera.viewProjectionMatrix, shadowCamera.position, emptyLights);

      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      host.renderShadowScene(
        MaterialType.DEPTH,
        DepthMaterial.LINE_QUADS_SHADER_ID,
        2 / spotArray.size,
        sortedGroups,
      );
      host.drawFieldShadowView(MaterialType.DEPTH, shadowCamera.viewProjectionMatrix, "shadow");

      gl.cullFace(gl.BACK);
      spotArray.unbind();
    }

    for (let s = 0; s < pointSlots; s++) this._renderPointShadowFaces(host, s);

    // Free depth maps of lights that stopped casting or were removed.
    for (const [light, shadowFbo] of this._shadowMaps) {
      if (this._shadowMapsUsed.has(light)) continue;
      shadowFbo.destroy();
      this._shadowMaps.delete(light);
    }
  }

  /** Binds dummy depth textures to shadow samplers to satisfy WebGL2 sampler2DShadow validation. */
  public bindDummyShadowMaps(
    gl: WebGL2RenderingContext,
    cache: WebGLProgramCacheEntry,
    maxUnits: number,
    shadowMode: ShadowMode | undefined,
  ): void {
    const dummyUnit = 12;
    if (dummyUnit >= maxUnits) {
      console.warn(`[WebGL2Renderer] dummyUnit ${dummyUnit} >= maxUnits ${maxUnits}`);
      return;
    }

    gl.activeTexture(gl.TEXTURE0 + dummyUnit);
    gl.bindTexture(gl.TEXTURE_2D, this._dummyShadowMap.texture);

    const dirMapLoc = this._cachedUniformLocation(gl, cache, "u_dirShadowMap");
    if (dirMapLoc) gl.uniform1i(dirMapLoc, dummyUnit);

    const dirMapRawLoc = this._cachedUniformLocation(gl, cache, "u_dirShadowMapRaw");
    if (dirMapRawLoc) {
      gl.activeTexture(gl.TEXTURE0 + WebGL2ShadowManager.RAW_DEPTH_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, this._dummyShadowMap.texture);
      gl.uniform1i(dirMapRawLoc, WebGL2ShadowManager.RAW_DEPTH_UNIT);
    }

    const spotMapLoc = this._cachedUniformLocation(gl, cache, "u_spotShadowMap");
    if (spotMapLoc) {
      gl.activeTexture(gl.TEXTURE0 + WebGL2ShadowManager.SPOT_SHADOW_UNIT);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._dummySpotShadowArray.texture);
      gl.uniform1i(spotMapLoc, WebGL2ShadowManager.SPOT_SHADOW_UNIT);
    }

    this._bindEvsmShadowUniforms(gl, cache, false, shadowMode, maxUnits);
  }

  /** Binds the spot shadow array, per-slot matrices/info, and point-light face table (ADR 0052). */
  public bindSpotShadowMaps(
    gl: WebGL2RenderingContext,
    cache: WebGLProgramCacheEntry,
    lights?: LightDataInterface,
  ): void {
    const pointSlots = this._pointShadows.slotCount;
    const mapLoc = cache.uniforms.get("u_spotShadowMap");
    if (mapLoc && (pointSlots > 0 || this._spotShadowSlots.includes(true))) {
      gl.activeTexture(gl.TEXTURE0 + WebGL2ShadowManager.SPOT_SHADOW_UNIT);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._spotShadowArray.texture);
      gl.uniform1i(mapLoc, WebGL2ShadowManager.SPOT_SHADOW_UNIT);
    }
    const pointInfoLoc = cache.uniforms.get("u_pointShadowInfo[0]");
    if (pointInfoLoc) gl.uniform4fv(pointInfoLoc, this._pointShadows.info);
    const pointMatLoc = cache.uniforms.get("u_pointShadowMatrix[0]");
    if (pointMatLoc && pointSlots > 0) {
      gl.uniformMatrix4fv(pointMatLoc, false, this._pointShadows.matrices);
    }

    if (!lights || lights.sLights.length === 0) return;

    for (let i = 0; i < 4; i++) {
      if (i >= lights.sLights.length) break;
      const light = lights.sLights[i]!;
      const matLoc = cache.uniforms.get(`u_spotShadowMatrix[${i}]`);
      const infoLoc = cache.uniforms.get(`u_spotShadowInfo[${i}]`);

      if (light.castShadow && light.shadowCamera && this._spotShadowSlots[i]) {
        if (matLoc) gl.uniformMatrix4fv(matLoc, false, light.shadowCamera.viewProjectionMatrix);
        if (infoLoc) {
          this._scratchFloat4[0] = light.shadowBias;
          this._scratchFloat4[1] = light.shadowNormalBias;
          this._scratchFloat4[2] = 1.0;
          this._scratchFloat4[3] = 0.0;
          gl.uniform4fv(infoLoc, this._scratchFloat4);
        }
      } else if (infoLoc) {
        this._scratchFloat4[0] = 0.0;
        this._scratchFloat4[1] = 0.0;
        this._scratchFloat4[2] = 0.0;
        this._scratchFloat4[3] = 0.0;
        gl.uniform4fv(infoLoc, this._scratchFloat4);
      }
    }
  }

  /** Binds the directional shadow map + cascade matrices, or resets uniforms when inactive/offscreen. */
  public bindDirectionalShadowMaps(
    gl: WebGL2RenderingContext,
    cache: WebGLProgramCacheEntry,
    lights: LightDataInterface | undefined,
    isOffscreen: boolean,
    quality: QualityConfig,
    maxUnits: number,
  ): void {
    if (
      !isOffscreen &&
      lights &&
      lights.dLight &&
      lights.dLight.castShadow &&
      lights.dLight.numCascades > 0
    ) {
      const light = lights.dLight;
      const mapLoc = cache.uniforms.get("u_dirShadowMap");
      const mapRawLoc = cache.uniforms.get("u_dirShadowMapRaw");
      const splitsLoc = cache.uniforms.get("u_cascadeSplits");
      const infoLoc = cache.uniforms.get("u_dirShadowInfo");

      const fbo = this._shadowMaps.get(light);
      this._bindEvsmShadowUniforms(gl, cache, !!fbo, quality.shadowMode, maxUnits);
      if (fbo && fbo.texture) {
        const texUnit = 12;
        if (!this._ensureShadowMapUnit(texUnit, maxUnits, "directional shadow map")) return;
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, fbo.texture);
        if (mapLoc) gl.uniform1i(mapLoc, texUnit);

        gl.activeTexture(gl.TEXTURE0 + WebGL2ShadowManager.RAW_DEPTH_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, fbo.texture);
        if (mapRawLoc) gl.uniform1i(mapRawLoc, WebGL2ShadowManager.RAW_DEPTH_UNIT);

        for (let i = 0; i < light.numCascades; i++) {
          const matLoc = cache.uniforms.get(`u_cascadeMatrices[${i}]`);
          if (matLoc && light.cascadeCameras[i]) {
            gl.uniformMatrix4fv(matLoc, false, light.cascadeCameras[i]!.viewProjectionMatrix);
          }
        }

        if (splitsLoc) {
          this._scratchFloat4[0] = light.cascadeSplits[0] ?? 0;
          this._scratchFloat4[1] = light.cascadeSplits[1] ?? 0;
          this._scratchFloat4[2] = light.cascadeSplits[2] ?? 0;
          this._scratchFloat4[3] = light.cascadeSplits[3] ?? 0;
          gl.uniform4fv(splitsLoc, this._scratchFloat4);
        }

        if (infoLoc) {
          this._scratchFloat4[0] = light.shadowBias;
          this._scratchFloat4[1] = light.shadowNormalBias;
          this._scratchFloat4[2] = 1.0;
          this._scratchFloat4[3] = light.numCascades;
          gl.uniform4fv(infoLoc, this._scratchFloat4);
        }

        const softLoc = cache.uniforms.get("u_shadowSoftness");
        if (softLoc) {
          this._scratchFloat4[0] = quality.shadowSoftness ?? 1.0;
          this._scratchFloat4[1] = quality.shadowMaxPcfRadius ?? 4.0;
          this._scratchFloat4[2] = 0.0;
          this._scratchFloat4[3] = 0.0;
          gl.uniform4fv(softLoc, this._scratchFloat4);
        }

        const dirBiasLoc = cache.uniforms.get("u_dirShadowBias");
        if (dirBiasLoc) {
          this._scratchFloat4[0] = light.cascadeNormalBiases?.[0] ?? 0.0;
          this._scratchFloat4[1] = light.cascadeNormalBiases?.[1] ?? 0.0;
          this._scratchFloat4[2] = light.cascadeNormalBiases?.[2] ?? 0.0;
          this._scratchFloat4[3] = light.cascadeNormalBiases?.[3] ?? 0.0;
          gl.uniform4fv(dirBiasLoc, this._scratchFloat4);
        }
      }
    } else {
      this._bindEvsmShadowUniforms(gl, cache, false, quality.shadowMode, maxUnits);
      const mapLoc = cache.uniforms.get("u_dirShadowMap");
      if (mapLoc) gl.uniform1i(mapLoc, 12);
      const mapRawLoc = cache.uniforms.get("u_dirShadowMapRaw");
      if (mapRawLoc) gl.uniform1i(mapRawLoc, WebGL2ShadowManager.RAW_DEPTH_UNIT);
      const infoLoc = cache.uniforms.get("u_dirShadowInfo");
      if (infoLoc) {
        this._scratchFloat4[0] = 0.0;
        this._scratchFloat4[1] = 0.0;
        this._scratchFloat4[2] = 0.0;
        this._scratchFloat4[3] = 0.0;
        gl.uniform4fv(infoLoc, this._scratchFloat4);
      }
      const dirBiasLoc = cache.uniforms.get("u_dirShadowBias");
      if (dirBiasLoc) {
        this._scratchFloat4[0] = 0.0;
        this._scratchFloat4[1] = 0.0;
        this._scratchFloat4[2] = 0.0;
        this._scratchFloat4[3] = 0.0;
        gl.uniform4fv(dirBiasLoc, this._scratchFloat4);
      }
    }
  }

  public resetOnContextRestored(): void {
    this._shadowMaps.clear();
    this._shadowMapsUsed.clear();
    this._evsmAtlasFbo = null;
    this._evsmAtlasTexture = null;
    this._evsmDummyTexture = null;
    this._evsmSupported = false;
    this._evsmSupportChecked = false;
  }

  public destroy(gl: WebGL2RenderingContext): void {
    for (const shadowFbo of this._shadowMaps.values()) shadowFbo.destroy();
    this._dummyShadowMap?.destroy();
    this._spotShadowArray?.destroy();
    this._dummySpotShadowArray?.destroy();
    if (this._rawDepthSampler) gl.deleteSampler(this._rawDepthSampler);
    if (this._evsmAtlasTexture) gl.deleteTexture(this._evsmAtlasTexture);
    if (this._evsmAtlasFbo) gl.deleteFramebuffer(this._evsmAtlasFbo);
    if (this._evsmDummyTexture) gl.deleteTexture(this._evsmDummyTexture);
    this._evsmAtlasTexture = null;
    this._evsmAtlasFbo = null;
    this._evsmDummyTexture = null;
    this._shadowMaps.clear();
    this._shadowMapsUsed.clear();
  }

  private _renderPointShadowFaces(host: WebGL2ShadowHost, slot: number): void {
    const gl = host.gl;
    const pointShadows = this._pointShadows;
    const spotArray = this._spotShadowArray;
    const vpOffset = WebGL2GlobalUniformLayout.fields.vp.offset;
    let uboReady = false;
    for (let face = 0; face < CUBE_FACE_COUNT; face++) {
      if (!pointShadows.isFaceVisible(slot, face)) continue;
      const casters = pointShadows.faceCasters(slot, face);
      spotArray.bindLayer(pointShadowLayer(slot, face));
      if (casters.length === 0) continue;

      const vp = this._pointFaceMatrix;
      const base = (slot * CUBE_FACE_COUNT + face) * 16;
      for (let k = 0; k < 16; k++) vp[k] = pointShadows.matrices[base + k]!;
      if (uboReady) {
        host.globalUBO.setMatrix(vpOffset, vp);
        host.globalUBO.updateRange(vpOffset, 64);
      } else {
        host.updateGlobalUBO(vp, pointShadows.position(slot), this._emptyLights);
        uboReady = true;
      }

      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      host.renderShadowScene(
        MaterialType.DEPTH,
        DepthMaterial.LINE_QUADS_SHADER_ID,
        2 / spotArray.size,
        casters,
      );
      host.drawFieldShadowView(MaterialType.DEPTH, vp, "shadow");
      gl.cullFace(gl.BACK);
    }
    spotArray.unbind();
  }

  private _checkEvsmSupport(gl: WebGL2RenderingContext): void {
    if (this._evsmSupportChecked) return;
    this._evsmSupportChecked = true;
    this._evsmSupported = Boolean(gl.getExtension("EXT_color_buffer_float"));

    const farE = Math.exp(40);
    this._evsmFarClear = [farE, farE * farE, -1 / farE, 1 / (farE * farE)];

    if (!this._evsmSupported) {
      console.warn(
        "[WebGL2Renderer] EXT_color_buffer_float is unavailable: EVSM (quality.shadowMode = " +
          "'evsm') falls back to the default shadow mapping instead of a broken moment atlas.",
      );
      return;
    }
    if (this._evsmDummyTexture) return;
    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._evsmDummyTexture = tex;
  }

  private _ensureEvsmAtlas(
    gl: WebGL2RenderingContext,
    atlasWidth: number,
    atlasHeight: number,
  ): boolean {
    if (this._evsmAtlasTexture && this._evsmAtlasFbo) return true;
    if (this._evsmAtlasTexture) {
      gl.deleteTexture(this._evsmAtlasTexture);
      this._evsmAtlasTexture = null;
    }
    if (this._evsmAtlasFbo) {
      gl.deleteFramebuffer(this._evsmAtlasFbo);
      this._evsmAtlasFbo = null;
    }
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      atlasWidth,
      atlasHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      null,
    );
    // NEAREST preserves exact texel taps for the shader's 3x3 box filter and avoids OES_texture_float_linear quirks.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn(
        `[WebGL2Renderer] EVSM moment framebuffer incomplete (0x${status.toString(16)}); ` +
          "falling back to the default shadow mapping.",
      );
      return false;
    }
    this._evsmAtlasTexture = tex;
    this._evsmAtlasFbo = fbo;
    return true;
  }

  private _bindEvsmShadowUniforms(
    gl: WebGL2RenderingContext,
    cache: WebGLProgramCacheEntry,
    atlasReady: boolean,
    shadowMode: ShadowMode | undefined,
    maxUnits: number,
  ): void {
    if (shadowMode !== ShadowMode.EVSM) return;
    const paramsLoc = this._cachedUniformLocation(gl, cache, "u_evsmParams");
    const mapLoc = this._cachedUniformLocation(gl, cache, "u_dirEVSMMap");
    if (!paramsLoc && !mapLoc) return;
    this._checkEvsmSupport(gl);
    const active = atlasReady && shadowMode === ShadowMode.EVSM && this._evsmSupported;
    if (paramsLoc) {
      this._scratchFloat4[0] = active ? 1.0 : 0.0;
      this._scratchFloat4[1] = WebGL2ShadowManager._EVSM_VARIANCE_FLOOR;
      this._scratchFloat4[2] = WebGL2ShadowManager._EVSM_LIGHT_BLEED;
      this._scratchFloat4[3] = WebGL2ShadowManager._EVSM_RECEIVE_BIAS;
      gl.uniform4fv(paramsLoc, this._scratchFloat4);
    }
    if (mapLoc) {
      const unit = cache.samplerUnits.get("u_dirEVSMMap") ?? WebGL2ShadowManager._EVSM_MAP_UNIT;
      if (this._ensureShadowMapUnit(unit, maxUnits, "EVSM moment map")) {
        const useAtlas = active && this._evsmAtlasTexture;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, useAtlas ? this._evsmAtlasTexture : this._evsmDummyTexture);
        gl.uniform1i(mapLoc, unit);
        gl.activeTexture(gl.TEXTURE0);
      }
    }
  }

  private _renderEvsmMoments(
    host: WebGL2ShadowHost,
    light: DirectionalLight,
    depthFbo: WebGL2DepthFrameBuffer,
    cols: number,
    res: number,
    atlasWidth: number,
    atlasHeight: number,
    sortedGroups: RenderBatch[],
  ): void {
    const gl = host.gl;
    this._checkEvsmSupport(gl);
    if (!this._evsmSupported) return;
    if (!this._ensureEvsmAtlas(gl, atlasWidth, atlasHeight)) return;
    if (!this._evsmAtlasFbo || !this._evsmAtlasTexture) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._evsmAtlasFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      depthFbo.texture,
      0,
    );

    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    for (let i = 0; i < light.numCascades; i++) {
      const cascadeCam = light.cascadeCameras[i];
      if (!cascadeCam) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      gl.viewport(col * res, row * res, res, res);

      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(col * res, row * res, res, res);
      gl.clearColor(
        this._evsmFarClear[0],
        this._evsmFarClear[1],
        this._evsmFarClear[2],
        this._evsmFarClear[3],
      );
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);

      host.updateGlobalUBO(cascadeCam.viewProjectionMatrix, cascadeCam.position, this._emptyLights);
      host.renderShadowScene(
        MaterialType.EVSM,
        EvsmMomentMaterial.LINE_QUADS_SHADER_ID,
        2 / res,
        sortedGroups,
      );
      host.drawFieldShadowView(MaterialType.EVSM, cascadeCam.viewProjectionMatrix, "evsm", 1 + i);
    }

    const cc = host.targetClearColor;
    gl.clearColor(cc.r, cc.g, cc.b, cc.a);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.cullFace(gl.BACK);
  }

  private _cachedUniformLocation(
    gl: WebGL2RenderingContext,
    cache: WebGLProgramCacheEntry,
    name: string,
  ): WebGLUniformLocation | undefined {
    if (!cache.uniforms.has(name)) {
      cache.uniforms.set(name, gl.getUniformLocation(cache.prog, name) ?? undefined);
    }
    return cache.uniforms.get(name);
  }

  private _ensureShadowMapUnit(unit: number, maxUnits: number, label: string): boolean {
    if (unit < maxUnits) return true;
    console.warn(
      `[WebGL2Renderer] Exceeded MAX_TEXTURE_IMAGE_UNITS (${maxUnits}). Cannot bind ${label} to texture unit ${unit}.`,
    );
    return false;
  }
}
