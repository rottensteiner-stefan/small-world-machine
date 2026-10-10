[WGSL_LIQUID_WORLEY_NOISE]

@fragment fn fs(i: Out) -> @location(0) vec4<f32> {
    let waterColor = sRGBToLinear(obj.color.rgb);
    let deepWaterColor = sRGBToLinear(obj.specColor.rgb);

    let edgeColor = vec3<f32>(obj.texOffset.x, obj.texOffset.y, obj.texRepeat.x);
    let edgeSoftness = max(obj.texRepeat.y, 0.001);
    // Parameters unpacked from 512-byte ObjectUniforms (obj.matParam0..2)
    let waterAbsorption = obj.matParam0.xyz;
    let refractionStrength = obj.matParam0.w;
    let foamColor = sRGBToLinear(obj.matParam1.xyz);
    let foamDistance = max(obj.matParam1.w, 0.001);
    let foamCutoff = obj.matParam2.x;
    let foamNoiseScale = obj.matParam2.y;
    let foamNoiseSpeed = obj.matParam2.z;

    let fragPosCoords = vec2<i32>(i.pos.xy);
    let bgDepth = textureLoad(u_opaqueDepthMap, fragPosCoords, 0);

    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;

    let ndcBg = bgDepth * 2.0 - 1.0;
    let linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));

    let ndcFrag = i.pos.z * 2.0 - 1.0;
    let linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));

    let depthDiff = max(linBgDepth - linFragDepth, 0.0);

    // Screen-space refraction: distort the sample point by the wave normal's horizontal components.
    // If the distorted sample lands in front of the water surface, fall back to the undistorted texel.
    let screenRes = vec2<f32>(textureDimensions(u_opaqueDepthMap));
    let screenUv = i.pos.xy / screenRes;
    let refrDamping = clamp(depthDiff / 0.3, 0.0, 1.0);
    let distortedUv = screenUv + (i.n.xz * refractionStrength * refrDamping);
    let distortedCoords = vec2<i32>(distortedUv * screenRes);
    let distortedBgDepth = textureLoad(u_opaqueDepthMap, distortedCoords, 0);
    let ndcDistortedBg = distortedBgDepth * 2.0 - 1.0;
    let linDistortedBgDepth = (2.0 * near * far) / (far + near - ndcDistortedBg * (far - near));
    let refractionUv = select(screenUv, distortedUv, linDistortedBgDepth > linFragDepth);

    let refractedColor = sRGBToLinear(textureSample(u_opaqueMap, s, refractionUv).rgb);

    // Beer-Lambert absorption: light traveling through `depthDiff` units of water loses each
    // color channel at its own exponential rate (waterAbsorption). Ambient in-scattering prevents
    // unnatural blackness in deep or shaded regions.
    let transmittance = exp(-depthDiff * waterAbsorption);
    let tintedSeabed = refractedColor * mix(vec3<f32>(1.0), waterColor, 0.6);
    let inScatterCol = mix(waterColor, deepWaterColor, 0.35) * 0.15;
    let underwaterLighting = tintedSeabed * transmittance + inScatterCol * (1.0 - transmittance);
    var baseColor = mix(deepWaterColor, underwaterLighting, transmittance);

    // Squared falloff, capped at 0.55: the edge colour tints the shoreline instead of blowing it out to white.
    let edgeBlend = pow(1.0 - saturate(depthDiff / edgeSoftness), 2.0) * 0.4;

    let viewDir = normalize(global.viewPos.xyz - i.wp);
    let fresnel = pow(1.0 - saturate(dot(i.n, viewDir)), 5.0);
    let skyColor = vec3<f32>(0.6, 0.8, 1.0);
    baseColor = mix(baseColor, skyColor, fresnel * 0.5);

    let lightDir = normalize(global.dirLightDir.xyz);
    let halfVector = normalize(lightDir + viewDir);
    let nDotH = saturate(dot(i.n, halfVector));
    let surfaceShadow = sampleDirShadow(i.wp, i.n);
    let specular = pow(nDotH, 1200.0) * 0.8 * surfaceShadow;
    baseColor += global.dirLightColor.rgb * specular;

    let edgeColLinear = sRGBToLinear(edgeColor);
    var finalColor = mix(baseColor, edgeColLinear, edgeBlend);

    // Procedural foam: an anisotropic lace pattern drifting in world-space XZ, masked to its own
    // shoreline/intersection band (foamDistance).
    let foamBlend = pow(1.0 - saturate(depthDiff / foamDistance), 2.0);
    let foamUv = i.wp.xz * foamNoiseScale + obj.time * foamNoiseSpeed;
    let foamCell = waterCellNoise(foamUv);
    let foamPattern = 1.0 - smoothstep(foamCutoff, foamCutoff + 0.15, foamCell);

    // Splash pulse: modulates intersection foam intensity over time instead of a static band
    let splashPhase = dot(normalize(vec2<f32>(1.0, 0.4)), i.wp.xz) * 0.8 - obj.time * 1.6;
    let splashPulse = 0.6 + 0.4 * sin(splashPhase);
    let foamMask = foamPattern * foamBlend * splashPulse * 0.65;

    // Wave-crest foam from vertex Jacobian metric
    const CREST_FOAM_THRESHOLD_LOW: f32 = 0.65;
    const CREST_FOAM_THRESHOLD_HIGH: f32 = 0.95;
    const CREST_FOAM_INTENSITY: f32 = 0.9;
    let crestCell2 = waterCellNoise(foamUv * 2.7 + 11.0);
    let crestMask = smoothstep(CREST_FOAM_THRESHOLD_LOW, CREST_FOAM_THRESHOLD_HIGH, i.original_uv.x);
    let crestLace = max(smoothstep(0.35, 0.85, foamCell), smoothstep(0.35, 0.85, crestCell2));
    let crestFoam = clamp(crestMask * crestLace + crestMask * crestMask * 0.6, 0.0, 1.0) * CREST_FOAM_INTENSITY;
    let foamMaskFinal = max(foamMask, crestFoam);

    finalColor = mix(finalColor, foamColor, foamMaskFinal);

    // Ground-projected caustics: cells are anchored to the pool floor by following the sun ray
    // (not the view ray, which smeared them radially along the walls). Own scale, independent of foam.
    const CAUSTICS_MAX_DEPTH: f32 = 3.0;
    const CAUSTICS_SCALE: f32 = 1.4;
    const CAUSTICS_GAIN: f32 = 0.1;
    const CAUSTICS_FADE_EXPONENT: f32 = 0.7;
    const CAUSTICS_LIGHT_TINT: vec3<f32> = vec3<f32>(1.0, 0.98, 0.88);

    let toLight = normalize(global.dirLightDir.xyz);
    let causticsDepth = min(depthDiff, CAUSTICS_MAX_DEPTH);
    let lightVertical = max(abs(toLight.y), 0.3);
    let groundXZ = i.wp.xz - toLight.xz * (causticsDepth / lightVertical);
    let groundPos = vec3<f32>(groundXZ.x, i.wp.y - causticsDepth, groundXZ.y);
    let groundShadow = sampleDirShadow(groundPos, vec3<f32>(0.0, 1.0, 0.0));

    let causticsUv1 = (groundXZ + i.n.xz * 0.25) * CAUSTICS_SCALE + vec2<f32>(obj.time * foamNoiseSpeed * 0.35, obj.time * foamNoiseSpeed * 0.2);
    let causticsUv2 = (groundXZ - i.n.xz * 0.2) * (CAUSTICS_SCALE * 1.4) - vec2<f32>(obj.time * foamNoiseSpeed * 0.25, obj.time * foamNoiseSpeed * 0.4);
    let caustics1 = 1.0 - waterCellNoise(causticsUv1);
    let caustics2 = 1.0 - waterCellNoise(causticsUv2);
    let causticsValue = pow(caustics1 * caustics2, 1.6) * 3.2;
    let causticsFade = exp(-depthDiff * CAUSTICS_FADE_EXPONENT) * smoothstep(0.05, 0.4, depthDiff);
    let underwaterLuma = dot(refractedColor, vec3<f32>(0.299, 0.587, 0.114));
    let shadowMask = smoothstep(0.05, 0.22, underwaterLuma) * groundShadow;
    let causticsLight = CAUSTICS_LIGHT_TINT * causticsValue * causticsFade * shadowMask * CAUSTICS_GAIN;
    finalColor += causticsLight;

    finalColor *= global.exposure;
    finalColor = linearToSRGB(finalColor);

    return vec4<f32>(finalColor, 1.0);
}
