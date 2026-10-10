#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec4 v_color;

[LIGHT_DEFS]

uniform float u_time;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_diffuseMap; // _MainTex (white = Unity's default)
uniform sampler2D u_distortMap; // _DistortTex (white = Unity's default)

#ifdef USE_RAMP_LUT
uniform sampler2D u_rampMap;
#endif

uniform vec4 u_matParam0; // [scaleMain, scaleDistort, distortion, vertexDistortion]
uniform vec4 u_matParam1; // [speedMainX, speedMainY, speedDistortX, speedDistortY]
uniform vec4 u_matParam2; // [cutoffTop, topBlur, tintOffset, brightnessUnderLava]
uniform vec4 u_matParam3; // [edgeThickness, edgeBlur, brightnessTopLava, unused]
uniform vec4 u_matParam6; // Main Tint Start
uniform vec4 u_matParam7; // Main Tint End
uniform vec4 u_matParam8; // Top Layer Tint
uniform vec4 u_matParam9; // Edge Color

out vec4 fragColor;

// smoothstep() is undefined for edge0 >= edge1 (a blur of 0); fall back to a hard step.
float lavaSmoothstep(float edge0, float edge1, float x) {
    return edge0 < edge1 ? smoothstep(edge0, edge1, x) : step(edge0, x);
}

void main() {
    // Unity's _Time.x is t / 20.
    float timeX = u_time * 0.05;
    float r = v_color.r;

    // Distortion: the noise texture projected over world XZ at two scales, scrolling.
    vec2 uvDistort = v_worldPos.xz * u_matParam0.y;
    vec2 speedDistort = timeX * u_matParam1.zw;
    float d = texture(u_distortMap, uvDistort + speedDistort).r;
    float d2 = texture(u_distortMap, (v_worldPos.xz * (u_matParam0.y * 0.5)) + speedDistort).r;
    float layeredDist = clamp((d + d2) * 0.5, 0.0, 1.0);

    // Main texture over world XZ + distortion, scrolling, plus extra distortion from the red
    // vertex color (a scalar added to both UV components, as in the original).
    vec2 uvMain = v_worldPos.xz * u_matParam0.x;
    uvMain += layeredDist * u_matParam0.z;
    uvMain += timeX * u_matParam1.xy + (r * u_matParam0.w);

    // Main texture fading with vertex color, plus the layered distortion.
    float col = texture(u_diffuseMap, uvMain).r * r;
    col += layeredDist;

    // Top layer: the brightest part of the texture, dimmed by the vertex color.
    float top = lavaSmoothstep(u_matParam2.x, u_matParam2.x + u_matParam2.y, col) * r;

    // Depth edge detection. texture() with normalized coordinates (not texelFetch) so a 1x1
    // fallback depth stays valid; a missing capture (0) is treated as "nothing behind".
    vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(u_opaqueDepthMap, 0));
    float bgDepth = texture(u_opaqueDepthMap, screenUv).r;
    if (bgDepth <= 0.0) bgDepth = 1.0;
    float near = u_cameraNearFar.x;
    float far = u_cameraNearFar.y;
    float linBgDepth = (2.0 * near * far) / (far + near - (bgDepth * 2.0 - 1.0) * (far - near));
    float linFragDepth = (2.0 * near * far) / (far + near - (gl_FragCoord.z * 2.0 - 1.0) * (far - near));
    float edgeLine = 1.0 - clamp(u_matParam3.x * (linBgDepth - linFragDepth), 0.0, 1.0);

    // Cutoff edge based on the main texture.
    float edge = lavaSmoothstep(1.0 - col, 1.0 - col + u_matParam3.y, edgeLine);

    // Lerp start and end color over the main texture (unclamped, like Unity's lerp), multiply
    // for brightness.
    vec3 colorStart = sRGBToLinear(u_matParam6.rgb);
    vec3 colorEnd = sRGBToLinear(u_matParam7.rgb);
    vec3 baseColor;
#ifdef USE_RAMP_LUT
    // ADR 0026 extension: a 256-color thermal ramp replaces the two-color lerp.
    float heat = clamp(col * u_matParam2.z, 0.0, 1.0);
    baseColor = sRGBToLinear(texture(u_rampMap, vec2((heat * 255.0 + 0.5) / 256.0, 0.5)).rgb);
#else
    baseColor = mix(colorStart, colorEnd, col * u_matParam2.z);
#endif
    vec3 color = baseColor * u_matParam2.w;

    // Take the edge and the top out of the main color, fade by the vertex color, add them back.
    color *= (1.0 - edge);
    color *= (1.0 - top);
    color *= r;
    color += (edge * sRGBToLinear(u_matParam9.rgb)) * u_matParam3.z;
    color += top * sRGBToLinear(u_matParam8.rgb) * u_matParam3.z;

    // Negative light is meaningless in an HDR target (the unclamped lerp can undershoot).
    color = max(color, vec3(0.0));
    color *= u_exposure;
    fragColor = vec4(linearToSRGB(color), 1.0);
}
