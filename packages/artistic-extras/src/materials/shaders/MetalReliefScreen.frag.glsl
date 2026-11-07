[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]

uniform vec4 u_matParam0; // semantic lane 0: relief / palette-knife / scratch parameters
uniform vec4 u_matParam1; // semantic lane 1: edge / wire-mesh / rain parameters
uniform vec4 u_matParam2; // lane 2: color-pop (hue, tolerance, desaturation, rust)
uniform vec4 u_matParam3; // lane 3: x = split position (-1 = off)
uniform float u_time;

// Hoskins hash without sine: identical bits in WGSL / GLSL300 / GLSL100 (cross-dialect parity).
float mrs_hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 mrs_hash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 mrs_rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

float mrs_luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 mrs_voronoiFacets(vec2 uv, float scale) {
    vec2 st = uv * scale;
    vec2 i_st = floor(st);
    vec2 f_st = fract(st);

    float minDist = 8.0;
    vec2 bestCell = vec2(0.0);

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = mrs_hash2(i_st + neighbor);
            vec2 diff = neighbor + point - f_st;
            float dist = dot(diff, diff);
            if (dist < minDist) {
                minDist = dist;
                bestCell = i_st + neighbor;
            }
        }
    }

    vec2 slope = (mrs_hash2(bestCell * 1.33) - 0.5) * 2.0;
    float facetHeight = mrs_hash(bestCell * 0.77);
    return vec3(slope, facetHeight);
}

void main() {
    float reliefStrength       = u_matParam0.x; // default: 1.5
    float paletteKnifeStrength = u_matParam0.y; // default: 0.5
    float paletteKnifeScale    = u_matParam0.z; // default: 24.0
    float scratchIntensity     = u_matParam0.w; // default: 0.35

    float scratchScale         = u_matParam1.x; // default: 120.0
    float edgeGlintStrength    = u_matParam1.y; // default: 1.2
    float wetRainStreaks       = u_matParam1.z; // default: 0.5
    float wireMeshStrength     = u_matParam1.w; // default: 0.0

    float targetHue            = u_matParam2.x; // default: 0.0 (Red)
    float hueTolerance         = u_matParam2.y; // default: 0.09
    float desaturation         = u_matParam2.z; // default: 0.95
    float rustStrength         = u_matParam2.w; // default: 0.8

    // Estimated texel size for Sobel kernel
    vec2 texelSize = vec2(1.0 / 512.0, 1.0 / 512.0);

    float l00 = mrs_luma(texture(u_diffuseMap, v_uv + vec2(-1.0, -1.0) * texelSize).rgb);
    float l10 = mrs_luma(texture(u_diffuseMap, v_uv + vec2( 0.0, -1.0) * texelSize).rgb);
    float l20 = mrs_luma(texture(u_diffuseMap, v_uv + vec2( 1.0, -1.0) * texelSize).rgb);

    float l01 = mrs_luma(texture(u_diffuseMap, v_uv + vec2(-1.0,  0.0) * texelSize).rgb);
    vec4 centerTex = texture(u_diffuseMap, v_uv);
    float l11 = mrs_luma(centerTex.rgb);
    float l21 = mrs_luma(texture(u_diffuseMap, v_uv + vec2( 1.0,  0.0) * texelSize).rgb);

    float l02 = mrs_luma(texture(u_diffuseMap, v_uv + vec2(-1.0,  1.0) * texelSize).rgb);
    float l12 = mrs_luma(texture(u_diffuseMap, v_uv + vec2( 0.0,  1.0) * texelSize).rgb);
    float l22 = mrs_luma(texture(u_diffuseMap, v_uv + vec2( 1.0,  1.0) * texelSize).rgb);

    // 1. Sobel Gradient
    float dX = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float dY = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edgeMag = length(vec2(dX, dY));

    // 2. Voronoi Palette Knife Perturbation
    vec3 facets = mrs_voronoiFacets(v_uv, paletteKnifeScale);
    vec2 facetSlope = facets.xy;

    vec3 reliefN = normalize(vec3(-dX * reliefStrength + facetSlope.x * paletteKnifeStrength * 0.35,
                                  -dY * reliefStrength + facetSlope.y * paletteKnifeStrength * 0.35,
                                  1.0));

    // 3. Directional Brushed Metal & Grind Scratches
    float scratchCoord = (v_uv.x * 0.85 + v_uv.y * 0.53) * scratchScale;
    float scratchH = mrs_hash(vec2(floor(scratchCoord), 1.0));
    float scratchNoise = 0.7 + 0.3 * sin(scratchCoord * 6.28318 + scratchH * 6.28);
    float scratchFactor = mix(1.0, scratchNoise, scratchIntensity);

    // 4. Selective Color Isolation (Red Pop)
    vec3 hsv = mrs_rgb2hsv(centerTex.rgb);
    float hueDiff = abs(hsv.x - targetHue);
    hueDiff = min(hueDiff, 1.0 - hueDiff);

    float colorMask = smoothstep(hueTolerance, hueTolerance * 0.3, hueDiff) * smoothstep(0.2, 0.4, hsv.y);

    // Industrial Metal/Rust Ramp
    vec3 rustShadow = vec3(0.38, 0.22, 0.12) * rustStrength + vec3(l11 * 0.6) * (1.0 - rustStrength);
    vec3 steelMid   = vec3(0.52, 0.56, 0.60) * l11;
    vec3 zincHigh   = vec3(0.88, 0.90, 0.94) * l11;

    vec3 metalGrad = mix(rustShadow, steelMid, clamp(l11 * 2.2, 0.0, 1.0));
    metalGrad = mix(metalGrad, zincHigh, clamp((l11 - 0.45) * 2.2, 0.0, 1.0));

    vec3 steelAlbedo = mix(centerTex.rgb, metalGrad, desaturation);
    vec3 finalAlbedo = mix(steelAlbedo, centerTex.rgb, colorMask) * scratchFactor;

    // 5. Directional Relief Lighting & Specular Edge Glints
    // STYLIZED (by design): screen-space relief with a fixed key light and a camera-facing view vector;
    // it does not sample scene lights. Not energy conserving beyond the 1.1 diffuse ceiling.
    vec3 L = normalize(vec3(0.5, 0.7, 0.5));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);

    float NdotL = max(dot(reliefN, L), 0.0);
    float NdotH = max(dot(reliefN, H), 0.0);

    float edgeGlint = clamp(edgeMag * 4.0 * edgeGlintStrength, 0.0, 1.0);
    float spec = pow(NdotH, 32.0) * (0.4 + 0.6 * edgeGlint);

    vec3 specColor = vec3(0.9, 0.92, 0.96) * spec * (0.5 + 0.5 * edgeGlint);

    if (wetRainStreaks > 0.01) {
        float streakHash = mrs_hash(vec2(floor(v_uv.x * 240.0), 3.14));
        float streak = pow(streakHash, 14.0) * smoothstep(0.45, 0.95, v_uv.y) * wetRainStreaks;
        specColor += vec3(0.9, 0.95, 1.0) * streak;
    }

    vec3 shadedColor = finalAlbedo * (0.35 + 0.75 * NdotL) + specColor;

    float splitPos = u_matParam3.x;
    if (splitPos >= 0.0 && v_uv.x < splitPos) {
        shadedColor = centerTex.rgb;
    }

    fragColor = vec4(displayToTarget(shadedColor), centerTex.a);
    [FOG_CALC]
}
