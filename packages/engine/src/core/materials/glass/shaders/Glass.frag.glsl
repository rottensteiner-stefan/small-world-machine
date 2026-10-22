[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform float u_metallic;
uniform float u_roughness;
uniform vec4 u_liquidParams;
uniform sampler2D u_opaqueMap;

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
    float dotNV = max(dot(N, V), 0.0001);

    vec3 F0 = vec3(0.04);
    F0 = mix(F0, tintColor, metallic);

    vec3 Lo = vec3(0.0);

[GLASS_PBR_LOOPS]

    // --- Screen Space Refraction ---
    ivec2 texSize = textureSize(u_opaqueMap, 0);
    vec2 screenUv = gl_FragCoord.xy / vec2(texSize);
    
    vec3 refrDir = refract(-V, N, 1.0 / ior);
    screenUv = screenUv + refrDir.xy * thickness * 0.05;
    screenUv = clamp(screenUv, vec2(0.001), vec2(0.999));
    
    // Sample opaque map (WebGL2 doesn't auto-convert if internalformat is standard RGBA, but we'll manually sRGBToLinear to be safe and consistent)
    vec3 refractedColor = sRGBToLinear(texture(u_opaqueMap, screenUv).rgb);
    vec3 transmittance = exp(-((vec3(1.0) - tintColor) * thickness * 3.0));
    vec3 finalRefraction = refractedColor * transmittance * transmission;
    
    // Ambient Light
    vec3 ambient = u_ambientColor * tintColor * u_extraParams.x; // u_extraParams.x is AO

    vec3 F_refr = F_Schlick(dotNV, F0);
    vec3 kD_refr = (vec3(1.0) - F_refr) * (1.0 - metallic);
    
    vec3 color = ambient + Lo + finalRefraction * kD_refr;
    
    // Exposure & Tone Mapping
    color *= u_exposure;
    color = color / (color + vec3(1.0));
    
    // Gamma Correction
    color = linearToSRGB(color);
    
    [FOG_CALC]
    
    fragColor = vec4(color, 1.0);
}
