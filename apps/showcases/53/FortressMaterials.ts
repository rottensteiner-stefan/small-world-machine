import type {
  CubeTexture,
  OpenWaterMaterialOptions,
  PlanarReflectionNode,
  ShaderDefinition,
  Texture,
} from "@small-world-machine/engine";
import {
  Color,
  CustomShaderMaterial,
  OpenWaterMaterial,
  ShaderFlag,
  StandardMaterial,
  StandardWebGPULayout,
  Vector2D,
} from "@small-world-machine/engine";
import fragWGSL from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.wgsl?raw";
import fragGLSL from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.glsl?raw";
import fragGLSL100 from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.glsl100?raw";
import openWaterVertWGSL from "@small-world-machine/engine/core/materials/liquid/shaders/OpenWater.vert.wgsl?raw";
import openWaterVertGLSL from "@small-world-machine/engine/core/materials/liquid/shaders/OpenWater.vert.glsl?raw";
import openWaterVertGLSL100 from "@small-world-machine/engine/core/materials/liquid/shaders/OpenWater.vert.glsl100?raw";

/**
 * World-space Y elevation of Moon Nur's sea plane.
 * @domain World-space sea level in meters (default 0.0).
 */
export const FORTRESS_WATER_Y = 0.0;

/**
 * Default vertical extent of the wave-lap wetness and salt/spray band above sea level.
 * @domain Vertical splash-zone height in meters above `waterY` (> 0).
 */
const DEFAULT_WET_BAND_HEIGHT = 3.8;

/**
 * Default vertical wave-lap oscillation amplitude used by the waterline wetness shader.
 * @domain World-space vertical wave-lap amplitude in meters (>= 0).
 */
const DEFAULT_WAVE_LAP_AMPLITUDE = 0.38;

/**
 * Default linear albedo darkening factor applied inside the wet waterline zone.
 * @domain Linear multiplier in (0, 1]; 0.42 models porous wet steel/basalt darkening.
 */
const DEFAULT_WET_ALBEDO_SCALE = 0.42;

/**
 * PBR texture bundle accepted by Fortress Inquisitorius material builders.
 * All maps are optional so assets or fallback stages degrade cleanly.
 */
export interface FortressPbrMaps {
  diffuseMap?: Texture | undefined;
  normalMap?: Texture | undefined;
  metallicMap?: Texture | undefined;
  roughnessMap?: Texture | undefined;
  aoMap?: Texture | undefined;
  emissiveMap?: Texture | undefined;
  alphaMap?: Texture | undefined;
  envMap?: CubeTexture | undefined;
}

/**
 * Options for the 3-tier waterline-wetness armor `CustomShaderMaterial`.
 */
export interface FortressArmorOptions {
  /** Base sRGB albedo tint. Defaults to dark imperial steel `(0.26, 0.28, 0.31)`. */
  color?: Color;
  /** @domain PBR metallic factor in [0, 1] (default 0.82). */
  metallic?: number;
  /** @domain PBR perceptual roughness in [0.05, 1] (default 0.48). */
  roughness?: number;
  /** @domain Scalar ambient occlusion multiplier in [0, 1] (default 1.0). */
  ao?: number;
  /** Tangent-space normal map scale. Defaults to `(1.1, 1.1)`. */
  normalScale?: Vector2D;
  /** UV tiling repeat. Defaults to `(1, 1)`. */
  texRepeat?: Vector2D;
  /** UV offset. Defaults to `(0, 0)`. */
  texOffset?: Vector2D;
  /** @domain World-space sea level in meters (defaults to `FORTRESS_WATER_Y`). */
  waterY?: number;
  /** @domain Height in meters of the wet splash band above `waterY` (default 3.8). */
  wetBandHeight?: number;
  /** @domain Animated wave-lap vertical amplitude in meters (default 0.38). */
  waveLapAmplitude?: number;
  /** @domain Albedo darkening multiplier in the submerged/wet band in (0, 1] (default 0.42). */
  wetAlbedoScale?: number;
  /** @domain Clearcoat intensity in [0, 1] (default 0.0; set > 0 for wet lacquer). */
  clearcoat?: number;
  /** @domain Clearcoat roughness in [0.05, 1] (default 0.1). */
  clearcoatRoughness?: number;
  /** Optional emissive color (sRGB). Defaults to black. */
  emissiveColor?: Color;
  /** @domain Linear emissive intensity multiplier >= 0 (default 1.0). */
  emissiveIntensity?: number;
}

/**
 * Options for dark metallic trim (`StandardMaterial`).
 */
export interface FortressTrimOptions {
  /** Base sRGB tint. Defaults to dark gunmetal `(0.14, 0.15, 0.18)`. */
  color?: Color;
  /** @domain PBR metallic factor in [0, 1] (default 0.9). */
  metallic?: number;
  /** @domain PBR perceptual roughness in [0.05, 1] (default 0.36). */
  roughness?: number;
  /** @domain Scalar ambient occlusion multiplier in [0, 1] (default 1.0). */
  ao?: number;
  /** Tangent-space normal map scale. Defaults to `(1.0, 1.0)`. */
  normalScale?: Vector2D;
}

/**
 * Options for the wet dark basalt foundation material.
 */
export interface FortressRockOptions {
  /** Base sRGB tint. Defaults to wet dark basalt `(0.13, 0.14, 0.16)`. */
  color?: Color;
  /** @domain PBR metallic factor in [0, 1] (default 0.05). */
  metallic?: number;
  /** @domain PBR perceptual roughness in [0.05, 1] (default 0.32). */
  roughness?: number;
  /** @domain Scalar ambient occlusion multiplier in [0, 1] (default 1.0). */
  ao?: number;
  /** Tangent-space normal map scale. Defaults to `(1.25, 1.25)`. */
  normalScale?: Vector2D;
  /** When true, upgrades to the 3-tier world-Y waterline wetness shader. Defaults to false. */
  wetWaterline?: boolean;
  /** @domain World-space sea level in meters when `wetWaterline` is true. */
  waterY?: number;
  /** @domain Height in meters of the wet splash band above `waterY` (default 4.4). */
  wetBandHeight?: number;
  /** @domain Animated wave-lap vertical amplitude in meters (default 0.42). */
  waveLapAmplitude?: number;
  /** @domain Albedo darkening multiplier in the wet band in (0, 1] (default 0.38). */
  wetAlbedoScale?: number;
}

/**
 * Options for dark armor with sharp emissive window slits (`StandardMaterial`).
 */
export interface FortressWindowTrimOptions {
  /** Base sRGB hull tint. Defaults to `(0.18, 0.2, 0.23)`. */
  color?: Color;
  /** @domain PBR metallic factor in [0, 1] (default 0.78). */
  metallic?: number;
  /** @domain PBR perceptual roughness in [0.05, 1] (default 0.42). */
  roughness?: number;
  /** @domain Scalar ambient occlusion multiplier in [0, 1] (default 1.0). */
  ao?: number;
  /** Tangent-space normal map scale. Defaults to `(1.0, 1.0)`. */
  normalScale?: Vector2D;
  /** Emissive slit tint (sRGB). Defaults to crisp imperial amber-white `(1.0, 0.84, 0.62)`. */
  emissiveColor?: Color;
  /** @domain Linear emissive multiplier (>= 2.2 for HDR bloom on WebGPU/WebGL2; default 2.6). */
  emissiveIntensity?: number;
}

/**
 * Options for pure emissive accents (bridge visor, hangar forcefield, landing beacons).
 */
export interface EmissiveAccentOptions {
  /** Base unlit housing tint (sRGB). Defaults to dark `(0.04, 0.01, 0.01)`. */
  color?: Color;
  /** @domain PBR roughness in [0.05, 1] (default 0.2). */
  roughness?: number;
  /** @domain PBR metallic factor in [0, 1] (default 0.1). */
  metallic?: number;
  /** Enable alpha blending (e.g. hangar containment shield). Defaults to false. */
  transparent?: boolean;
  /** @domain Alpha opacity in [0, 1] when `transparent` is true (default 0.65). */
  opacity?: number;
}

/**
 * Options for Moon Nur's dark stormy ocean (`OpenWaterMaterial`).
 */
