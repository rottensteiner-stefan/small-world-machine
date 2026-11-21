import {
  BoundingBox,
  Color,
  CullMode,
  CustomShaderMaterial,
  StandardWebGPULayout,
  Vector3D,
  type BoundingVolume,
  type GeometryDataInterface,
  type ShaderLayout,
} from "@small-world-machine/engine";
import type { CanopyCoverageMap } from "./CanopyCoverage.js";

/** Maximum index count supported safely by WebGL1 `Uint16Array` buffers. */
const MAX_WEBGL1_VERTICES = 65000;

export interface CanopyShellOptions {
  /** @domain Base canopy elevation offset above terrain height in metres (> 0). Default 12. */
  canopyHeight?: number;
  /** Optional ground elevation callback `(worldX, worldZ) -> groundY`. Default returns 0. */
  elevationAt?: (worldX: number, worldZ: number) => number;
  /** @domain Minimum coverage fraction [0, 1] required to emit a shell quad. Default 0.06. */
  minCoverage?: number;
  /** @fixed Coverage-grid cell stride per shell quad (>= 1). Auto-upscaled if > 65k verts. */
  stride?: number;
  /** @domain Relative deterministic crown dome height relief amplitude [0, 1]. Default 0.25. */
  crownVariation?: number;
  /** @domain Vertical offset added beneath terrain-following canopy skirt in metres. Default 0. */
  baseElevationOffset?: number;
}

export interface CanopyShellMaterialOptions {
  /** Base linear-intent foliage canopy tint. Default deep forest green `(0.14, 0.25, 0.09)`. */
  color?: Color;
  /** @domain Horizontal distance in metres where Bayer dither fade-in starts. Default 180. */
  handoverStart?: number;
  /** @domain Horizontal distance in metres where shell reaches 100% opacity. Default 220. */
  handoverEnd?: number;
  /** @domain Minimum ambient multiplier inside dense canopy cores [0, 1]. Default 0.28. */
  ambientFloor?: number;
  /** @domain World-space XZ leaf clump noise frequency in m^-1. Default 0.18. */
  clumpScale?: number;
  /** @domain Sunlit-tip / valley hue modulation strength [0, 1]. Default 0.22. */
  colorVariation?: number;
  /** @domain Subtle top-surface wind shimmer amplitude in metres. Default 0.08. */
  windSwayAmplitude?: number;
}

function deterministicDomeNoise(wx: number, wz: number): number {
  const s1 = Math.sin(wx * 0.11 + wz * 0.07);
  const s2 = Math.cos(wx * 0.19 - wz * 0.17);
  const s3 = Math.sin(wx * 0.37 + wz * 0.41);
  return (s1 * 0.5 + s2 * 0.35 + s3 * 0.15) * 0.5 + 0.5;
}

function emptyCanopyGeometry(): GeometryDataInterface {
  const emptyBounds: BoundingVolume = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(0, 0, 0));
  return {
    vertices: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint16Array(0),
    getBoundingVolume: () => emptyBounds,
  };
}

/**
 * Builds a terrain-following far-field canopy shell mesh (ADR 0059 Step 4) from a baked
 * `CanopyCoverageMap`. Empty meadow quads below `minCoverage` are omitted, vertex counts are
 * bounded inside WebGL1 `Uint16Array` limits by automatic stride scaling, and triangle winding
 * is strictly right-handed `+Y` CCW.
 */
