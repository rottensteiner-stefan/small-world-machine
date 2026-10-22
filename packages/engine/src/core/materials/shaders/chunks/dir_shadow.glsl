// For shaders with their own header; BASE_FRAGMENT_HEADER already declares these, so never combine both.
precision highp sampler2DShadow;
uniform sampler2DShadow u_dirShadowMap;
uniform sampler2D u_dirEVSMMap;
uniform vec4 u_evsmParams; // x=mode flag (0/1), y=dynamic variance floor multiplier, z=LBR amount, w=reserved
uniform mat4 u_cascadeMatrices[4];
uniform vec4 u_cascadeSplits;
uniform vec4 u_dirShadowInfo; // x=bias, y=normalBias, z=castShadow, w=numCascades

// EVSM (ADR 0007) helpers -- exact duplicates of the ones in BASE_FRAGMENT_HEADER (this chunk is
// for shaders with their own header, and the two headers never mix). Cell-clamped taps, same
// warp/lane semantics as the WebGPU getEVSM and the moment writer EvsmMoment.frag.glsl.
float chebyshevUpperBoundEVSM(float m1, float m2, float depth) {
    if (depth <= m1) return 1.0;
    float variance = max(m2 - m1 * m1, u_evsmParams.y * m1 * m1);
    float d = depth - m1;
    float pMax = variance / max(variance + d * d, 1e-7);
    float lbr = clamp(u_evsmParams.z, 0.0, 0.999);
    return clamp((pMax - lbr) / max(1.0 - lbr, 1e-7), 0.0, 1.0);
}

float evalEVSMDir(vec2 atlasUV, vec2 cellMin, vec2 cellMax, float currentDepth) {
    float pw = exp(40.0 * (currentDepth * 2.0 - 1.0));
    float nw = -1.0 / pw;
    vec2 texel = 1.0 / vec2(textureSize(u_dirEVSMMap, 0));
    vec4 moments = vec4(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 tapUV = clamp(atlasUV + vec2(float(x), float(y)) * texel, cellMin, cellMax);
            moments += texture(u_dirEVSMMap, tapUV);
        }
    }
    moments /= 9.0;
    return min(
        chebyshevUpperBoundEVSM(moments.x, moments.y, pw),
        chebyshevUpperBoundEVSM(moments.z, moments.w, nw)
    );
}

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
    vec3 samplePos = worldPos + N * u_dirShadowInfo.y * (1.0 - nDotL);
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
    vec2 texelSize = 1.0 / vec2(textureSize(u_dirShadowMap, 0));

    if (u_evsmParams.x > 0.5) {
        // EVSM (ADR 0007): one cell-clamped moment evaluation in place of the fixed 3x3 PCF
        // below, so this material follows the same opt-in quality.shadowMode="evsm" path as the
        // main + PBR lighting chunks (byte-identical fixed-PCF fallback when mode is 0).
        return evalEVSMDir(atlasUV, cellMin, cellMax, proj.z);
    }

    float lit = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 tapUV = clamp(atlasUV + vec2(float(x), float(y)) * texelSize, cellMin, cellMax);
            lit += texture(u_dirShadowMap, vec3(tapUV, proj.z - u_dirShadowInfo.x));
        }
    }
    return lit / 9.0;
}
