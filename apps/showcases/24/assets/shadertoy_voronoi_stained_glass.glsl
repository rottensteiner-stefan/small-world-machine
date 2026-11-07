// Stained-glass mosaic: F1/F2 voronoi with animated feature points, jewel-toned cells
// and black "lead" borders between panes.
vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
}

vec3 voronoi(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);

    float f1 = 8.0;
    float f2 = 8.0;
    float cellHash = 0.0;

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 neighbor = vec2(float(i), float(j));
            vec2 point = hash2(n + neighbor);
            vec2 animated = 0.5 + 0.4 * sin(iTime * 0.35 + 6.2831 * point);
            vec2 diff = neighbor + animated - f;
            float d = length(diff);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                cellHash = hash2(n + neighbor).x;
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    return vec3(f1, f2, cellHash);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    uv *= 4.0;

    vec3 v = voronoi(uv);
    float f1 = v.x;
    float f2 = v.y;
    float cellHash = v.z;

    vec3 gemColor = 0.5 + 0.5 * cos(6.2831 * cellHash + vec3(0.0, 0.6, 1.2) + 1.5);
    gemColor = mix(gemColor, vec3(1.0), 0.15);

    float glow = 1.0 - smoothstep(0.0, 0.9, f1);
    vec3 col = gemColor * (0.55 + 0.55 * glow);

    // Black lead lines at cell borders
    float edge = smoothstep(0.0, 0.06, f2 - f1);
    col = mix(vec3(0.03), col, edge);

    float vig = 1.0 - dot(uv * 0.12, uv * 0.12);
    col *= clamp(vig, 0.5, 1.0);

    fragColor = vec4(col, 1.0);
}
