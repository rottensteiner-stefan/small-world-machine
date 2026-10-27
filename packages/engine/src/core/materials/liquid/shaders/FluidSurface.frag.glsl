#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_worldPos;
in vec3 v_normal;

[LIGHT_DEFS]
[DIR_SHADOW]

uniform vec4 u_color;
uniform vec4 u_specColor;
// Typed semantic lane bank (ADR 0027 / 0039) -- see FluidSurfaceMaterial.getRenderManifest.
uniform vec4 u_matParam0; // [shade, rimStrength, specularStrength, normalStrength]
uniform vec4 u_matParam1; // [specularPower, absorption, emissiveMask, transitionSoftness]
uniform vec4 u_matParam2; // [flowSpeed, distortion, emissivePulse, emissivePulseSpeed]
uniform vec4 u_matParam3; // [emissive.r*strength, emissive.g*strength, emissive.b*strength, time]
uniform vec4 u_matParam5; // [worldUVFreq, edgeSoftness, alphaFloor, rimExponent] (R4/E4-B)
uniform vec4 u_matParam9; // [reflectionStrength (0 = no mirror), reflectionDistortion, reflectionRoughness, 0]
uniform sampler2D u_diffuseMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_reflectionMap;

out vec4 fragColor;

void main() {
    float time = u_matParam3.w;
    float flowSpeed = u_matParam2.x;
    float noiseScale = u_matParam2.y;

    // Use world position XZ for seamless tiling across objects. R4/E4-B: 0.5 is a per-meter
    // lane value (u_matParam5.x), pre-scaled by domainScale on the CPU.
    vec2 worldUV = v_worldPos.xz * u_matParam5.x;
    vec2 uv = worldUV * noiseScale;

    vec2 uv1 = uv + vec2(time * 0.05, time * 0.02) * flowSpeed;
    vec2 uv2 = uv + vec2(-time * 0.03, time * 0.04) * flowSpeed;

    float n1 = dot(texture(u_diffuseMap, uv1).rgb, vec3(0.299, 0.587, 0.114));
    float n2 = dot(texture(u_diffuseMap, uv2).rgb, vec3(0.299, 0.587, 0.114));
    float noise = (n1 + n2) * 0.5;

    // Surface normal: the mesh normal (displaced analytically in the vertex stage) tilted by the
    // flowing normal map. normalStrength 0 (default) leaves it untouched.
    vec3 nm = texture(u_normalMap, uv1).rgb * 2.0 - 1.0;
    vec3 N = normalize(v_normal + vec3(nm.x, 0.0, nm.y) * u_matParam0.w);
    vec3 V = normalize(u_viewPos - v_worldPos);
    float softness = max(u_matParam1.w, 0.01);

    vec3 baseColor = sRGBToLinear(u_color.rgb) * (1.0 - smoothstep(0.0, 0.6, noise)) * 1.5;
    vec3 edgeColor = sRGBToLinear(u_specColor.rgb);

    // Depth Fade -- texture() (not texelFetch) so the 1x1 fallback texture's CLAMP_TO_EDGE wrap
    // mode kicks in correctly when no real depth capture exists (same reasoning as OpenWater.frag.glsl).
    vec2 depthUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueDepthMap, 0));
    float bgDepth = texture(u_opaqueDepthMap, depthUv).r;

    float near = u_cameraNearFar.x;
    float far = u_cameraNearFar.y;

    float ndcBg = bgDepth * 2.0 - 1.0;
    float linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));

    float ndcFrag = gl_FragCoord.z * 2.0 - 1.0;
    float linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));

    float depthDiff = linBgDepth - linFragDepth;

    // R4/E4-B: the 1.0 m edge softness travels in u_matParam5.y (÷ domainScale on the CPU).
    float edgeBlend = 1.0 - clamp(depthDiff / u_matParam5.y, 0.0, 1.0);
    float noiseBlend = smoothstep(0.7 - softness * 0.5, 0.7 + softness * 0.5, noise);
    float finalBlend = clamp(noiseBlend + edgeBlend, 0.0, 1.0);

    vec3 finalColor = mix(baseColor, edgeColor, finalBlend);

    // Emissive glow (lava/molten presets) -- u_matParam3.rgb carries emissiveColor pre-multiplied
    // by emissiveStrength (see FluidSurfaceMaterial.ts). Zero by default, a no-op for plain fluids.
    vec3 emissive = u_matParam3.rgb;
    // Noise-driven mask: hot where the noise is low (cracks), dark crust where it is high, with a
    // soft falloff. emissiveMask 0 keeps the legacy constant glow; the pulse rolls along the noise.
    float hot = 1.0 - smoothstep(0.5 - softness, 0.5 + softness, noise);
    float pulse = 1.0 + u_matParam2.z * 0.5 * sin(time * u_matParam2.w + noise * 6.2831853);
    finalColor += sRGBToLinear(emissive) * mix(1.0, hot, u_matParam1.z) * pulse;

    // Optional lighting: wrapped diffuse shade, Fresnel rim (translucent edge glow), specular.
    vec3 L = normalize(u_dirLightDir);
    float dirShadow = sampleDirShadow(v_worldPos, N);
    float ndl = dot(N, L) * 0.5 + 0.5;
    finalColor *= mix(1.0, ndl * ndl * 1.6 * mix(0.35, 1.0, dirShadow), u_matParam0.x);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    // R4: rim exponent is a raw dimensionless look scalar in u_matParam5.w (default 3.0).
    float rim = pow(1.0 - ndv, u_matParam5.w) * u_matParam0.y;
    finalColor += edgeColor * rim;
    float ndh = clamp(dot(N, normalize(L + V)), 0.0, 1.0);
    finalColor += u_dirLightColor * pow(ndh, max(u_matParam1.x, 1.0)) * u_matParam0.z * dirShadow;

    // Beer-Lambert thickness from the opaque depth capture: thin slime (shallow depthDiff) turns
    // see-through, thick slime stays dense. absorption 0 (default) keeps alpha at 1.
    float thickness = 1.0 - exp(-u_matParam1.y * max(depthDiff, 0.0));
    // R4: alpha floor is a raw dimensionless look scalar in u_matParam5.z (default 0.25).
    float alpha = mix(1.0, clamp(thickness + rim, u_matParam5.z, 1.0), step(0.0001, u_matParam1.y));

    if (u_matParam9.x > 0.0) {
        vec4 mirrorClip = u_vp * vec4(v_worldPos, 1.0);
        vec2 mirrorUv = clamp(mirrorClip.xy / mirrorClip.w * 0.5 + 0.5 + N.xz * u_matParam9.y, vec2(0.001), vec2(0.999));
        float mirrorLod = clamp(u_matParam9.z * 7.0, 0.0, 7.0);
        vec3 mirror = targetToLinear(textureLod(u_reflectionMap, mirrorUv, mirrorLod).rgb) / max(u_exposure, 0.001);
        float fresnel = pow(1.0 - ndv, 5.0);
        finalColor = mix(finalColor, mirror, (0.02 + 0.98 * fresnel) * u_matParam9.x);
    }

    finalColor *= u_exposure;
    // Same guard as FluidSurface.frag.wgsl: without post-processing (u_gamma != 1.0) this pass is the
    // final one, so the HDR emissive/specular terms are clamped here; a no-op with post-processing.
    if (u_gamma != 1.0) {
        finalColor = finalColor / (finalColor + vec3(1.0)); // Reinhard
    }
    finalColor = linearToSRGB(finalColor);

    fragColor = vec4(finalColor, alpha);}
