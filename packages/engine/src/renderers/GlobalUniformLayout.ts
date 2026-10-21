/**
 * Single source of truth for the `GlobalUniforms` buffer layout.
 *
 * The block used to be described by hand in five places that must match byte for byte:
 *   - `shaders/source/web_gpu/chunks/structs.wgsl` (`struct GlobalUniforms`),
 *   - the two std140 GLSL copies in `base_vertex_header.vert.glsl` and `lights.frag.glsl`,
 *   - `WebGL2Renderer.updateGlobalUBO` / `writeClusterGridUniforms`,
 *   - `WebGPURenderer._updateGlobalBuffers`,
 *   - `SpotShadowPassGPU` / `CascadedShadowPassGPU` (partial re-uploads).
 *
 * This file is the single table for the writers. Shader drift is pinned by
 * `tests/renderers/GlobalUniformLayout.test.ts`, which parses the WGSL struct and the GLSL std140
 * blocks and asserts field order, offsets and sizes against these tables -- a shader edit that
 * moves a field fails CI instead of silently corrupting rendering.
 *
 * Field names mirror the shader field names (`viewPos`, `cascadeMatrices`, `tileSizePx`,
 * `clusterDims`, ...).
 */

/** One field of a global-uniform block. Units differ per backend (bytes vs. floats). */
export interface GlobalUniformField {
  /** Start of the field: byte offset in the WebGL2 std140 UBO, float index in the WebGPU block. */
  offset: number;
  /** Span of the field: byte length (WebGL2) or float count (WebGPU). */
  size: number;
}

/** A size-fixed array of `GlobalUniformField` (e.g. 4 spot shadow matrices). */
export interface GlobalUniformArrayField extends GlobalUniformField {
  count: number;
  /** Byte (WebGL2) / float (WebGPU) stride between two consecutive array elements. */
  stride: number;
}

// ── WebGL2 std140 (2112 bytes) ────────────────────────────────────────────────────────────────
// Field order and std140 offsets match `base_vertex_header.vert.glsl` / `lights.frag.glsl`
// exactly. Sub-layouts of the three light structs are separate tables below.

export const WebGL2GlobalUniformLayout = {
  totalBytes: 2112,
  fields: {
    vp: { offset: 0, size: 64 },
    viewPos: { offset: 64, size: 12 },
    ambientColor: { offset: 80, size: 12 },
    dirLightColor: { offset: 96, size: 12 },
    dirLightDir: { offset: 112, size: 12 },
    numPointLights: { offset: 128, size: 4 },
    numSpotLights: { offset: 132, size: 4 },
    numAreaLights: { offset: 136, size: 4 },
    gamma: { offset: 140, size: 4 },
    exposure: { offset: 144, size: 4 },
    cameraNearFar: { offset: 152, size: 8 },
    pointLights: { offset: 160, size: 512, count: 16, stride: 32 },
    spotLights: { offset: 672, size: 1024, count: 16, stride: 64 },
    areaLights: { offset: 1696, size: 384, count: 4, stride: 96 },
    tileSizePx: { offset: 2080, size: 8 },
    clusterDims: { offset: 2096, size: 16 },
  },
} as const;

/** std140 sub-layout of a `PointLight` slot (32 bytes). Offsets are relative to the slot start. */
export const WebGL2PointLightLayout = {
  pos: 0,
  distance: 12,
  color: 16,
  decay: 28,
  slotBytes: 32,
} as const;

/** std140 sub-layout of a `SpotLight` slot (64 bytes). Offsets are relative to the slot start. */
export const WebGL2SpotLightLayout = {
  pos: 0,
  dir: 16,
  color: 32,
  angleCos: 48,
  angleCosPenumbra: 52,
  distance: 56,
  decay: 60,
  slotBytes: 64,
} as const;

/** std140 sub-layout of an `AreaLight` slot (96 bytes). Offsets are relative to the slot start. */
export const WebGL2AreaLightLayout = {
  pos: 0,
  color: 16,
  u: 32,
  v: 48,
  w: 64,
  widthHalf: 80,
  heightHalf: 84,
  distance: 88,
  decay: 92,
  slotBytes: 96,
} as const;

// ── WebGPU (216 floats / 864 bytes) ───────────────────────────────────────────────────────────
// Field order and float indices match `structs.wgsl` exactly.

export const WebGPUGGlobalUniformLayout = {
  totalFloats: 216,
  totalBytes: 864,
  fields: {
    vp: { index: 0, floats: 16 },
    viewPos: { index: 16, floats: 4 },
    ambientColor: { index: 20, floats: 4 },
    dirLightColor: { index: 24, floats: 4 },
    dirLightDir: { index: 28, floats: 4 },
    numPointLights: { index: 32, floats: 1 },
    numSpotLights: { index: 33, floats: 1 },
    numAreaLights: { index: 34, floats: 1 },
    gamma: { index: 35, floats: 1 },
    exposure: { index: 36, floats: 1 },
    fogMode: { index: 37, floats: 1 },
    fogDensity: { index: 38, floats: 1 },
    fogNear: { index: 39, floats: 1 },
    fogFar: { index: 40, floats: 1 },
    fogHeight: { index: 41, floats: 1 },
    fogHeightFalloff: { index: 42, floats: 1 },
    envIntensity: { index: 43, floats: 1 },
    fogColor: { index: 44, floats: 4 },
    spotShadowMatrices: { index: 48, floats: 64, count: 4, stride: 16 },
    spotShadowInfo: { index: 112, floats: 16, count: 4, stride: 4 },
    cascadeMatrices: { index: 128, floats: 64, count: 4, stride: 16 },
    cascadeSplits: { index: 192, floats: 4 },
    dirShadowInfo: { index: 196, floats: 4 },
    cameraNearFar: { index: 200, floats: 2 },
    resolution: { index: 202, floats: 2 },
    projScale: { index: 204, floats: 2 },
    tileSizePx: { index: 206, floats: 2 },
    clusterDims: { index: 208, floats: 4 },
    shadowSoftness: { index: 212, floats: 4 },
  },
} as const;