export function buildCanopyShellGeometry(
  coverage: CanopyCoverageMap,
  options: CanopyShellOptions = {},
): GeometryDataInterface {
  const canopyHeight = options.canopyHeight ?? 12.0;
  if (!(canopyHeight > 0)) {
    throw new Error(`[CanopyShell] canopyHeight must be > 0 (got ${canopyHeight}).`);
  }
  const minCoverage = Math.min(1, Math.max(0, options.minCoverage ?? 0.06));
  const crownVariation = Math.min(1, Math.max(0, options.crownVariation ?? 0.25));
  const baseOffset = options.baseElevationOffset ?? 0.0;
  const elevationAt = options.elevationAt ?? ((): number => 0);

  let stride = Math.max(1, Math.floor(options.stride ?? 1));
  // Ensure grid sample nodes remain safely inside Uint16Array bounds (WebGL1 compatible)
  while (
    (Math.ceil((coverage.width - 1) / stride) + 1) *
      (Math.ceil((coverage.height - 1) / stride) + 1) >
      MAX_WEBGL1_VERTICES &&
    stride < Math.max(coverage.width, coverage.height)
  ) {
    stride *= 2;
  }

  const cols = Math.max(0, Math.ceil((coverage.width - 1) / stride));
  const rows = Math.max(0, Math.ceil((coverage.height - 1) / stride));
  if (cols === 0 || rows === 0) {
    return emptyCanopyGeometry();
  }

  const gridW = cols + 1;
  const gridH = rows + 1;
  const gridX = new Float32Array(gridW * gridH);
  const gridY = new Float32Array(gridW * gridH);
  const gridZ = new Float32Array(gridW * gridH);
  const gridCov = new Float32Array(gridW * gridH);

  for (let r = 0; r < gridH; r++) {
    const cz = Math.min(coverage.height - 1, r * stride);
    const wz = coverage.originZ + (cz + 0.5) * coverage.cellSize;
    for (let c = 0; c < gridW; c++) {
      const cx = Math.min(coverage.width - 1, c * stride);
      const wx = coverage.originX + (cx + 0.5) * coverage.cellSize;
      const idx = r * gridW + c;
      const cov = coverage.data[cz * coverage.width + cx]! / 255;
      const relief = 1.0 + (deterministicDomeNoise(wx, wz) - 0.5) * 2.0 * crownVariation;
      const h = canopyHeight * (0.35 + 0.65 * cov) * relief;
      gridX[idx] = wx;
      gridZ[idx] = wz;
      gridY[idx] = elevationAt(wx, wz) + baseOffset + (cov > 0 ? h : 0);
      gridCov[idx] = cov;
    }
  }

  // Remap only vertices referenced by active forest quads
  const vertexMap = new Int32Array(gridW * gridH).fill(-1);
  const rawIndices: number[] = [];
  let activeVertCount = 0;

  const ensureVertex = (gridIdx: number): number => {
    const existing = vertexMap[gridIdx]!;
    if (existing >= 0) return existing;
    vertexMap[gridIdx] = activeVertCount;
    activeVertCount++;
    return vertexMap[gridIdx]!;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i00 = r * gridW + c;
      const i10 = r * gridW + (c + 1);
      const i01 = (r + 1) * gridW + c;
      const i11 = (r + 1) * gridW + (c + 1);
      const maxC = Math.max(gridCov[i00]!, gridCov[i10]!, gridCov[i01]!, gridCov[i11]!);
      if (maxC < minCoverage) continue;

      const v00 = ensureVertex(i00);
      const v10 = ensureVertex(i10);
      const v01 = ensureVertex(i01);
      const v11 = ensureVertex(i11);
      // Right-handed +Y CCW winding: (v00, v01, v10) and (v10, v01, v11)
      rawIndices.push(v00, v01, v10, v10, v01, v11);
    }
  }

  if (activeVertCount === 0) {
    return emptyCanopyGeometry();
  }

  const vertices = new Float32Array(activeVertCount * 3);
  const normals = new Float32Array(activeVertCount * 3);
  const uvs = new Float32Array(activeVertCount * 2);
  const colors = new Float32Array(activeVertCount * 4);
  const stepMeters = stride * coverage.cellSize;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < gridW; c++) {
      const gIdx = r * gridW + c;
      const vIdx = vertexMap[gIdx]!;
      if (vIdx < 0) continue;

      const x = gridX[gIdx]!;
      const y = gridY[gIdx]!;
      const z = gridZ[gIdx]!;
      vertices[vIdx * 3] = x;
      vertices[vIdx * 3 + 1] = y;
      vertices[vIdx * 3 + 2] = z;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);

      // Central difference heightfield normal
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(gridW - 1, c + 1);
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(gridH - 1, r + 1);
      const dx = Math.max(1e-4, (cNext - cPrev) * stepMeters);
      const dz = Math.max(1e-4, (rNext - rPrev) * stepMeters);
      const dhdx = (gridY[r * gridW + cNext]! - gridY[r * gridW + cPrev]!) / dx;
      const dhdz = (gridY[rNext * gridW + c]! - gridY[rPrev * gridW + c]!) / dz;
      const nx = -dhdx;
      const ny = 1.0;
      const nz = -dhdz;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      normals[vIdx * 3] = nx / nLen;
      normals[vIdx * 3 + 1] = ny / nLen;
      normals[vIdx * 3 + 2] = nz / nLen;

      uvs[vIdx * 2] = c / cols;
      uvs[vIdx * 2 + 1] = r / rows;

      const cov = gridCov[gIdx]!;
      const hueShift = deterministicDomeNoise(x * 0.4, z * 0.4);
      colors[vIdx * 4] = 0.85 + 0.3 * hueShift;
      colors[vIdx * 4 + 1] = 0.9 + 0.2 * cov;
      colors[vIdx * 4 + 2] = 0.85 + 0.2 * (1 - hueShift);
      colors[vIdx * 4 + 3] = cov;
    }
  }

  const bounds: BoundingVolume = new BoundingBox(
    new Vector3D(minX, minY, minZ),
    new Vector3D(maxX, maxY, maxZ),
  );

  const indices = new Uint16Array(rawIndices);
  return {
    vertices,
    normals,
    uvs,
    colors,
    indices,
    getBoundingVolume: () => bounds,
  };
}

