#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_worldPos;
in vec3 v_normal;

[LIGHT_DEFS]
[DIR_SHADOW]

uniform vec4 u_color;
uniform vec4 u_specColor;
uniform vec4 u_extraParams;
uniform vec4 u_liquidParams;
uniform vec4 u_thresholds; // [rimStrength, specStrength, normalStrength, absorption]
uniform float u_shininess; // specular power
uniform float u_isTerrain; // emissiveMask: 0 = constant glow, 1 = noise-driven (hot cracks, dark crust)
uniform float u_metallic; // emissive pulse amplitude
uniform float u_roughness; // emissive pulse speed (rad/s)
uniform float u_reflectivity; // transition softness (0.2 = legacy two-tone width)
uniform float u_pad1; // diffuse shade strength (wrapped N.L)
uniform sampler2D u_diffuseMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_opaqueDepthMap;

out vec4 fragColor;

void main() {
    float time = u_extraParams.y;
    float flowSpeed = u_extraParams.z;
    float noiseScale = u_extraParams.w;

    // Use world position XZ for seamless tiling across objects
    vec2 worldUV = v_worldPos.xz * 0.5;
    vec2 uv = worldUV * noiseScale;

    vec2 uv1 = uv + vec2(time * 0.05, time * 0.02) * flowSpeed;
    vec2 uv2 = uv + vec2(-time * 0.03, time * 0.04) * flowSpeed;

    float n1 = dot(texture(u_diffuseMap, uv1).rgb, vec3(0.299, 0.587, 0.114));
    float n2 = dot(texture(u_diffuseMap, uv2).rgb, vec3(0.299, 0.587, 0.114));
    float noise = (n1 + n2) * 0.5;

    // Surface normal: the mesh normal (displaced analytically in the vertex stage) tilted by the
    // flowing normal map. normalStrength 0 (default) leaves it untouched.
    vec3 nm = texture(u_normalMap, uv1).rgb * 2.0 - 1.0;
    vec3 N = normalize(v_normal + vec3(nm.x, 0.0, nm.y) * u_thresholds.z);
    vec3 V = normalize(u_viewPos - v_worldPos);
    float softness = max(u_reflectivity, 0.01);

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

    float edgeBlend = 1.0 - clamp(depthDiff / 1.0, 0.0, 1.0); // Softness of 1.0 units
    float noiseBlend = smoothstep(0.7 - softness * 0.5, 0.7 + softness * 0.5, noise);
    float finalBlend = clamp(noiseBlend + edgeBlend, 0.0, 1.0);

    vec3 finalColor = mix(baseColor, edgeColor, finalBlend);

    // Emissive glow (lava/molten presets) -- u_extraParams.x and u_liquidParams.zw are otherwise
    // unused by this shader, repurposed to carry emissiveColor.rgb pre-multiplied by
    // emissiveStrength (see FluidSurfaceMaterial.ts). Zero by default, a no-op for plain fluids.
    vec3 emissive = vec3(u_extraParams.x, u_liquidParams.z, u_liquidParams.w);
    // Noise-driven mask: hot where the noise is low (cracks), dark crust where it is high, with a
    // soft falloff. emissiveMask 0 keeps the legacy constant glow; the pulse rolls along the noise.
    float hot = 1.0 - smoothstep(0.5 - softness, 0.5 + softness, noise);
    float pulse = 1.0 + u_metallic * 0.5 * sin(time * u_roughness + noise * 6.2831853);
    finalColor += sRGBToLinear(emissive) * mix(1.0, hot, u_isTerrain) * pulse;

    // Optional lighting: wrapped diffuse shade, Fresnel rim (translucent edge glow), specular.
    vec3 L = normalize(u_dirLightDir);
    float dirShadow = sampleDirShadow(v_worldPos, N);
    float ndl = dot(N, L) * 0.5 + 0.5;
    finalColor *= mix(1.0, ndl * ndl * 1.6 * mix(0.35, 1.0, dirShadow), u_pad1);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float rim = pow(1.0 - ndv, 3.0) * u_thresholds.x;
    finalColor += edgeColor * rim;
    float ndh = clamp(dot(N, normalize(L + V)), 0.0, 1.0);
    finalColor += u_dirLightColor * pow(ndh, max(u_shininess, 1.0)) * u_thresholds.y * dirShadow;

    // Beer-Lambert thickness from the opaque depth capture: thin slime (shallow depthDiff) turns
    // see-through, thick slime stays dense. absorption 0 (default) keeps alpha at 1.
    float thickness = 1.0 - exp(-u_thresholds.w * max(depthDiff, 0.0));
    float alpha = mix(1.0, clamp(thickness + rim, 0.25, 1.0), step(0.0001, u_thresholds.w));

    finalColor *= u_exposure;
    finalColor = linearToSRGB(finalColor);

    fragColor = vec4(finalColor, alpha);
}
