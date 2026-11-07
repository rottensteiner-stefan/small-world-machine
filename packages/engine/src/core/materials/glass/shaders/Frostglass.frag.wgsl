@fragment fn fs(i: Out) -> @location(0) vec4f {
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
        let rawNormal = textureSample(u_normalMap, s, i.uv).rgb * 2.0 - 1.0;
        N = normalize(TBN * rawNormal);
    }
    // Double-sided glass (cullMode NONE also renders the far wall): face the shading normal toward the
    // viewer. Otherwise back faces see dot(N, V) < 0, the Fresnel term saturates to 1 and the whole far
    // wall mirrors the environment (uniform opaque-looking sheet). No-op for front faces.
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    let dotNV = max(dot(N, V), 0.0001);

    var F0 = vec3f(0.04);
    F0 = mix(F0, tintColor, metallic);

    var Lo = vec3f(0.0);

    // Transmitted light replaces the diffuse lobe (KHR_materials_transmission semantics): only the
    // non-transmitted share scatters diffusely. The shared light loops read diffuseColor.
    let diffuseColor = tintColor * (1.0 - transmission);
[WGSL_GLASS_PBR_LOOPS]
    
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
        refractedColor = targetToLinear(textureSampleLevel(u_opaqueMap, s, screenUv, 0.0).rgb) / max(global.exposure, 0.001);
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
            refractedColor += targetToLinear(textureSampleLevel(u_opaqueMap, s, offsetUv, 0.0).rgb) / max(global.exposure, 0.001);
        }
        refractedColor /= 12.0;
    }
    
    let finalRefraction = refractedColor * tintColor * transmission;
    
    // extraParams is fully repurposed for the clarity pulse (center.xyz, radius) on this
    // material, so it can't double as an AO term here -- match the GLSL paths' fixed factor.
    let ambient = global.ambientColor.rgb * diffuseColor * 0.5;
    
    let F_refr = F_Schlick(dotNV, F0);
    let kD_refr = (vec3f(1.0) - F_refr) * (1.0 - metallic);
    
    // Fresnel environment reflection: glass is read mostly through what it reflects (bright rims at grazing
    // angles). Split-sum IBL when the scene has one, else the uniform ambient stands in for the environment
    // radiance. The refraction is already weighted by (1 - F), so the sum stays energy-conserving.
    // The IBL maps are always bound on WebGPU; a black irradiance cube means "no scene IBL" (as in the PBR chunk).
    var envSpecular = global.ambientColor.rgb * F_Schlick(dotNV, F0);
    let envIrradiance = sRGBToLinear(textureSampleLevel(u_irradianceMap, globalSampler, N, 0.0).rgb);
    if (dot(envIrradiance, envIrradiance) > 1e-6) {
        let R_env = reflect(-V, N);
        let envRadiance = sRGBToLinear(textureSampleLevel(u_prefilterMap, globalSampler, R_env, roughness * 4.0).rgb) * global.envIntensity;
        let envBRDF = textureSampleLevel(u_brdfLUT, globalSampler, vec2f(dotNV, roughness), 0.0).rg;
        envSpecular = envRadiance * (F0 * envBRDF.x + envBRDF.y);
    }

    var color = ambient + envSpecular + Lo + finalRefraction * kD_refr;
    
    color *= global.exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    
    [WGSL_FOG_CALC]
    
    return vec4f(color, 1.0);
}