const CANOPY_WGSL = `
[WGSL_STRUCTS]
[WGSL_PBR_MATH]
[WGSL_VS]

fn canopyHash(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn canopyNoise(p: vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = canopyHash(i);
    let b = canopyHash(i + vec2f(1.0, 0.0));
    let c = canopyHash(i + vec2f(0.0, 1.0));
    let d = canopyHash(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn canopyFbm(p: vec2f) -> f32 {
    return canopyNoise(p) * 0.65 + canopyNoise(p * 2.13 + vec2f(5.2, 1.7)) * 0.35;
}

fn canopyBayer4(pos: vec2f) -> f32 {
    let x = i32(floor(pos.x)) & 3;
    let y = i32(floor(pos.y)) & 3;
    let idx = y * 4 + x;
    var m = 0.0;
    if (idx == 0) { m = 0.0; } else if (idx == 1) { m = 8.0; } else if (idx == 2) { m = 2.0; } else if (idx == 3) { m = 10.0; }
    else if (idx == 4) { m = 12.0; } else if (idx == 5) { m = 4.0; } else if (idx == 6) { m = 14.0; } else if (idx == 7) { m = 6.0; }
    else if (idx == 8) { m = 3.0; } else if (idx == 9) { m = 11.0; } else if (idx == 10) { m = 1.0; } else if (idx == 11) { m = 9.0; }
    else if (idx == 12) { m = 15.0; } else if (idx == 13) { m = 7.0; } else if (idx == 14) { m = 13.0; } else { m = 5.0; }
    return (m + 0.5) * (1.0 / 16.0);
}

@fragment fn fs(i: Out) -> @location(0) vec4f {
    let handoverStart = obj.matParam0.x;
    let handoverEnd = obj.matParam0.y;
    let ambientFloor = obj.matParam0.z;
    let clumpScale = obj.matParam0.w;
    let colorVar = obj.matParam1.x;
    let swayAmp = obj.matParam1.y;

    let horizDist = length(i.wp.xz - global.viewPos.xz);
    if (handoverEnd > handoverStart) {
        let fade = clamp((horizDist - handoverStart) / (handoverEnd - handoverStart), 0.0, 1.0);
        if (fade < 0.999 && fade <= canopyBayer4(i.pos.xy)) {
            discard;
        }
    }

    let windShift = vec2f(sin(obj.time * 0.9), cos(obj.time * 0.7)) * swayAmp;
    let p = (i.wp.xz + windShift) * clumpScale;
    let eps = 0.25;
    let n0 = canopyFbm(p);
    let nx = canopyFbm(p + vec2f(eps, 0.0));
    let nz = canopyFbm(p + vec2f(0.0, eps));
    let baseN = normalize(i.n);
    let worldN = normalize(baseN + vec3f((n0 - nx) * 2.4, 0.0, (n0 - nz) * 2.4));
    g_shadingNormal = worldN;

    let macroHue = canopyNoise(i.wp.xz * (clumpScale * 0.2));
    let tintWarm = vec3f(1.0 + colorVar * 0.45, 1.0 + colorVar * 0.35, 1.0 - colorVar * 0.3);
    let tintCool = vec3f(1.0 - colorVar * 0.35, 1.0 - colorVar * 0.1, 1.0 + colorVar * 0.2);
    let clumpAo = mix(ambientFloor, 1.0, smoothstep(0.15, 0.85, n0));
    let albedo = sRGBToLinear(obj.color.rgb) * mix(tintCool, tintWarm, macroHue) * clumpAo;

    let L = normalize(global.dirLightDir.xyz);
    let ndotl = max(dot(worldN, L), 0.0);
    let wrapDiff = max((dot(worldN, L) + 0.3) / 1.3, 0.0);
    var shadow = 1.0;
    if (global.dirShadowInfo.z > 0.5) {
        let numCascades = u32(global.dirShadowInfo.w);
        var cascadeIndex = max(numCascades, 1u) - 1u;
        let viewDist = length(global.viewPos.xyz - i.wp);
        for (var c: u32 = 0u; c < numCascades; c++) {
            if (viewDist < global.cascadeSplits[c]) {
                cascadeIndex = c;
                break;
            }
        }
        let samplePos = i.wp + worldN * global.dirShadowBias[cascadeIndex] * (1.0 - ndotl);
        let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(samplePos, 1.0);
        shadow = getShadowDirMain(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);
    }

    let skyAmbient = global.ambientColor.rgb * mix(ambientFloor, 1.1, worldN.y * 0.5 + 0.5);
    var color = albedo * (skyAmbient + global.dirLightColor.rgb * wrapDiff * shadow);
    color *= global.exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    [WGSL_FOG_CALC]
    return vec4f(color, obj.color.a);
}
`;

