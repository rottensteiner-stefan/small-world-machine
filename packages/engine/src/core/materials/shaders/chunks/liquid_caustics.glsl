// Smooth Voronoi border line factor (F1 - SmoothF1) / k and domain warp for anime/Ghibli caustics.
// GLSL ES 1.00 and 3.00 compatible.

vec2 waterDomainWarp(vec2 p, float t) {
    float nx = sin(p.y * 1.5 + t * 1.2) * 0.35 + cos(p.x * 2.1 - t * 0.8) * 0.2;
    float ny = cos(p.x * 1.8 + t * 1.1) * 0.35 + sin(p.y * 2.3 - t * 0.9) * 0.2;
    return p + vec2(nx, ny);
}

float waterCausticLine(vec2 p, float k) {
    vec2 cell = floor(p);
    vec2 localPos = fract(p);
    float d1 = 8.0;

    // Pass 1: find nearest cell distance d1 (F1)
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 jitter = vec2(
                waterHash(cell + neighbor),
                waterHash(cell + neighbor + vec2(17.0, 31.0))
            );
            vec2 diff = neighbor + jitter - localPos;
            d1 = min(d1, length(diff));
        }
    }

    // Pass 2: relative exponential sum relative to d1 (numerically stable for mediump)
    float s = 0.0;
    float safeK = max(k, 0.05);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 jitter = vec2(
                waterHash(cell + neighbor),
                waterHash(cell + neighbor + vec2(17.0, 31.0))
            );
            vec2 diff = neighbor + jitter - localPos;
            float d = length(diff);
            s += exp(-(d - d1) / safeK);
        }
    }

    return log(max(s, 1.0));
}
