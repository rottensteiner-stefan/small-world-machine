@fragment fn fs(i: Out) -> @location(0) vec4f {
    // The alpha map shares the carrier texture's transform (repeat, offset, rotation): it samples the same
    // transformed i.uv as the diffuse map. Dividing by texRepeat only undid the scale and broke under
    // rotation/offset.
    let diffuseTex = textureSample(u_diffuseMap, s, i.uv);
    let albedo = sRGBToLinear(diffuseTex.rgb) * sRGBToLinear(obj.color.rgb);
    let metallic = obj.metallic * textureSample(u_metallicMap, s, i.uv).b;
    var roughness = clamp(obj.roughness * textureSample(u_roughnessMap, s, i.uv).g, 0.05, 1.0);
    let ao = obj.extraParams.x * textureSample(u_aoMap, s, i.uv).r;
#ifdef USE_UNLIT
    // KHR_materials_unlit: flat base color -- no direct lighting, no IBL, no emissive, no
    // reflection/transmission. The exposure + tonemapping + sRGB tail below still applies so an
    // unlit material obeys the same post-processing contracts as lit ones. `albedo` and the
    // diffuse/alpha reads above stay shared with the lit path.
    var color = albedo;
#else
    [WGSL_PBR_LIGHTING]

    if (obj.useReflectionMap > 0.5) {
        let clipPos = global.vp * vec4f(i.wp, 1.0);
        let ndc = clipPos.xy / clipPos.w;
        let screenUV = vec2f(ndc.x * 0.5 + 0.5, ndc.y * -0.5 + 0.5); // WebGPU Y is down
        // A02: cancel the forward-capture exposure like the liquid-mirror path (identity when post
        // owns the tail -- renderer forces global.exposure = 1.0); the reflection map is a planar
        // reflection snapshot written through the same forward pass as the opaque capture.
        let reflectionColor = targetToLinear(textureSample(u_reflectionMap, s, screenUV).rgb) / max(global.exposure, 0.001);
        let V_dir = normalize(global.viewPos.xyz - i.wp);
        let dotNV_refl = max(dot(normalize(i.n), V_dir), 0.0);
        let F0_refl = mix(vec3f(0.04), albedo, metallic);
        let F_refl = F_Schlick(dotNV_refl, F0_refl).x;
        // obj.matParam0.x (repurposed as reflectionFresnelBlend, see StandardMaterial.ts) picks
        // how much of the reflection's strength comes from view angle at all: 0 = constant
        // regardless of angle, 1 = pure Schlick Fresnel (its (1-cosTheta)^5 term stays low across
        // most of the angle range and only rises steeply in the last few degrees before grazing
        // incidence -- physically correct for a dielectric, but reads as an on/off switch to a
        // human observer rather than a gradual falloff). Materials wanting a reflection that stays
        // legible across a wider range of angles (see the Showcase 30 puddle) should lower this
        // well below 0.5.
        let f = obj.reflectivity * mix(1.0, F_refl, obj.matParam0.x);
        color = mix(color, reflectionColor, f);
    }
    // KHR_materials_transmission/volume is resolved inside the PBR lighting chunk (USE_TRANSMISSION),
    // mirroring the WebGL2 light_calc_pbr chunk: the BTDF replaces the diffuse lobe there.
#endif
    let finalAlpha = obj.color.a * diffuseTex.a * textureSample(u_alphaMap, s, i.uv).r;
    if (finalAlpha < obj.extraParams.y) {
        discard;
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
    let tint = select(vec3f(1.0, 1.0, 1.0), i.instColor.rgb, USE_INSTANCE_COLOR);
    return vec4f(color * tint, finalAlpha);
}