const CANOPY_GLSL300_FS = `[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform vec4 u_matParam0;
uniform vec4 u_matParam1;
uniform float u_time;

float canopyHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float canopyNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = canopyHash(i);
    float b = canopyHash(i + vec2(1.0, 0.0));
    float c = canopyHash(i + vec2(0.0, 1.0));
    float d = canopyHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float canopyFbm(vec2 p) {
    return canopyNoise(p) * 0.65 + canopyNoise(p * 2.13 + vec2(5.2, 1.7)) * 0.35;
}

float canopyBayer4(vec2 pos) {
    int x = int(mod(floor(pos.x), 4.0));
    int y = int(mod(floor(pos.y), 4.0));
    int idx = y * 4 + x;
    float m = 0.0;
    if (idx == 0) m = 0.0; else if (idx == 1) m = 8.0; else if (idx == 2) m = 2.0; else if (idx == 3) m = 10.0;
    else if (idx == 4) m = 12.0; else if (idx == 5) m = 4.0; else if (idx == 6) m = 14.0; else if (idx == 7) m = 6.0;
    else if (idx == 8) m = 3.0; else if (idx == 9) m = 11.0; else if (idx == 10) m = 1.0; else if (idx == 11) m = 9.0;
    else if (idx == 12) m = 15.0; else if (idx == 13) m = 7.0; else if (idx == 14) m = 13.0; else m = 5.0;
    return (m + 0.5) * (1.0 / 16.0);
}

void main() {
    float handoverStart = u_matParam0.x;
    float handoverEnd = u_matParam0.y;
    float ambientFloor = u_matParam0.z;
    float clumpScale = u_matParam0.w;
    float colorVar = u_matParam1.x;
    float swayAmp = u_matParam1.y;

    float horizDist = length(v_worldPos.xz - u_viewPos.xz);
    if (handoverEnd > handoverStart) {
        float fade = clamp((horizDist - handoverStart) / (handoverEnd - handoverStart), 0.0, 1.0);
        if (fade < 0.999 && fade <= canopyBayer4(gl_FragCoord.xy)) {
            discard;
        }
    }

    vec2 windShift = vec2(sin(u_time * 0.9), cos(u_time * 0.7)) * swayAmp;
    vec2 p = (v_worldPos.xz + windShift) * clumpScale;
    float eps = 0.25;
    float n0 = canopyFbm(p);
    float nx = canopyFbm(p + vec2(eps, 0.0));
    float nz = canopyFbm(p + vec2(0.0, eps));
    vec3 worldN = normalize(normalize(v_normal) + vec3((n0 - nx) * 2.4, 0.0, (n0 - nz) * 2.4));
#ifdef USE_NORMAL_OUT
    g_shadingNormal = worldN;
#endif

    float macroHue = canopyNoise(v_worldPos.xz * (clumpScale * 0.2));
    vec3 tintWarm = vec3(1.0 + colorVar * 0.45, 1.0 + colorVar * 0.35, 1.0 - colorVar * 0.3);
    vec3 tintCool = vec3(1.0 - colorVar * 0.35, 1.0 - colorVar * 0.1, 1.0 + colorVar * 0.2);
    float clumpAo = mix(ambientFloor, 1.0, smoothstep(0.15, 0.85, n0));
    vec3 albedo = sRGBToLinear(u_color.rgb) * mix(tintCool, tintWarm, macroHue) * clumpAo;

    vec3 L = normalize(u_dirLightDir);
    float ndotl = max(dot(worldN, L), 0.0);
    float wrapDiff = max((dot(worldN, L) + 0.3) / 1.3, 0.0);
    float viewDist = length(u_viewPos - v_worldPos);
    float shadow = glassDirShadowFactor(v_worldPos, ndotl, worldN, viewDist);

    vec3 skyAmbient = u_ambientColor * mix(ambientFloor, 1.1, worldN.y * 0.5 + 0.5);
    vec3 color = albedo * (skyAmbient + u_dirLightColor * wrapDiff * shadow);
    color *= u_exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    fragColor = vec4(color, u_color.a);
    [FOG_CALC]
}
`;

