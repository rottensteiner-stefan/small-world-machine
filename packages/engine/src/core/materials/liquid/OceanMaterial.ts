import vertWGSL from "./shaders/Ocean.vert.wgsl?raw";
import fragWGSL from "./shaders/Ocean.frag.wgsl?raw";
import vertGLSL from "./shaders/Ocean.vert.glsl?raw";
import fragGLSL from "./shaders/Ocean.frag.glsl?raw";
import vertGLSL100 from "./shaders/Ocean.vert.glsl100?raw";
import fragGLSL100 from "./shaders/Ocean.frag.glsl100?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import {
  StandardWebGPULayout,
  type RenderManifest,
  type ShaderDefinition,
} from "../../../renderers/shaders/index.js";
import { MaterialType, ShaderFlag, ShaderPropertyType } from "../../../enums/index.js";
import { RenderTargetCube, type CubeTexture, type Texture } from "../../textures/index.js";
import { Color } from "../../colors/index.js";
import { Vector2D } from "../../../math/index.js";
import { generateOceanWaveNormalTexture } from "./OceanWaveNormalGenerator.js";

/**
 * Configuration options for the 3-tier horizon-scale {@link OceanMaterial} (ADR 0062).
 */
export interface OceanMaterialOptions {
  /** Shallow/crest body tint (sRGB). Defaults to storm navy `(0.018, 0.065, 0.115)`. */
  waterColor?: Color;
  /** Abyssal deep-water extinction color (sRGB). Defaults to `(0.004, 0.015, 0.036)`. */
  deepWaterColor?: Color;
  /** Backlight wave-crest subsurface scatter tint (sRGB). Defaults to `(0.04, 0.24, 0.30)`. */
  scatterColor?: Color;
  /** @domain Backlight crest subsurface scatter intensity >= 0 (defaults to 0.42). */
  scatterStrength?: number;
  /** @domain Perceptual capillary roughness in [0.03, 1] (defaults to 0.09). */
  roughness?: number;
  /** @domain Wave propagation wind speed multiplier >= 0 (defaults to 1.0). */
  windSpeed?: number;
  /** Normalized dominant XZ wind direction. Defaults to `(0.84, 0.54)`. */
  windDirection?: Vector2D;
  /** @domain Global swell height/steepness multiplier >= 0 (defaults to 1.0). */
  waveScale?: number;
  /** @domain Primary swell wavelength in meters > 2 (defaults to 34.0). */
  waveWavelength?: number;
  /** @domain World XZ radius in meters where swells begin fading out (defaults to 350). */
  swellFadeStart?: number;
  /** @domain World XZ radius in meters where swells become flush with horizon (defaults to 1950). */
  swellFadeEnd?: number;
  /** @domain Micro-normal cascade tiling multiplier > 0 (defaults to 1.0). */
  detailScale?: number;
  /** @domain Micro-normal perturbation gain >= 0 (defaults to 1.15). */
  detailStrength?: number;
  /** Whitecap and shoreline surf color (sRGB). Defaults to `(0.76, 0.84, 0.90)`. */
  foamColor?: Color;
  /** @domain Shoreline surf depth band in meters >= 0 (defaults to 3.2). */
  foamDistance?: number;
  /** @domain Deep-water breaking whitecap coverage in [0, 1] (defaults to 0.42). */
  foamCoverage?: number;
  /** @domain Beer-Lambert RGB absorption coefficients in 1/m (defaults to `[0.52, 0.24, 0.14]`). */
  waterAbsorption?: [number, number, number];
  /** @domain Screen-space underwater refraction distortion gain >= 0 (defaults to 0.02). */
  refractionStrength?: number;
  /** Optional seamless periodic tangent-space normal map; auto-generated in browser when omitted. */
  normalMap?: Texture;
  /** Optional override sky/environment cubemap; falls back to scene `prefilterMap` when omitted. */
  envMap?: CubeTexture;
  /** Optional `PlanarReflectionNode.renderTarget` texture for near-field silhouettes. */
  reflectionMap?: Texture;
  /** @domain Planar reflection mix weight in [0, 1] (defaults to 0.78). */
  reflectionStrength?: number;
  /** @domain Wave-slope UV distortion for planar reflection lookup (defaults to 0.11). */
  reflectionDistortion?: number;
  /** @domain Planar reflection mip-blur roughness in [0, 1] (defaults to 0.04). */
  reflectionRoughness?: number;
  /** @domain Enables WebGPU compute JONSWAP 2D IFFT wavefield synthesis when available (defaults to true). */
  fftEnabled?: boolean;
  /** @domain Fundamental JONSWAP FFT periodic tile width in meters > 16 (defaults to 180.0). */
  fftPatchSize?: number;
  /** @domain Lateral Gerstner chop displacement scale for JONSWAP FFT crests >= 0 (defaults to 1.15). */
  choppiness?: number;
}

