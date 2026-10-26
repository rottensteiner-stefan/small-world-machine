import { ShaderPropertyType } from "../../enums/index.js";

/**
 * The standard uniform layout for objects using the [WGSL_STRUCTS] chunk.
 * This MUST match the ObjectUniforms struct in structs.wgsl (512 bytes / 128 floats).
 *
 * Structurally grouped into 4 sections:
 *  1. Transform Block (u_model, 64 bytes)
 *  2. Core Material & Surface Properties (u_color .. u_roughness, 64 bytes)
 *  3. Pipeline, Surface Tuning & Animation (u_extraParams .. u_styleB, 128 bytes)
 *  4. Semantic Material Parameters (u_matParam0 .. u_matParam15, 256 bytes)
 */
export const StandardWebGPULayout = {
  uniforms: {
    // --- 1. Transform Block (64 bytes) ---
    u_model: { type: ShaderPropertyType.MAT4 },

    // --- 2. Core Material & Surface Properties (64 bytes) ---
    // Neutral defaults: StandardMaterial and the engine's own presets write every one of these,
    // but a CustomShaderMaterial on this layout often supplies none, and a missing value made the
    // packer warn once per field, per object, per frame. (`u_color` falls back to the material's
    // own colour in the renderer.)
    u_color: { type: ShaderPropertyType.COLOR },
    u_specColor: { type: ShaderPropertyType.COLOR, defaultValue: [1, 1, 1, 1] },
    u_texOffset: { type: ShaderPropertyType.VEC2, defaultValue: [0, 0] },
    u_texRepeat: { type: ShaderPropertyType.VEC2, defaultValue: [1, 1] },
    u_shininess: { type: ShaderPropertyType.FLOAT, defaultValue: 32 },
    u_isTerrain: { type: ShaderPropertyType.FLOAT, defaultValue: 0 },
    u_metallic: { type: ShaderPropertyType.FLOAT, defaultValue: 0 },
    u_roughness: { type: ShaderPropertyType.FLOAT, defaultValue: 0.5 },

    // --- 3. Pipeline, Surface Tuning & Animation (128 bytes) ---
    u_extraParams: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_liquidParams: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_thresholds: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_useEnvMap: { type: ShaderPropertyType.FLOAT, defaultValue: 0 },
    u_useReflectionMap: { type: ShaderPropertyType.FLOAT, defaultValue: 0 },
    u_reflectivity: { type: ShaderPropertyType.FLOAT, defaultValue: 1.0 },
    u_time: { type: ShaderPropertyType.FLOAT, defaultValue: 0.0 },
    u_isSkinned: { type: ShaderPropertyType.FLOAT, defaultValue: 0.0 },
    u_boneOffset: { type: ShaderPropertyType.FLOAT, defaultValue: 0.0 },
    u_pad1: { type: ShaderPropertyType.FLOAT, defaultValue: 0.0 },
    u_pad2: { type: ShaderPropertyType.FLOAT, defaultValue: 0.0 },
    u_pad3: { type: ShaderPropertyType.FLOAT, defaultValue: 0.0 },
    u_styleA: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_styleB: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },

    // --- 4. Semantic Material Parameters: u_matParam0..15 (256 bytes) ---
    u_matParam0: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam1: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam2: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam3: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam4: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam5: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam6: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam7: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam8: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam9: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam10: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam11: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam12: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam13: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam14: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
    u_matParam15: { type: ShaderPropertyType.VEC4, defaultValue: [0, 0, 0, 0] },
  },
  uniformLayout: [
    // 1. Transform
    "u_model",
    // 2. Core Material
    "u_color",
    "u_specColor",
    "u_texOffset",
    "u_texRepeat",
    "u_shininess",
    "u_isTerrain",
    "u_metallic",
    "u_roughness",
    // 3. Pipeline, Surface Tuning & Animation
    "u_extraParams",
    "u_liquidParams",
    "u_thresholds",
    "u_useEnvMap",
    "u_useReflectionMap",
    "u_reflectivity",
    "u_time",
    "u_isSkinned",
    "u_boneOffset",
    "u_pad1",
    "u_pad2",
    "u_pad3",
    "u_styleA",
    "u_styleB",
    // 4. Semantic Material Parameters
    "u_matParam0",
    "u_matParam1",
    "u_matParam2",
    "u_matParam3",
    "u_matParam4",
    "u_matParam5",
    "u_matParam6",
    "u_matParam7",
    "u_matParam8",
    "u_matParam9",
    "u_matParam10",
    "u_matParam11",
    "u_matParam12",
    "u_matParam13",
    "u_matParam14",
    "u_matParam15",
  ],
  textures: {
    u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
    u_normalMap: { type: ShaderPropertyType.TEXTURE },
    u_metallicMap: { type: ShaderPropertyType.TEXTURE },
    u_roughnessMap: { type: ShaderPropertyType.TEXTURE },
    u_emissiveMap: { type: ShaderPropertyType.TEXTURE },
    u_alphaMap: { type: ShaderPropertyType.TEXTURE },
    u_envMap: { type: ShaderPropertyType.TEXTURE },
    u_reflectionMap: { type: ShaderPropertyType.TEXTURE },
    u_aoMap: { type: ShaderPropertyType.TEXTURE },
    u_opaqueMap: { type: ShaderPropertyType.TEXTURE },
  },
};
