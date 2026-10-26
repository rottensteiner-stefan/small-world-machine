@fragment fn fs(i: Out) -> @location(0) vec4f {
    let original_uv = i.uv / obj.texRepeat;
    
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
    let dotNV = max(dot(N, V), 0.0001);

    var F0 = vec3f(0.04);
    F0 = mix(F0, tintColor, metallic);

    var Lo = vec3f(0.0);

[WGSL_GLASS_PBR_LOOPS]
    
    // --- Screen Space Refraction ---
    let screenPos = i.pos.xy; 
    let screenRes = vec2f(textureDimensions(u_opaqueMap));
    var screenUv = screenPos / screenRes;
    
    // Simple refraction offset based on normal
    let refrDir = refract(-V, N, 1.0 / ior);
    
    // P3/S1 R2 (widescreen fix): aspect-compensate so the screen-space bokeh stays isotropic on
    // non-square targets. At square aspect the h/w factor is 1.0 exactly (x * 1.0 is a numeric
    // identity), so no existing golden shifts (byte-identical).
    // Distort UV
    let refrAspect = screenRes.y / max(screenRes.x, 1.0); // h/w (== 1.0 at square aspect)
    screenUv = screenUv + refrDir.xy * vec2f(refrAspect, 1.0) * thickness * 0.05;
    screenUv = clamp(screenUv, vec2f(0.001), vec2f(0.999));
    
    // Sample opaque map
    let refractedColor = targetToLinear(textureSample(u_opaqueMap, s, screenUv).rgb);
    
    // Apply tint (Beer's Law approximation)
    let transmittance = exp(-((vec3f(1.0) - tintColor) * thickness * 3.0));
    
    let finalRefraction = refractedColor * transmittance * transmission;
    
    // Ambient Light
    let ambient = global.ambientColor.rgb * tintColor * ao;
    
    // Energy Conservation for Refraction
    let F_refr = F_Schlick(dotNV, F0);
    let kD_refr = (vec3f(1.0) - F_refr) * (1.0 - metallic);
    
    var color = ambient + Lo + finalRefraction * kD_refr;
    
    // Exposure & Tone Mapping
    color *= global.exposure;
    if (global.gamma != 1.0) {
        color = color / (color + vec3f(1.0)); // Reinhard
    }
    
    // Gamma Correction
    color = linearToSRGB(color);
    
    [WGSL_FOG_CALC]
    
    return vec4f(color, 1.0);
}
