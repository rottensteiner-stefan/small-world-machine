// 4-point astroid star billboards / sun glint with organic jitter and stepped time for anime water in WGSL.

fn waterGlintStar(p: vec2<f32>, steppedTime: f32, gate: f32) -> f32 {
    if (gate < 0.76) {
        return 0.0;
    }
    let cell = floor(p);
    let h = waterHash(cell + floor(steppedTime));
    if (h < 0.45) {
        return 0.0;
    }

    let jitter = (vec2<f32>(waterHash(cell + vec2<f32>(13.7, 37.1)), waterHash(cell + vec2<f32>(71.3, 19.9))) - 0.5) * 0.42;
    let localPos = fract(p) - 0.5 - jitter;

    let dx = abs(localPos.x);
    let dy = abs(localPos.y);

    let astroid = max(1.0 - (sqrt(dx) + sqrt(dy)) * 2.25, 0.0);
    let starCross = pow(astroid, 1.3) * 1.5;
    let diamondCore = max(1.0 - (dx + dy) * 5.5, 0.0);
    let halo = max(1.0 - length(localPos) * 3.8, 0.0);
    let bloomHalo = halo * halo * 0.35;

    let star = starCross + diamondCore * 0.75 + bloomHalo;
    let gateIntensity = smoothstep(0.76, 0.95, gate);
    return star * gateIntensity * (0.65 + 0.35 * sin(h * 6.28318));
}
