[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform float u_metallic;
uniform float u_roughness;
uniform vec4 u_liquidParams;
uniform sampler2D u_opaqueMap;
// E01: model-scale mirror of the vertex-stage uniform (same convention as Standard.frag.glsl) --
// the refraction march must convert mesh-local thickness to world units like the Standard volume ray.
uniform highp mat4 u_model;

void main() {
    float ior = u_liquidParams.x;
    float thickness = u_liquidParams.y;
    float transmission = u_liquidParams.z;
    
    vec3 tintColor = sRGBToLinear(u_color.rgb);
    float metallic = u_metallic;
    float roughness = clamp(u_roughness, 0.05, 1.0);
    
    vec3 V = normalize(u_viewPos - v_worldPos);
    #ifdef USE_NORMAL_MAP
    vec3 rawNormal = texture(u_normalMap, v_uv).rgb * 2.0 - 1.0;
    rawNormal.xy *= u_extraParams.zw;
    vec3 N = normalize(v_tbn * rawNormal);
    #else
    vec3 N = normalize(v_normal);
    #endif
    // Double-sided glass (cullMode NONE also renders the far wall): face the shading normal toward the
    // viewer. Otherwise back faces see dot(N, V) < 0, the Fresnel term saturates to 1 and the whole far
    // wall mirrors the environment (uniform opaque-looking sheet). No-op for front faces.
    if (dot(N, V) < 0.0) N = -N;
    float dotNV = max(dot(N, V), 0.0001);

    vec3 F0 = vec3(0.04);
    F0 = mix(F0, tintColor, metallic);

    vec3 Lo = vec3(0.0);

    // Transmitted light replaces the diffuse lobe (KHR_materials_transmission semantics): only the
    // non-transmitted share scatters diffusely. The shared light loops read diffuseColor.
    vec3 diffuseColor = tintColor * (1.0 - transmission);
[GLASS_PBR_LOOPS]

    // --- Refraction (projected volume ray) ---
    // March the refracted view ray `thickness` world units through the glass and sample the opaque
    // snapshot where it exits -- the StandardMaterial KHR_materials_transmission model. The former
    // offset added the x/y of the WORLD-space refraction direction to screen UV, so the distortion rotated with the camera.
    // E01: thickness is mesh-local, so the march must convert it to world units via the model scale
    // -- exactly the Standard volume ray (light_calc_pbr). Unit-scale models are unaffected; on
    // non-uniformly scaled meshes the refraction distance + Beer absorption now match Standard.
    vec3 modelScale = vec3(length(u_model[0].xyz), length(u_model[1].xyz), length(u_model[2].xyz));
    vec3 refrDir = refract(-V, N, 1.0 / ior);
    vec3 refrMarch = refrDir * thickness * modelScale;
    vec4 exitClip = u_vp * vec4(v_worldPos + refrMarch, 1.0);
    vec2 screenUv = clamp(exitClip.xy / exitClip.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));
    
    // Sample opaque map (WebGL2 doesn't auto-convert if internalformat is standard RGBA, but we'll manually sRGBToLinear to be safe and consistent)
    // A01: cancel the forward-capture exposure (mirror pattern); identity when post owns the tail.
    vec3 refractedColor = targetToLinear(texture(u_opaqueMap, screenUv).rgb) / max(u_exposure, 0.001);
    vec3 transmittance = exp(-((vec3(1.0) - tintColor) * length(refrMarch) * 3.0));
    vec3 finalRefraction = refractedColor * transmittance * transmission;
    
    // Ambient Light
    vec3 ambient = u_ambientColor * diffuseColor * u_extraParams.x; // u_extraParams.x is AO

    vec3 F_refr = F_Schlick(dotNV, F0);
    vec3 kD_refr = (vec3(1.0) - F_refr) * (1.0 - metallic);
    
    // Fresnel environment reflection: glass is read mostly through what it reflects (bright rims at grazing
    // angles). Split-sum IBL when the scene has one, else the uniform ambient stands in for the environment
    // radiance. The refraction is already weighted by (1 - F), so the sum stays energy-conserving.
#ifdef USE_IBL
    vec3 R_env = reflect(-V, N);
    vec3 envRadiance = sRGBToLinear(textureLod(u_prefilterMap, R_env, roughness * 4.0).rgb) * u_envIntensity;
    vec2 envBRDF = texture(u_brdfLUT, vec2(dotNV, roughness)).rg;
    vec3 envSpecular = envRadiance * (F0 * envBRDF.x + envBRDF.y);
#else
    vec3 envSpecular = u_ambientColor * F_Schlick(dotNV, F0);
#endif

    vec3 color = ambient + envSpecular + Lo + finalRefraction * kD_refr;
    
    // Exposure & Tone Mapping
    color *= u_exposure;
    if (u_gamma != 1.0) {
        color = color / (color + vec3(1.0)); // Reinhard (the post-process pass tone-maps otherwise)
    }
    
    // Gamma Correction
    color = linearToSRGB(color);
    
    [FOG_CALC]
    
    fragColor = vec4(color, 1.0);
}
