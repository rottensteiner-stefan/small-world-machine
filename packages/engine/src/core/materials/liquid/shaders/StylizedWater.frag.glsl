#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;

[LIGHT_DEFS]
[DIR_SHADOW]

uniform vec4 u_color;          // Shallow water color (RGBA)
uniform vec4 u_specColor;      // Deep water color (RGBA)
uniform vec2 u_texOffset;      // Edge/Shore color (R, G)
uniform vec2 u_texRepeat;      // Edge color (B), edgeSoftness
// Dedicated material parameter bank (512-byte layout slots)
uniform vec4 u_matParam0;         // [waterAbsorption.rgb, refractionStrength]
uniform vec4 u_matParam1;         // [foamColor.rgb, foamDistance]
uniform vec4 u_matParam2;         // [foamCutoff, foamNoiseScale, foamNoiseSpeed, unused]
uniform vec4 u_styleA;             // [rampSoftness, washAmount, lineDensity, lineWidth]
uniform vec4 u_styleB;             // [foamSoftness, skyTint, glitterStrength, styleId]
uniform float u_time;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_opaqueMap;
#ifdef USE_RAMP_LUT
uniform sampler2D u_rampMap;
#endif

out vec4 fragColor;

[LIQUID_WORLEY_NOISE]
[LIQUID_CAUSTICS]
[LIQUID_GLINT]
[WATER_EXT_DECL]

// Anti-aliased threshold: replaces a binary step() with a smoothstep ramp whose width tracks the
// local screen-space gradient (fwidth), so hard mask edges de-quantize instead of aliasing. The
// ramp only widens where the underlying value actually varies fast per pixel -- slow gradations
// stay pixel-sharp, which preserves the stylized toon identity (sharp edges, no jaggies/banding).
float aaStepMask(float edge, float value, float softness) {
    float width = max(fwidth(value) * 1.5, softness);
    return smoothstep(edge - width, edge + width, value);
}