export interface StormOceanOptions {
  /** Shallow/crest water color (sRGB). Defaults to abyssal navy-slate `(0.03, 0.07, 0.11)`. */
  waterColor?: Color;
  /** Deep ocean extinction color (sRGB). Defaults to near-black abyssal `(0.01, 0.025, 0.045)`. */
  deepWaterColor?: Color;
  /** Shoreline edge color (sRGB). Defaults to cold slate `(0.18, 0.24, 0.30)`. */
  edgeColor?: Color;
  /** @domain Depth-fade distance in meters for shoreline blending (default 2.4). */
  edgeSoftness?: number;
  /** @domain Global wave speed multiplier (default 1.15). */
  speed?: number;
  /** Primary swell `[dirX, dirY, steepness, wavelengthMeters]`. */
  wave1?: [number, number, number, number];
  /** Secondary cross-swell `[dirX, dirY, steepness, wavelengthMeters]`. */
  wave2?: [number, number, number, number];
  /** Short wind chop `[dirX, dirY, steepness, wavelengthMeters]`. */
  wave3?: [number, number, number, number];
  /** @domain Screen-space refraction UV distortion strength (default 0.025). */
  refractionStrength?: number;
  /** @domain Beer-Lambert RGB absorption coefficients in 1/m (default `[0.55, 0.24, 0.14]`). */
  waterAbsorption?: [number, number, number];
  /** Shoreline/crest foam color (sRGB). Defaults to storm-mist gray `(0.48, 0.56, 0.64)`. */
  foamColor?: Color;
  /** @domain World-space depth distance in meters where shoreline foam fades out (default 2.8). */
  foamDistance?: number;
  /** @domain Worley foam threshold in (0, 1) (default 0.52). */
  foamCutoff?: number;
  /** @domain World-space Worley foam pattern frequency (default 1.6). */
  foamNoiseScale?: number;
  /** @domain Foam pattern drift speed (default 0.7). */
  foamNoiseSpeed?: number;
  /** @domain Square basin half-extent in meters (`0` disables clapotis walls; default 0). */
  poolHalfExtent?: number;
  /** @domain Scale-invariant reference domain size in meters (> 0; default 1.0). */
  domainScale?: number;
  /** @domain Planar reflection mix strength in [0, 1] (default 0.92). */
  reflectionStrength?: number;
  /** @domain Wave-normal UV distortion applied to planar reflection lookup (default 0.075). */
  reflectionDistortion?: number;
  /** @domain Planar reflection mip roughness blur in [0, 1] (default 0.06). */
  reflectionRoughness?: number;
}

const WGSL_WATERLINE_BLOCK = `
    // Fortress Inquisitorius waterline wetness + dark salt/spray band (showcase-local)
    {
        let waterY = obj.matParam2.x;
        let wetBand = max(obj.matParam2.y, 0.001);
        let waveAmp = obj.matParam2.z;
        let wetAlbedoScale = obj.matParam2.w;
        let waveLap = sin(i.wp.x * 0.45 + obj.time * 1.4) * cos(i.wp.z * 0.45 - obj.time * 1.1) * waveAmp;
        let tideHeight = waterY + waveLap;
        let distAboveWater = i.wp.y - tideHeight;
        let wetMask = 1.0 - smoothstep(-0.15, wetBand, distAboveWater);
        let saltBand = smoothstep(wetBand * 0.45, wetBand * 0.78, distAboveWater) *
                       (1.0 - smoothstep(wetBand * 0.78, wetBand * 1.05, distAboveWater));
        let albedoFactor = mix(1.0, wetAlbedoScale, wetMask) * (1.0 - 0.18 * saltBand);
        albedo = albedo * albedoFactor;
        let wetRoughness = clamp(roughness * 0.25, 0.06, 0.12);
        roughness = mix(roughness, wetRoughness, wetMask);
    }
`;

const GLSL_WATERLINE_BLOCK = `
    // Fortress Inquisitorius waterline wetness + dark salt/spray band (showcase-local)
    {
        float waterY = u_matParam2.x;
        float wetBand = max(u_matParam2.y, 0.001);
        float waveAmp = u_matParam2.z;
        float wetAlbedoScale = u_matParam2.w;
        float waveLap = sin(v_worldPos.x * 0.45 + u_time * 1.4) * cos(v_worldPos.z * 0.45 - u_time * 1.1) * waveAmp;
        float tideHeight = waterY + waveLap;
        float distAboveWater = v_worldPos.y - tideHeight;
        float wetMask = 1.0 - smoothstep(-0.15, wetBand, distAboveWater);
        float saltBand = smoothstep(wetBand * 0.45, wetBand * 0.78, distAboveWater) *
                         (1.0 - smoothstep(wetBand * 0.78, wetBand * 1.05, distAboveWater));
        float albedoFactor = mix(1.0, wetAlbedoScale, wetMask) * (1.0 - 0.18 * saltBand);
        albedo *= albedoFactor;
        float wetRoughness = clamp(roughness * 0.25, 0.06, 0.12);
        roughness = mix(roughness, wetRoughness, wetMask);
    }
`;

function buildWaterlineWgslSource(): string {
  const mutableFrag = fragWGSL
    .replace(
      "let albedo = sRGBToLinear(diffuseTex.rgb) * sRGBToLinear(obj.color.rgb);",
      "var albedo = sRGBToLinear(diffuseTex.rgb) * sRGBToLinear(obj.color.rgb);",
    )
    .replace("[WGSL_PBR_LIGHTING]", `${WGSL_WATERLINE_BLOCK}\n    [WGSL_PBR_LIGHTING]`);

  return `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${mutableFrag}`;
}

function buildWaterlineGlsl300Source(): { vs: string; fs: string } {
  const fs = fragGLSL
    .replace("uniform float u_time;", "uniform float u_time;\nuniform vec4 u_matParam2;")
    .replace("[LIGHT_CALC_PBR]", `${GLSL_WATERLINE_BLOCK}\n    [LIGHT_CALC_PBR]`);

  return {
    vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]",
    fs,
  };
}

function buildWaterlineGlsl100Source(): { vs: string; fs: string } {
  const fs = fragGLSL100
    .replace("uniform float u_time;", "uniform float u_time;\nuniform vec4 u_matParam2;")
    .replace("[LIGHT_CALC_PBR]", `${GLSL_WATERLINE_BLOCK}\n    [LIGHT_CALC_PBR]`);

  return {
    vs: "[BASE_VS]",
    fs,
  };
}

function cloneStandardLayout(): typeof StandardWebGPULayout {
  return {
    uniforms: { ...StandardWebGPULayout.uniforms },
    uniformLayout: [...StandardWebGPULayout.uniformLayout],
    textures: { ...StandardWebGPULayout.textures },
  };
}

