
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

    // --- Directional Light ---
    vec3 L = normalize(u_dirLightDir);
    vec3 H = normalize(V + L);
    float dotNL = max(dot(N, L), 0.0);
    float dotNH = max(dot(N, H), 0.0);
    float dotVH = max(dot(V, H), 0.0);
    vec3 radiance = u_dirLightColor;

    float D = D_GGX(dotNH, roughness);
    float G = G_SchlickGGX(dotNL, dotNV, roughness);
    vec3 F = F_Schlick(dotVH, F0);
    
    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);
    vec3 specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
    Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;

    // --- Point Lights ---
    for(int i = 0; i < 4; i++) {
        if (i >= u_numPointLights) break;
        vec3 lightVec = u_pointLights[i].pos - v_worldPos;
        float dist = length(lightVec);
        vec3 L_p = normalize(lightVec);
        vec3 H_p = normalize(V + L_p);

        float attenuation = 1.0 / (dist * dist + 0.0001);
        vec3 pRadiance = u_pointLights[i].color * attenuation;

        float pDotNL = max(dot(N, L_p), 0.0);
        float pDotNH = max(dot(N, H_p), 0.0);
        float pDotVH = max(dot(V, H_p), 0.0);

        float pD = D_GGX(pDotNH, roughness);
        float pG = G_SchlickGGX(pDotNL, dotNV, roughness);
        vec3 pF = F_Schlick(pDotVH, F0);

        vec3 pkS = pF;
        vec3 pkD = (vec3(1.0) - pkS) * (1.0 - metallic);
        vec3 pSpecular = (pD * pG * pF) / (4.0 * dotNV * pDotNL + 0.0001);
        Lo += (pkD * tintColor / 3.14159265359 + pSpecular) * pRadiance * pDotNL;
    }

    // --- Spot Lights ---
    for(int i = 0; i < 4; i++) {
        if (i >= u_numSpotLights) break;
        vec3 lightVec = u_spotLights[i].pos - v_worldPos;
        float dist = length(lightVec);
        vec3 L_s = normalize(lightVec);
        vec3 H_s = normalize(V + L_s);

        vec3 spotDir = normalize(u_spotLights[i].dir);
        float cosOuter = u_spotLights[i].params.x;
        float cosInner = u_spotLights[i].params.y;
        float maxDist = u_spotLights[i].params.z;
        float decay = u_spotLights[i].params.w;

        float theta = dot(-L_s, spotDir);
        float epsilon = max(cosInner - cosOuter, 0.0001);
        float intensity = clamp((theta - cosOuter) / epsilon, 0.0, 1.0);

        if (intensity > 0.0 && dist < maxDist) {
            float distanceAttenuation = pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay);
            float attenuation = distanceAttenuation * intensity;
            vec3 sRadiance = u_spotLights[i].color * attenuation;

            float sDotNL = max(dot(N, L_s), 0.0);
            float sDotNH = max(dot(N, H_s), 0.0);
            float sDotVH = max(dot(V, H_s), 0.0);

            float sD = D_GGX(sDotNH, roughness);
            float sG = G_SchlickGGX(sDotNL, dotNV, roughness);
            vec3 sF = F_Schlick(sDotVH, F0);

            vec3 skS = sF;
            vec3 skD = (vec3(1.0) - skS) * (1.0 - metallic);
            vec3 sSpecular = (sD * sG * sF) / (4.0 * dotNV * sDotNL + 0.0001);
            Lo += (skD * tintColor / 3.14159265359 + sSpecular) * sRadiance * sDotNL;
        }
    }

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
