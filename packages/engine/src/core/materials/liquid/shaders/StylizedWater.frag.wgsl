[WGSL_LIQUID_WORLEY_NOISE]
[WGSL_LIQUID_CAUSTICS]
[WGSL_LIQUID_GLINT]
[WGSL_WATER_EXT_DECL]

// Anti-aliased threshold: replaces a binary step() with a smoothstep ramp whose width tracks the
// local screen-space gradient (fwidth), so hard mask edges de-quantize instead of aliasing. The
// ramp only widens where the underlying value actually varies fast per pixel -- slow gradations
// stay pixel-sharp, which preserves the stylized toon identity (sharp edges, no jaggies/banding).
fn aaStepMask(edge: f32, value: f32, softness: f32) -> f32 {
    let width = max(fwidth(value) * 1.5, softness);
    return smoothstep(edge - width, edge + width, value);
}

@fragment fn fs(i: Out) -> @location(0) vec4<f32> {
    let shallowColor = sRGBToLinear(obj.color.rgb);
    let deepColor = sRGBToLinear(obj.specColor.rgb);
    let edgeColor = sRGBToLinear(vec3<f32>(obj.texOffset.x, obj.texOffset.y, obj.texRepeat.x));
    let edgeSoftness = max(obj.texRepeat.y, 0.001);
    let foamDistance = max(obj.matParam1.w, 0.001);

    // styleId map: 0 toon, 1 soft, 2 sparkle, 3 extension (Noir/Oil), 4 dredge, 5 bold
    let styleId = obj.styleB.w;
    let painterly = (styleId > 0.5 && styleId < 2.5) || styleId > 3.5;
    let isSparkle = abs(styleId - 2.0) < 0.5;
    let isExtension = abs(styleId - 3.0) < 0.5;
    let isDredge = abs(styleId - 4.0) < 0.5;

    let fragPosCoords = vec2<i32>(i.pos.xy);
    let bgDepth = textureLoad(u_opaqueDepthMap, fragPosCoords, 0);

    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;

    let ndcBg = bgDepth * 2.0 - 1.0;
    let linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));

    let ndcFrag = i.pos.z * 2.0 - 1.0;
    let linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));

    let depthDiff = max(linBgDepth - linFragDepth, 0.0);

    // Screen-space Refraction (Masked strictly to depthDiff > 0.0)
    let screenRes = vec2<f32>(textureDimensions(u_opaqueDepthMap));
    let screenUv = i.pos.xy / screenRes;
    let refrDamping = clamp(depthDiff / 0.3, 0.0, 1.0);
    let distortedUv = screenUv + (i.n.xz * obj.matParam0.w * refrDamping);
    let distortedCoords = vec2<i32>(distortedUv * screenRes);
    let distortedBgDepth = textureLoad(u_opaqueDepthMap, distortedCoords, 0);
    let ndcDistortedBg = distortedBgDepth * 2.0 - 1.0;
    let linDistortedBgDepth = (2.0 * near * far) / (far + near - ndcDistortedBg * (far - near));
    let refractionUv = select(screenUv, distortedUv, linDistortedBgDepth > linFragDepth && abs(linDistortedBgDepth - linBgDepth) < 0.25); // depth-discontinuity guard: no smear across pool walls

    let opaqueUnderwaterColor = sRGBToLinear(textureSample(u_opaqueMap, s, refractionUv).rgb);

    // Ground Position Reconstruction for Directional Caustics Projection
    let viewDir = normalize(i.wp - global.viewPos.xyz);
    let groundWorldPos = i.wp + viewDir * depthDiff;
    let groundShadow = sampleDirShadow(groundWorldPos, vec3f(0.0, 1.0, 0.0));

    let causticsDistortionStrength = 0.45;
    let uvCaustics = groundWorldPos.xz + (i.n.xz * causticsDistortionStrength);
    let causticsSpeed = obj.matParam2.z * 0.75;

    let maxCausticsDepth = 6.0;
    let causticsFade = 1.0 - smoothstep(0.0, maxCausticsDepth, depthDiff);
    let causticsColor = vec3<f32>(1.0, 0.98, 0.88);
    var finalCaustics = vec3<f32>(0.0);
    var illuminatedUnderwater = opaqueUnderwaterColor;

    if (obj.styleB.w > 0.5) {
        let warpedCaustics = waterDomainWarp(uvCaustics * (obj.matParam2.y * 0.9), obj.time * causticsSpeed);
        let lineSignal = waterCausticLine(warpedCaustics, 0.18);
        let causticHalo = smoothstep(0.30, 0.55, lineSignal);
        let causticCore = aaStepMask(0.62, lineSignal, 0.06);

        let cyanHalo = select(vec3<f32>(0.0, 0.88, 0.95), vec3<f32>(0.7), isExtension);
        let pureWhite = vec3<f32>(1.0, 1.0, 1.0);
        let causticRgb = cyanHalo * (causticHalo * 0.55) + pureWhite * (causticCore * 1.0);

        // Compressed gain: a strong causticStrength brightens the net without clipping to flat cyan
        let causticGain = obj.specColor.a / (1.0 + 0.5 * obj.specColor.a);
        let underwaterLuma = dot(opaqueUnderwaterColor, vec3<f32>(0.299, 0.587, 0.114));
        let shadowMask = smoothstep(0.06, 0.24, underwaterLuma) * groundShadow;
        finalCaustics = causticRgb * causticsFade * causticGain * shadowMask;
        illuminatedUnderwater = opaqueUnderwaterColor * mix(vec3<f32>(0.82, 0.92, 0.98), vec3<f32>(1.0), 1.0 - causticCore * 0.45 * shadowMask) + finalCaustics;
    } else {
        let causticsUv1 = uvCaustics * (obj.matParam2.y * 0.85) + vec2<f32>(obj.time * causticsSpeed, obj.time * causticsSpeed * 0.5);
        let causticsUv2 = uvCaustics * (obj.matParam2.y * 1.1) - vec2<f32>(obj.time * causticsSpeed * 0.6, obj.time * causticsSpeed * 0.8);
        let causticsNoise1 = 1.0 - waterCellNoise(causticsUv1);
        let causticsNoise2 = 1.0 - waterCellNoise(causticsUv2);
        let causticsThreshold = 0.42;
        let underwaterLuma = dot(opaqueUnderwaterColor, vec3<f32>(0.299, 0.587, 0.114));
        let shadowMask = smoothstep(0.06, 0.24, underwaterLuma) * groundShadow;
        finalCaustics = vec3<f32>(aaStepMask(causticsThreshold, causticsNoise1 * causticsNoise2, 0.08)) * causticsFade * causticsColor * obj.specColor.a * shadowMask;
        illuminatedUnderwater = opaqueUnderwaterColor + finalCaustics;
    }

    // Parameters from 512-byte ObjectUniforms (obj.matParam0..2)
    let waterAbsorption = obj.matParam0.xyz;
    let washNoise = (waterCellNoise(i.wp.xz * 0.5 + vec2<f32>(obj.time * 0.08, obj.time * 0.04)) - 0.5) * obj.styleA.y;
    let effDepth = max(depthDiff + washNoise * 1.5, 0.0);
    let transmittance = exp(-effDepth * waterAbsorption);
    let tintedSeabed = illuminatedUnderwater * shallowColor;
    let inScatterCol = mix(shallowColor, deepColor, 0.35) * 0.15;
    let underwaterLighting = tintedSeabed * transmittance + inScatterCol * (1.0 - transmittance);
    var baseWaterColor = mix(deepColor, underwaterLighting, transmittance);

    if (USE_RAMP_LUT) {
        // Ramp LUT (ADR 0026 route a): artist gradient replaces the hard-coded ramp, constant weight, no rampSoftness gate.
        const RAMP_LUT_WEIGHT: f32 = 0.6;
        let rampT = clamp(effDepth / 4.0, 0.0, 1.0);
        let lutColor = sRGBToLinear(textureSampleLevel(u_rampMap, s, vec2<f32>((rampT * 255.0 + 0.5) / 256.0, 0.5), 0.0).rgb);
        baseWaterColor = mix(baseWaterColor, lutColor, RAMP_LUT_WEIGHT);
    } else if (obj.styleA.x > 0.05) {
        let rampT = clamp(effDepth / 4.0, 0.0, 1.0);
        let midColor = mix(shallowColor, deepColor, 0.5) * vec3<f32>(0.9, 1.1, 1.05);
        var softRamp = mix(shallowColor, midColor, smoothstep(0.0, 0.5, rampT));
        softRamp = mix(softRamp, deepColor, smoothstep(0.4, 1.0, rampT));
        baseWaterColor = mix(baseWaterColor, softRamp, obj.styleA.x * 0.6);
    }

    let edgeBlend = 1.0 - saturate(depthDiff / edgeSoftness);
    var edgeAmount = 0.6;
    if (painterly) {
        // Painterly styles: weaker, noise-broken edge tint instead of a solid bright border
        edgeAmount = 0.2 * (0.5 + 0.8 * waterCellNoise(i.wp.xz * 1.7 + vec2<f32>(obj.time * 0.05, 0.0)));
    }
    var surfaceColor = mix(baseWaterColor, edgeColor, smoothstep(0.0, 1.0, edgeBlend) * edgeAmount);

    // Dredge murk: depth fog (styleId 4 only)
    let surfaceShadow = sampleDirShadow(i.wp, i.n);
    if (isDredge) {
        let fogColor = mix(shallowColor, deepColor, 0.6) * 0.9;
        let fogAmount = (1.0 - exp(-depthDiff * 0.9)) * 0.8;
        surfaceColor = mix(surfaceColor, fogColor, fogAmount) * mix(0.7, 1.0, surfaceShadow);
    }

    let camDir = normalize(global.viewPos.xyz - i.wp);
    let fresnel = pow(1.0 - saturate(dot(i.n, camDir)), 4.0);
    let skyColor = vec3<f32>(0.65, 0.85, 1.0);
    let skyFactor = select(0.45, obj.styleB.y, obj.styleB.w > 0.5);
    surfaceColor = mix(surfaceColor, skyColor, fresnel * skyFactor);

    let lightDir = normalize(global.dirLightDir.xyz);
    let halfVector = normalize(lightDir + camDir);
    let nDotH = saturate(dot(i.n, halfVector));
    // Narrow cone: wave slopes are smooth over metres, a wide cone covers ~20 percent of the pool
    let specular = aaStepMask(0.9993, nDotH, 0.0005) * obj.color.a * surfaceShadow;
    surfaceColor += global.dirLightColor.rgb * specular;

    if (obj.styleB.z > 0.0) {
        let stepFps = select(12.0, 8.0, isSparkle);
        let glint = waterGlintStar(i.wp.xz * 2.6, obj.time * stepFps, nDotH) * obj.styleB.z * surfaceShadow;
        surfaceColor += vec3<f32>(1.0, 0.92, 0.7) * glint * obj.color.a;
    }

    if (obj.styleA.z > 0.0) {
        var rippleLine: f32;
        if (painterly) {
            // Painterly strokes: lineWidth = stroke thickness 0..1, phase warped by noise, broken up by a patch mask
            let rp = i.wp.xz;
            let rippleWarp = sin(rp.x * 0.7 + obj.time * 0.25) * 1.6 + cos(rp.y * 0.9 - obj.time * 0.2) * 1.3 + (waterCellNoise(rp * 0.6) - 0.5) * 3.0;
            let rippleAngle = 0.6;
            let ripplePhase = sin(dot(rp, vec2<f32>(cos(rippleAngle), sin(rippleAngle))) * 7.0 + rippleWarp * 1.3 + obj.time * 0.8);
            let strokeThreshold = cos(clamp(obj.styleA.w, 0.02, 1.0) * 1.5708);
            let strokePatch = smoothstep(0.2, 0.55, 1.0 - waterCellNoise(rp * 0.5 + vec2<f32>(obj.time * 0.05, 0.0)));
            rippleLine = aaStepMask(strokeThreshold, ripplePhase, 0.06) * strokePatch * obj.styleA.z * (1.0 - smoothstep(0.0, 5.0, depthDiff));
        } else {
            let ripplePattern = sin((i.wp.x + i.wp.z) * obj.styleA.w + obj.time * 1.5);
            rippleLine = aaStepMask(0.75, ripplePattern, 0.05) * obj.styleA.z * (1.0 - smoothstep(0.0, 5.0, depthDiff));
        }
        surfaceColor += edgeColor * rippleLine * 0.5;
    }

    if (isSparkle) {
        // Soft shoulder so saturated cyan keeps a gradient instead of clipping flat
        let sparkleLuma = dot(surfaceColor, vec3<f32>(0.299, 0.587, 0.114));
        surfaceColor = mix(vec3<f32>(sparkleLuma), surfaceColor, 0.92);
        surfaceColor = surfaceColor * 1.1 / (1.0 + 0.3 * surfaceColor);
    }

    let foamColor = sRGBToLinear(obj.matParam1.xyz);
    let foamCutoff = obj.matParam2.x;
    let foamScale = obj.matParam2.y;
    let foamSpeed = obj.matParam2.z;
    let foamSoftness = select(0.06, max(obj.styleB.x, 0.01), obj.styleB.w > 0.5);

    // Shoreline foam
    let uvFoam1 = i.wp.xz * foamScale + vec2<f32>(obj.time * foamSpeed, obj.time * foamSpeed * 0.4);
    let uvFoam2 = i.wp.xz * (foamScale * 1.4) - vec2<f32>(obj.time * foamSpeed * 0.5, obj.time * foamSpeed * 0.8);
    let noise1 = 1.0 - waterCellNoise(uvFoam1);
    let noise2 = 1.0 - waterCellNoise(uvFoam2);
    let shoreFoamDepthMod = 1.0 - smoothstep(0.0, foamDistance, depthDiff);
    var shoreFoamMask = (noise1 * noise2) * shoreFoamDepthMod;
    if (painterly) {
        // Foam band hugging the shore instead of isolated bubbles; noise only roughens its inner edge
        shoreFoamMask = pow(shoreFoamDepthMod, 5.0) * mix(0.3, 1.7, clamp(noise1 * noise2 * 3.0, 0.0, 1.0));
    }
    var finalShoreFoam = aaStepMask(foamCutoff, shoreFoamMask, foamSoftness);
    if (painterly) {
        // Gentle rim: broken into tufts by noise and only partly opaque
        finalShoreFoam = finalShoreFoam * 0.2 * smoothstep(0.25, 0.65, noise1 + 0.35 * noise2);
    }

    // Dredge: murky foam that picks up the water colour instead of stark white
    let shoreFoamColor = select(foamColor, mix(foamColor, surfaceColor, 0.6), isDredge);
    var finalColor = mix(surfaceColor, shoreFoamColor, finalShoreFoam);

    [WGSL_WATER_EXT_SURFACE]

    finalColor *= global.exposure;
    finalColor = linearToSRGB(finalColor);

    return vec4<f32>(finalColor, 1.0);
}