function buildWaterlineCustomMaterial(
  maps: FortressPbrMaps,
  params: {
    color: Color;
    metallic: number;
    roughness: number;
    ao: number;
    normalScale: Vector2D;
    texRepeat: Vector2D;
    texOffset: Vector2D;
    waterY: number;
    wetBandHeight: number;
    waveLapAmplitude: number;
    wetAlbedoScale: number;
    clearcoat: number;
    clearcoatRoughness: number;
    emissiveColor: Color;
    emissiveIntensity: number;
  },
): CustomShaderMaterial {
  const extraFlags: string[] = [];
  if (maps.metallicMap && maps.metallicMap === maps.roughnessMap) {
    extraFlags.push(ShaderFlag.METALLIC_ROUGHNESS_SHARED);
  }
  if (params.clearcoat > 0) {
    extraFlags.push(ShaderFlag.CLEARCOAT);
  }

  const textures: Record<string, Texture | CubeTexture | undefined> = {};
  if (maps.diffuseMap) textures["u_diffuseMap"] = maps.diffuseMap;
  if (maps.normalMap) textures["u_normalMap"] = maps.normalMap;
  if (maps.metallicMap) textures["u_metallicMap"] = maps.metallicMap;
  if (maps.roughnessMap) textures["u_roughnessMap"] = maps.roughnessMap;
  if (maps.aoMap) textures["u_aoMap"] = maps.aoMap;
  if (maps.emissiveMap) textures["u_emissiveMap"] = maps.emissiveMap;
  if (maps.alphaMap) textures["u_alphaMap"] = maps.alphaMap;
  if (maps.envMap) textures["u_envMap"] = maps.envMap;

  const mat = new CustomShaderMaterial({
    sources: {
      wgsl: buildWaterlineWgslSource(),
      glsl300: buildWaterlineGlsl300Source(),
      glsl100: buildWaterlineGlsl100Source(),
    },
    layout: cloneStandardLayout(),
    flags: extraFlags,
    properties: {
      u_model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      u_color: params.color.toFloat32Array(),
      u_specColor: new Float32Array([
        params.emissiveColor.r,
        params.emissiveColor.g,
        params.emissiveColor.b,
        params.emissiveIntensity,
      ]),
      u_texOffset: [params.texOffset.x, params.texOffset.y],
      u_texRepeat: [params.texRepeat.x, params.texRepeat.y],
      u_texRotation: 0.0,
      u_shininess: 32.0,
      u_isTerrain: 0.0,
      u_metallic: params.metallic,
      u_roughness: params.roughness,
      u_extraParams: [params.ao, 0.0, params.normalScale.x, params.normalScale.y],
      u_liquidParams: [1.5, 0.0, 0.0, params.clearcoat],
      u_thresholds: [params.clearcoatRoughness, 0.0, 1000.0, 0.0],
      u_useEnvMap: maps.envMap ? 1.0 : 0.0,
      u_useReflectionMap: 0.0,
      u_reflectivity: 1.0,
      u_time: 0.0,
      u_matParam0: [0.5, 0.0, 0.0, 0.0],
      u_matParam2: [
        params.waterY,
        params.wetBandHeight,
        params.waveLapAmplitude,
        params.wetAlbedoScale,
      ],
      u_matParam10: [0.0, 0.0, 0.0, 0.0],
      u_matParam11: [1.0, 1.0, 1.0, 1.0],
      u_matParam12: [0.0, 0.0, 0.0, 0.0],
      u_matParam13: [1.0, 0.0, 0.0, 0.0],
      u_matParam14: [0.0, 1.3, 100.0, 400.0],
      u_matParam15: [0.0, 1.0, 0.0, 0.0],
    },
    textures,
  });
  mat.color.copyFrom(params.color);
  return mat;
}

/**
 * Creates the 3-tier (`wgsl`, `glsl300`, `glsl100`) Fortress armor `CustomShaderMaterial`
 * wrapping `Standard.frag.*` with a world-Y waterline wetness + dark salt/spray band.
 *
 * Uses zero extra texture samplers (stays within WebGL1's 8-unit minimum) and drives
 * wet darkening (`~0.42x`) and specular roughness clamping (`0.06..0.12`) dynamically
 * from `u_time` and `u_matParam2` (`[waterY, wetBandHeight, waveLapAmplitude, wetAlbedoScale]`).
 */
export function createFortressArmorMaterial(
  maps: FortressPbrMaps,
  options: FortressArmorOptions = {},
): CustomShaderMaterial {
  return buildWaterlineCustomMaterial(maps, {
    color: options.color ?? new Color(0.26, 0.28, 0.31),
    metallic: options.metallic ?? 0.82,
    roughness: options.roughness ?? 0.48,
    ao: options.ao ?? 1.0,
    normalScale: options.normalScale ?? new Vector2D(1.1, 1.1),
    texRepeat:
      options.texRepeat ??
      (maps.diffuseMap
        ? new Vector2D(maps.diffuseMap.repeat.x, maps.diffuseMap.repeat.y)
        : new Vector2D(1, 1)),
    texOffset:
      options.texOffset ??
      (maps.diffuseMap
        ? new Vector2D(maps.diffuseMap.offset.x, maps.diffuseMap.offset.y)
        : new Vector2D(0, 0)),
    waterY: options.waterY ?? FORTRESS_WATER_Y,
    wetBandHeight: options.wetBandHeight ?? DEFAULT_WET_BAND_HEIGHT,
    waveLapAmplitude: options.waveLapAmplitude ?? DEFAULT_WAVE_LAP_AMPLITUDE,
    wetAlbedoScale: options.wetAlbedoScale ?? DEFAULT_WET_ALBEDO_SCALE,
    clearcoat: options.clearcoat ?? 0.0,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.1,
    emissiveColor: options.emissiveColor ?? new Color(0, 0, 0),
    emissiveIntensity: options.emissiveIntensity ?? 1.0,
  });
}

/**
 * Updates the animated wave-lap time uniform on a waterline `CustomShaderMaterial`.
 */
export function updateFortressWaterlineTime(
  material: CustomShaderMaterial,
  elapsedSeconds: number,
): void {
  material.setProperty("u_time", elapsedSeconds);
}

/**
 * Creates the dark gunmetal/steel trim `StandardMaterial` for structural ribs, struts,
 * landing-pad frames, and heavy blast doors.
 */
export function createTrimArmorMaterial(
  maps: FortressPbrMaps,
  options: FortressTrimOptions = {},
): StandardMaterial {
  return new StandardMaterial({
    color: options.color ?? new Color(0.14, 0.15, 0.18),
    metallic: options.metallic ?? 0.9,
    roughness: options.roughness ?? 0.36,
    ao: options.ao ?? 1.0,
    normalScale: options.normalScale ?? new Vector2D(1.0, 1.0),
    diffuseMap: maps.diffuseMap,
    normalMap: maps.normalMap,
    metallicMap: maps.metallicMap,
    roughnessMap: maps.roughnessMap,
    aoMap: maps.aoMap,
    envMap: maps.envMap,
  });
}

/**
 * Creates the wet dark basalt foundation material (`StandardMaterial` by default, or
 * 3-tier waterline `CustomShaderMaterial` when `options.wetWaterline` is `true`).
 */
export function createRockFoundationMaterial(
  maps: FortressPbrMaps,
  options?: FortressRockOptions & { wetWaterline?: false },
): StandardMaterial;
export function createRockFoundationMaterial(
  maps: FortressPbrMaps,
  options: FortressRockOptions & { wetWaterline: true },
): CustomShaderMaterial;
export function createRockFoundationMaterial(
  maps: FortressPbrMaps,
  options: FortressRockOptions = {},
): StandardMaterial | CustomShaderMaterial {
  if (options.wetWaterline === true) {
    return buildWaterlineCustomMaterial(maps, {
      color: options.color ?? new Color(0.13, 0.14, 0.16),
      metallic: options.metallic ?? 0.05,
      roughness: options.roughness ?? 0.32,
      ao: options.ao ?? 1.0,
      normalScale: options.normalScale ?? new Vector2D(1.25, 1.25),
      texRepeat: maps.diffuseMap
        ? new Vector2D(maps.diffuseMap.repeat.x, maps.diffuseMap.repeat.y)
        : new Vector2D(1, 1),
      texOffset: maps.diffuseMap
        ? new Vector2D(maps.diffuseMap.offset.x, maps.diffuseMap.offset.y)
        : new Vector2D(0, 0),
      waterY: options.waterY ?? FORTRESS_WATER_Y,
      wetBandHeight: options.wetBandHeight ?? 4.4,
      waveLapAmplitude: options.waveLapAmplitude ?? 0.42,
      wetAlbedoScale: options.wetAlbedoScale ?? 0.38,
      clearcoat: 0.0,
      clearcoatRoughness: 0.1,
      emissiveColor: new Color(0, 0, 0),
      emissiveIntensity: 1.0,
    });
  }

  return new StandardMaterial({
    color: options.color ?? new Color(0.13, 0.14, 0.16),
    metallic: options.metallic ?? 0.05,
    roughness: options.roughness ?? 0.32,
    ao: options.ao ?? 1.0,
    normalScale: options.normalScale ?? new Vector2D(1.25, 1.25),
    diffuseMap: maps.diffuseMap,
    normalMap: maps.normalMap,
    metallicMap: maps.metallicMap,
    roughnessMap: maps.roughnessMap,
    aoMap: maps.aoMap,
    envMap: maps.envMap,
  });
}

/**
 * Creates the dark hull window-trim `StandardMaterial` with sharp emissive window slits
 * (`emissiveIntensity >= 2.2` for HDR bloom on WebGPU/WebGL2).
 */
