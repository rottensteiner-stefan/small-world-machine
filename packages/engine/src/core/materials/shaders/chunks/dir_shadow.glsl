// For shaders with their own header; BASE_FRAGMENT_HEADER already declares these, so never combine both.
precision highp sampler2DShadow;
uniform sampler2DShadow u_dirShadowMap;
uniform sampler2D u_dirShadowMapRaw; // non-comparison view for the PCSS blocker search
uniform vec4 u_shadowSoftness; // x=penumbra scale, y=PCF radius cap in texels
uniform sampler2D u_dirEVSMMap;
uniform vec4 u_evsmParams; // x=mode flag (0/1), y=dynamic variance floor multiplier, z=LBR amount, w=receiver depth bias
uniform mat4 u_cascadeMatrices[4];
uniform vec4 u_cascadeSplits;
uniform vec4 u_dirShadowInfo; // x=bias, y=normalBias, z=castShadow, w=numCascades
// E10 (P3): per-cascade normal-offset bias lanes (baked from k * texel size), indexed by
// cascadeIndex. u_dirShadowInfo.y is now reserved/no-op for directional shadows.
uniform vec4 u_dirShadowBias;

// EVSM (ADR 0043) helpers -- exact duplicates of the ones in BASE_FRAGMENT_HEADER (this chunk is
// for shaders with their own header, and the two headers never mix). Cell-clamped taps, same
// warp/lane semantics as the WebGPU getEVSM and the moment writer EvsmMoment.frag.glsl.
float chebyshevUpperBoundEVSM(float m1, float m2, float depth) {
    if (depth <= m1) return 1.0;
    float rawVar = max(m2 - m1 * m1, 0.0);
    float variance = max(m2 - m1 * m1, u_evsmParams.y * m1 * m1);
    variance = max(rawVar, variance * 0.06);
    float d = depth - m1;
    float pMax = variance / max(variance + d * d, 1e-7);
    float lbr = clamp(u_evsmParams.z, 0.0, 0.999);
    return clamp((pMax - lbr) / max(1.0 - lbr, 1e-7), 0.0, 1.0);
}

float evalEVSMDir(vec2 atlasUV, vec2 cellMin, vec2 cellMax, float currentDepth) {
    // w lane = tiny receiver depth bias in the [0,1] light-depth domain (three.js VSM bias
    // precedent; see the base_fragment_header copy -- these two must stay identical).
    float pw = exp(40.0 * ((currentDepth + u_evsmParams.w) * 2.0 - 1.0));
    float nw = -1.0 / pw;
    vec4 rMoment = vec4(pw, pw * pw, nw, nw * nw);
    // Receiver-horizon-clamped two-slice moment filter + blocker-min gap blend (ADR 0043).
    // Byte-parallel with WebGPU getEVSM (pbr_math.wgsl) and base_fragment_header.frag.glsl.
    const int EVSM_FILTER_RADIUS = 1;
    const int EVSM_WIDE_STEP = 4;
    const float EVSM_BLEND_DEPTH = 0.012;
    vec2 texel = 1.0 / vec2(textureSize(u_dirEVSMMap, 0));

    vec4 tight = vec4(0.0);
    float tightBlockerSum = 0.0;
    float tightBlockerCount = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 tapUV = clamp(atlasUV + vec2(float(x * EVSM_FILTER_RADIUS), float(y * EVSM_FILTER_RADIUS)) * texel, cellMin, cellMax);
            vec4 rawTap = texture(u_dirEVSMMap, tapUV);
            if (rawTap.x < pw) {
                tightBlockerSum += rawTap.x;
                tightBlockerCount += 1.0;
            }
            tight += (rawTap.x >= pw) ? rMoment : rawTap;
        }
    }
    tight /= 9.0;

    vec4 wide = vec4(0.0);
    float wideBlockerSum = 0.0;
    float wideBlockerCount = 0.0;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 tapOffset = vec2(float(x * EVSM_WIDE_STEP + y), float(y * EVSM_WIDE_STEP - x));
            vec2 tapUV = clamp(atlasUV + tapOffset * texel, cellMin, cellMax);
            vec4 rawTap = texture(u_dirEVSMMap, tapUV);
            if (rawTap.x < pw) {
                wideBlockerSum += rawTap.x;
                wideBlockerCount += 1.0;
            }
            wide += (rawTap.x >= pw) ? rMoment : rawTap;
        }
    }
    wide /= 25.0;

    float pTight = min(
        chebyshevUpperBoundEVSM(tight.x, tight.y, pw),
        chebyshevUpperBoundEVSM(tight.z, tight.w, nw)
    );
    float pWide = min(
        chebyshevUpperBoundEVSM(wide.x, wide.y, pw),
        chebyshevUpperBoundEVSM(wide.z, wide.w, nw)
    );
    // True local occluder depth in [0,1] light-depth domain (exact inversion of the c = 40 warp
    // from the blocker-only mean). Blend = clamped linear gap / EVSM_BLEND_DEPTH.
    float blockerPos = pw;
    if (tightBlockerCount > 0.0) {
        blockerPos = tightBlockerSum / tightBlockerCount;
    } else if (wideBlockerCount > 0.0) {
        blockerPos = wideBlockerSum / wideBlockerCount;
    }
    float occluderDepth = (log(blockerPos) / 40.0 + 1.0) * 0.5;
    float gap = max(currentDepth + u_evsmParams.w - occluderDepth, 0.0);
    float blend = smoothstep(0.0015, EVSM_BLEND_DEPTH, gap);
    return mix(pTight, pWide, blend);
}

[DIR_PCSS]

float sampleDirShadow(vec3 worldPos, vec3 N) {
    if (u_dirShadowInfo.z < 0.5 || u_dirShadowInfo.w < 1.0) {
        return 1.0;
    }

    int numCascades = int(u_dirShadowInfo.w);
    int cascadeIndex = numCascades - 1;
    float viewDist = length(u_viewPos - worldPos);
    for (int c = 0; c < 4; c++) {
        if (c >= numCascades) break;
        if (viewDist < u_cascadeSplits[c]) {
            cascadeIndex = c;
            break;
        }
    }

    float nDotL = max(dot(N, normalize(u_dirLightDir)), 0.0);
    // E10 (P3): per-cascade normal-offset bias lane (baked from k * texel size in updateCascades).
    vec3 samplePos = worldPos + N * u_dirShadowBias[cascadeIndex] * (1.0 - nDotL);
    vec4 lightSpacePos = u_cascadeMatrices[cascadeIndex] * vec4(samplePos, 1.0);
    vec3 proj = lightSpacePos.xyz / lightSpacePos.w * 0.5 + 0.5;
    if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) {
        return 1.0;
    }

    float cols = ceil(sqrt(u_dirShadowInfo.w));
    vec2 cell = vec2(mod(float(cascadeIndex), cols), floor(float(cascadeIndex) / cols));
    vec2 cellMin = cell / cols;
    vec2 cellMax = cellMin + vec2(1.0 / cols);
    vec2 atlasUV = (proj.xy + cell) / cols;

    if (u_evsmParams.x > 0.5) {
        // EVSM (ADR 0043): one cell-clamped moment evaluation, the same opt-in
        // quality.shadowMode="evsm" path as the main + PBR lighting chunks.
        return evalEVSMDir(atlasUV, cellMin, cellMax, proj.z);
    }
    // PCSS, the same filter as the main + PBR lighting chunks (ADR 0006).
    return evalPCSSDir(atlasUV, cellMin, cellMax, proj.z, u_dirShadowInfo.x, cascadeIndex);
}