let cachedOceanShaderDefinition: ShaderDefinition | undefined;

function getOceanShaderDefinition(): ShaderDefinition {
  cachedOceanShaderDefinition ??= {
    id: MaterialType.OCEAN,
    layout: {
      ...StandardWebGPULayout,
      textures: {
        u_opaqueMap: { type: ShaderPropertyType.TEXTURE },
        u_reflectionMap: { type: ShaderPropertyType.TEXTURE },
        u_opaqueDepthMap: { type: ShaderPropertyType.TEXTURE },
        u_oceanDispMap: { type: ShaderPropertyType.TEXTURE },
        u_oceanNormFoamMap: { type: ShaderPropertyType.TEXTURE },
      },
    },
    sources: {
      glsl300: { vs: vertGLSL, fs: fragGLSL },
      glsl100: { vs: vertGLSL100, fs: fragGLSL100 },
      wgsl: `${vertWGSL}\n[WGSL_PBR_MATH]\n[WGSL_DIR_SHADOW]\n${fragWGSL}`,
    },
  };
  return cachedOceanShaderDefinition;
}

/**
 * First-class open ocean material (ADR 0062) rendered in its own opaque-depth-writing sub-phase
 * (`"main:ocean"`). Features 5-octave swell displacement, 3-layer seamless periodic normal cascade,
 * Tokuyoshi Specular AA, Schlick Fresnel IBL + planar reflection, crest SSS, and organic whitecaps.
 */
export class OceanMaterial extends AbstractMaterial {
  /** Shallow/crest body tint (sRGB). */
  public waterColor: Color;
  /** Abyssal deep-water extinction color (sRGB). */
  public deepWaterColor: Color;
  /** Wave-crest subsurface scatter tint (sRGB). */
  public scatterColor: Color;
  /** @domain Wave-crest subsurface scatter intensity >= 0. */
  public scatterStrength: number;
  /** @domain Perceptual capillary roughness in [0.03, 1]. */
  public roughness: number;
  /** @domain Wave propagation speed scale >= 0. */
  public windSpeed: number;
  /** Dominant XZ wind vector. */
  public windDirection: Vector2D;
  /** @domain Global swell height/steepness scale >= 0. */
  public waveScale: number;
  /** @domain Primary swell wavelength in meters > 2. */
  public waveWavelength: number;
  /** @domain World XZ radius in meters where swells begin flattening. */
  public swellFadeStart: number;
  /** @domain World XZ radius in meters where surface flattens into horizon plane. */
  public swellFadeEnd: number;
  /** @domain Micro-normal cascade tiling multiplier > 0. */
  public detailScale: number;
  /** @domain Micro-normal perturbation gain >= 0. */
  public detailStrength: number;
  /** Whitecap and shoreline surf color (sRGB). */
  public foamColor: Color;
  /** @domain Shoreline surf depth band in meters >= 0. */
  public foamDistance: number;
  /** @domain Breaking whitecap coverage factor in [0, 1]. */
  public foamCoverage: number;
  /** @domain Beer-Lambert RGB absorption coefficients in 1/m. */
  public waterAbsorption: [number, number, number];
  /** @domain Screen-space underwater refraction gain >= 0. */
  public refractionStrength: number;
  /** Elapsed simulation time in seconds. */
  public time: number = 0;

