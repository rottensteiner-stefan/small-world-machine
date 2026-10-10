#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in float v_crest;

[LIGHT_DEFS]
[DIR_SHADOW]

uniform vec4 u_color;
uniform vec4 u_specColor;
uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;
// Dedicated material parameter bank (512-byte layout slots)
uniform vec4 u_matParam0; // [waterAbsorption.rgb, refractionStrength]
uniform vec4 u_matParam1; // [foamColor.rgb, foamDistance]
uniform vec4 u_matParam2; // [foamCutoff, foamNoiseScale, foamNoiseSpeed, poolHalfExtent (vertex stage)]
uniform float u_time;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_opaqueMap;

out vec4 fragColor;

[LIQUID_WORLEY_NOISE]

void main() {
    vec3 waterColor = sRGBToLinear(u_color.rgb);
    vec3 deepWaterColor = sRGBToLinear(u_specColor.rgb);

    vec3 edgeColor = vec3(u_texOffset.x, u_texOffset.y, u_texRepeat.x);
    float edgeSoftness = max(u_texRepeat.y, 0.001);

    // Unpack from dedicated material parameter slots (512-byte layout)
    vec3 waterAbsorption = u_matParam0.rgb;
    float refractionStrength = u_matParam0.a;
    vec3 foamColor = sRGBToLinear(u_matParam1.rgb);
    float foamDistance = max(u_matParam1.a, 0.001);
    float foamCutoff = u_matParam2.r;
    float foamNoiseScale = u_matParam2.g;
    float foamNoiseSpeed = u_matParam2.b;

    // texture() (not texelFetch) so the 1x1 fallback texture's CLAMP_TO_EDGE wrap mode kicks
    // in correctly when no real depth capture exists -- texelFetch has no such fallback and
    // returns 0 for any out-of-range texel, which a 1x1 texture always is at full-res coords.
    vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueDepthMap, 0));
    float bgDepth = texture(u_opaqueDepthMap, screenUv).r;

    float near = u_cameraNearFar.x;
    float far = u_cameraNearFar.y;

    float ndcBg = bgDepth * 2.0 - 1.0;
    float linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));

    float ndcFrag = gl_FragCoord.z * 2.0 - 1.0;
    float linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));

    float depthDiff = max(linBgDepth - linFragDepth, 0.0);

    // Screen-space refraction: distort the sample point by the wave normal's horizontal
    // components, damped in shallow depth to prevent edge tear.
    float refrDamping = clamp(depthDiff / 0.3, 0.0, 1.0);
    vec2 distortedUv = screenUv + (v_normal.xz * refractionStrength * refrDamping);
    float distortedBgDepth = texture(u_opaqueDepthMap, distortedUv).r;
    float ndcDistortedBg = distortedBgDepth * 2.0 - 1.0;
    float linDistortedBgDepth = (2.0 * near * far) / (far + near - ndcDistortedBg * (far - near));
    vec2 refractionUv = (linDistortedBgDepth > linFragDepth) ? distortedUv : screenUv;

    vec3 refractedColor = sRGBToLinear(texture(u_opaqueMap, refractionUv).rgb);

    // Beer-Lambert absorption: light traveling through `depthDiff` units of water loses each
    // color channel at its own exponential rate (waterAbsorption). Ambient in-scattering prevents
    // unnatural blackness in deep or shaded regions.
    vec3 transmittance = exp(-depthDiff * waterAbsorption);
    vec3 tintedSeabed = refractedColor * mix(vec3(1.0), waterColor, 0.6);
    vec3 inScatterCol = mix(waterColor, deepWaterColor, 0.35) * 0.15;
    vec3 underwaterLighting = tintedSeabed * transmittance + inScatterCol * (1.0 - transmittance);
    vec3 baseColor = mix(deepWaterColor, underwaterLighting, transmittance);

    // Squared falloff, capped at 0.55: the edge colour tints the shoreline instead of blowing it out to white.
    float edgeBlend = pow(1.0 - clamp(depthDiff / edgeSoftness, 0.0, 1.0), 2.0) * 0.4;

    vec3 viewDir = normalize(u_viewPos - v_worldPos);
    float fresnel = pow(1.0 - clamp(dot(v_normal, viewDir), 0.0, 1.0), 5.0);
    vec3 skyColor = vec3(0.6, 0.8, 1.0);
    baseColor = mix(baseColor, skyColor, fresnel * 0.5);

    const float SPECULAR_EXPONENT = 1200.0;
    const float SPECULAR_INTENSITY = 0.8;
    vec3 lightDir = normalize(u_dirLightDir);
    vec3 halfVector = normalize(lightDir + viewDir);
    float nDotH = clamp(dot(v_normal, halfVector), 0.0, 1.0);
    float surfaceShadow = sampleDirShadow(v_worldPos, v_normal);
    float specular = pow(nDotH, SPECULAR_EXPONENT) * SPECULAR_INTENSITY * surfaceShadow;
    baseColor += u_dirLightColor * specular;

    vec3 edgeColLinear = sRGBToLinear(edgeColor);
    vec3 finalColor = mix(baseColor, edgeColLinear, edgeBlend);

    // Procedural foam: an anisotropic lace pattern drifting in world-space XZ, masked to its own
    // shoreline/intersection band (foamDistance).
    float foamBlend = pow(1.0 - clamp(depthDiff / foamDistance, 0.0, 1.0), 2.0);
    vec2 foamUv = v_worldPos.xz * foamNoiseScale + u_time * foamNoiseSpeed;
    float foamCell = waterCellNoise(foamUv);
    float foamPattern = 1.0 - smoothstep(foamCutoff, foamCutoff + 0.15, foamCell);

    // Splash pulse: modulates intersection foam intensity over time instead of a static band
    float splashPhase = dot(normalize(vec2(1.0, 0.4)), v_worldPos.xz) * 0.8 - u_time * 1.6;
    float splashPulse = 0.6 + 0.4 * sin(splashPhase);
    float foamMask = foamPattern * foamBlend * splashPulse * 0.65;

    // Wave-crest foam from vertex Jacobian metric
    const float CREST_FOAM_THRESHOLD_LOW = 0.65;
    const float CREST_FOAM_THRESHOLD_HIGH = 0.95;
    const float CREST_FOAM_INTENSITY = 0.9;
    float crestCell2 = waterCellNoise(foamUv * 2.7 + 11.0);
    float crestMask = smoothstep(CREST_FOAM_THRESHOLD_LOW, CREST_FOAM_THRESHOLD_HIGH, v_crest);
    float crestLace = max(smoothstep(0.35, 0.85, foamCell), smoothstep(0.35, 0.85, crestCell2));
    float crestFoam = clamp(crestMask * crestLace + crestMask * crestMask * 0.6, 0.0, 1.0) * CREST_FOAM_INTENSITY;
    foamMask = max(foamMask, crestFoam);

    finalColor = mix(finalColor, foamColor, foamMask);

    // Ground-projected caustics: cells are anchored to the pool floor by following the sun ray
    // (not the view ray, which smeared them radially along the walls). Own scale, independent of foam.
    const float CAUSTICS_MAX_DEPTH = 3.0;
    const float CAUSTICS_SCALE = 1.4;
    const float CAUSTICS_GAIN = 0.1;
    const float CAUSTICS_FADE_EXPONENT = 0.7;
    const vec3 CAUSTICS_LIGHT_TINT = vec3(1.0, 0.98, 0.88);

    vec3 toLight = normalize(u_dirLightDir);
    float causticsDepth = min(depthDiff, CAUSTICS_MAX_DEPTH);
    float lightVertical = max(abs(toLight.y), 0.3);
    vec2 groundXZ = v_worldPos.xz - toLight.xz * (causticsDepth / lightVertical);
    vec3 groundPos = vec3(groundXZ.x, v_worldPos.y - causticsDepth, groundXZ.y);
    float groundShadow = sampleDirShadow(groundPos, vec3(0.0, 1.0, 0.0));

    vec2 causticsUv1 = (groundXZ + v_normal.xz * 0.25) * CAUSTICS_SCALE + vec2(u_time * foamNoiseSpeed * 0.35, u_time * foamNoiseSpeed * 0.2);
    vec2 causticsUv2 = (groundXZ - v_normal.xz * 0.2) * (CAUSTICS_SCALE * 1.4) - vec2(u_time * foamNoiseSpeed * 0.25, u_time * foamNoiseSpeed * 0.4);
    float caustics1 = 1.0 - waterCellNoise(causticsUv1);
    float caustics2 = 1.0 - waterCellNoise(causticsUv2);
    float causticsValue = pow(caustics1 * caustics2, 1.6) * 3.2;
    float causticsFade = exp(-depthDiff * CAUSTICS_FADE_EXPONENT) * smoothstep(0.05, 0.4, depthDiff);
    float underwaterLuma = dot(refractedColor, vec3(0.299, 0.587, 0.114));
    float shadowMask = smoothstep(0.05, 0.22, underwaterLuma) * groundShadow;
    vec3 causticsLight = CAUSTICS_LIGHT_TINT * causticsValue * causticsFade * shadowMask * CAUSTICS_GAIN;
    finalColor += causticsLight;

    finalColor *= u_exposure;
    finalColor = linearToSRGB(finalColor);

    fragColor = vec4(finalColor, 1.0);
}