void main() {
    vec3 shallowColor = sRGBToLinear(u_color.rgb);
    vec3 deepColor = sRGBToLinear(u_specColor.rgb);
    vec3 edgeColor = sRGBToLinear(vec3(u_texOffset.x, u_texOffset.y, u_texRepeat.x));
    float edgeSoftness = max(u_texRepeat.y, 0.001);
    float foamDistance = max(u_matParam1.a, 0.001);
    float refractionStrength = u_matParam0.a;

    // styleId map: 0 toon, 1 soft, 2 sparkle, 3 extension (Noir/Oil), 4 dredge, 5 bold
    float styleId = u_styleB.w;
    bool painterly = (styleId > 0.5 && styleId < 2.5) || styleId > 3.5;
    bool isSparkle = abs(styleId - 2.0) < 0.5;
    bool isExtension = abs(styleId - 3.0) < 0.5;
    bool isDredge = abs(styleId - 4.0) < 0.5;

    // 1. Depth buffer reading & exact linear depth delta
    vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueDepthMap, 0));
    float bgDepth = texture(u_opaqueDepthMap, screenUv).r;

    float near = u_cameraNearFar.x;
    float far = u_cameraNearFar.y;

    float ndcBg = bgDepth * 2.0 - 1.0;
    float linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));

    float ndcFrag = gl_FragCoord.z * 2.0 - 1.0;
    float linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));

    float depthDiff = max(linBgDepth - linFragDepth, 0.0);

    // 2. Screen-space Refraction (Masked strictly to depthDiff > 0.0)
    float refrDamping = clamp(depthDiff / 0.3, 0.0, 1.0);
    vec2 distortedUv = screenUv + (v_normal.xz * refractionStrength * refrDamping);
    float distortedBgDepth = texture(u_opaqueDepthMap, distortedUv).r;
    float ndcDistortedBg = distortedBgDepth * 2.0 - 1.0;
    float linDistortedBgDepth = (2.0 * near * far) / (far + near - ndcDistortedBg * (far - near));
    vec2 refractionUv = (linDistortedBgDepth > linFragDepth && abs(linDistortedBgDepth - linBgDepth) < 0.25) ? distortedUv : screenUv; // depth-discontinuity guard: no smear across pool walls

    vec3 opaqueUnderwaterColor = sRGBToLinear(texture(u_opaqueMap, refractionUv).rgb);

    // 3. Ground Position Reconstruction for Directional Caustics Projection
    vec3 viewDir = normalize(v_worldPos - u_viewPos);
    vec3 groundWorldPos = v_worldPos + viewDir * depthDiff;
    float groundShadow = sampleDirShadow(groundWorldPos, vec3(0.0, 1.0, 0.0));

    // Distorted Caustics UVs mapped to underwater ground
    float causticsDistortionStrength = 0.45;
    vec2 uvCaustics = groundWorldPos.xz + (v_normal.xz * causticsDistortionStrength);
    float causticsSpeed = u_matParam2.b * 0.75;

    float maxCausticsDepth = 6.0;
    float causticsFade = 1.0 - smoothstep(0.0, maxCausticsDepth, depthDiff);
    vec3 causticsColor = vec3(1.0, 0.98, 0.88);
    vec3 finalCaustics = vec3(0.0);
    vec3 illuminatedUnderwater = opaqueUnderwaterColor;

    if (u_styleB.w > 0.5) {
        // Anime / Ghibli F1-SmoothF1 cellular caustics network with bold pure white core + soft cyan halo
        vec2 warpedCaustics = waterDomainWarp(uvCaustics * (u_matParam2.g * 0.9), u_time * causticsSpeed);
        float lineSignal = waterCausticLine(warpedCaustics, 0.18);
        float causticHalo = smoothstep(0.30, 0.55, lineSignal);
        float causticCore = aaStepMask(0.62, lineSignal, 0.06);

        vec3 cyanHalo = isExtension ? vec3(0.7) : vec3(0.0, 0.88, 0.95);
        vec3 pureWhite = vec3(1.0, 1.0, 1.0);
        vec3 causticRgb = cyanHalo * (causticHalo * 0.55) + pureWhite * (causticCore * 1.0);

        // Compressed gain: a strong causticStrength brightens the net without clipping to flat cyan
        float causticGain = u_specColor.a / (1.0 + 0.5 * u_specColor.a);
        float underwaterLuma = dot(opaqueUnderwaterColor, vec3(0.299, 0.587, 0.114));
        float shadowMask = smoothstep(0.06, 0.24, underwaterLuma) * groundShadow;
        finalCaustics = causticRgb * causticsFade * causticGain * shadowMask;
        illuminatedUnderwater = opaqueUnderwaterColor * mix(vec3(0.82, 0.92, 0.98), vec3(1.0), 1.0 - causticCore * 0.45 * shadowMask) + finalCaustics;
    } else {
        // Legacy Dual-Chromatic Panning Voronoi noise
        vec2 causticsUv1 = uvCaustics * (u_matParam2.g * 0.85) + vec2(u_time * causticsSpeed, u_time * causticsSpeed * 0.5);
        vec2 causticsUv2 = uvCaustics * (u_matParam2.g * 1.1) - vec2(u_time * causticsSpeed * 0.6, u_time * causticsSpeed * 0.8);
        float causticsNoise1 = 1.0 - waterCellNoise(causticsUv1);
        float causticsNoise2 = 1.0 - waterCellNoise(causticsUv2);
        float causticsThreshold = 0.42;
        float underwaterLuma = dot(opaqueUnderwaterColor, vec3(0.299, 0.587, 0.114));
        float shadowMask = smoothstep(0.06, 0.24, underwaterLuma) * groundShadow;
        finalCaustics = vec3(aaStepMask(causticsThreshold, causticsNoise1 * causticsNoise2, 0.08)) * causticsFade * causticsColor * u_specColor.a * shadowMask;
        illuminatedUnderwater = opaqueUnderwaterColor + finalCaustics;
    }

    // 4. Stylized Beer-Lambert absorption & painted wash depth ramp
    vec3 waterAbsorption = u_matParam0.rgb;
    float washNoise = (waterCellNoise(v_worldPos.xz * 0.5 + vec2(u_time * 0.08, u_time * 0.04)) - 0.5) * u_styleA.y;
    float effDepth = max(depthDiff + washNoise * 1.5, 0.0);
    vec3 transmittance = exp(-effDepth * waterAbsorption);
    vec3 tintedSeabed = illuminatedUnderwater * shallowColor;
    vec3 inScatterCol = mix(shallowColor, deepColor, 0.35) * 0.15;
    vec3 underwaterLighting = tintedSeabed * transmittance + inScatterCol * (1.0 - transmittance);
    vec3 baseWaterColor = mix(deepColor, underwaterLighting, transmittance);

