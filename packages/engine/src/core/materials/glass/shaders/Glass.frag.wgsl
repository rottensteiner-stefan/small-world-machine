@fragment fn fs(i: Out) -> @location(0) vec4f {
    // IOR, Thickness, Transmission from liquidParams
    let ior = obj.liquidParams.x;
    let thickness = obj.liquidParams.y;
    let transmission = obj.liquidParams.z;
    
    let tintColor = sRGBToLinear(obj.color.rgb);
    let metallic = obj.metallic;
    let roughness = clamp(obj.roughness, 0.05, 1.0);
    let ao = obj.extraParams.x;
    
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
    
    // --- Refraction (projected volume ray) ---
    // March the refracted view ray `thickness` world units through the glass and sample the opaque
    // snapshot where it exits -- the StandardMaterial KHR_materials_transmission model. The former
    // offset added the x/y of the WORLD-space refraction direction to screen UV, so the distortion rotated with the camera.
    // E01: thickness is mesh-local, so the march converts it to world units via the model scale --
    // exactly the Standard volume ray (lighting_pbr.wgsl). Unit-scale models are unaffected;
    // non-uniformly scaled meshes now match Standard instead of diverging.
    let modelScale = vec3f(length(obj.model[0].xyz), length(obj.model[1].xyz), length(obj.model[2].xyz));
    let refrDir = refract(-V, N, 1.0 / ior);
    let refrMarch = refrDir * thickness * modelScale;
    let exitClip = global.vp * vec4f(i.wp + refrMarch, 1.0);
    let exitNdc = exitClip.xy / exitClip.w;
    // WebGPU texture space is y-down; NDC is y-up.
    let screenUv = clamp(vec2f(exitNdc.x * 0.5 + 0.5, 0.5 - exitNdc.y * 0.5), vec2f(0.001), vec2f(0.999));
    
    // Sample opaque map
    // A01: cancel the forward-capture exposure (mirror pattern); identity when post owns the tail.
    let refractedColor = targetToLinear(textureSample(u_opaqueMap, s, screenUv).rgb) / max(global.exposure, 0.001);
    
    // Apply tint (Beer's Law approximation) over the ACTUAL travelled (scaled) distance.
    let transmittance = exp(-((vec3f(1.0) - tintColor) * length(refrMarch) * 3.0));
    
    let finalRefraction = refractedColor * transmittance * transmission;
    
    // Ambient Light
    let ambient = global.ambientColor.rgb * diffuseColor * ao;
    
    // Energy Conservation for Refraction
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
    
    // Exposure & Tone Mapping
    color *= global.exposure;
    color = forwardToneMap(color);
    
    // Gamma Correction
    color = linearToSRGB(color);
    
    [WGSL_FOG_CALC]
    
    return vec4f(color, 1.0);
}