export function createWindowTrimMaterial(
  maps: FortressPbrMaps,
  options: FortressWindowTrimOptions = {},
): StandardMaterial {
  const emissiveIntensity = Math.max(options.emissiveIntensity ?? 2.6, 2.2);
  return new StandardMaterial({
    color: options.color ?? new Color(0.18, 0.2, 0.23),
    metallic: options.metallic ?? 0.78,
    roughness: options.roughness ?? 0.42,
    ao: options.ao ?? 1.0,
    normalScale: options.normalScale ?? new Vector2D(1.0, 1.0),
    diffuseMap: maps.diffuseMap,
    normalMap: maps.normalMap,
    metallicMap: maps.metallicMap,
    roughnessMap: maps.roughnessMap,
    aoMap: maps.aoMap,
    emissiveMap: maps.emissiveMap,
    emissiveColor: options.emissiveColor ?? new Color(1.0, 0.84, 0.62),
    emissiveIntensity,
    envMap: maps.envMap,
  });
}

/**
 * Creates a crisp emissive accent `StandardMaterial` (crimson bridge visor `#ff2214`,
 * hangar forcefield glow, landing pad beacons) tuned for HDR bloom.
 */
export function createEmissiveAccentMaterial(
  color: Color,
  intensity: number = 3.2,
  options: EmissiveAccentOptions = {},
): StandardMaterial {
  const transparent = options.transparent ?? false;
  const base = options.color ?? new Color(0.04, 0.01, 0.01);
  const albedo = transparent
    ? new Color(base.r, base.g, base.b, options.opacity ?? 0.65)
    : new Color(base.r, base.g, base.b, 1.0);

  return new StandardMaterial({
    color: albedo,
    metallic: options.metallic ?? 0.1,
    roughness: options.roughness ?? 0.2,
    emissiveColor: color.clone(),
    emissiveIntensity: intensity,
    transparent,
  });
}

const STORM_VERT_PATCH_WGSL = {
  wavesOld: `    let w4 = vec4f(w1.y, -w1.x, w1.z * 0.45, w1.w * 0.42); // Detail wave 1 (perpendicular, shorter)
    let w5 = vec4f(-w2.y, w2.x, w2.z * 0.35, w2.w * 0.35); // Detail wave 2
    let w6 = vec4f(w1.x * 0.5 - w1.y * 0.866, w1.x * 0.866 + w1.y * 0.5, w1.z * 0.25, w1.w * 0.22); // Bimodal 60-deg cross-swell

    displacement += gerstnerWave(w1, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w2, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w3, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w4, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w5, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w6, wp, speed, time, &t, &b);`,
  wavesNew: `    let w4 = vec4f(0.34, 0.94, w1.z * 0.52, w1.w * 0.263);
    let w5 = vec4f(0.97, 0.24, w2.z * 0.58, w2.w * 0.289);
    let w6 = vec4f(0.18, -0.98, w3.z * 0.62, w3.w * 0.319);
    let w7 = vec4f(-0.42, 0.91, w2.z * 0.42, w1.w * 0.086);
    let w8 = vec4f(0.73, -0.68, w3.z * 0.45, w2.w * 0.095);

    displacement += gerstnerWave(w1, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w2, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w3, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w4, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w5, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w6, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w7, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w8, wp, speed, time, &t, &b);`,
  crestOld: `    let steepSum = w1.z + w2.z + w3.z + w4.z + w5.z + w6.z;
    let jacobian = t.x * b.z - t.z * b.x;
    o.original_uv = vec2f(clamp(2.5 * (1.0 - jacobian) / max(steepSum, 0.001), -1.0, 1.0), 0.0);`,
  crestNew: `    let steepSum = w1.z + w2.z + w3.z + w4.z + w5.z + w6.z + w7.z + w8.z;
    let jacobian = t.x * b.z - t.z * b.x;
    o.original_uv = vec2f(clamp(1.35 * (1.0 - jacobian) / max(steepSum, 0.001) + displacement.y * 0.18, -1.0, 1.0), 0.0);`,
};

const STORM_VERT_PATCH_GLSL = {
  wavesOld: `    vec4 w4 = vec4(w1.y, -w1.x, w1.z * 0.45, w1.w * 0.42); // Detail wave 1 (perpendicular, shorter)
    vec4 w5 = vec4(-w2.y, w2.x, w2.z * 0.35, w2.w * 0.35); // Detail wave 2
    vec4 w6 = vec4(w1.x * 0.5 - w1.y * 0.866, w1.x * 0.866 + w1.y * 0.5, w1.z * 0.25, w1.w * 0.22); // Bimodal 60-deg cross-swell

    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 displacement = vec3(0.0);

    displacement += gerstnerWave(w1, wp, speed, time, t, b);
    displacement += gerstnerWave(w2, wp, speed, time, t, b);
    displacement += gerstnerWave(w3, wp, speed, time, t, b);
    displacement += gerstnerWave(w4, wp, speed, time, t, b);
    displacement += gerstnerWave(w5, wp, speed, time, t, b);
    displacement += gerstnerWave(w6, wp, speed, time, t, b);`,
  wavesNew: `    vec4 w4 = vec4(0.34, 0.94, w1.z * 0.52, w1.w * 0.263);
    vec4 w5 = vec4(0.97, 0.24, w2.z * 0.58, w2.w * 0.289);
    vec4 w6 = vec4(0.18, -0.98, w3.z * 0.62, w3.w * 0.319);
    vec4 w7 = vec4(-0.42, 0.91, w2.z * 0.42, w1.w * 0.086);
    vec4 w8 = vec4(0.73, -0.68, w3.z * 0.45, w2.w * 0.095);

    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 displacement = vec3(0.0);

    displacement += gerstnerWave(w1, wp, speed, time, t, b);
    displacement += gerstnerWave(w2, wp, speed, time, t, b);
    displacement += gerstnerWave(w3, wp, speed, time, t, b);
    displacement += gerstnerWave(w4, wp, speed, time, t, b);
    displacement += gerstnerWave(w5, wp, speed, time, t, b);
    displacement += gerstnerWave(w6, wp, speed, time, t, b);
    displacement += gerstnerWave(w7, wp, speed, time, t, b);
    displacement += gerstnerWave(w8, wp, speed, time, t, b);`,
  crestOld: `    float steepSum = w1.z + w2.z + w3.z + w4.z + w5.z + w6.z;
    float jacobian = t.x * b.z - t.z * b.x;
    v_crest = clamp(2.5 * (1.0 - jacobian) / max(steepSum, 0.001), -1.0, 1.0);`,
  crestNew: `    float steepSum = w1.z + w2.z + w3.z + w4.z + w5.z + w6.z + w7.z + w8.z;
    float jacobian = t.x * b.z - t.z * b.x;
    v_crest = clamp(1.35 * (1.0 - jacobian) / max(steepSum, 0.001) + displacement.y * 0.18, -1.0, 1.0);`,
};

const STORM_VERT_PATCH_GLSL100 = {
  wavesOld: `    vec4 w4 = vec4(w1.y, -w1.x, w1.z * 0.45, w1.w * 0.42);
    vec4 w5 = vec4(-w2.y, w2.x, w2.z * 0.35, w2.w * 0.35);
    vec4 w6 = vec4(w1.x * 0.5 - w1.y * 0.866, w1.x * 0.866 + w1.y * 0.5, w1.z * 0.25, w1.w * 0.22);

    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 displacement = vec3(0.0);

    displacement += gerstnerWave(w1, wp, speed, time, t, b);
    displacement += gerstnerWave(w2, wp, speed, time, t, b);
    displacement += gerstnerWave(w3, wp, speed, time, t, b);
    displacement += gerstnerWave(w4, wp, speed, time, t, b);
    displacement += gerstnerWave(w5, wp, speed, time, t, b);
    displacement += gerstnerWave(w6, wp, speed, time, t, b);`,
  wavesNew: `    vec4 w4 = vec4(0.34, 0.94, w1.z * 0.52, w1.w * 0.263);
    vec4 w5 = vec4(0.97, 0.24, w2.z * 0.58, w2.w * 0.289);
    vec4 w6 = vec4(0.18, -0.98, w3.z * 0.62, w3.w * 0.319);
    vec4 w7 = vec4(-0.42, 0.91, w2.z * 0.42, w1.w * 0.086);
    vec4 w8 = vec4(0.73, -0.68, w3.z * 0.45, w2.w * 0.095);

    vec3 t = vec3(1.0, 0.0, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0);
    vec3 displacement = vec3(0.0);

    displacement += gerstnerWave(w1, wp, speed, time, t, b);
    displacement += gerstnerWave(w2, wp, speed, time, t, b);
    displacement += gerstnerWave(w3, wp, speed, time, t, b);
    displacement += gerstnerWave(w4, wp, speed, time, t, b);
    displacement += gerstnerWave(w5, wp, speed, time, t, b);
    displacement += gerstnerWave(w6, wp, speed, time, t, b);
    displacement += gerstnerWave(w7, wp, speed, time, t, b);
    displacement += gerstnerWave(w8, wp, speed, time, t, b);`,
  crestOld: STORM_VERT_PATCH_GLSL.crestOld,
  crestNew: STORM_VERT_PATCH_GLSL.crestNew,
};

