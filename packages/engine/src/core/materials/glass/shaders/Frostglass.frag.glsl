[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform float u_metallic;
uniform float u_roughness;
uniform vec4 u_liquidParams;
uniform sampler2D u_opaqueMap;

void main() {
    float blurRadius = u_liquidParams.x;
    float transmission = u_liquidParams.y;
    
    vec3 pulseCenter = u_extraParams.xyz;
    float pulseRadius = u_extraParams.w;
    
    vec3 tintColor = sRGBToLinear(u_color.rgb);
    float metallic = u_metallic;
    float roughness = clamp(u_roughness, 0.05, 1.0);
    
    vec3 V = normalize(u_viewPos - v_worldPos);
    #ifdef USE_NORMAL_MAP
    vec3 rawNormal = texture(u_normalMap, v_uv).rgb * 2.0 - 1.0;
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

    // Clarity Pulse logic
    float distToPulse = length(v_worldPos - pulseCenter);
    float clarity = 0.0;
    if (pulseRadius > 0.0) {
        clarity = 1.0 - smoothstep(max(0.0, pulseRadius - 1.5), pulseRadius, distToPulse);
    }
    float currentBlur = blurRadius * (1.0 - clarity);

    ivec2 texSize = textureSize(u_opaqueMap, 0);
    vec2 screenUv = gl_FragCoord.xy / vec2(texSize);
    
    vec3 refractedColor = vec3(0.0);
    
    if (currentBlur <= 0.001) {
        refractedColor = targetToLinear(textureLod(u_opaqueMap, screenUv, 0.0).rgb) / max(u_exposure, 0.001);
    } else {
        vec2 poisson[12];
        poisson[0] = vec2(-0.326212,-0.405805); poisson[1] = vec2(-0.840144,-0.073580);
        poisson[2] = vec2(-0.695914,0.457137);  poisson[3] = vec2(-0.203345,0.620716);
        poisson[4] = vec2(0.962340,-0.194983);  poisson[5] = vec2(0.473434,-0.480026);
        poisson[6] = vec2(0.519456,0.767022);   poisson[7] = vec2(0.185461,-0.893124);
        poisson[8] = vec2(0.507431,0.064425);   poisson[9] = vec2(0.896420,0.412458);
        poisson[10] = vec2(-0.321940,-0.932615); poisson[11] = vec2(-0.791559,-0.597705);
        
        for(int i = 0; i < 12; i++) {
            vec2 offsetUv = clamp(screenUv + poisson[i] * currentBlur, vec2(0.001), vec2(0.999));
            refractedColor += targetToLinear(textureLod(u_opaqueMap, offsetUv, 0.0).rgb) / max(u_exposure, 0.001);
        }
        refractedColor /= 12.0;
    }

    vec3 finalRefraction = refractedColor * tintColor * transmission;
    
    vec3 ambient = u_ambientColor * diffuseColor * 0.5;

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
    
    color *= u_exposure;
    if (u_gamma != 1.0) {
        color = color / (color + vec3(1.0)); // Reinhard (the post-process pass tone-maps otherwise)
    }
    color = linearToSRGB(color);
    
    [FOG_CALC]
    
    fragColor = vec4(color, 1.0);
}