const CANOPY_GLSL100_FS = `
[BASE_FS_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform vec4 u_matParam0;
uniform vec4 u_matParam1;
uniform float u_time;

float canopyHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float canopyNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = canopyHash(i);
    float b = canopyHash(i + vec2(1.0, 0.0));
    float c = canopyHash(i + vec2(0.0, 1.0));
    float d = canopyHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float canopyFbm(vec2 p) {
    return canopyNoise(p) * 0.65 + canopyNoise(p * 2.13 + vec2(5.2, 1.7)) * 0.35;
}

float canopyBayer4(vec2 pos) {
    int x = int(mod(floor(pos.x), 4.0));
    int y = int(mod(floor(pos.y), 4.0));
    int idx = y * 4 + x;
    float m = 0.0;
    if (idx == 0) m = 0.0; else if (idx == 1) m = 8.0; else if (idx == 2) m = 2.0; else if (idx == 3) m = 10.0;
    else if (idx == 4) m = 12.0; else if (idx == 5) m = 4.0; else if (idx == 6) m = 14.0; else if (idx == 7) m = 6.0;
    else if (idx == 8) m = 3.0; else if (idx == 9) m = 11.0; else if (idx == 10) m = 1.0; else if (idx == 11) m = 9.0;
    else if (idx == 12) m = 15.0; else if (idx == 13) m = 7.0; else if (idx == 14) m = 13.0; else m = 5.0;
    return (m + 0.5) * (1.0 / 16.0);
}

void main() {
    float handoverStart = u_matParam0.x;
    float handoverEnd = u_matParam0.y;
    float ambientFloor = u_matParam0.z;
    float clumpScale = u_matParam0.w;
    float colorVar = u_matParam1.x;
    float swayAmp = u_matParam1.y;

    float horizDist = length(v_worldPos.xz - u_viewPos.xz);
    if (handoverEnd > handoverStart) {
        float fade = clamp((horizDist - handoverStart) / (handoverEnd - handoverStart), 0.0, 1.0);
        if (fade < 0.999 && fade <= canopyBayer4(gl_FragCoord.xy)) {
            discard;
        }
    }

    vec2 windShift = vec2(sin(u_time * 0.9), cos(u_time * 0.7)) * swayAmp;
    vec2 p = (v_worldPos.xz + windShift) * clumpScale;
    float eps = 0.25;
    float n0 = canopyFbm(p);
    float nx = canopyFbm(p + vec2(eps, 0.0));
    float nz = canopyFbm(p + vec2(0.0, eps));
    vec3 worldN = normalize(normalize(v_normal) + vec3((n0 - nx) * 2.4, 0.0, (n0 - nz) * 2.4));

    float macroHue = canopyNoise(v_worldPos.xz * (clumpScale * 0.2));
    vec3 tintWarm = vec3(1.0 + colorVar * 0.45, 1.0 + colorVar * 0.35, 1.0 - colorVar * 0.3);
    vec3 tintCool = vec3(1.0 - colorVar * 0.35, 1.0 - colorVar * 0.1, 1.0 + colorVar * 0.2);
    float clumpAo = mix(ambientFloor, 1.0, smoothstep(0.15, 0.85, n0));
    vec3 albedo = sRGBToLinear(u_color.rgb) * mix(tintCool, tintWarm, macroHue) * clumpAo;

    vec3 L = normalize(u_dirLightDir);
    float wrapDiff = max((dot(worldN, L) + 0.3) / 1.3, 0.0);
    vec3 skyAmbient = u_ambientColor * mix(ambientFloor, 1.1, worldN.y * 0.5 + 0.5);
    vec3 color = albedo * (skyAmbient + u_dirLightColor * wrapDiff);
    color *= u_exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    gl_FragColor = vec4(color, u_color.a);
    [FOG_CALC]
}
`;