  /** Seamless periodic wave tangent normal map (browser auto-generated when omitted). */
  public normalMap: Texture | undefined;
  /** Optional override sky/environment cubemap. */
  public envMap: CubeTexture | undefined;
  /** Optional planar reflection render target texture. */
  public reflectionMap: Texture | undefined;
  /** @domain Planar reflection mix weight in [0, 1]. */
  public reflectionStrength: number;
  /** @domain Planar reflection wave-slope UV distortion. */
  public reflectionDistortion: number;
  /** @domain Planar reflection mip-blur factor in [0, 1]. */
  public reflectionRoughness: number;
  /** @domain Enables WebGPU compute JONSWAP 2D IFFT wavefield synthesis when available. */
  public fftEnabled: boolean;
  /** @domain Fundamental JONSWAP FFT periodic tile width in meters > 16. */
  public fftPatchSize: number;
  /** @domain Lateral Gerstner chop scale for JONSWAP FFT crests >= 0. */
  public choppiness: number;

  private readonly _ownsNormalMap: boolean;

  /** @derived Packed float32 lane buffer for `u_color`. */
  private readonly _colorArray: Float32Array = new Float32Array(4);
  /** @derived Packed float32 lane buffer for `u_specColor`. */
  private readonly _deepColorArray: Float32Array = new Float32Array(4);
  /** @derived Packed lane `u_matParam0`: `[waterAbsorption.xyz, refractionStrength]`. */
  private readonly _matParam0Array: number[] = [0, 0, 0, 0];
  /** @derived Packed lane `u_matParam1`: `[foamColor.rgb, foamDistance]`. */
  private readonly _matParam1Array: number[] = [0, 0, 0, 0];
  /** @derived Packed lane `u_matParam2`: `[windDirX, windDirZ, waveScale, waveWavelength]`. */
  private readonly _matParam2Array: number[] = [0, 0, 0, 0];
  /** @derived Packed lane `u_matParam3`: `[swellFadeStart, swellFadeEnd, foamCoverage, detailScale]`. */
  private readonly _matParam3Array: number[] = [0, 0, 0, 0];
  /** @derived Packed lane `u_matParam4`: `[scatterColor.rgb, scatterStrength]`. */
  private readonly _matParam4Array: number[] = [0, 0, 0, 0];
  /** @derived Packed lane `u_matParam5`: `[detailStrength, fftEnabled, fftPatchSize, choppiness]`. */
  private readonly _matParam5Array: number[] = [0, 0, 0, 0];
  /** @derived Packed lane `u_matParam9`: `[reflectionStrength, reflectionDistortion, reflectionRoughness, 0]`. */
  private readonly _matParam9Array: number[] = [0, 0, 0, 0];

