@fragment fn fs(i: Out) -> @location(0) vec4f {
    let original_uv = i.uv / obj.texRepeat;
    
    let blurRadius = obj.liquidParams.x;
    let transmission = obj.liquidParams.y;
    
    let pulseCenter = obj.extraParams.xyz;
    let pulseRadius = obj.extraParams.w;
    
    let tintColor = sRGBToLinear(obj.color.rgb);
    let metallic = obj.metallic;
    let roughness = clamp(obj.roughness, 0.05, 1.0);
    
    let V = normalize(global.viewPos.xyz - i.wp);
    // Mirror the GLSL fallback guard: only sample the normal map when the material actually
    // supplies one (USE_NORMAL_MAP flag). Reading u_normalMap unconditionally (even through a
    // flat-normal fallback view) kept the TBN path busy with a sample that approaches v_normal
    // numerically; branching on the injected const keeps this shader's behaviour aligned with
    // the GLSL300/GLSL100 variants instead of relying on a coincidental fallback texture.
    var N = normalize(i.n);
    if (USE_NORMAL_MAP) {
        let TBN = mat3x3f(normalize(i.t), normalize(i.b), normalize(i.n));
        var rawNormal = textureSample(u_normalMap, s, i.uv).rgb * 2.0 - 1.0;
        rawNormal.x *= obj.extraParams.z;
        rawNormal.y *= obj.extraParams.w;
        N = normalize(TBN * rawNormal);
    }
    let dotNV = max(dot(N, V), 0.0001);

    var F0 = vec3f(0.04);
    F0 = mix(F0, tintColor, metallic);

    var Lo = vec3f(0.0);

    // Directional Light
    {
        let L = normalize(global.dirLightDir.xyz);
        let H = normalize(V + L);
        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);
        let radiance = global.dirLightColor.xyz;

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;
    }

    // Point Lights
    for(var j=0u; j<u32(global.numPointLights); j++) {
        let lightVec = pLights[j].pos.xyz - i.wp;
        let dist = length(lightVec);
        let L = lightVec / dist;
        let H = normalize(V + L);
        let attenuation = 1.0 / (dist * dist + 0.0001);
        let radiance = pLights[j].col.xyz * attenuation;

        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;
    }

    // Spot Lights
    for(var k=0u; k<u32(global.numSpotLights); k++) {
        let lightVec = sLights[k].pos.xyz - i.wp;
        let dist = length(lightVec);
        let L = lightVec / dist;
        let H = normalize(V + L);
        
        let spotDir = normalize(sLights[k].dir.xyz);
        let cosOuter = sLights[k].params.x;
        let cosInner = sLights[k].params.y;
        let maxDist = sLights[k].params.z;
        let decay = sLights[k].params.w;
        let theta = dot(L, -spotDir);
        let epsilon = max(cosInner - cosOuter, 0.0001);
        let spotIntensity = clamp((theta - cosOuter) / epsilon, 0.0, 1.0);
        let distanceAttenuation = select(1.0 / (dist * dist + 0.0001), pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay), maxDist > 0.0);
        let radiance = sLights[k].col.xyz * distanceAttenuation * spotIntensity;

        let dotNL = max(dot(N, L), 0.0);
        let dotNH = max(dot(N, H), 0.0);
        let dotVH = max(dot(V, H), 0.0);

        let D = D_GGX(dotNH, roughness);
        let G = G_SchlickGGX(dotNL, dotNV, roughness);
        let F = F_Schlick(dotVH, F0);

        let kS = F;
        let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
        let specular = (D * G * F) / (4.0 * dotNV * dotNL + 0.0001);
        Lo += (kD * tintColor / 3.14159265359 + specular) * radiance * dotNL;
    }
    
    // Clarity Pulse logic
    let distToPulse = length(i.wp - pulseCenter);
    var clarity = 0.0;
    if (pulseRadius > 0.0) {
        clarity = 1.0 - smoothstep(max(0.0, pulseRadius - 1.5), pulseRadius, distToPulse);
    }
    let currentBlur = blurRadius * (1.0 - clarity);
    
    // --- Screen Space Frost Blur ---
    let screenPos = i.pos.xy; 
    let screenRes = vec2f(textureDimensions(u_opaqueMap));
    var screenUv = screenPos / screenRes;
    
    var refractedColor = vec3f(0.0);
    
    if (currentBlur <= 0.001) {
        refractedColor = sRGBToLinear(textureSampleLevel(u_opaqueMap, s, screenUv, 0.0).rgb);
    } else {
        let poisson = array<vec2f, 12>(
            vec2f(-0.326212,-0.405805), vec2f(-0.840144,-0.073580),
            vec2f(-0.695914,0.457137),  vec2f(-0.203345,0.620716),
            vec2f(0.962340,-0.194983),  vec2f(0.473434,-0.480026),
            vec2f(0.519456,0.767022),   vec2f(0.185461,-0.893124),
            vec2f(0.507431,0.064425),   vec2f(0.896420,0.412458),
            vec2f(-0.321940,-0.932615), vec2f(-0.791559,-0.597705)
        );
        for(var tap = 0u; tap < 12u; tap++) {
            let offsetUv = clamp(screenUv + poisson[tap] * currentBlur, vec2f(0.001), vec2f(0.999));
            refractedColor += sRGBToLinear(textureSampleLevel(u_opaqueMap, s, offsetUv, 0.0).rgb);
        }
        refractedColor /= 12.0;
    }
    
    let finalRefraction = refractedColor * tintColor * transmission;
    
    // extraParams is fully repurposed for the clarity pulse (center.xyz, radius) on this
    // material, so it can't double as an AO term here -- match the GLSL paths' fixed factor.
    let ambient = global.ambientColor.rgb * tintColor * 0.5;
    
    let F_refr = F_Schlick(dotNV, F0);
    let kD_refr = (vec3f(1.0) - F_refr) * (1.0 - metallic);
    
    var color = ambient + Lo + finalRefraction * kD_refr;
    
    color *= global.exposure;
    if (global.gamma != 1.0) {
        color = color / (color + vec3f(1.0)); // Reinhard
    }
    color = linearToSRGB(color);
    
    [WGSL_FOG_CALC]
    
    return vec4f(color, 1.0);
}