function createCanopyShellLayout(): ShaderLayout {
  return {
    uniforms: { ...StandardWebGPULayout.uniforms },
    uniformLayout: [...StandardWebGPULayout.uniformLayout],
    textures: {},
  };
}

/**
 * Cross-tier (`WEB_GPU`, `WEB_GL2`, `WEB_GL1`) procedural far-field canopy material (ADR 0059 Step 4).
 *
 * Uses zero extra texture samplers: shades a terrain-following canopy shell mesh with multi-octave
 * leaf clump noise normals, density/crevice AO darkening, macro hue variation, distance-based 4×4
 * Bayer dither handover fade-in beyond `[handoverStart, handoverEnd]`, and full fog/tone parity.
 */
export class CanopyShellMaterial extends CustomShaderMaterial {
  public static readonly TYPE = "CanopyShellMaterial";

  constructor(options: CanopyShellMaterialOptions = {}) {
    const color = options.color ?? new Color(0.14, 0.25, 0.09);
    const handoverStart = options.handoverStart ?? 180.0;
    const handoverEnd = options.handoverEnd ?? 220.0;
    const ambientFloor = Math.min(1, Math.max(0, options.ambientFloor ?? 0.28));
    const clumpScale = options.clumpScale ?? 0.18;
    const colorVariation = Math.min(1, Math.max(0, options.colorVariation ?? 0.22));
    const windSwayAmp = options.windSwayAmplitude ?? 0.08;

    super({
      sources: {
        wgsl: CANOPY_WGSL,
        glsl300: {
          vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]",
          fs: CANOPY_GLSL300_FS,
        },
        glsl100: {
          vs: "[BASE_VS]",
          fs: CANOPY_GLSL100_FS,
        },
      },
      layout: createCanopyShellLayout(),
      cullMode: CullMode.BACK,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      properties: {
        u_model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        u_color: color.toFloat32Array(),
        u_time: 0.0,
        u_matParam0: [handoverStart, handoverEnd, ambientFloor, clumpScale],
        u_matParam1: [colorVariation, windSwayAmp, 0.0, 0.0],
      },
    });
    this.color.copyFrom(color);
  }

  /** Updates animated wind shimmer time on this canopy shell material without allocating. */
  public setTime(seconds: number): void {
    this.properties["u_time"] = seconds;
  }
}