#ifdef USE_RAMP_LUT
    {
        // Ramp LUT (ADR 0026 route a): artist gradient replaces the hard-coded ramp, constant weight, no rampSoftness gate.
        const float RAMP_LUT_WEIGHT = 0.6;
        float rampT = clamp(effDepth / 4.0, 0.0, 1.0);
        vec3 lutColor = sRGBToLinear(texture(u_rampMap, vec2((rampT * 255.0 + 0.5) / 256.0, 0.5)).rgb);
        baseWaterColor = mix(baseWaterColor, lutColor, RAMP_LUT_WEIGHT);
    }
#else
    if (u_styleA.x > 0.05) {
        float rampT = clamp(effDepth / 4.0, 0.0, 1.0);
        vec3 midColor = mix(shallowColor, deepColor, 0.5) * vec3(0.9, 1.1, 1.05);
        vec3 softRamp = mix(shallowColor, midColor, smoothstep(0.0, 0.5, rampT));
        softRamp = mix(softRamp, deepColor, smoothstep(0.4, 1.0, rampT));
        baseWaterColor = mix(baseWaterColor, softRamp, u_styleA.x * 0.6);
    }
#endif

    // 5. Stylized Edge color transition
    float edgeBlend = 1.0 - clamp(depthDiff / edgeSoftness, 0.0, 1.0);
    float edgeAmount = 0.6;
    if (painterly) {
        // Painterly styles: weaker, noise-broken edge tint instead of a solid bright border
        edgeAmount = 0.2 * (0.5 + 0.8 * waterCellNoise(v_worldPos.xz * 1.7 + vec2(u_time * 0.05, 0.0)));
    }
    vec3 surfaceColor = mix(baseWaterColor, edgeColor, smoothstep(0.0, 1.0, edgeBlend) * edgeAmount);

    // 5b. Dredge murk: depth fog (styleId 4 only)
    float surfaceShadow = sampleDirShadow(v_worldPos, v_normal);
    if (isDredge) {
        vec3 fogColor = mix(shallowColor, deepColor, 0.6) * 0.9;
        float fogAmount = (1.0 - exp(-depthDiff * 0.9)) * 0.8;
        surfaceColor = mix(surfaceColor, fogColor, fogAmount) * mix(0.7, 1.0, surfaceShadow);
    }

    // 6. Fresnel & Specular + Star Glints
    vec3 camDir = normalize(u_viewPos - v_worldPos);
    float fresnel = pow(1.0 - clamp(dot(v_normal, camDir), 0.0, 1.0), 4.0);
    vec3 skyColor = vec3(0.65, 0.85, 1.0);
    float skyFactor = (u_styleB.w > 0.5) ? u_styleB.y : 0.45;
    surfaceColor = mix(surfaceColor, skyColor, fresnel * skyFactor);

    vec3 lightDir = normalize(u_dirLightDir);
    vec3 halfVector = normalize(lightDir + camDir);
    float nDotH = clamp(dot(v_normal, halfVector), 0.0, 1.0);
    // Toon-specular, a = specularStrength. Narrow cone: wave slopes are smooth over metres, a wide cone covers ~20 percent of the pool
    float specular = aaStepMask(0.9993, nDotH, 0.0005) * u_color.a * surfaceShadow;
    surfaceColor += u_dirLightColor * specular;

    if (u_styleB.z > 0.0) {
        float stepFps = isSparkle ? 8.0 : 12.0;
        float glint = waterGlintStar(v_worldPos.xz * 2.6, u_time * stepFps, nDotH) * u_styleB.z * surfaceShadow;
        surfaceColor += vec3(1.0, 0.92, 0.7) * glint * u_color.a;
    }

    // Stroke / Ripple lines
    if (u_styleA.z > 0.0) {
        float rippleLine;
        if (painterly) {
            // Painterly strokes: lineWidth = stroke thickness 0..1, phase warped by noise, broken up by a patch mask
            vec2 rp = v_worldPos.xz;
            float rippleWarp = sin(rp.x * 0.7 + u_time * 0.25) * 1.6 + cos(rp.y * 0.9 - u_time * 0.2) * 1.3 + (waterCellNoise(rp * 0.6) - 0.5) * 3.0;
            float rippleAngle = 0.6;
            float ripplePhase = sin(dot(rp, vec2(cos(rippleAngle), sin(rippleAngle))) * 7.0 + rippleWarp * 1.3 + u_time * 0.8);
            float strokeThreshold = cos(clamp(u_styleA.w, 0.02, 1.0) * 1.5708);
            float strokePatch = smoothstep(0.2, 0.55, 1.0 - waterCellNoise(rp * 0.5 + vec2(u_time * 0.05, 0.0)));
            rippleLine = aaStepMask(strokeThreshold, ripplePhase, 0.06) * strokePatch * u_styleA.z * (1.0 - smoothstep(0.0, 5.0, depthDiff));
        } else {
            float ripplePattern = sin((v_worldPos.x + v_worldPos.z) * u_styleA.w + u_time * 1.5);
            rippleLine = aaStepMask(0.75, ripplePattern, 0.05) * u_styleA.z * (1.0 - smoothstep(0.0, 5.0, depthDiff));
        }
        surfaceColor += edgeColor * rippleLine * 0.5;
    }

    if (isSparkle) {
        // Soft shoulder so saturated cyan keeps a gradient instead of clipping flat
        float sparkleLuma = dot(surfaceColor, vec3(0.299, 0.587, 0.114));
        surfaceColor = mix(vec3(sparkleLuma), surfaceColor, 0.92);
        surfaceColor = surfaceColor * 1.1 / (1.0 + 0.3 * surfaceColor);
    }

    // 7. Advanced Procedural Foam (Intersection/Shoreline Foam)
    vec3 foamColor = sRGBToLinear(u_matParam1.rgb);
    float foamCutoff = u_matParam2.r;
    float foamScale = u_matParam2.g;
    float foamSpeed = u_matParam2.b;
    float foamSoftness = (u_styleB.w > 0.5) ? max(u_styleB.x, 0.01) : 0.06;

    // 7a. Intersection / Shoreline Foam (Depth-Driven Dual Noise)
    vec2 uvFoam1 = v_worldPos.xz * foamScale + vec2(u_time * foamSpeed, u_time * foamSpeed * 0.4);
    vec2 uvFoam2 = v_worldPos.xz * (foamScale * 1.4) - vec2(u_time * foamSpeed * 0.5, u_time * foamSpeed * 0.8);
    float noise1 = 1.0 - waterCellNoise(uvFoam1);
    float noise2 = 1.0 - waterCellNoise(uvFoam2);
    float shoreFoamDepthMod = 1.0 - smoothstep(0.0, foamDistance, depthDiff);
    float shoreFoamMask = (noise1 * noise2) * shoreFoamDepthMod;
    if (painterly) {
        // Foam band hugging the shore instead of isolated bubbles; noise only roughens its inner edge
        shoreFoamMask = pow(shoreFoamDepthMod, 5.0) * mix(0.3, 1.7, clamp(noise1 * noise2 * 3.0, 0.0, 1.0));
    }
    float finalShoreFoam = aaStepMask(foamCutoff, shoreFoamMask, foamSoftness);
    if (painterly) {
        // Gentle rim: broken into tufts by noise and only partly opaque
        finalShoreFoam *= 0.2 * smoothstep(0.25, 0.65, noise1 + 0.35 * noise2);
    }

    // Dredge: murky foam that picks up the water colour instead of stark white
    vec3 shoreFoamColor = isDredge ? mix(foamColor, surfaceColor, 0.6) : foamColor;
    vec3 finalColor = mix(surfaceColor, shoreFoamColor, finalShoreFoam);

    [WATER_EXT_SURFACE]

    finalColor *= u_exposure;
    finalColor = linearToSRGB(finalColor);

    fragColor = vec4(finalColor, 1.0);
}