  constructor(options: OceanMaterialOptions = {}) {
    super(MaterialType.OCEAN);
    this.transparent = false;
    this.depthWrite = true;
    this.depthTest = true;

    this.waterColor = options.waterColor ?? new Color(0.018, 0.065, 0.115);
    this.deepWaterColor = options.deepWaterColor ?? new Color(0.004, 0.015, 0.036);
    this.scatterColor = options.scatterColor ?? new Color(0.04, 0.24, 0.3);
    this.scatterStrength = options.scatterStrength ?? 0.42;
    this.roughness = options.roughness ?? 0.09;
    this.windSpeed = options.windSpeed ?? 1.0;
    this.windDirection = options.windDirection?.clone() ?? new Vector2D(0.84, 0.54);
    this.waveScale = options.waveScale ?? 1.0;
    this.waveWavelength = options.waveWavelength ?? 34.0;
    this.swellFadeStart = options.swellFadeStart ?? 350.0;
    this.swellFadeEnd = options.swellFadeEnd ?? 1950.0;
    this.detailScale = options.detailScale ?? 1.0;
    this.detailStrength = options.detailStrength ?? 1.15;
    this.foamColor = options.foamColor ?? new Color(0.76, 0.84, 0.9);
    this.foamDistance = options.foamDistance ?? 3.2;
    this.foamCoverage = options.foamCoverage ?? 0.42;
    this.waterAbsorption = options.waterAbsorption
      ? [options.waterAbsorption[0], options.waterAbsorption[1], options.waterAbsorption[2]]
      : [0.52, 0.24, 0.14];
    this.refractionStrength = options.refractionStrength ?? 0.02;

    if (options.normalMap) {
      this.normalMap = options.normalMap;
      this._ownsNormalMap = false;
    } else {
      const generated = generateOceanWaveNormalTexture();
      this.normalMap = generated;
      this._ownsNormalMap = generated !== undefined;
    }

    this.envMap = options.envMap;
    this.reflectionMap = options.reflectionMap;
    this.reflectionStrength = options.reflectionStrength ?? 0.78;
    this.reflectionDistortion = options.reflectionDistortion ?? 0.11;
    this.reflectionRoughness = options.reflectionRoughness ?? 0.04;
    this.fftEnabled = options.fftEnabled ?? true;
    this.fftPatchSize = options.fftPatchSize ?? 180.0;
    this.choppiness = options.choppiness ?? 1.15;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return getOceanShaderDefinition();
  }

  /** @inheritdoc Zero-allocation per-frame manifest synchronization. */
  public override getRenderManifest(): RenderManifest {
    if (!this._renderManifest) {
      const m = this._createBaseManifest();
      m.textures["u_opaqueDepthMap"] = undefined;
      m.textures["u_opaqueMap"] = undefined;
      m.properties["u_color"] = this._colorArray;
      m.properties["u_specColor"] = this._deepColorArray;
      m.properties["u_matParam0"] = this._matParam0Array;
      m.properties["u_matParam1"] = this._matParam1Array;
      m.properties["u_matParam2"] = this._matParam2Array;
      m.properties["u_matParam3"] = this._matParam3Array;
      m.properties["u_matParam4"] = this._matParam4Array;
      m.properties["u_matParam5"] = this._matParam5Array;
      m.properties["u_matParam9"] = this._matParam9Array;
      this._renderManifest = m;
    }

    this._syncBaseManifestState();
    const manifest = this._renderManifest;
    if (manifest.state) {
      manifest.state.skipDepthPrePass = true;
    }

    const props = manifest.properties;
    const textures = manifest.textures;
    this._manifestFlags.length = 0;

    if (this.normalMap) {
      textures["u_normalMap"] = this.normalMap;
      this._manifestFlags.push(ShaderFlag.NORMAL_MAP);
    } else {
      delete textures["u_normalMap"];
    }

    if (this.envMap) {
      textures["u_envMap"] = this.envMap;
      this._manifestFlags.push(ShaderFlag.ENV_MAP);
      props["u_useEnvMap"] = this.envMap instanceof RenderTargetCube ? 2.0 : 1.0;
    } else {
      delete textures["u_envMap"];
      props["u_useEnvMap"] = 0.0;
    }

    if (this.reflectionMap) {
      textures["u_reflectionMap"] = this.reflectionMap;
      this._manifestFlags.push(ShaderFlag.REFLECTION_MAP);
    } else {
      delete textures["u_reflectionMap"];
    }

    this._colorArray[0] = this.waterColor.r;
    this._colorArray[1] = this.waterColor.g;
    this._colorArray[2] = this.waterColor.b;
    this._colorArray[3] = 1.0;

    this._deepColorArray[0] = this.deepWaterColor.r;
    this._deepColorArray[1] = this.deepWaterColor.g;
    this._deepColorArray[2] = this.deepWaterColor.b;
    this._deepColorArray[3] = 1.0;

    const p0 = this._matParam0Array;
    p0[0] = this.waterAbsorption[0];
    p0[1] = this.waterAbsorption[1];
    p0[2] = this.waterAbsorption[2];
    p0[3] = this.refractionStrength;

    const p1 = this._matParam1Array;
    p1[0] = this.foamColor.r;
    p1[1] = this.foamColor.g;
    p1[2] = this.foamColor.b;
    p1[3] = this.foamDistance;

    const wx = this.windDirection.x;
    const wz = this.windDirection.y;
    const wLen = Math.hypot(wx, wz);
    const p2 = this._matParam2Array;
    p2[0] = wLen > 1e-4 ? wx / wLen : 0.84;
    p2[1] = wLen > 1e-4 ? wz / wLen : 0.54;
    p2[2] = this.waveScale;
    p2[3] = this.waveWavelength;

    const p3 = this._matParam3Array;
    p3[0] = this.swellFadeStart;
    p3[1] = this.swellFadeEnd;
    p3[2] = this.foamCoverage;
    p3[3] = this.detailScale;

    const p4 = this._matParam4Array;
    p4[0] = this.scatterColor.r;
    p4[1] = this.scatterColor.g;
    p4[2] = this.scatterColor.b;
    p4[3] = this.scatterStrength;

    const p5 = this._matParam5Array;
    p5[0] = this.detailStrength;
    p5[1] = this.fftEnabled ? 1.0 : 0.0;
    p5[2] = Math.max(this.fftPatchSize, 16.0);
    p5[3] = Math.max(this.choppiness, 0.0);

    const p9 = this._matParam9Array;
    p9[0] = this.reflectionMap ? this.reflectionStrength : 0.0;
    p9[1] = this.reflectionDistortion;
    p9[2] = this.reflectionRoughness;
    p9[3] = 0.0;

    // `_syncBaseManifestState()` resets `u_color` to `this.color.toFloat32Array()`, so restore
    // the pre-allocated `_colorArray` reference afterward (zero allocations per frame).
    props["u_color"] = this._colorArray;
    props["u_specColor"] = this._deepColorArray;
    props["u_roughness"] = this.roughness;
    props["u_reflectivity"] = this.windSpeed;
    props["u_time"] = this.time;

    this._commitFlags();
    return manifest;
  }

