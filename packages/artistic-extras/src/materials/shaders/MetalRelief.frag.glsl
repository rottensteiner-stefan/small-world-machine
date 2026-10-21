[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]

uniform vec4 u_matParam0; // semantic lane 0: relief / palette-knife / scratch parameters
uniform vec4 u_matParam1; // semantic lane 1: edge / wire-mesh / rain parameters
uniform vec4 u_styleA;
uniform float u_metallic;
uniform float u_roughness;
uniform float u_time;

// Procedural hash
float mr_hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 mr_hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453123);
}

// RGB to HSV
vec3 mr_rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// 2D Voronoi / Palette Knife Facet generator
vec3 mr_voronoiFacets(vec2 uv, float scale) {
    vec2 st = uv * scale;
    vec2 i_st = floor(st);
    vec2 f_st = fract(st);

    float minDist = 8.0;
    vec2 bestCell = vec2(0.0);
    vec2 bestOffset = vec2(0.0);

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = mr_hash2(i_st + neighbor);
            vec2 diff = neighbor + point - f_st;
            float dist = dot(diff, diff);
            if (dist < minDist) {
                minDist = dist;
                bestCell = i_st + neighbor;
                bestOffset = diff;
            }
        }
    }

    vec2 slope = (mr_hash2(bestCell * 1.33) - 0.5) * 2.0;
    float facetHeight = mr_hash(bestCell * 0.77);
    return vec3(slope, facetHeight);
}