const NUR_STORM_OCEAN_FRAG_WGSL = `[WGSL_LIQUID_WORLEY_NOISE]

fn stormChopNormal(wp: vec3<f32>, baseN: vec3<f32>, time: f32, dist: f32, crest: f32) -> vec3<f32> {
    let p1 = (wp.x * 0.84 + wp.z * 0.54) * 1.65 - time * 3.1;
    let p2 = (wp.x * 0.58 + wp.z * 0.81) * 2.95 - time * 4.2;
    let p3 = (wp.x * 0.95 - wp.z * 0.31) * 5.10 - time * 5.4;
    let p4 = (wp.x * 0.26 + wp.z * 0.96) * 8.70 - time * 6.8;

    let grad = vec2<f32>(0.84, 0.54) * (cos(p1) * 0.09)
             + vec2<f32>(0.58, 0.81) * (cos(p2) * 0.07)
             + vec2<f32>(0.95, -0.31) * (cos(p3) * 0.048)
             + vec2<f32>(0.26, 0.96) * (cos(p4) * 0.03);

    let aaFade = 1.0 / (1.0 + dist * 0.011);
    let chopAmp = aaFade * (0.8 + 0.55 * clamp(crest, 0.0, 1.0));
    return normalize(baseN + vec3<f32>(-grad.x, 0.0, -grad.y) * chopAmp);
}

@fragment fn fs(i: Out) -> @location(0) vec4<f32> {
    let waterColor = sRGBToLinear(obj.color.rgb);
    let deepWaterColor = sRGBToLinear(obj.specColor.rgb);

    let edgeColor = obj.matParam6.xyz;
    let edgeSoftness = max(obj.matParam6.w, 0.001);
    let waterAbsorption = obj.matParam0.xyz;
    let refractionStrength = obj.matParam0.w;
    let foamColor = sRGBToLinear(obj.matParam1.xyz);
    let foamDistance = max(obj.matParam1.w, 0.001);
    let foamCutoff = obj.matParam2.x;
    let foamNoiseScale = obj.matParam2.y;
    let foamNoiseSpeed = obj.matParam2.z;

    let viewVec = global.viewPos.xyz - i.wp;
    let viewDist = length(viewVec);
    let viewDir = viewVec / max(viewDist, 0.001);
    let crestVal = i.original_uv.x;
    let stormN = stormChopNormal(i.wp, i.n, obj.time, viewDist, crestVal);

    let fragPosCoords = vec2<i32>(i.pos.xy);
    let bgDepth = textureLoad(u_opaqueDepthMap, fragPosCoords, 0);

    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;

    let ndcBg = bgDepth * 2.0 - 1.0;
    let linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));

    let ndcFrag = i.pos.z * 2.0 - 1.0;
    let linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));

    let depthDiff = max(linBgDepth - linFragDepth, 0.0);

    let screenRes = vec2<f32>(textureDimensions(u_opaqueDepthMap));
    let screenUv = i.pos.xy / screenRes;
    let refrDamping = clamp(depthDiff / obj.matParam7.x, 0.0, 1.0);
    let distortedUv = screenUv + (worldDirToScreen(vec3f(stormN.x, 0.0, stormN.z)) * refractionStrength * refrDamping);
    let distortedCoords = vec2<i32>(distortedUv * screenRes);
    let distortedBgDepth = textureLoad(u_opaqueDepthMap, distortedCoords, 0);
    let ndcDistortedBg = distortedBgDepth * 2.0 - 1.0;
    let linDistortedBgDepth = (2.0 * near * far) / (far + near - ndcDistortedBg * (far - near));
    let refractionUv = select(screenUv, distortedUv, linDistortedBgDepth > linFragDepth);

    let refractedColor = targetToLinear(textureSample(u_opaqueMap, s, refractionUv).rgb) / max(global.exposure, 0.001);

    let transmittance = exp(-depthDiff * waterAbsorption);
    let tintedSeabed = refractedColor * mix(vec3<f32>(1.0), waterColor, 0.6);
    var baseColor = tintedSeabed * transmittance + deepWaterColor * (1.0 - transmittance);

    let edgeBlend = pow(1.0 - saturate(depthDiff / edgeSoftness), 2.0) * 0.4;
    let fresnel = pow(1.0 - saturate(dot(stormN, viewDir)), 5.0);

    if (obj.matParam9.x > 0.0) {
        let mirrorClip = global.vp * vec4<f32>(i.wp, 1.0);
        let mirrorNdc = mirrorClip.xy / mirrorClip.w;
        let mirrorUv = clamp(
            vec2<f32>(mirrorNdc.x * 0.5 + 0.5, mirrorNdc.y * -0.5 + 0.5) + worldDirToScreen(vec3f(stormN.x, 0.0, stormN.z)) * obj.matParam9.y,
            vec2<f32>(0.001), vec2<f32>(0.999));
        let mirrorLod = clamp(obj.matParam9.z * 7.0, 0.0, 7.0);
        let mirror = targetToLinear(textureSampleLevel(u_reflectionMap, s, mirrorUv, mirrorLod).rgb) / max(global.exposure, 0.001);
        baseColor = mix(baseColor, mirror, (0.02 + 0.98 * fresnel) * obj.matParam9.x);
    } else {
        let stormSky = vec3<f32>(0.035, 0.058, 0.095);
        baseColor = mix(baseColor, stormSky, fresnel * 0.65);
    }

    let lightDir = normalize(global.dirLightDir.xyz);
    let halfVector = normalize(lightDir + viewDir);
    let nDotH = saturate(dot(stormN, halfVector));
    let surfaceShadow = sampleDirShadow(i.wp, stormN);

    // Subtle cold petrol-teal subsurface scattering on steep wave crests
    let grazing = pow(1.0 - saturate(dot(stormN, viewDir)), 2.2);
    let backScatter = pow(saturate(dot(viewDir, -lightDir) * 0.5 + 0.5), 2.0);
    let sssMask = pow(clamp(crestVal * 0.85 + 0.2, 0.0, 1.0), 2.0) * (0.3 + 0.7 * grazing) * (0.45 + 0.55 * backScatter);
    baseColor += vec3<f32>(0.016, 0.068, 0.096) * sssMask * 0.85;

    // Dual-lobe moonlight glint across wind-chop facets
    let specular = (pow(nDotH, 760.0) * 0.88 + pow(nDotH, 68.0) * 0.11) * surfaceShadow;
    baseColor += global.dirLightColor.rgb * specular;

    let edgeColLinear = sRGBToLinear(edgeColor);
    var finalColor = mix(baseColor, edgeColLinear, edgeBlend);

    // Shoreline crash foam at fortress/rock base
    let foamBlend = pow(1.0 - saturate(depthDiff / foamDistance), 2.0);
    let windDir = vec2<f32>(0.84, 0.54);
    let foamUv = i.wp.xz * foamNoiseScale + windDir * (obj.time * foamNoiseSpeed);
    let foamCell = waterCellNoise(foamUv);
    let foamPattern = 1.0 - smoothstep(foamCutoff, foamCutoff + 0.15, foamCell);

    let splashPhase = dot(windDir, i.wp.xz) * 0.75 - obj.time * 1.7;
    let splashPulse = 0.6 + 0.4 * sin(splashPhase);
    let shoreFoamMask = foamPattern * foamBlend * splashPulse * 0.8;

    // Gust-gated turbulent whitecaps + wind-sheared spindrift streaks
    let gustCell = waterCellNoise(i.wp.xz * 0.045 + vec2<f32>(obj.time * 0.18, obj.time * 0.11));
    let gustGate = smoothstep(0.26, 0.74, gustCell);
    let crestCell2 = waterCellNoise(foamUv * 2.35 + vec2<f32>(11.3, 7.1));
    let webA = smoothstep(0.38, 0.78, foamCell);
    let webB = 1.0 - smoothstep(0.18, 0.56, crestCell2);
    let foamWeb = clamp(webA * 0.65 + webB * 0.55, 0.0, 1.0);

    let along = dot(i.wp.xz, windDir);
    let across = dot(i.wp.xz, vec2<f32>(-0.54, 0.84));
    let streakUv = vec2<f32>(along * 0.16 - obj.time * 1.4, across * 1.25 + sin(along * 0.12) * 0.4);
    let streakCell = waterCellNoise(streakUv);
    let spindrift = (1.0 - smoothstep(0.18, 0.46, streakCell)) * smoothstep(0.18, 0.62, crestVal) * (0.3 + 0.7 * gustGate);

    let aeratedCol = vec3<f32>(0.095, 0.18, 0.24);
    let aeratedMask = clamp(smoothstep(0.28, 0.72, crestVal) * (0.3 + 0.7 * gustGate) * (0.45 * webA + 0.55 * spindrift), 0.0, 0.72);
    finalColor = mix(finalColor, aeratedCol, aeratedMask);

    let breakerMask = smoothstep(0.52, 0.94, crestVal) * (0.28 + 0.72 * gustGate);
    let crestFoam = clamp(breakerMask * foamWeb * 0.92 + smoothstep(0.82, 1.0, crestVal) * gustGate * webA * 0.32, 0.0, 0.85);
    let foamMaskFinal = max(shoreFoamMask, crestFoam);
    let foamLit = foamColor * (0.48 + 0.52 * surfaceShadow) * (0.68 + 0.32 * saturate(dot(stormN, lightDir) * 0.5 + 0.5));

    finalColor = mix(finalColor, foamLit, foamMaskFinal);

    finalColor *= global.exposure;
    finalColor = linearToSRGB(finalColor);

    return vec4<f32>(finalColor, 1.0);
}
`;

