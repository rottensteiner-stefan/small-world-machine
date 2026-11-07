// 4-point astroid star billboards / sun glint with organic jitter and stepped time for anime water.
// GLSL ES 1.00 and 3.00 compatible.

float waterGlintStar(vec2 p, float steppedTime, float gate) {
    if (gate < 0.76) {
        return 0.0;
    }
    vec2 cell = floor(p);
    float h = waterHash(cell + floor(steppedTime));
    if (h < 0.45) {
        return 0.0;
    }

    vec2 jitter = (vec2(waterHash(cell + vec2(13.7, 37.1)), waterHash(cell + vec2(71.3, 19.9))) - 0.5) * 0.42;
    vec2 localPos = fract(p) - 0.5 - jitter;

    float dx = abs(localPos.x);
    float dy = abs(localPos.y);

    float astroid = max(1.0 - (sqrt(dx) + sqrt(dy)) * 2.25, 0.0);
    float starCross = pow(astroid, 1.3) * 1.5;
    float diamondCore = max(1.0 - (dx + dy) * 5.5, 0.0);
    float halo = max(1.0 - length(localPos) * 3.8, 0.0);
    float bloomHalo = halo * halo * 0.35;

    float star = starCross + diamondCore * 0.75 + bloomHalo;
    float gateIntensity = smoothstep(0.76, 0.95, gate);
    return star * gateIntensity * (0.65 + 0.35 * sin(h * 6.28318));
}
