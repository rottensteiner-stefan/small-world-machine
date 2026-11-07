/**
 * Built-in shader chunk IDs (keys for `ShaderRegistry.registerChunk` / `getChunk`). Each value is the
 * literal `[TOKEN]` placeholder the shader sources and material templates embed, so renaming a member
 * must never change its value; `ShaderChunkId.test.ts` guards format, uniqueness and registration
 * linkage against the real registry. External/dynamic chunks keep the registry open via plain string
 * ids (`registerChunk(id: ShaderChunkId | (string & {}), ...)`).
 */
export const ShaderChunkId = {
  // --- Vertex / fragment scaffolding ---
  BASE_VERTEX_HEADER: "BASE_VERTEX_HEADER",
  BASE_VERTEX_MAIN: "BASE_VERTEX_MAIN",
  BASE_FRAGMENT_HEADER: "BASE_FRAGMENT_HEADER",
  BASE_VS: "BASE_VS",
  BASE_FS_HEADER: "BASE_FS_HEADER",
  // --- Lighting / PBR ---
  LIGHT_DEFS: "LIGHT_DEFS",
  LIGHT_CALC: "LIGHT_CALC",
  LIGHT_CALC_PBR: "LIGHT_CALC_PBR",
  PBR_MATH: "PBR_MATH",
  GLASS_PBR_LOOPS: "GLASS_PBR_LOOPS",
  WORLD_DIR_TO_SCREEN: "WORLD_DIR_TO_SCREEN",
  // --- Shadows / SDF / fog ---
  DIR_SHADOW: "DIR_SHADOW",
  DIR_PCSS: "DIR_PCSS",
  SDF_MATH: "SDF_MATH",
  FOG_DEFS: "FOG_DEFS",
  FOG_CALC: "FOG_CALC",
  // --- Liquid / water ---
  LIQUID_GERSTNER_WAVE: "LIQUID_GERSTNER_WAVE",
  LIQUID_WORLEY_NOISE: "LIQUID_WORLEY_NOISE",
  LIQUID_CAUSTICS: "LIQUID_CAUSTICS",
  LIQUID_GLINT: "LIQUID_GLINT",
  WATER_EXT_DECL: "WATER_EXT_DECL",
  WATER_EXT_SURFACE: "WATER_EXT_SURFACE",
  // --- WebGPU WGSL ---
  WGSL_STRUCTS: "WGSL_STRUCTS",
  WGSL_LIGHTING: "WGSL_LIGHTING",
  WGSL_PBR_MATH: "WGSL_PBR_MATH",
  WGSL_PBR_LIGHTING: "WGSL_PBR_LIGHTING",
  WGSL_GLASS_PBR_LOOPS: "WGSL_GLASS_PBR_LOOPS",
  CLUSTER_INDEX_LOOKUP: "CLUSTER_INDEX_LOOKUP",
  WGSL_DIR_SHADOW: "WGSL_DIR_SHADOW",
  WGSL_FOG_CALC: "WGSL_FOG_CALC",
  WGSL_SDF_MATH: "WGSL_SDF_MATH",
  WGSL_SCREEN_FOOTPRINT: "WGSL_SCREEN_FOOTPRINT",
  WGSL_LIQUID_GERSTNER_WAVE: "WGSL_LIQUID_GERSTNER_WAVE",
  WGSL_LIQUID_WORLEY_NOISE: "WGSL_LIQUID_WORLEY_NOISE",
  WGSL_LIQUID_CAUSTICS: "WGSL_LIQUID_CAUSTICS",
  WGSL_LIQUID_GLINT: "WGSL_LIQUID_GLINT",
  WGSL_WATER_EXT_DECL: "WGSL_WATER_EXT_DECL",
  WGSL_WATER_EXT_SURFACE: "WGSL_WATER_EXT_SURFACE",
  WGSL_VS: "WGSL_VS",
  // --- Post-processing filters ---
  FILTER_GLITCH_DISTORT: "FILTER_GLITCH_DISTORT",
  FILTER_VHS_DISTORT: "FILTER_VHS_DISTORT",
  FILTER_COLOR_GRADING: "FILTER_COLOR_GRADING",
} as const;

/** Type definition for ShaderChunkId. */
export type ShaderChunkId = (typeof ShaderChunkId)[keyof typeof ShaderChunkId];