const NUR_STORM_OCEAN_FRAG_GLSL = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in float v_crest;

[LIGHT_DEFS]
[WORLD_DIR_TO_SCREEN]
[DIR_SHADOW]

uniform vec4 u_color;
uniform vec4 u_specColor;
uniform vec4 u_matParam0;
uniform vec4 u_matParam1;
uniform vec4 u_matParam2;
uniform vec4 u_matParam6;
uniform vec4 u_matParam7;
uniform vec4 u_matParam9;
uniform float u_time;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_opaqueMap;
uniform sampler2D u_reflectionMap;

out vec4 fragColor;

[LIQUID_WORLEY_NOISE]

vec3 stormChopNormal(vec3 wp, vec3 baseN, float time, float dist, float crest) {
    float p1 = (wp.x * 0.84 + wp.z * 0.54) * 1.65 - time * 3.1;
    float p2 = (wp.x * 0.58 + wp.z * 0.81) * 2.95 - time * 4.2;
    float p3 = (wp.x * 0.95 - wp.z * 0.31) * 5.10 - time * 5.4;
    float p4 = (wp.x * 0.26 + wp.z * 0.96) * 8.70 - time * 6.8;

    vec2 grad = vec2(0.84, 0.54) * (cos(p1) * 0.09)
              + vec2(0.58, 0.81) * (cos(p2) * 0.07)
              + vec2(0.95, -0.31) * (cos(p3) * 0.048)
              + vec2(0.26, 0.96) * (cos(p4) * 0.03);

    float aaFade = 1.0 / (1.0 + dist * 0.011);
    float chopAmp = aaFade * (0.8 + 0.55 * clamp(crest, 0.0, 1.0));
    return normalize(baseN + vec3(-grad.x, 0.0, -grad.y) * chopAmp);
}

