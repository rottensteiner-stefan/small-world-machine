// Cheap 2D hash for the foam/caustics cell noise below -- not a general-purpose PRNG, just enough
// decorrelation between neighboring cells to avoid an obviously repeating pattern.
float waterHash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Worley/cellular noise: distance from `p` to the nearest jittered point among the 3x3
// neighboring grid cells. Produces the blotchy, cell-like coverage foam needs -- unlike smooth
// Perlin-style noise, its edges are naturally sharp, which reads as foam clumps rather than a
// soft gradient. Shared by every liquid surface material that needs shoreline/foam/caustics noise.
// Plain GLSL ES 1.00-compatible syntax so the same source serves both the WebGL2 (glsl300) and
// WebGL1 (glsl100) backends.
float waterCellNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 localPos = fract(p);
    float minDistSq = 1.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 jitter = vec2(
                waterHash(cell + neighbor),
                waterHash(cell + neighbor + vec2(17.0, 31.0))
            );
            vec2 diff = neighbor + jitter - localPos;
            minDistSq = min(minDistSq, dot(diff, diff));
        }
    }
    return sqrt(minDistSq);
}
