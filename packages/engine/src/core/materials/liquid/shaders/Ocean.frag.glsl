#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in float v_crest;

[FOG_DEFS]
[LIGHT_DEFS]
[WORLD_DIR_TO_SCREEN]
[PBR_MATH]
[DIR_SHADOW]

uniform vec4 u_color;
uniform vec4 u_specColor;
uniform float u_roughness;
uniform float u_reflectivity;
uniform float u_time;
uniform float u_useEnvMap;
uniform vec4 u_matParam0; // [waterAbsorption.xyz, refractionStrength]
uniform vec4 u_matParam1; // [foamColor.rgb, foamDistance]
uniform vec4 u_matParam2; // [windDirX, windDirZ, waveScale, waveWavelength]
uniform vec4 u_matParam3; // [swellFadeStart, swellFadeEnd, foamCoverage, detailScale]
uniform vec4 u_matParam4; // [scatterColor.rgb, scatterStrength]
uniform vec4 u_matParam5; // [detailStrength, 0, 0, 0]
uniform vec4 u_matParam9; // [reflectionStrength, reflectionDistortion, reflectionRoughness, 0]

#ifdef USE_IBL
uniform samplerCube u_prefilterMap;
uniform float u_envIntensity;
#endif
uniform samplerCube u_envMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_opaqueMap;
uniform sampler2D u_reflectionMap;

out vec4 fragColor;
vec3 g_shadingNormal = vec3(0.0, 1.0, 0.0);

float oceanHash2(vec2 p) {
    vec2 q = fract(p * vec2(123.34, 456.21));
    q += dot(q, q + 45.32);
    return fract(q.x * q.y);
}

float oceanValueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = oceanHash2(i);
    float b = oceanHash2(i + vec2(1.0, 0.0));
    float c = oceanHash2(i + vec2(0.0, 1.0));
    float d = oceanHash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float oceanFoamFbm(vec2 p) {
    float v = 0.0;
    v += 0.55 * oceanValueNoise(p);
    v += 0.30 * oceanValueNoise(p * 2.13 + vec2(17.3, -9.1));
    v += 0.15 * oceanValueNoise(p * 4.41 - vec2(5.7, 13.4));
    return v;
}

// F1 Worley (cellular) distance: ~0 at bubble-cell centres, ~0.5..0.9 along cell borders.
float oceanFoamCells(vec2 p) {
    vec2 g = floor(p);
    vec2 f = fract(p);
    float m = 1.0;
    for (int oy = -1; oy <= 1; oy++) {
        for (int ox = -1; ox <= 1; ox++) {
            vec2 o = vec2(float(ox), float(oy));
            vec2 h = vec2(oceanHash2(g + o), oceanHash2(g + o + vec2(31.7, 17.3)));
            m = min(m, length(o + h - f));
        }
    }
    return m;
}

vec3 sampleOceanEnv(vec3 reflDir, float mip, float horizonMix) {
    if (u_useEnvMap > 0.5) {
        vec3 s = textureLod(u_envMap, reflDir, mip).rgb;
        return (u_useEnvMap > 1.5) ? (targetToLinear(s) / max(u_exposure, 0.001)) : sRGBToLinear(s);
    }
#ifdef USE_IBL
    return sRGBToLinear(textureLod(u_prefilterMap, reflDir, mip).rgb) * mix(u_envIntensity, 1.0, horizonMix);
#else
    float skyGrad = clamp(reflDir.y * 2.5, 0.0, 1.0);
    vec3 baseSky = sRGBToLinear(u_ambientColor);
    return mix(baseSky * 0.45, baseSky * 1.15, skyGrad);
#endif
}