void main() {
    vec3 waterColor = sRGBToLinear(u_color.rgb);
    vec3 deepWaterColor = sRGBToLinear(u_specColor.rgb);

    vec3 edgeColor = u_matParam6.rgb;
    float edgeSoftness = max(u_matParam6.a, 0.001);

    vec3 waterAbsorption = u_matParam0.rgb;
    float refractionStrength = u_matParam0.a;
    vec3 foamColor = sRGBToLinear(u_matParam1.rgb);
    float foamDistance = max(u_matParam1.a, 0.001);
    float foamCutoff = u_matParam2.r;
    float foamNoiseScale = u_matParam2.g;
    float foamNoiseSpeed = u_matParam2.b;

    vec3 viewVec = u_viewPos - v_worldPos;
    float viewDist = length(viewVec);
    vec3 viewDir = viewVec / max(viewDist, 0.001);
    float crestVal = v_crest;
    vec3 stormN = stormChopNormal(v_worldPos, v_normal, u_time, viewDist, crestVal);

    vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueDepthMap, 0));
    float bgDepth = texture(u_opaqueDepthMap, screenUv).r;

    float near = u_cameraNearFar.x;
    float far = u_cameraNearFar.y;

    float ndcBg = bgDepth * 2.0 - 1.0;
    float linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));

    float ndcFrag = gl_FragCoord.z * 2.0 - 1.0;
    float linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));

    float depthDiff = max(linBgDepth - linFragDepth, 0.0);

    float refrDamping = clamp(depthDiff / u_matParam7.x, 0.0, 1.0);
    vec2 distortedUv = screenUv + (worldDirToScreen(vec3(stormN.x, 0.0, stormN.z)) * refractionStrength * refrDamping);
    float distortedBgDepth = texture(u_opaqueDepthMap, distortedUv).r;
    float ndcDistortedBg = distortedBgDepth * 2.0 - 1.0;
    float linDistortedBgDepth = (2.0 * near * far) / (far + near - ndcDistortedBg * (far - near));
    vec2 refractionUv = (linDistortedBgDepth > linFragDepth) ? distortedUv : screenUv;

    vec3 refractedColor = targetToLinear(texture(u_opaqueMap, refractionUv).rgb) / max(u_exposure, 0.001);

    vec3 transmittance = exp(-depthDiff * waterAbsorption);
    vec3 tintedSeabed = refractedColor * mix(vec3(1.0), waterColor, 0.6);
    vec3 baseColor = tintedSeabed * transmittance + deepWaterColor * (1.0 - transmittance);

    float edgeBlend = pow(1.0 - clamp(depthDiff / edgeSoftness, 0.0, 1.0), 2.0) * 0.4;
    float fresnel = pow(1.0 - clamp(dot(stormN, viewDir), 0.0, 1.0), 5.0);

    if (u_matParam9.x > 0.0) {
        vec4 mirrorClip = u_vp * vec4(v_worldPos, 1.0);
        vec2 mirrorUv = clamp(mirrorClip.xy / mirrorClip.w * 0.5 + 0.5 + worldDirToScreen(vec3(stormN.x, 0.0, stormN.z)) * u_matParam9.y, vec2(0.001), vec2(0.999));
        float mirrorLod = clamp(u_matParam9.z * 7.0, 0.0, 7.0);
        vec3 mirror = targetToLinear(textureLod(u_reflectionMap, mirrorUv, mirrorLod).rgb) / max(u_exposure, 0.001);
        baseColor = mix(baseColor, mirror, (0.02 + 0.98 * fresnel) * u_matParam9.x);
    } else {
        vec3 stormSky = vec3(0.035, 0.058, 0.095);
        baseColor = mix(baseColor, stormSky, fresnel * 0.65);
    }

    vec3 lightDir = normalize(u_dirLightDir);
    vec3 halfVector = normalize(lightDir + viewDir);
    float nDotH = clamp(dot(stormN, halfVector), 0.0, 1.0);
    float surfaceShadow = sampleDirShadow(v_worldPos, stormN);

    float grazing = pow(1.0 - clamp(dot(stormN, viewDir), 0.0, 1.0), 2.2);
    float backScatter = pow(clamp(dot(viewDir, -lightDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
    float sssMask = pow(clamp(crestVal * 0.85 + 0.2, 0.0, 1.0), 2.0) * (0.3 + 0.7 * grazing) * (0.45 + 0.55 * backScatter);
    baseColor += vec3(0.016, 0.068, 0.096) * sssMask * 0.85;

    float specular = (pow(nDotH, 760.0) * 0.88 + pow(nDotH, 68.0) * 0.11) * surfaceShadow;
    baseColor += u_dirLightColor * specular;

    vec3 edgeColLinear = sRGBToLinear(edgeColor);
    vec3 finalColor = mix(baseColor, edgeColLinear, edgeBlend);

    float foamBlend = pow(1.0 - clamp(depthDiff / foamDistance, 0.0, 1.0), 2.0);
    vec2 windDir = vec2(0.84, 0.54);
    vec2 foamUv = v_worldPos.xz * foamNoiseScale + windDir * (u_time * foamNoiseSpeed);
    float foamCell = waterCellNoise(foamUv);
    float foamPattern = 1.0 - smoothstep(foamCutoff, foamCutoff + 0.15, foamCell);

    float splashPhase = dot(windDir, v_worldPos.xz) * 0.75 - u_time * 1.7;
    float splashPulse = 0.6 + 0.4 * sin(splashPhase);
    float shoreFoamMask = foamPattern * foamBlend * splashPulse * 0.8;

    float gustCell = waterCellNoise(v_worldPos.xz * 0.045 + vec2(u_time * 0.18, u_time * 0.11));
    float gustGate = smoothstep(0.26, 0.74, gustCell);
    float crestCell2 = waterCellNoise(foamUv * 2.35 + vec2(11.3, 7.1));
    float webA = smoothstep(0.38, 0.78, foamCell);
    float webB = 1.0 - smoothstep(0.18, 0.56, crestCell2);
    float foamWeb = clamp(webA * 0.65 + webB * 0.55, 0.0, 1.0);

    float along = dot(v_worldPos.xz, windDir);
    float across = dot(v_worldPos.xz, vec2(-0.54, 0.84));
    vec2 streakUv = vec2(along * 0.16 - u_time * 1.4, across * 1.25 + sin(along * 0.12) * 0.4);
    float streakCell = waterCellNoise(streakUv);
    float spindrift = (1.0 - smoothstep(0.18, 0.46, streakCell)) * smoothstep(0.18, 0.62, crestVal) * (0.3 + 0.7 * gustGate);

    vec3 aeratedCol = vec3(0.095, 0.18, 0.24);
    float aeratedMask = clamp(smoothstep(0.28, 0.72, crestVal) * (0.3 + 0.7 * gustGate) * (0.45 * webA + 0.55 * spindrift), 0.0, 0.72);
    finalColor = mix(finalColor, aeratedCol, aeratedMask);

    float breakerMask = smoothstep(0.52, 0.94, crestVal) * (0.28 + 0.72 * gustGate);
    float crestFoam = clamp(breakerMask * foamWeb * 0.92 + smoothstep(0.82, 1.0, crestVal) * gustGate * webA * 0.32, 0.0, 0.85);
    float foamMaskFinal = max(shoreFoamMask, crestFoam);
    vec3 foamLit = foamColor * (0.48 + 0.52 * surfaceShadow) * (0.68 + 0.32 * clamp(dot(stormN, lightDir) * 0.5 + 0.5, 0.0, 1.0));

    finalColor = mix(finalColor, foamLit, foamMaskFinal);

    finalColor *= u_exposure;
    finalColor = linearToSRGB(finalColor);

    fragColor = vec4(finalColor, 1.0);
}
`;

const NUR_STORM_OCEAN_FRAG_GLSL100 = `precision highp float;

varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
varying vec4 v_clipPos;
varying float v_crest;

[LIGHT_DEFS]
[WORLD_DIR_TO_SCREEN]

uniform vec3 u_viewPos;
uniform vec4 u_color;
uniform vec4 u_specColor;
uniform vec4 u_matParam6;
uniform vec4 u_matParam0;
uniform vec4 u_matParam1;
uniform vec4 u_matParam2;
uniform vec4 u_matParam9;
uniform float u_time;
uniform sampler2D u_opaqueMap;
uniform sampler2D u_reflectionMap;

[LIQUID_WORLEY_NOISE]

vec3 stormChopNormal(vec3 wp, vec3 baseN, float time, float dist, float crest) {
    float p1 = (wp.x * 0.84 + wp.z * 0.54) * 1.65 - time * 3.1;
    float p2 = (wp.x * 0.58 + wp.z * 0.81) * 2.95 - time * 4.2;
    float p3 = (wp.x * 0.95 - wp.z * 0.31) * 5.10 - time * 5.4;
    float p4 = (wp.x * 0.26 + wp.z * 0.96) * 8.70 - time * 6.8;

    vec2 grad = vec2(0.84, 0.54) * (cos(p1) * 0.09)
              + vec2(0.58, 0.81) * (cos(p2) * 0.07)
              + vec2(0.95, -0.31) * (cos(p3) * 0.048)
              + vec2(0.26, 0.96) * (cos(p4) * 0.03);

    float aaFade = 1.0 / (1.0 + dist * 0.011);
    float chopAmp = aaFade * (0.8 + 0.55 * clamp(crest, 0.0, 1.0));
    return normalize(baseN + vec3(-grad.x, 0.0, -grad.y) * chopAmp);
}

void main() {
    vec3 waterColor = pow(u_color.rgb, vec3(2.2));
    vec3 deepWaterColor = pow(u_specColor.rgb, vec3(2.2));

    vec3 edgeColor = u_matParam6.rgb;
    float edgeSoftness = max(u_matParam6.a, 0.001);

    vec3 waterAbsorption = u_matParam0.rgb;
    float refractionStrength = u_matParam0.a;
    vec3 foamColor = pow(u_matParam1.rgb, vec3(2.2));
    float foamDistance = max(u_matParam1.a, 0.001);
    float foamCutoff = u_matParam2.r;
    float foamNoiseScale = u_matParam2.g;
    float foamNoiseSpeed = u_matParam2.b;

    vec3 viewVec = u_viewPos - v_worldPos;
    float viewDist = length(viewVec);
    vec3 viewDir = viewVec / max(viewDist, 0.001);
    float crestVal = v_crest;
    vec3 stormN = stormChopNormal(v_worldPos, v_normal, u_time, viewDist, crestVal);

    vec2 screenUv = v_clipPos.xy / v_clipPos.w * 0.5 + 0.5;
    vec2 refractionUv = clamp(screenUv + worldDirToScreen(vec3(stormN.x, 0.0, stormN.z)) * refractionStrength, vec2(0.001), vec2(0.999));
    vec3 refractedColor = pow(texture2D(u_opaqueMap, refractionUv).rgb, vec3(2.2));

    float fresnel = pow(1.0 - clamp(dot(stormN, viewDir), 0.0, 1.0), 5.0);

    // Deep-ocean floor extinction even when looking steeply downward in WebGL1 (no caustics)
    vec3 transmittance = exp(-(1.2 + fresnel * 10.0) * waterAbsorption);
    vec3 tintedSeabed = refractedColor * mix(vec3(1.0), waterColor, 0.6);
    vec3 baseColor = tintedSeabed * transmittance + deepWaterColor * (1.0 - transmittance);

    if (u_matParam9.x > 0.0) {
        vec2 mirrorUv = clamp(screenUv + worldDirToScreen(vec3(stormN.x, 0.0, stormN.z)) * u_matParam9.y, vec2(0.001), vec2(0.999));
        vec3 mirror = pow(texture2D(u_reflectionMap, mirrorUv).rgb, vec3(2.2));
        baseColor = mix(baseColor, mirror, (0.02 + 0.98 * fresnel) * u_matParam9.x);
    } else {
        vec3 stormSky = vec3(0.035, 0.058, 0.095);
        baseColor = mix(baseColor, stormSky, fresnel * 0.65);
    }

    vec3 lightDir = normalize(u_dirLightDir);
    vec3 halfVector = normalize(lightDir + viewDir);
    float nDotH = clamp(dot(stormN, halfVector), 0.0, 1.0);

    float grazing = pow(1.0 - clamp(dot(stormN, viewDir), 0.0, 1.0), 2.2);
    float backScatter = pow(clamp(dot(viewDir, -lightDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
    float sssMask = pow(clamp(crestVal * 0.85 + 0.2, 0.0, 1.0), 2.0) * (0.3 + 0.7 * grazing) * (0.45 + 0.55 * backScatter);
    baseColor += vec3(0.016, 0.068, 0.096) * sssMask * 0.85;

    float specular = smoothstep(0.998, 0.9999, nDotH) * 0.55 + pow(nDotH, 48.0) * 0.08;
    baseColor += u_dirLightColor * specular;

    float edgeBlend = smoothstep(0.04, 0.04 + 0.5 * edgeSoftness, fresnel) * 0.35;
    vec3 edgeColLinear = pow(edgeColor, vec3(2.2));
    vec3 finalColor = mix(baseColor, edgeColLinear, edgeBlend * 0.25);

    vec2 windDir = vec2(0.84, 0.54);
    vec2 foamUv = v_worldPos.xz * foamNoiseScale + windDir * (u_time * foamNoiseSpeed);
    float foamCell = waterCellNoise(foamUv);
    float foamPattern = 1.0 - smoothstep(foamCutoff, foamCutoff + 0.15, foamCell);
    float foamBlend = smoothstep(0.04, 0.04 + 0.5 * foamDistance, fresnel) * 0.25;
    float shoreFoamMask = foamPattern * foamBlend;

    float gustCell = waterCellNoise(v_worldPos.xz * 0.045 + vec2(u_time * 0.18, u_time * 0.11));
    float gustGate = smoothstep(0.26, 0.74, gustCell);
    float crestCell2 = waterCellNoise(foamUv * 2.35 + vec2(11.3, 7.1));
    float webA = smoothstep(0.38, 0.78, foamCell);
    float webB = 1.0 - smoothstep(0.18, 0.56, crestCell2);
    float foamWeb = clamp(webA * 0.65 + webB * 0.55, 0.0, 1.0);

    float along = dot(v_worldPos.xz, windDir);
    float across = dot(v_worldPos.xz, vec2(-0.54, 0.84));
    vec2 streakUv = vec2(along * 0.16 - u_time * 1.4, across * 1.25 + sin(along * 0.12) * 0.4);
    float streakCell = waterCellNoise(streakUv);
    float spindrift = (1.0 - smoothstep(0.18, 0.46, streakCell)) * smoothstep(0.18, 0.62, crestVal) * (0.3 + 0.7 * gustGate);

    vec3 aeratedCol = vec3(0.095, 0.18, 0.24);
    float aeratedMask = clamp(smoothstep(0.28, 0.72, crestVal) * (0.3 + 0.7 * gustGate) * (0.45 * webA + 0.55 * spindrift), 0.0, 0.72);
    finalColor = mix(finalColor, aeratedCol, aeratedMask);

    float breakerMask = smoothstep(0.52, 0.94, crestVal) * (0.28 + 0.72 * gustGate);
    float crestFoam = clamp(breakerMask * foamWeb * 0.92 + smoothstep(0.82, 1.0, crestVal) * gustGate * webA * 0.32, 0.0, 0.85);
    float foamMaskFinal = max(shoreFoamMask, crestFoam);
    vec3 foamLit = foamColor * (0.68 + 0.32 * clamp(dot(stormN, lightDir) * 0.5 + 0.5, 0.0, 1.0));

    finalColor = mix(finalColor, foamLit, foamMaskFinal);

    finalColor = pow(finalColor, vec3(1.0 / 2.2));
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

function buildStormOceanSources(): ShaderDefinition["sources"] {
  const wgslVert = openWaterVertWGSL
    .replace(STORM_VERT_PATCH_WGSL.wavesOld, STORM_VERT_PATCH_WGSL.wavesNew)
    .replace(STORM_VERT_PATCH_WGSL.crestOld, STORM_VERT_PATCH_WGSL.crestNew);

  const glslVert = openWaterVertGLSL
    .replace(STORM_VERT_PATCH_GLSL.wavesOld, STORM_VERT_PATCH_GLSL.wavesNew)
    .replace(STORM_VERT_PATCH_GLSL.crestOld, STORM_VERT_PATCH_GLSL.crestNew);

  const glsl100Vert = openWaterVertGLSL100
    .replace(STORM_VERT_PATCH_GLSL100.wavesOld, STORM_VERT_PATCH_GLSL100.wavesNew)
    .replace(STORM_VERT_PATCH_GLSL100.crestOld, STORM_VERT_PATCH_GLSL100.crestNew);

  return {
    glsl300: {
      vs: glslVert,
      fs: NUR_STORM_OCEAN_FRAG_GLSL,
    },
    glsl100: {
      vs: glsl100Vert,
      fs: NUR_STORM_OCEAN_FRAG_GLSL100,
    },
    wgsl: `${wgslVert}\n[WGSL_PBR_MATH]\n[WGSL_DIR_SHADOW]\n${NUR_STORM_OCEAN_FRAG_WGSL}`,
  };
}

/**
 * Showcase-local stormy open-ocean extension of {@link OpenWaterMaterial} (ADR 0047).
 * Replaces symmetric 6-wave crests with an 8-wave incommensurate wind spectrum,
 * high-frequency procedural chop normals, cold teal crest subsurface scattering,
 * gust-gated spindrift/whitecap foam, and caustics-free abyssal WebGL1 shading.
 */
export class NurStormOceanMaterial extends OpenWaterMaterial {
  constructor(options: OpenWaterMaterialOptions = {}) {
    super(options);
  }

  protected override _getLiquidWaveShaderSources(): ShaderDefinition["sources"] {
    return buildStormOceanSources();
  }
}

/**
 * Creates Moon Nur's dark stormy ocean `NurStormOceanMaterial` wired to a `PlanarReflectionNode`
 * across all 3 tiers (`WEB_GPU`, `WEB_GL2`, `WEB_GL1`), avoiding the hardcoded bright-blue
 * fallback sky color and reflecting the fortress silhouette plus crimson hangar glow.
 */
export function createStormOceanMaterial(
  reflectionNode: PlanarReflectionNode | undefined,
  options: StormOceanOptions = {},
): OpenWaterMaterial {
  const edgeSoftness = options.edgeSoftness ?? 1.4;
  return new NurStormOceanMaterial({
    waterColor: options.waterColor ?? new Color(0.01, 0.036, 0.072),
    deepWaterColor: options.deepWaterColor ?? new Color(0.003, 0.01, 0.025),
    edgeColor: options.edgeColor ?? new Color(0.12, 0.2, 0.3),
    edgeSoftness,
    speed: options.speed ?? 1.55,
    wave1: options.wave1 ?? [0.84, 0.54, 0.16, 44.0],
    wave2: options.wave2 ?? [0.52, 0.85, 0.12, 27.3],
    wave3: options.wave3 ?? [0.96, -0.28, 0.09, 16.9],
    refractionStrength: options.refractionStrength ?? 0.04,
    waterAbsorption: options.waterAbsorption ?? [0.95, 0.42, 0.24],
    foamColor: options.foamColor ?? new Color(0.68, 0.78, 0.86),
    foamDistance: options.foamDistance ?? 2.8,
    foamCutoff: options.foamCutoff ?? 0.46,
    foamNoiseScale: options.foamNoiseScale ?? 1.15,
    foamNoiseSpeed: options.foamNoiseSpeed ?? 1.15,
    poolHalfExtent: options.poolHalfExtent ?? 0,
    domainScale: options.domainScale ?? 1.0,
    reflectionMap: reflectionNode?.renderTarget,
    reflectionStrength: options.reflectionStrength ?? 0.82,
    reflectionDistortion: options.reflectionDistortion ?? 0.12,
    reflectionRoughness: options.reflectionRoughness ?? 0.04,
  });
}
