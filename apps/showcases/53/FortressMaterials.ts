import type { CubeTexture, Texture } from "@small-world-machine/engine";
import {
  Color,
  CustomShaderMaterial,
  ShaderFlag,
  StandardMaterial,
  StandardWebGPULayout,
  Vector2D,
} from "@small-world-machine/engine";
import fragWGSL from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.wgsl?raw";
import fragGLSL from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.glsl?raw";
import fragGLSL100 from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.glsl100?raw";

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

const WGSL_WATERLINE_BLOCK = `
    // Fortress Inquisitorius waterline wetness + synchronized bore-front surge & drainage film
    {
        let waterY = obj.matParam2.x;
        let wetBand = max(obj.matParam2.y, 0.001);
        let waveAmp = obj.matParam2.z;
        let wetAlbedoScale = obj.matParam2.w;
        let waveLap = sin(i.wp.x * 0.45 + obj.time * 1.4) * cos(i.wp.z * 0.45 - obj.time * 1.1) * waveAmp;
        let spatialWave = sin(i.wp.x * 0.18 + i.wp.z * 0.14) * 0.35 + cos(i.wp.x * 0.31 - i.wp.z * 0.27) * 0.2;
        let borePhase = fract(obj.time * 0.21 - spatialWave);
        let boreSurge = smoothstep(0.0, 0.10, borePhase) * (1.0 - smoothstep(0.10, 0.78, borePhase));
        let tideHeight = waterY + waveLap + boreSurge * waveAmp * 2.2;
        let distAboveWater = i.wp.y - tideHeight;
        let wetMask = 1.0 - smoothstep(-0.15, wetBand, distAboveWater);
        let drainFilm = (1.0 - smoothstep(-0.1, wetBand * 0.58, distAboveWater)) * (0.35 + 0.65 * boreSurge);
        let saltBand = smoothstep(wetBand * 0.45, wetBand * 0.78, distAboveWater) *
                       (1.0 - smoothstep(wetBand * 0.78, wetBand * 1.05, distAboveWater));
        let albedoFactor = mix(1.0, wetAlbedoScale, wetMask) * (1.0 - 0.14 * drainFilm) * (1.0 - 0.18 * saltBand);
        albedo = albedo * albedoFactor;
        let wetRoughness = clamp(roughness * 0.25, 0.06, 0.12);
        let filmRoughness = mix(wetRoughness, 0.04, drainFilm);
        roughness = mix(roughness, filmRoughness, wetMask);
    }
`;

const GLSL_WATERLINE_BLOCK = `
    // Fortress Inquisitorius waterline wetness + synchronized bore-front surge & drainage film
    {
        float waterY = u_matParam2.x;
        float wetBand = max(u_matParam2.y, 0.001);
        float waveAmp = u_matParam2.z;
        float wetAlbedoScale = u_matParam2.w;
        float waveLap = sin(v_worldPos.x * 0.45 + u_time * 1.4) * cos(v_worldPos.z * 0.45 - u_time * 1.1) * waveAmp;
        float spatialWave = sin(v_worldPos.x * 0.18 + v_worldPos.z * 0.14) * 0.35 + cos(v_worldPos.x * 0.31 - v_worldPos.z * 0.27) * 0.2;
        float borePhase = fract(u_time * 0.21 - spatialWave);
        float boreSurge = smoothstep(0.0, 0.10, borePhase) * (1.0 - smoothstep(0.10, 0.78, borePhase));
        float tideHeight = waterY + waveLap + boreSurge * waveAmp * 2.2;
        float distAboveWater = v_worldPos.y - tideHeight;
        float wetMask = 1.0 - smoothstep(-0.15, wetBand, distAboveWater);
        float drainFilm = (1.0 - smoothstep(-0.1, wetBand * 0.58, distAboveWater)) * (0.35 + 0.65 * boreSurge);
        float saltBand = smoothstep(wetBand * 0.45, wetBand * 0.78, distAboveWater) *
                         (1.0 - smoothstep(wetBand * 0.78, wetBand * 1.05, distAboveWater));
        float albedoFactor = mix(1.0, wetAlbedoScale, wetMask) * (1.0 - 0.14 * drainFilm) * (1.0 - 0.18 * saltBand);
        albedo *= albedoFactor;
        float wetRoughness = clamp(roughness * 0.25, 0.06, 0.12);
        float filmRoughness = mix(wetRoughness, 0.04, drainFilm);
        roughness = mix(roughness, filmRoughness, wetMask);
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
