@fragment fn fs(i: Out) -> @location(0) vec4f {
    // original_uv must map the vertex UV (0-1) which was multiplied by obj.texRepeat.
    // So we just divide i.uv by obj.texRepeat to get back to 0-1, ignoring offset since puddle shouldn't scroll.
    let original_uv = i.uv / obj.texRepeat;

    let diffuseTex = textureSample(u_diffuseMap, s, i.uv);
    let albedo = sRGBToLinear(diffuseTex.rgb) * sRGBToLinear(obj.color.rgb);
    let metallic = obj.metallic * textureSample(u_metallicMap, s, i.uv).b;
    let roughness = clamp(obj.roughness * textureSample(u_roughnessMap, s, i.uv).g, 0.05, 1.0);
    let ao = obj.extraParams.x * textureSample(u_aoMap, s, i.uv).r;
    [WGSL_PBR_LIGHTING]
    let finalAlpha = obj.color.a * diffuseTex.a * textureSample(u_alphaMap, s, original_uv).r;
    if (finalAlpha < obj.extraParams.y) {
        discard;
    }
    
    if (obj.useReflectionMap > 0.5) {
        let clipPos = global.vp * vec4f(i.wp, 1.0);
        let ndc = clipPos.xy / clipPos.w;
        let screenUV = vec2f(ndc.x * 0.5 + 0.5, ndc.y * -0.5 + 0.5); // WebGPU Y is down
        let reflectionColor = sRGBToLinear(textureSample(u_reflectionMap, s, screenUV).rgb);
        let V_dir = normalize(global.viewPos.xyz - i.wp);
        let dotNV_refl = max(dot(normalize(i.n), V_dir), 0.0);
        let F0_refl = mix(vec3f(0.04), albedo, metallic);
        let F_refl = F_Schlick(dotNV_refl, F0_refl).x;
        // obj.pad1 (repurposed as reflectionFresnelBlend, see StandardMaterial.ts) picks how much
        // of the reflection's strength comes from view angle at all: 0 = constant regardless of
        // angle, 1 = pure Schlick Fresnel (its (1-cosTheta)^5 term stays low across most of the
        // angle range and only rises steeply in the last few degrees before grazing incidence --
        // physically correct for a dielectric, but reads as an on/off switch to a human observer
        // rather than a gradual falloff). Materials wanting a reflection that stays legible across
        // a wider range of angles (see the Showcase 30 puddle) should lower this well below 0.5.
        let f = obj.reflectivity * mix(1.0, F_refl, obj.pad1);
        color = mix(color, reflectionColor, f);
    }

    if (obj.liquidParams.z > 0.0) {
        let transmission = obj.liquidParams.z;
        let ior_trans = select(1.5, obj.liquidParams.x, obj.liquidParams.x > 0.0);
        let thickness = obj.liquidParams.y;
        let attenuationDist = obj.thresholds.z;

        let clipPos = global.vp * vec4f(i.wp, 1.0);
        let ndc = clipPos.xy / clipPos.w;
        var screenUV = vec2f(ndc.x * 0.5 + 0.5, ndc.y * -0.5 + 0.5);
        let V_dir = normalize(global.viewPos.xyz - i.wp);
        let refrDir = refract(-V_dir, normalize(i.n), 1.0 / ior_trans);
        screenUV = clamp(screenUV + refrDir.xy * thickness * 0.05, vec2f(0.001), vec2f(0.999));
        let transmittedColor = sRGBToLinear(textureSample(u_opaqueMap, s, screenUV).rgb);
        let volumeTransmittance = VolumeAbsorption(albedo, attenuationDist, thickness);
        let finalTransmission = transmittedColor * volumeTransmittance * albedo;
        let f_refr = F_Schlick(max(dot(normalize(i.n), V_dir), 0.0), F0).x;
        let kD_refr = (1.0 - f_refr) * (1.0 - metallic);
        color = mix(color, color + finalTransmission * kD_refr, transmission);
    }
    
    // Exposure
    color *= global.exposure;

    // Tonemapping guard
    if (global.gamma != 1.0) {
        color = color / (color + vec3f(1.0)); // Reinhard
    }

    // Gamma Correction (converts linear to sRGB for the render target)
    color = linearToSRGB(color);

    [WGSL_FOG_CALC]
    return vec4f(color, finalAlpha);
}