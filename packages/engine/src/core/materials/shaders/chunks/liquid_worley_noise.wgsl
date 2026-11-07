// Cheap 2D hash for the foam/caustics cell noise below -- fast dot-product polynomial hash without trigonometric calls.
fn waterHash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Worley/cellular noise: distance from `p` to the nearest jittered point among the 3x3
// neighboring grid cells. Produces the blotchy, cell-like coverage foam needs -- unlike smooth
// Perlin-style noise, its edges are naturally sharp, which reads as foam clumps rather than a
// soft gradient. Shared by every liquid surface material that needs shoreline/foam/caustics noise.
fn waterCellNoise(p: vec2<f32>) -> f32 {
    let cell = floor(p);
    let localPos = fract(p);
    var minDistSq = 1.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let neighbor = vec2<f32>(f32(x), f32(y));
            let jitter = vec2<f32>(
                waterHash(cell + neighbor),
                waterHash(cell + neighbor + vec2<f32>(17.0, 31.0))
            );
            let diff = neighbor + jitter - localPos;
            minDistSq = min(minDistSq, dot(diff, diff));
        }
    }
    return sqrt(minDistSq);
}
