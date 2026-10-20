#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_colorTexture;
uniform vec2 u_resolution;
uniform float u_time;

// Tuning Uniforms
uniform float u_reliefStrength;      // default: 1.5
uniform float u_paletteKnifeStrength; // default: 0.5
uniform float u_paletteKnifeScale;    // default: 24.0
uniform float u_scratchIntensity;     // default: 0.35
uniform float u_scratchScale;         // default: 120.0
uniform float u_targetHue;            // default: 0.0 (Red)
uniform float u_hueTolerance;         // default: 0.09
uniform float u_desaturation;         // default: 0.95
uniform float u_rustStrength;         // default: 0.8
uniform float u_edgeGlintStrength;    // default: 1.2
uniform float u_wetRainStreaks;       // default: 0.5
uniform float u_wireMeshStrength;     // default: 0.0
uniform float u_wireMeshScale;        // default: 30.0

float mr_hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 mr_hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453123);
}

vec3 mr_rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

float getLuma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 mr_voronoiFacets(vec2 uv, float scale) {
    vec2 st = uv * scale;
    vec2 i_st = floor(st);
    vec2 f_st = fract(st);

    float minDist = 8.0;
    vec2 bestCell = vec2(0.0);

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = mr_hash2(i_st + neighbor);
            vec2 diff = neighbor + point - f_st;
            float dist = dot(diff, diff);
            if (dist < minDist) {
                minDist = dist;
                bestCell = i_st + neighbor;
            }
        }
    }

    vec2 slope = (mr_hash2(bestCell * 1.33) - 0.5) * 2.0;
    float facetHeight = mr_hash(bestCell * 0.77);
    return vec3(slope, facetHeight);
}

void main() {
    vec2 texelSize = 1.0 / max(u_resolution, vec2(1.0));

    // --- 1. Sobel Luminance Gradient for 3D Metal Relief Embossing ---
    float l00 = getLuma(texture(u_colorTexture, v_uv + vec2(-1.0, -1.0) * texelSize).rgb);
    float l10 = getLuma(texture(u_colorTexture, v_uv + vec2( 0.0, -1.0) * texelSize).rgb);
    float l20 = getLuma(texture(u_colorTexture, v_uv + vec2( 1.0, -1.0) * texelSize).rgb);

    float l01 = getLuma(texture(u_colorTexture, v_uv + vec2(-1.0,  0.0) * texelSize).rgb);
    vec4 centerTex = texture(u_colorTexture, v_uv);
    float l11 = getLuma(centerTex.rgb);
    float l21 = getLuma(texture(u_colorTexture, v_uv + vec2( 1.0,  0.0) * texelSize).rgb);

    float l02 = getLuma(texture(u_colorTexture, v_uv + vec2(-1.0,  1.0) * texelSize).rgb);
    float l12 = getLuma(texture(u_colorTexture, v_uv + vec2( 0.0,  1.0) * texelSize).rgb);
    float l22 = getLuma(texture(u_colorTexture, v_uv + vec2( 1.0,  1.0) * texelSize).rgb);

    float dX = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float dY = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edgeMag = length(vec2(dX, dY));

    // --- 2. Voronoi Palette Knife Perturbation ---
    vec3 facets = mr_voronoiFacets(v_uv, u_paletteKnifeScale);
    vec2 facetSlope = facets.xy;

    // Embossed surface normal
    vec3 reliefN = normalize(vec3(-dX * u_reliefStrength + facetSlope.x * u_paletteKnifeStrength * 0.3,
                                  -dY * u_reliefStrength + facetSlope.y * u_paletteKnifeStrength * 0.3,
                                  1.0));

    // --- 3. Brushed Metal & Angle Grind Scratches ---
    float scratchCoord = (v_uv.x * 0.85 + v_uv.y * 0.53) * u_scratchScale;
    float scratchH = mr_hash(vec2(floor(scratchCoord), 1.0));
    float scratchNoise = 0.7 + 0.3 * sin(scratchCoord * 6.28318 + scratchH * 6.28);
    float scratchFactor = mix(1.0, scratchNoise, u_scratchIntensity);

    // --- 4. Streckmetall Wire Mesh Overlay ---
    if (u_wireMeshStrength > 0.01) {
        vec2 mUv = fract(v_uv * u_wireMeshScale) - 0.5;
        float diamond = abs(mUv.x) * 1.5 + abs(mUv.y);
        float wire = smoothstep(0.42, 0.48, diamond) - smoothstep(0.52, 0.58, diamond);
        scratchFactor *= (1.0 - wire * u_wireMeshStrength * 0.5);
    }

    // --- 5. Selective Color Isolation (The Red Pop) ---
    vec3 hsv = mr_rgb2hsv(centerTex.rgb);
    float hueDiff = abs(hsv.x - u_targetHue);
    hueDiff = min(hueDiff, 1.0 - hueDiff);

    float colorMask = smoothstep(u_hueTolerance, u_hueTolerance * 0.3, hueDiff) * smoothstep(0.2, 0.4, hsv.y);

    // Industrial Metal & Rust Ramp
    vec3 rustShadow = vec3(0.38, 0.22, 0.12) * u_rustStrength + vec3(l11 * 0.6) * (1.0 - u_rustStrength);
    vec3 steelMid   = vec3(0.52, 0.56, 0.60) * l11;
    vec3 zincHigh   = vec3(0.88, 0.90, 0.94) * l11;

    vec3 metalGrad = mix(rustShadow, steelMid, clamp(l11 * 2.2, 0.0, 1.0));
    metalGrad = mix(metalGrad, zincHigh, clamp((l11 - 0.45) * 2.2, 0.0, 1.0));

    vec3 steelAlbedo = mix(centerTex.rgb, metalGrad, u_desaturation);
    vec3 finalAlbedo = mix(steelAlbedo, centerTex.rgb, colorMask) * scratchFactor;

    // --- 6. Directional Relief Lighting & Specular Edge Glints ---
    vec3 L = normalize(vec3(0.5, 0.7, 0.5));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);

    float NdotL = max(dot(reliefN, L), 0.0);
    float NdotH = max(dot(reliefN, H), 0.0);

    float edgeGlint = clamp(edgeMag * 4.0 * u_edgeGlintStrength, 0.0, 1.0);
    float spec = pow(NdotH, 32.0) * (0.4 + 0.6 * edgeGlint);

    vec3 specColor = vec3(0.9, 0.92, 0.96) * spec * (0.5 + 0.5 * edgeGlint);

    // Wet ground reflection streaks
    if (u_wetRainStreaks > 0.01) {
        float streakHash = mr_hash(vec2(floor(v_uv.x * u_resolution.x * 0.15), 3.14));
        float streak = pow(streakHash, 14.0) * smoothstep(0.45, 0.95, v_uv.y) * u_wetRainStreaks;
        specColor += vec3(0.9, 0.95, 1.0) * streak;
    }

    vec3 shadedColor = finalAlbedo * (0.35 + 0.75 * NdotL) + specColor;

    fragColor = vec4(shadedColor, centerTex.a);
}
