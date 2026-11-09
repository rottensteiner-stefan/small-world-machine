/**
 * Compile-time feature flags a material pushes into `RenderManifest.flags`. Each value is the literal
 * `USE_*` token the shader sources test (`#ifdef` in GLSL, a generated `const` in WGSL), so renaming a
 * member must never change its value; `ShaderFlag.test.ts` checks every value against the shader sources.
 */
export const ShaderFlag = {
  /** The diffuse map is a texture array. */
  TEXTURE_ARRAY: "USE_TEXTURE_ARRAY",
  /** Metallic map present. */
  METALLIC_MAP: "USE_METALLIC_MAP",
  /** Roughness map present. */
  ROUGHNESS_MAP: "USE_ROUGHNESS_MAP",
  /**
   * Metallic and roughness maps are the same texture (the glTF metallicRoughness layout): WebGL2 reads
   * both channels through the one `u_metallicMap` sampler and declares no `u_roughnessMap`, saving a
   * texture unit of the scarce 11 (ADR 0055).
   */
  METALLIC_ROUGHNESS_SHARED: "USE_METALLIC_ROUGHNESS_SHARED",
  /** Ambient-occlusion map present. */
  AO_MAP: "USE_AO_MAP",
  /** Emissive map present. */
  EMISSIVE_MAP: "USE_EMISSIVE_MAP",
  /** Alpha map present. */
  ALPHA_MAP: "USE_ALPHA_MAP",
  /** Per-material environment cube map present. */
  ENV_MAP: "USE_ENV_MAP",
  /** Normal map present. */
  NORMAL_MAP: "USE_NORMAL_MAP",
  /** Planar reflection map present. */
  REFLECTION_MAP: "USE_REFLECTION_MAP",
  /** KHR_materials_clearcoat active. */
  CLEARCOAT: "USE_CLEARCOAT",
  /** Clearcoat intensity map present. */
  CLEARCOAT_MAP: "USE_CLEARCOAT_MAP",
  /** Clearcoat roughness map present. */
  CLEARCOAT_ROUGHNESS_MAP: "USE_CLEARCOAT_ROUGHNESS_MAP",
  /** Clearcoat normal map present. */
  CLEARCOAT_NORMAL_MAP: "USE_CLEARCOAT_NORMAL_MAP",
  /** KHR_materials_sheen active. */
  SHEEN: "USE_SHEEN",
  /** Sheen colour map present. */
  SHEEN_COLOR_MAP: "USE_SHEEN_COLOR_MAP",
  /** Sheen roughness map present. */
  SHEEN_ROUGHNESS_MAP: "USE_SHEEN_ROUGHNESS_MAP",
  /** KHR_materials_transmission active. */
  TRANSMISSION: "USE_TRANSMISSION",
  /** Transmission map present. */
  TRANSMISSION_MAP: "USE_TRANSMISSION_MAP",
  /** Volume thickness map present. */
  THICKNESS_MAP: "USE_THICKNESS_MAP",
  /** KHR_materials_specular factors or maps deviate from the spec default. */
  MATERIAL_SPECULAR: "USE_MATERIAL_SPECULAR",
  /** KHR_materials_specular strength map present (WebGL2 + WebGPU; WebGL1 uses factors only, ADR 0054 revisit 2026-11-01). */
  SPECULAR_WEIGHT_MAP: "USE_SPECULAR_WEIGHT_MAP",
  /** KHR_materials_specular tint map present (WebGL2 + WebGPU; WebGL1 uses factors only, ADR 0054 revisit 2026-11-01). */
  SPECULAR_COLOR_MAP: "USE_SPECULAR_COLOR_MAP",
  /**
   * The specular strength and tint textures are one texture (the packed RGBA layout, alpha = strength,
   * rgb = tint): WebGL2 reads the strength from the alpha channel of the `u_specularColorMap` sampler and
   * declares no `u_specularWeightMap`, saving a texture unit (ADR 0054).
   */
  SPECULAR_MAPS_SHARED: "USE_SPECULAR_MAPS_SHARED",
  /** KHR_materials_anisotropy strength above 0 (ADR 0055). */
  ANISOTROPY: "USE_ANISOTROPY",
  /** KHR_materials_iridescence factor above 0 (ADR 0055). */
  IRIDESCENCE: "USE_IRIDESCENCE",
  /**
   * Renderer-injected, never set by a material: `quality.cheapIridescence` swaps the spectral thin-film model
   * for the two-beam model of WebGL1 in iridescent programs of WebGPU and WebGL2 (ADR 0055).
   */
  IRIDESCENCE_CHEAP: "USE_IRIDESCENCE_CHEAP",
  /** KHR_materials_anisotropy direction/strength texture present (WebGL2 only, ADR 0055). */
  ANISOTROPY_MAP: "USE_ANISOTROPY_MAP",
  /** KHR_materials_iridescence intensity texture (red channel) present (WebGL2 only, ADR 0055). */
  IRIDESCENCE_MAP: "USE_IRIDESCENCE_MAP",
  /** KHR_materials_iridescence thickness texture (green channel) present (WebGL2 only, ADR 0055). */
  IRIDESCENCE_THICKNESS_MAP: "USE_IRIDESCENCE_THICKNESS_MAP",
  /**
   * The iridescence and thickness textures are one texture (the usual packed glTF layout): WebGL2 reads
   * the thickness from the green channel of the `u_iridescenceMap` sampler and declares no
   * `u_iridescenceThicknessMap`, saving a texture unit (ADR 0055).
   */
  IRIDESCENCE_MAPS_SHARED: "USE_IRIDESCENCE_MAPS_SHARED",
  /** Phong specular map present. */
  SPECULAR_MAP: "USE_SPECULAR_MAP",
  /** The material reads per-vertex colours (`a_color`). */
  VERTEX_COLOR: "USE_VERTEX_COLOR",
  /** The draw is instanced (WebGPU declares it per pipeline). */
  INSTANCING: "USE_INSTANCING",
  /** Per-instance colour tint stream bound. */
  INSTANCE_COLOR: "USE_INSTANCE_COLOR",
  /** The colour comes from a bound ramp texture (dropped when textures are disabled). */
  RAMP_LUT: "USE_RAMP_LUT",
  /** The mesh is skinned. */
  SKINNING: "USE_SKINNING",
  /** Scene-level image-based lighting is bound. */
  IBL: "USE_IBL",
  /** WebGL1: the scene BRDF LUT is bound (`u_brdfLUT`); without it the analytic `EnvBRDFApprox` fit runs. */
  BRDF_LUT: "USE_BRDF_LUT",
  /** Exponential variance shadow maps are the active shadow mode. */
  EVSM: "USE_EVSM",
  /** The program also writes the normal buffer (ADR 0028). */
  NORMAL_OUT: "USE_NORMAL_OUT",
  /** Decal samples with explicit UV gradients (depth-reconstructed UVs). */
  DECAL_GRADIENTS: "USE_DECAL_GRADIENTS",
  /** Decal ORM map present. */
  DECAL_ORM: "USE_DECAL_ORM",
  /** Decal is unlit. */
  DECAL_UNLIT: "USE_DECAL_UNLIT",
  /** Material renders unlit (KHR_materials_unlit): flat base color, no lighting/IBL. */
  UNLIT: "USE_UNLIT",
  /**
   * ADR 0059 field lane: the vertex stage sources the per-instance pose from the 16-byte
   * cell-sorted instance record (GL CPU-cell fallback: `a_instancePos` + packed pose word) and
   * ignores `u_model`. NEVER combined with `INSTANCING`: the field programs bind the record
   * attributes at their own locations instead of `a_instanceMatrix`/`a_instanceData`.
   */
  INSTANCE_FIELD: "USE_INSTANCE_FIELD",
  /** Thin-surface sun transmission on StandardMaterial (`backlight`, ADR 0060). */
  BACKLIGHT: "USE_BACKLIGHT",
} as const;

/** Type definition for ShaderFlag. */
export type ShaderFlag = (typeof ShaderFlag)[keyof typeof ShaderFlag];
