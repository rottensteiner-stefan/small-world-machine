[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform float u_metallic;
uniform float u_roughness;
uniform vec4 u_liquidParams;
uniform vec4 u_thresholds;

#ifdef USE_METALLIC_MAP
uniform sampler2D u_metallicMap;
#endif
#if defined(USE_ROUGHNESS_MAP) && !defined(USE_METALLIC_ROUGHNESS_SHARED)
uniform sampler2D u_roughnessMap;
#endif
#ifdef USE_AO_MAP
uniform sampler2D u_aoMap;
#endif
#ifdef USE_EMISSIVE_MAP
uniform sampler2D u_emissiveMap;
#endif
#ifdef USE_ALPHA_MAP
uniform sampler2D u_alphaMap;
#endif
#ifdef USE_ENV_MAP
uniform samplerCube u_envMap;
#endif
#ifdef USE_REFLECTION_MAP
uniform sampler2D u_reflectionMap;
#endif
#ifdef USE_CLEARCOAT_MAP
uniform sampler2D u_clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESS_MAP
uniform sampler2D u_clearcoatRoughnessMap;
#endif
#ifdef USE_CLEARCOAT_NORMAL_MAP
uniform sampler2D u_clearcoatNormalMap;
#endif
#ifdef USE_SHEEN_COLOR_MAP
uniform sampler2D u_sheenColorMap;
#endif
#ifdef USE_SHEEN_ROUGHNESS_MAP
uniform sampler2D u_sheenRoughnessMap;
#endif
#ifdef USE_TRANSMISSION_MAP
uniform sampler2D u_transmissionMap;
#endif
#ifdef USE_THICKNESS_MAP
uniform sampler2D u_thicknessMap;
#endif
#ifdef USE_TRANSMISSION
uniform sampler2D u_opaqueMap;
// Shared with the vertex stage (same name/type/precision -> one location); KHR_materials_volume
// thickness is mesh-space and is scaled to world by the model matrix's column lengths.
uniform highp mat4 u_model;
#endif

uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;
uniform float u_useEnvMap;
uniform float u_useReflectionMap;
uniform float u_reflectivity;
// Typed semantic lane (ADR 0027 / 0039): reflectionFresnelBlend -- how much of the reflection's
// strength comes from view angle at all (0 = constant regardless of angle, 1 = pure Fresnel).
// See Standard.frag.wgsl's identical use of obj.matParam0.x for the full rationale.
uniform vec4 u_matParam0;
uniform float u_time;

// Typed semantic lane (ADR 0027 / 0039): sheenColor -- rgb tint (sRGB, linearized below), w = enable
// flag mirroring the USE_SHEEN push basis (sheen is decoupled from u_specColor / emissive).
uniform vec4 u_matParam10;

// Typed semantic lane (ADR 0027 / 0039 / P3-S1 R1): attenuationColor -- KHR_materials_volume
// volumetric attenuation colour (LINEAR/RAW, see StandardMaterial._LANES). Read by the shared
// LIGHT_CALC_PBR chunk inside USE_TRANSMISSION; declared here so the WebGL2 Standard program links.
uniform vec4 u_matParam11;

#ifdef USE_MATERIAL_SPECULAR
// Typed semantic lanes (KHR_materials_specular): u_matParam12.rgb = linear f0(ior) x specularColor,
// u_matParam13.x = specularFactor (F90). Read by the shared LIGHT_CALC_PBR chunk; compile-gated so
// the Decal program sharing the chunk stays untouched.
uniform vec4 u_matParam12;
uniform vec4 u_matParam13;
#ifdef USE_SPECULAR_COLOR_MAP
uniform sampler2D u_specularColorMap;
#endif
#if defined(USE_SPECULAR_WEIGHT_MAP) && !defined(USE_SPECULAR_MAPS_SHARED)
uniform sampler2D u_specularWeightMap;
#endif
#endif

#ifdef USE_IRIDESCENCE
// Typed semantic lane (KHR_materials_iridescence): (factor, film ior, thickness min nm, thickness max nm). Read by
// the shared LIGHT_CALC_PBR chunk; compile-gated so the Decal program sharing the chunk stays untouched.
uniform vec4 u_matParam14;
#ifdef USE_IRIDESCENCE_MAP
uniform sampler2D u_iridescenceMap;
#endif
#if defined(USE_IRIDESCENCE_THICKNESS_MAP) && !defined(USE_IRIDESCENCE_MAPS_SHARED)
uniform sampler2D u_iridescenceThicknessMap;
#endif
#endif

#ifdef USE_ANISOTROPY
// Typed semantic lane (KHR_materials_anisotropy): (strength, cos(rotation), sin(rotation), 0). Read by the
// shared LIGHT_CALC_PBR chunk; compile-gated so the Decal program sharing the chunk stays untouched.
uniform vec4 u_matParam15;
#ifdef USE_ANISOTROPY_MAP
uniform sampler2D u_anisotropyMap;
#endif
#endif

void main() {
    // The alpha map shares the carrier texture's transform (repeat, offset, rotation): it samples the same
    // transformed v_uv as the diffuse map (dividing by u_texRepeat only undid the scale; wrong under rotation).
    // Convert sampled albedo to linear space
#if defined(USE_INSTANCING) && defined(USE_TEXTURE_ARRAY)
    vec4 texColor = texture(u_diffuseMap, vec3(v_uv, v_texIndex));
#else
    vec4 texColor = texture(u_diffuseMap, v_uv);
#endif
    
#ifdef USE_ALPHA_MAP
    texColor.a *= texture(u_alphaMap, v_uv).r;
#endif

    if (texColor.a < u_extraParams.y) {
        discard;
    }

    vec3 albedo = sRGBToLinear(texColor.rgb) * sRGBToLinear(u_color.rgb);
    
#ifdef USE_METALLIC_MAP
    float metallic = u_metallic * texture(u_metallicMap, v_uv).b;
#else
    float metallic = u_metallic;
#endif

#ifdef USE_ROUGHNESS_MAP
#ifdef USE_METALLIC_ROUGHNESS_SHARED
    // Same texture as the metallic map: read the green channel through that sampler (one unit, not two).
    float roughness = clamp(u_roughness * texture(u_metallicMap, v_uv).g, 0.05, 1.0);
#else
    float roughness = clamp(u_roughness * texture(u_roughnessMap, v_uv).g, 0.05, 1.0); // Avoid divide by zero
#endif
#else
    float roughness = clamp(u_roughness, 0.05, 1.0);
#endif

#ifdef USE_AO_MAP
    float ao = u_extraParams.x * texture(u_aoMap, v_uv).r;
#else
    float ao = u_extraParams.x;
#endif

#ifdef USE_UNLIT
    // KHR_materials_unlit: flat base color -- no direct lighting, no IBL, no emissive. The
    // output transform mirrors the shared LIGHT_CALC_PBR tail (exposure, forwardToneMap,
    // sRGB encode) so an unlit material obeys the same post-processing contracts as lit ones.
    vec3 color = albedo * u_exposure;
    color = forwardToneMap(color);
    fragColor = vec4(linearToSRGB(color), u_color.a * texColor.a);
    if (fragColor.a < u_extraParams.y) {
        discard;
    }
#else
    [LIGHT_CALC_PBR]
#endif

    // The USE_REFLECTION_MAP blend now lives inside the LIGHT_CALC_PBR chunk (pre-tail, linear
    // space, A02); blending here after the chunk's exposure/tone-curve/sRGB tail mixed linear
    // reflections into encoded values and bypassed tone mapping. Removed deliberately -- see
    // light_calc_pbr.frag.glsl. (No bracket-wrapped chunk-id token in this comment: the assembler
    // would expand it in place.)

    [FOG_CALC]
#ifdef USE_INSTANCE_COLOR
    fragColor.rgb *= v_instanceColor.rgb;
#endif
}