void main() {
    // --- Unpack Parameters ---
    float paletteKnifeStrength = u_matParam0.x; // default: 0.6
    float paletteKnifeScale    = u_matParam0.y; // default: 12.0
    float scratchIntensity      = u_matParam0.z; // default: 0.35
    float scratchScale          = u_matParam0.w; // default: 80.0

    float edgeBevelStrength    = u_matParam1.x; // default: 0.8
    float wireMeshStrength     = u_matParam1.y; // default: 0.0
    float wireMeshScale        = u_matParam1.z; // default: 40.0
    float wetRainStreaks       = u_matParam1.w; // default: 0.4

    float targetHue            = u_styleA.x; // default: 0.0 (Red)
    float hueTolerance         = u_styleA.y; // default: 0.09
    float desaturation         = u_styleA.z; // default: 0.95
    float rustStrength         = u_styleA.w; // default: 0.75

    // --- Base Color from texture or uniform ---
    #ifdef USE_DIFFUSE_MAP
        vec4 texel = texture(u_diffuseMap, v_uv);
        vec4 baseAlbedo = texel * u_color;
    #else
        vec4 baseAlbedo = u_color;
    #endif

    // --- 1. Procedural Voronoi / Palette Knife Faceting ---
    vec3 facets = mr_voronoiFacets(v_uv, paletteKnifeScale);
    vec2 facetSlope = facets.xy;

    // Construct local tangent space if not provided
    vec3 N = normalize(v_normal);
    vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);

    // Perturb surface normal with palette knife facets
    vec3 perturbedN = normalize(N + (T * facetSlope.x + B * facetSlope.y) * paletteKnifeStrength);

    // --- 2. Brushed Metal & Angle Grind Marks ---
    float scratchCoord = (v_uv.x * 0.85 + v_uv.y * 0.53) * scratchScale;
    float scratchH = mr_hash(vec2(floor(scratchCoord), 1.0));
    float scratchNoise = 0.7 + 0.3 * sin(scratchCoord * 6.28318 + scratchH * 6.28);
    float scratchFactor = mix(1.0, scratchNoise, scratchIntensity);

    // --- 3. Procedural Streckmetall (Wire Mesh) Pattern ---
    if (wireMeshStrength > 0.01) {
        vec2 mUv = fract(v_uv * wireMeshScale) - 0.5;
        float diamond = abs(mUv.x) * 1.5 + abs(mUv.y);
        float wire = smoothstep(0.42, 0.48, diamond) - smoothstep(0.52, 0.58, diamond);
        perturbedN = normalize(perturbedN + (T * (mUv.x * wire) + B * (mUv.y * wire)) * wireMeshStrength * 2.0);
        scratchFactor *= (1.0 - wire * wireMeshStrength * 0.4);
    }

    // --- 4. Curvature & Welded Edge Bevel ---
    float curvature = length(fwidth(perturbedN)) * 6.0;
    float edgeGlint = clamp(curvature * edgeBevelStrength, 0.0, 1.0);

    // --- 5. Selective Color Isolation (The Red Pop) ---
    vec3 hsv = mr_rgb2hsv(baseAlbedo.rgb);
    float hueDiff = abs(hsv.x - targetHue);
    hueDiff = min(hueDiff, 1.0 - hueDiff);

    float colorMask = smoothstep(hueTolerance, hueTolerance * 0.3, hueDiff) * smoothstep(0.2, 0.4, hsv.y);

    // Monochromatic Luma & Industrial Metal/Rust Ramp
    float luma = dot(baseAlbedo.rgb, vec3(0.299, 0.587, 0.114));
    
    // Rust tones in shadow, cold steel in midtones, bright aluminum in highlights
    vec3 rustShadow = vec3(0.38, 0.22, 0.12) * rustStrength + vec3(luma * 0.6) * (1.0 - rustStrength);
    vec3 steelMid   = vec3(0.52, 0.56, 0.60) * luma;
    vec3 zincHigh   = vec3(0.88, 0.90, 0.94) * luma;

    vec3 metalGrad = mix(rustShadow, steelMid, clamp(luma * 2.2, 0.0, 1.0));
    metalGrad = mix(metalGrad, zincHigh, clamp((luma - 0.45) * 2.2, 0.0, 1.0));

    // Desaturate non-accent areas
    vec3 steelAlbedo = mix(baseAlbedo.rgb, metalGrad, desaturation);
    vec3 finalAlbedo = mix(steelAlbedo, baseAlbedo.rgb, colorMask) * scratchFactor;

    // --- 6. Dual Roughness / Metallic & Wet Reflections ---
    float dynamicMetallic = mix(u_metallic, 0.95, edgeGlint * 0.8);
    float dynamicRoughness = mix(u_roughness, 0.08, edgeGlint * 0.9);

    // Vertical rain streak reflections
    if (wetRainStreaks > 0.01) {
        float streakHash = mr_hash(vec2(floor(v_uv.x * 120.0), 3.14));
        float streak = pow(streakHash, 14.0) * smoothstep(0.4, 0.9, v_uv.y) * wetRainStreaks;
        dynamicRoughness = mix(dynamicRoughness, 0.04, streak);
        dynamicMetallic  = mix(dynamicMetallic, 0.98, streak);
    }

    // --- 7. Simple Direct Lighting & Specular Highlight ---
    vec3 L = normalize(vec3(0.4, 0.8, 0.5)); // Main directional light key
    vec3 V = normalize(-v_worldPos);
    vec3 H = normalize(L + V);

    float NdotL = max(dot(perturbedN, L), 0.0);
    float NdotH = max(dot(perturbedN, H), 0.0);

    float specPower = mix(16.0, 128.0, 1.0 - dynamicRoughness);
    float spec = pow(NdotH, specPower) * (1.0 - dynamicRoughness);

    // Bare silver metal glint on worn edges
    vec3 specColor = mix(vec3(0.3), vec3(1.0, 0.98, 0.95), dynamicMetallic) + vec3(edgeGlint * 0.7);

    vec3 diffuseLight = finalAlbedo * (vec3(0.25) + vec3(0.85) * NdotL);
    vec3 specularLight = specColor * spec * (NdotL > 0.0 ? 1.0 : 0.0);

    vec3 shadedColor = diffuseLight + specularLight;

    fragColor = vec4(shadedColor, baseAlbedo.a);
}
