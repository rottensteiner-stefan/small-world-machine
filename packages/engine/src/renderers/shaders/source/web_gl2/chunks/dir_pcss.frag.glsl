// PCSS for the directional cascade atlas (ADR 0006): port of the WebGPU getShadowPCSS
// (pbr_math.wgsl). Deterministic 16-tap sunflower blocker search, penumbra width from the
// perspective-normalized receiver/blocker gap (decoupled from the acne bias), softness knobs from
// u_shadowSoftness. Atlas differences only: every tap is clamped to the cascade's own cell, and
// the cell's texel count stands in for the WebGPU per-layer map size.
const vec2 PCSS_DISK[16] = vec2[16](
    vec2(0.0000, 0.0000), vec2(-0.1843, 0.1689), vec2(0.0309, -0.3522), vec2(0.2635, 0.3436),
    vec2(-0.4924, -0.0871), vec2(0.4717, -0.3000), vec2(-0.1590, 0.5914), vec2(-0.3049, -0.5870),
    vec2(0.6642, 0.2426), vec2(-0.6933, 0.2862), vec2(0.3351, -0.7160), vec2(0.2482, 0.7912),
    vec2(-0.7493, -0.4342), vec2(0.8804, -0.1935), vec2(-0.5380, 0.7652), vec2(-0.1244, -0.9602)
);

float evalPCSSDir(vec2 atlasUV, vec2 cellMin, vec2 cellMax, float currentDepth, float bias, int cascadeIndex) {
    float depthRef = currentDepth - bias;
    vec2 atlasSize = vec2(textureSize(u_dirShadowMap, 0));
    vec2 texelSize = 1.0 / atlasSize;
    float cellTexels = (cellMax.x - cellMin.x) * atlasSize.x;
    ivec2 centerCoord = ivec2(atlasUV * atlasSize);
    ivec2 minCoord = ivec2(cellMin * atlasSize);
    ivec2 maxCoord = ivec2(cellMax * atlasSize) - ivec2(1);

    // Keep the world-space penumbra continuous across cascade splits (cascade 0 stays at 1).
    float cascadeScale = 1.0;
    if (cascadeIndex > 0) {
        cascadeScale = clamp(u_cascadeSplits[0] / max(u_cascadeSplits[cascadeIndex], 0.001), 0.2, 1.0);
    }
    float searchTexels = 8.0 * cascadeScale;

    float avgBlockerDepth = 0.0;
    float blockerCount = 0.0;
    for (int s = 0; s < 16; s++) {
        ivec2 coord = clamp(centerCoord + ivec2(PCSS_DISK[s] * searchTexels), minCoord, maxCoord);
        float blockerDepth = texelFetch(u_dirShadowMapRaw, coord, 0).r;
        if (blockerDepth < depthRef) {
            avgBlockerDepth += blockerDepth;
            blockerCount += 1.0;
        }
    }
    if (blockerCount < 1.0) return 1.0;
    avgBlockerDepth /= blockerCount;

    float dz = max(depthRef - avgBlockerDepth, 0.0);
    float radial = dz / max(depthRef, 0.00001);
    float pcfRadius = clamp(1.0 + radial * cellTexels * 0.12 * u_shadowSoftness.x, 1.0, max(u_shadowSoftness.y, 1.0));

    float shadow = 0.0;
    // Contact (radius ~ 1 texel): compact hard 3x3.
    if (pcfRadius <= 1.2) {
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 tapUV = clamp(atlasUV + vec2(float(x), float(y)) * texelSize, cellMin, cellMax);
                shadow += texture(u_dirShadowMap, vec3(tapUV, depthRef));
            }
        }
        return shadow / 9.0;
    }

    // Soft penumbra: the same disk scaled to the filter radius, rotated by interleaved gradient noise.
    float filterRadius = max(1.0, pcfRadius * cascadeScale);
    float noise = fract(52.9829189 * fract(0.06711056 * float(centerCoord.x) + 0.00583715 * float(centerCoord.y)));
    float angle = noise * 6.2831853;
    float cosA = cos(angle);
    float sinA = sin(angle);
    for (int s = 0; s < 16; s++) {
        vec2 raw = PCSS_DISK[s] * filterRadius;
        vec2 rot = vec2(raw.x * cosA - raw.y * sinA, raw.x * sinA + raw.y * cosA);
        vec2 tapUV = clamp(atlasUV + rot * texelSize, cellMin, cellMax);
        shadow += texture(u_dirShadowMap, vec3(tapUV, depthRef));
    }
    return shadow / 16.0;
}
