fn oceanHash2(p: vec2f) -> f32 {
    let q = fract(p * vec2f(123.34, 456.21));
    let r = q + dot(q, q + 45.32);
    return fract(r.x * r.y);
}

fn oceanValueNoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = oceanHash2(i);
    let b = oceanHash2(i + vec2f(1.0, 0.0));
    let c = oceanHash2(i + vec2f(0.0, 1.0));
    let d = oceanHash2(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn oceanFoamFbm(p: vec2f) -> f32 {
    var v = 0.0;
    v += 0.55 * oceanValueNoise(p);
    v += 0.30 * oceanValueNoise(p * 2.13 + vec2f(17.3, -9.1));
    v += 0.15 * oceanValueNoise(p * 4.41 - vec2f(5.7, 13.4));
    return v;
}

@fragment
fn fs(i: Out) -> @location(0) vec4f {
    let waterColor = sRGBToLinear(obj.color.rgb);
    let deepWaterColor = sRGBToLinear(obj.specColor.rgb);
    let waterAbsorption = obj.matParam0.xyz;
    let refractionStrength = obj.matParam0.w;

    let foamColor = sRGBToLinear(obj.matParam1.xyz);
    let foamDistance = max(obj.matParam1.w, 0.001);

    let rawWind = obj.matParam2.xy;
    let windLen = length(rawWind);
    let windDir = select(vec2f(0.84, 0.54), rawWind / max(windLen, 1e-4), windLen > 1e-4);
    let windPerp = vec2f(-windDir.y, windDir.x);

    let swellFadeStart = obj.matParam3.x;
    let swellFadeEnd = max(obj.matParam3.y, swellFadeStart + 1.0);
    let foamCoverage = obj.matParam3.z;
    let detailScale = max(obj.matParam3.w, 0.05);

    let scatterColor = sRGBToLinear(obj.matParam4.xyz);
    let scatterStrength = max(obj.matParam4.w, 0.0);
    let detailStrength = max(obj.matParam5.x, 0.0);

    let viewVec = global.viewPos.xyz - i.wp;
    let camDist = length(viewVec);
    let horizDist = length(viewVec.xz);
    let V = viewVec / max(camDist, 1e-4);
    let radialFade = 1.0 - smoothstep(swellFadeStart, swellFadeEnd, horizDist);
    let detailFade = (1.0 - smoothstep(140.0, 950.0, camDist)) * (0.25 + 0.75 * radialFade);

    // Multi-scale normal cascade in world XZ (3 incommensurate rotated/scrolled octaves + capillary chop).
    let t = obj.time * max(obj.reflectivity, 0.15);
    let uvBase1 = i.wp.xz * (0.042 * detailScale) + windDir * (t * 0.055);
    let uvBase2 = vec2f(
        i.wp.x * 0.7071 - i.wp.z * 0.7071,
        i.wp.x * 0.7071 + i.wp.z * 0.7071
    ) * (0.115 * detailScale) + windPerp * (t * 0.085);
    let uvBase3 = vec2f(
        i.wp.x * 0.3827 + i.wp.z * 0.9239,
        -i.wp.x * 0.9239 + i.wp.z * 0.3827
    ) * (0.29 * detailScale) - windDir * (t * 0.125);

    var detailTangent = vec2f(0.0);
    var normalLen = 1.0;
#ifdef USE_NORMAL_MAP
    let nTex1 = textureSample(u_normalMap, s, uvBase1).xyz * 2.0 - 1.0;
    let nTex2 = textureSample(u_normalMap, s, uvBase2).xyz * 2.0 - 1.0;
    let nTex3 = textureSample(u_normalMap, s, uvBase3).xyz * 2.0 - 1.0;
    normalLen = clamp((length(nTex1) + length(nTex2) + length(nTex3)) * 0.333333, 0.5, 1.0);
    detailTangent = (nTex1.xy * 0.52 + nTex2.xy * 0.34 + nTex3.xy * 0.24) * detailStrength;
#else
    let r1 = i.wp.xz * (0.31 * detailScale) + windDir * (t * 1.15);
    let r2 = i.wp.xz * (0.57 * detailScale) - windPerp * (t * 0.92);
    detailTangent = (vec2f(cos(r1.x + r1.y * 0.7), sin(r1.y - r1.x * 0.6)) * 0.18 +
                     vec2f(sin(r2.x * 1.3 - r2.y), cos(r2.y * 1.1 + r2.x)) * 0.12) * detailStrength;
#endif
    detailTangent *= detailFade;

    var fftFoamAccum = 0.0;
#ifdef USE_OCEAN_FFT
    let patchSize = max(obj.matParam5.z, 16.0);
    let fftUvA = i.wp.xz / patchSize;
    let fftUvB = rot2D(i.wp.xz, 0.541) / (patchSize * 0.43) + vec2f(0.37, 0.71);
    let nfA = textureSample(u_oceanNormFoamMap, s, fftUvA);
    let nfB = textureSample(u_oceanNormFoamMap, s, fftUvB);
    let fftTiltB = rot2D(nfB.xy, -0.541);
    let fftTilt = (nfA.xy * 0.85 + fftTiltB * 0.42) * (0.18 + 0.82 * radialFade);
    detailTangent = detailTangent * 0.65 + fftTilt;
    fftFoamAccum = clamp(nfA.w * 0.85 + nfB.w * 0.45, 0.0, 1.0) * radialFade;
#endif

    let macroN = normalize(i.n);
    let rawPerturbedN = normalize(vec3f(
        macroN.x + detailTangent.x,
        max(macroN.y, 0.35),
        macroN.z + detailTangent.y
    ));
    let N = normalize(mix(vec3f(0.0, 1.0, 0.0), rawPerturbedN, 0.12 + 0.88 * radialFade));
    g_shadingNormal = N;

    // ADR 0051 Specular AA + gentle distance lobe widening prevents horizon specular sparkle
    let distRoughBoost = smoothstep(120.0, 950.0, camDist) * 0.16;
    let roughness = specularAntiAliasing(clamp(obj.roughness + distRoughBoost, 0.03, 0.98), N, normalLen, max(detailStrength, 0.2));

    // Pre-ocean solid depth & refraction capture (MainRenderPass opaque -> ocean ordering)
    let fragCoords = vec2<i32>(i.pos.xy);
    let bgDepth = textureLoad(u_opaqueDepthMap, fragCoords, 0);
    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;
    let linBgDepth = (2.0 * near * far) / max(far + near - (bgDepth * 2.0 - 1.0) * (far - near), 1e-4);
    let linFragDepth = (2.0 * near * far) / max(far + near - (i.pos.z * 2.0 - 1.0) * (far - near), 1e-4);
    let depthDiff = max(linBgDepth - linFragDepth, 0.0);

    let screenRes = vec2f(textureDimensions(u_opaqueDepthMap));
    let screenUv = i.pos.xy / screenRes;
    let refrDamping = clamp(depthDiff / 0.8, 0.0, 1.0);
    let distortedUv = clamp(
        screenUv + worldDirToScreen(vec3f(N.x, 0.0, N.z)) * refractionStrength * refrDamping,
        vec2f(0.001),
        vec2f(0.999)
    );
    let distortedDepth = textureLoad(u_opaqueDepthMap, vec2<i32>(distortedUv * screenRes), 0);
    let linDistortedDepth = (2.0 * near * far) / max(far + near - (distortedDepth * 2.0 - 1.0) * (far - near), 1e-4);
    let refractionUv = select(screenUv, distortedUv, linDistortedDepth > linFragDepth);
    let refractedColor = targetToLinear(textureSample(u_opaqueMap, s, refractionUv).rgb) / max(global.exposure, 0.001);

    let validShore = step(depthDiff, foamDistance * 2.8) * select(0.0, 1.0, bgDepth < 0.99995);
    let shallowAeration = (1.0 - smoothstep(0.0, foamDistance * 0.95, depthDiff)) * validShore * 0.28;
    let transmittance = exp(-depthDiff * waterAbsorption);
    let aeratedWater = mix(waterColor, scatterColor * 1.15, shallowAeration);
    let shallowScatter = mix(aeratedWater, refractedColor * mix(vec3f(1.0), aeratedWater, 0.5), 0.72);
    let waterBody = mix(deepWaterColor, shallowScatter, transmittance);

    // Schlick Fresnel (water F0 = 0.02) + horizon-clamped IBL + optional PlanarReflection
    let NdotV = max(dot(N, V), 0.001);
    let fresnel = 0.02 + 0.98 * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0);

    var reflDir = reflect(-V, N);
    reflDir.y = max(reflDir.y, 0.015);
    let envMip = clamp(roughness * 4.5, 0.0, 6.0);
    var envColor: vec3f;
    if (obj.useEnvMap > 0.5) {
        let envSample = textureSampleLevel(u_envMap, globalSampler, reflDir, envMip).rgb;
        envColor = select(sRGBToLinear(envSample), targetToLinear(envSample) / max(global.exposure, 0.001), obj.useEnvMap > 1.5);
    } else {
        envColor = sRGBToLinear(textureSampleLevel(u_prefilterMap, globalSampler, reflDir, envMip).rgb) * global.envIntensity;
    }

    if (obj.matParam9.x > 0.0) {
        let mirrorClip = global.vp * vec4f(i.wp, 1.0);
        let mirrorRawUv = (mirrorClip.xy / max(mirrorClip.w, 1e-4)) * vec2f(0.5, -0.5) + 0.5;
        let mirrorEdgeFade = smoothstep(0.0, 0.08, mirrorRawUv.x) * (1.0 - smoothstep(0.92, 1.0, mirrorRawUv.x)) *
                             smoothstep(0.0, 0.08, mirrorRawUv.y) * (1.0 - smoothstep(0.92, 1.0, mirrorRawUv.y));
        let mirrorDistFade = 1.0 - smoothstep(220.0, 520.0, camDist);
        let mirrorUv = clamp(mirrorRawUv + worldDirToScreen(vec3f(N.x, 0.0, N.z)) * obj.matParam9.y, vec2f(0.001), vec2f(0.999));
        let mirrorLod = clamp(obj.matParam9.z * 6.0, 0.0, 6.0);
        let mirror = targetToLinear(textureSampleLevel(u_reflectionMap, s, mirrorUv, mirrorLod).rgb) / max(global.exposure, 0.001);
        let mirrorWeight = obj.matParam9.x * mirrorEdgeFade * mirrorDistFade;
        envColor = mix(envColor, mirror, mirrorWeight);
    }

    // Subtle diffuse ambient sky lift in wave valleys so dark water retains volume
    let skyAmbient = sRGBToLinear(global.ambientColor.rgb) * waterColor * (0.35 + 0.65 * N.y);
    var baseColor = mix(waterBody + skyAmbient, envColor, fresnel);

    // Directional moonlight/sunlight GGX specular + secondary glint lobe + shadow
    let L = normalize(global.dirLightDir.xyz);
    let H = normalize(L + V);
    let NdotL = max(dot(N, L), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let surfaceShadow = sampleDirShadow(i.wp, N);

    let dBroad = D_GGX(NdotH, max(roughness, 0.07));
    let dGlint = D_GGX(NdotH, max(roughness * 0.42, 0.025));
    let gSpec = G_SchlickGGX(max(NdotL, 0.001), NdotV, roughness);
    let fSpec = 0.02 + 0.98 * pow(clamp(1.0 - max(dot(H, V), 0.0), 0.0, 1.0), 5.0);
    let specDenom = max(4.0 * NdotV * max(NdotL, 0.001), 0.001);
    let specVal = clamp(((dBroad * 0.48 + dGlint * 0.52) * gSpec * fSpec) / specDenom, 0.0, 12.0);
    baseColor += global.dirLightColor.rgb * specVal * NdotL * surfaceShadow;

    // Backlight crest subsurface scattering (Schüler / AC4 style)
    let sssForward = pow(clamp(dot(V, normalize(-L + N * 0.45)), 0.0, 1.0), 3.0);
    let crestStrength = clamp(max(i.original_uv.x, fftFoamAccum * 0.65), 0.0, 1.0);
    let sssFactor = crestStrength * (0.28 + 0.72 * sssForward) * (1.0 - fresnel * 0.6);
    let lightTint = max(global.dirLightColor.rgb, vec3f(0.18, 0.24, 0.34));
    baseColor += scatterColor * scatterStrength * sssFactor * lightTint;

    // Organic FBM whitecaps (crest + persistent FFT foam trails) + broken turbulent shoreline surf tongues
    let foamNoiseUv = i.wp.xz * 0.24 + windDir * (t * 0.18);
    let foamNoise = oceanFoamFbm(foamNoiseUv);
    let foamDetail = oceanFoamFbm(i.wp.xz * 0.88 - windPerp * (t * 0.26));
    let lacyFoam = smoothstep(0.36, 0.72, foamNoise * 0.65 + foamDetail * 0.35);

    let crestThresh = 0.64 - foamCoverage * 0.34;
    let crestCaps = smoothstep(crestThresh, crestThresh + 0.26, crestStrength * (0.55 + 0.65 * foamNoise)) * lacyFoam * radialFade * foamCoverage * 1.15;
    let whitecaps = max(crestCaps, fftFoamAccum * lacyFoam * foamCoverage * 1.35);

    let surgeCellA = oceanFoamFbm(i.wp.xz * 0.16 + windDir * (t * 0.22));
    let surgeCellB = oceanFoamFbm(i.wp.xz * 0.48 - windPerp * (t * 0.34) + vec2f(9.2, -4.1));
    let shoreDepthWarp = depthDiff + (surgeCellA - 0.48) * 1.95 + (surgeCellB - 0.5) * 1.15;
    let rockContactGap = smoothstep(0.0, 0.18, shoreDepthWarp + 0.12 * (surgeCellA - 0.4));
    let surfFront = (1.0 - smoothstep(0.08, foamDistance * 0.82, max(shoreDepthWarp, 0.0))) * rockContactGap;
    let surfCycle = 0.55 + 0.45 * sin(depthDiff * 2.1 - t * 2.7 + surgeCellA * 4.2);
    let denseSurf = surfFront * surfCycle * smoothstep(0.28, 0.76, lacyFoam * 0.72 + surgeCellB * 0.45);
    let wakeBand = (1.0 - smoothstep(foamDistance * 0.45, foamDistance * 1.75, max(shoreDepthWarp, 0.0))) *
                   smoothstep(0.05, 0.45, depthDiff);
    let lacyWake = wakeBand * smoothstep(0.46, 0.82, foamDetail * 0.65 + surgeCellA * 0.35) * 0.52;
    let shoreFoam = clamp(max(denseSurf, lacyWake), 0.0, 1.0) * validShore;

    let foamMask = clamp(max(whitecaps, shoreFoam), 0.0, 1.0);
    let litFoamColor = foamColor * (0.35 + 0.65 * NdotL * surfaceShadow) * max(global.dirLightColor.rgb, vec3f(0.45, 0.55, 0.72));
    var finalColor = mix(baseColor, litFoamColor, foamMask);

    // Distance horizon dissolution: in outer skirt match exact calm sky reflection cleanly
    let horizonBlend = smoothstep(swellFadeEnd * 0.65, swellFadeEnd, horizDist);
    let flatRefl = normalize(vec3f(-V.x, max(-V.y, 0.015), -V.z));
    var horizonEnv: vec3f;
    if (obj.useEnvMap > 0.5) {
        let hSample = textureSampleLevel(u_envMap, globalSampler, flatRefl, 0.5).rgb;
        horizonEnv = select(sRGBToLinear(hSample), targetToLinear(hSample) / max(global.exposure, 0.001), obj.useEnvMap > 1.5);
    } else {
        horizonEnv = sRGBToLinear(textureSampleLevel(u_prefilterMap, globalSampler, flatRefl, 0.5).rgb) * mix(global.envIntensity, 1.0, horizonBlend);
    }
    finalColor = mix(finalColor, horizonEnv, horizonBlend * 0.96);

    finalColor *= global.exposure;
    finalColor = forwardToneMap(finalColor);
    var color: vec3f = linearToSRGB(finalColor);
    [WGSL_FOG_CALC]

    return vec4f(color, 1.0);
}