  /** @inheritdoc */
  public override clone(): OceanMaterial {
    return new OceanMaterial({
      waterColor: this.waterColor.clone(),
      deepWaterColor: this.deepWaterColor.clone(),
      scatterColor: this.scatterColor.clone(),
      scatterStrength: this.scatterStrength,
      roughness: this.roughness,
      windSpeed: this.windSpeed,
      windDirection: this.windDirection.clone(),
      waveScale: this.waveScale,
      waveWavelength: this.waveWavelength,
      swellFadeStart: this.swellFadeStart,
      swellFadeEnd: this.swellFadeEnd,
      detailScale: this.detailScale,
      detailStrength: this.detailStrength,
      foamColor: this.foamColor.clone(),
      foamDistance: this.foamDistance,
      foamCoverage: this.foamCoverage,
      waterAbsorption: [this.waterAbsorption[0], this.waterAbsorption[1], this.waterAbsorption[2]],
      refractionStrength: this.refractionStrength,
      ...(this.normalMap ? { normalMap: this.normalMap } : {}),
      ...(this.envMap ? { envMap: this.envMap } : {}),
      ...(this.reflectionMap ? { reflectionMap: this.reflectionMap } : {}),
      reflectionStrength: this.reflectionStrength,
      reflectionDistortion: this.reflectionDistortion,
      reflectionRoughness: this.reflectionRoughness,
      fftEnabled: this.fftEnabled,
      fftPatchSize: this.fftPatchSize,
      choppiness: this.choppiness,
    });
  }

  /** Releases an internally generated wave normal texture when owned by this material. */
  public dispose(): void {
    if (this._ownsNormalMap && this.normalMap) {
      this.normalMap.dispose();
      this.normalMap = undefined;
    }
  }
}