void main() {
    vec3 waterColor = sRGBToLinear(u_color.rgb);
    vec3 deepWaterColor = sRGBToLinear(u_specColor.rgb);
    vec3 waterAbsorption = u_matParam0.xyz;
    float refractionStrength = u_matParam0.w;

    vec3 foamColor = sRGBToLinear(u_matParam1.rgb);
    float foamDistance = max(u_matParam1.a, 0.001);

    vec2 rawWind = u_matParam2.xy;
    float windLen = length(rawWind);
    vec2 windDir = (windLen > 1e-4) ? (rawWind / windLen) : vec2(0.84, 0.54);
    vec2 windPerp = vec2(-windDir.y, windDir.x);

    float swellFadeStart = u_matParam3.x;
    float swellFadeEnd = max(u_matParam3.y, swellFadeStart + 1.0);
    float foamCoverage = u_matParam3.z;
    float detailScale = max(u_matParam3.w, 0.05);

    vec3 scatterColor = sRGBToLinear(u_matParam4.rgb);
    float scatterStrength = max(u_matParam4.a, 0.0);
    float detailStrength = max(u_matParam5.x, 0.0);

    vec3 viewVec = u_viewPos - v_worldPos;
    float camDist = length(viewVec);
    float horizDist = length(viewVec.xz);
    vec3 V = viewVec / max(camDist, 1e-4);
    float radialFade = 1.0 - smoothstep(swellFadeStart, swellFadeEnd, horizDist);
    float detailFade = (1.0 - smoothstep(140.0, 950.0, camDist)) * (0.25 + 0.75 * radialFade);

    float t = u_time * max(u_reflectivity, 0.15);
    vec2 uvBase1 = v_worldPos.xz * (0.042 * detailScale) + windDir * (t * 0.055);
    vec2 uvBase2 = vec2(
        v_worldPos.x * 0.7071 - v_worldPos.z * 0.7071,
        v_worldPos.x * 0.7071 + v_worldPos.z * 0.7071
    ) * (0.115 * detailScale) + windPerp * (t * 0.085);
    vec2 uvBase3 = vec2(
        v_worldPos.x * 0.3827 + v_worldPos.z * 0.9239,
        -v_worldPos.x * 0.9239 + v_worldPos.z * 0.3827
    ) * (0.29 * detailScale) - windDir * (t * 0.125);

    vec2 detailTangent = vec2(0.0);
    float normalLen = 1.0;
#ifdef USE_NORMAL_MAP
    vec3 nTex1 = texture(u_normalMap, uvBase1).xyz * 2.0 - 1.0;
    vec3 nTex2 = texture(u_normalMap, uvBase2).xyz * 2.0 - 1.0;
    vec3 nTex3 = texture(u_normalMap, uvBase3).xyz * 2.0 - 1.0;
    normalLen = clamp((length(nTex1) + length(nTex2) + length(nTex3)) * 0.333333, 0.5, 1.0);
    detailTangent = (nTex1.xy * 0.52 + nTex2.xy * 0.34 + nTex3.xy * 0.24) * detailStrength;
#else
    vec2 r1 = v_worldPos.xz * (0.31 * detailScale) + windDir * (t * 1.15);
    vec2 r2 = v_worldPos.xz * (0.57 * detailScale) - windPerp * (t * 0.92);
    detailTangent = (vec2(cos(r1.x + r1.y * 0.7), sin(r1.y - r1.x * 0.6)) * 0.18 +
                     vec2(sin(r2.x * 1.3 - r2.y), cos(r2.y * 1.1 + r2.x)) * 0.12) * detailStrength;
#endif
    detailTangent *= detailFade;

    vec3 macroN = normalize(v_normal);
    vec3 rawPerturbedN = normalize(vec3(
        macroN.x + detailTangent.x,
        max(macroN.y, 0.35),
        macroN.z + detailTangent.y
    ));
    vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), rawPerturbedN, 0.12 + 0.88 * radialFade));
    g_shadingNormal = N;

    float distRoughBoost = smoothstep(120.0, 950.0, camDist) * 0.16;
    float roughness = specularAntiAliasing(clamp(u_roughness + distRoughBoost, 0.03, 0.98), N, normalLen, max(detailStrength, 0.2));

    vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueDepthMap, 0));
    float bgDepth = texture(u_opaqueDepthMap, screenUv).r;
    float near = u_cameraNearFar.x;
    float far = u_cameraNearFar.y;
    float linBgDepth = (2.0 * near * far) / max(far + near - (bgDepth * 2.0 - 1.0) * (far - near), 1e-4);
    float linFragDepth = (2.0 * near * far) / max(far + near - (gl_FragCoord.z * 2.0 - 1.0) * (far - near), 1e-4);
    float depthDiff = max(linBgDepth - linFragDepth, 0.0);

    float refrDamping = clamp(depthDiff / 0.8, 0.0, 1.0);
    vec2 distortedUv = clamp(screenUv + worldDirToScreen(vec3(N.x, 0.0, N.z)) * refractionStrength * refrDamping, vec2(0.001), vec2(0.999));
    float distortedBgDepth = texture(u_opaqueDepthMap, distortedUv).r;
    float linDistortedBgDepth = (2.0 * near * far) / max(far + near - (distortedBgDepth * 2.0 - 1.0) * (far - near), 1e-4);
    vec2 refractionUv = (linDistortedBgDepth > linFragDepth) ? distortedUv : screenUv;
    vec3 refractedColor = targetToLinear(texture(u_opaqueMap, refractionUv).rgb) / max(u_exposure, 0.001);

    float validShore = step(depthDiff, foamDistance * 2.8) * (bgDepth < 0.99995 ? 1.0 : 0.0);
    float shallowAeration = (1.0 - smoothstep(0.0, foamDistance * 0.95, depthDiff)) * validShore * 0.28;
    vec3 transmittance = exp(-depthDiff * waterAbsorption);
    vec3 aeratedWater = mix(waterColor, scatterColor * 1.15, shallowAeration);
    vec3 shallowScatter = mix(aeratedWater, refractedColor * mix(vec3(1.0), aeratedWater, 0.5), 0.72);
    vec3 waterBody = mix(deepWaterColor, shallowScatter, transmittance);

    float NdotV = max(dot(N, V), 0.001);
    float fresnel = 0.02 + 0.98 * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0);

    vec3 reflDir = reflect(-V, N);
    reflDir.y = max(reflDir.y, 0.015);
    float envMip = clamp(roughness * 4.5, 0.0, 6.0);
    vec3 envColor = sampleOceanEnv(reflDir, envMip, 0.0);

    if (u_matParam9.x > 0.0) {
        vec4 mirrorClip = u_vp * vec4(v_worldPos, 1.0);
        vec2 mirrorRawUv = (mirrorClip.xy / max(mirrorClip.w, 1e-4)) * 0.5 + 0.5;
        float mirrorEdgeFade = smoothstep(0.0, 0.08, mirrorRawUv.x) * (1.0 - smoothstep(0.92, 1.0, mirrorRawUv.x)) *
                               smoothstep(0.0, 0.08, mirrorRawUv.y) * (1.0 - smoothstep(0.92, 1.0, mirrorRawUv.y));
        float mirrorDistFade = 1.0 - smoothstep(220.0, 520.0, camDist);
        vec2 mirrorUv = clamp(mirrorRawUv + worldDirToScreen(vec3(N.x, 0.0, N.z)) * u_matParam9.y, vec2(0.001), vec2(0.999));
        float mirrorLod = clamp(u_matParam9.z * 6.0, 0.0, 6.0);
        vec3 mirror = targetToLinear(textureLod(u_reflectionMap, mirrorUv, mirrorLod).rgb) / max(u_exposure, 0.001);
        float mirrorWeight = u_matParam9.x * mirrorEdgeFade * mirrorDistFade;
        envColor = mix(envColor, mirror, mirrorWeight);
    }

    vec3 skyAmbient = sRGBToLinear(u_ambientColor) * waterColor * (0.35 + 0.65 * N.y);
    vec3 baseColor = mix(waterBody + skyAmbient, envColor, fresnel);

    vec3 L = normalize(u_dirLightDir);
    vec3 H = normalize(L + V);
    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float surfaceShadow = sampleDirShadow(v_worldPos, N);

    float dBroad = D_GGX(NdotH, max(roughness, 0.07));
    float dGlint = D_GGX(NdotH, max(roughness * 0.42, 0.025));
    float gSpec = G_SchlickGGX(max(NdotL, 0.001), NdotV, roughness);
    float fSpec = 0.02 + 0.98 * pow(clamp(1.0 - max(dot(H, V), 0.0), 0.0, 1.0), 5.0);
    float specDenom = max(4.0 * NdotV * max(NdotL, 0.001), 0.001);
    float specVal = clamp(((dBroad * 0.48 + dGlint * 0.52) * gSpec * fSpec) / specDenom, 0.0, 12.0);
    baseColor += u_dirLightColor * specVal * NdotL * surfaceShadow;

    float sssForward = pow(clamp(dot(V, normalize(-L + N * 0.45)), 0.0, 1.0), 3.0);
    float sssFactor = v_crest * (0.28 + 0.72 * sssForward) * (1.0 - fresnel * 0.6);
    vec3 lightTint = max(u_dirLightColor, vec3(0.18, 0.24, 0.34));
    baseColor += scatterColor * scatterStrength * sssFactor * lightTint;

    vec2 foamNoiseUv = v_worldPos.xz * 0.24 + windDir * (t * 0.18);
    float foamNoise = oceanFoamFbm(foamNoiseUv);
    float foamDetail = oceanFoamFbm(v_worldPos.xz * 0.88 - windPerp * (t * 0.26));
    float lacyFoam = smoothstep(0.36, 0.72, foamNoise * 0.65 + foamDetail * 0.35);
    float foamCell = oceanFoamCells(v_worldPos.xz * 1.35 + windDir * (t * 0.12));
    float foamLace = mix(1.0, smoothstep(0.06, 0.46, foamCell), 0.6 * detailFade);
    float windStreak = oceanFoamFbm(vec2(dot(v_worldPos.xz, windDir) * 0.22 - t * 0.35, dot(v_worldPos.xz, windPerp) * 1.35));
    float streakMod = 0.62 + 0.75 * smoothstep(0.3, 0.7, windStreak);
    float crestTexture = clamp(lacyFoam * foamLace * streakMod, 0.0, 1.0);

    float crestThresh = 0.64 - foamCoverage * 0.34;
    float crestCaps = smoothstep(crestThresh, crestThresh + 0.26, v_crest * (0.55 + 0.65 * foamNoise)) * crestTexture * radialFade * foamCoverage * 1.15;
    float whitecaps = crestCaps;

    float surgeCellA = oceanFoamFbm(v_worldPos.xz * 0.16 + windDir * (t * 0.22));
    float surgeCellB = oceanFoamFbm(v_worldPos.xz * 0.48 - windPerp * (t * 0.34) + vec2(9.2, -4.1));
    float shoreDepthWarp = depthDiff + (surgeCellA - 0.48) * 1.95 + (surgeCellB - 0.5) * 1.15;
    float rockContactGap = smoothstep(0.0, 0.18, shoreDepthWarp + 0.12 * (surgeCellA - 0.4));
    float surfFront = (1.0 - smoothstep(0.08, foamDistance * 0.82, max(shoreDepthWarp, 0.0))) * rockContactGap;
    float surfCycle = 0.55 + 0.45 * sin(depthDiff * 2.1 - t * 2.7 + surgeCellA * 4.2);
    // Bore front: a sawtooth phase whose constant-phase contours travel toward the rock as t grows;
    // the sharp leading edge reads as a breaking wave front, the long tail as receding foam.
    float borePhase = fract(t * 0.21 + depthDiff * 0.35 + surgeCellA * 0.9);
    float boreFront = smoothstep(0.0, 0.07, borePhase) * (1.0 - smoothstep(0.07, 0.55, borePhase));
    float denseSurf = surfFront * max(surfCycle * 0.6, boreFront) * smoothstep(0.28, 0.76, lacyFoam * foamLace * 0.72 + surgeCellB * 0.45);
    float wakeBand = (1.0 - smoothstep(foamDistance * 0.45, foamDistance * 1.75, max(shoreDepthWarp, 0.0))) *
                     smoothstep(0.05, 0.45, depthDiff);
    float lacyWake = wakeBand * smoothstep(0.46, 0.82, foamDetail * 0.65 + surgeCellA * 0.35) * 0.52;
    float shoreFoam = clamp(max(denseSurf, lacyWake), 0.0, 1.0) * validShore;
    // Short-lived bright flash where the bore front hits the rock; >1 so Bloom picks it up.
    float contactSplash = boreFront * (1.0 - smoothstep(0.0, foamDistance * 0.5, max(shoreDepthWarp, 0.0))) * rockContactGap * validShore;

    float foamMask = clamp(max(whitecaps, shoreFoam), 0.0, 1.0);
    vec3 foamLight = foamColor * (0.35 + 0.65 * NdotL * surfaceShadow) * max(u_dirLightColor, vec3(0.45, 0.55, 0.72));
    vec3 litFoamColor = (foamLight + foamColor * sRGBToLinear(u_ambientColor) * 0.7) * (1.0 + contactSplash * 1.1);
    vec3 finalColor = mix(baseColor, litFoamColor, foamMask);

    float horizonBlend = smoothstep(swellFadeEnd * 0.65, swellFadeEnd, horizDist);
    vec3 flatRefl = normalize(vec3(-V.x, max(-V.y, 0.015), -V.z));
    vec3 horizonEnv = sampleOceanEnv(flatRefl, 0.5, horizonBlend);
    finalColor = mix(finalColor, horizonEnv, horizonBlend * 0.96);

    finalColor *= u_exposure;
    finalColor = forwardToneMap(finalColor);
    fragColor = vec4(linearToSRGB(finalColor), 1.0);
    [FOG_CALC]
}
