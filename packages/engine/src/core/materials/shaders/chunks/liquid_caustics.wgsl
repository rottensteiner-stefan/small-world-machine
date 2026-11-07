// Smooth Voronoi border line factor (F1 - SmoothF1) / k and domain warp for anime/Ghibli caustics in WGSL.

fn waterDomainWarp(p: vec2<f32>, t: f32) -> vec2<f32> {
    let nx = sin(p.y * 1.5 + t * 1.2) * 0.35 + cos(p.x * 2.1 - t * 0.8) * 0.2;
    let ny = cos(p.x * 1.8 + t * 1.1) * 0.35 + sin(p.y * 2.3 - t * 0.9) * 0.2;
    return p + vec2<f32>(nx, ny);
}

fn waterCausticLine(p: vec2<f32>, k: f32) -> f32 {
    let cell = floor(p);
    let localPos = fract(p);
    var d1: f32 = 8.0;

    // Pass 1: find nearest cell distance d1 (F1)
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let neighbor = vec2<f32>(f32(x), f32(y));
            let jitter = vec2<f32>(
                waterHash(cell + neighbor),
                waterHash(cell + neighbor + vec2<f32>(17.0, 31.0))
            );
            let diff = neighbor + jitter - localPos;
            d1 = min(d1, length(diff));
        }
    }

    // Pass 2: relative exponential sum relative to d1
    var s: f32 = 0.0;
    let safeK = max(k, 0.05);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let neighbor = vec2<f32>(f32(x), f32(y));
            let jitter = vec2<f32>(
                waterHash(cell + neighbor),
                waterHash(cell + neighbor + vec2<f32>(17.0, 31.0))
            );
            let diff = neighbor + jitter - localPos;
            let d = length(diff);
            s += exp(-(d - d1) / safeK);
        }
    }

    return log(max(s, 1.0));
}
