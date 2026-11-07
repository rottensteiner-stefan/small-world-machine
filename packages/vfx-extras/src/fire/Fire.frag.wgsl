fn fireHash(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn fireNoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = fireHash(i);
    let b = fireHash(i + vec2f(1.0, 0.0));
    let c = fireHash(i + vec2f(0.0, 1.0));
    let d = fireHash(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fireFbm(p: vec2f) -> f32 {
    var n = fireNoise(p) * 0.5;
    n += fireNoise(p * 2.03 + 17.1) * 0.25;
    n += fireNoise(p * 4.01 + 41.7) * 0.125;
    return n / 0.875;
}

// Lanes: matParam0 [time, intensity, turbulence, flowSpeed], matParam1 [core.rgb, seed],
// matParam2 [body.rgb, edgeFadeAngle], matParam3 [tip.rgb, -], matParam4 [lean.xyz world shear, one-time]
// (matParam4 is consumed by the VERTEX shader — world-space lean shear, see Fire.vert.*).
@fragment fn fs(i: Out) -> @location(0) vec4f {
    let time = obj.matParam0.x * obj.matParam0.w;
    let intensity = obj.matParam0.y;
    let turbulence = obj.matParam0.z;
    let seed = obj.matParam1.w;

    let n = normalize(i.n);
    let viewDir = normalize(global.viewPos.xyz - i.wp);
    // Crossed cards seen edge-on collapse to a bright line; fade each card by its facing ratio.
    let edgeFade = smoothstep(0.0, obj.matParam2.w, abs(dot(n, viewDir)));

    let y = i.uv.y;
    let x = i.uv.x - 0.5;

    // Two layers scroll upward at different speeds; layer A displaces layer B (flow distortion).
    let nA = fireFbm(vec2f(x * 3.0 + seed, y * 2.0 - time * 1.3));
    let nB = fireFbm(vec2f(x * 4.0 + (nA - 0.5) * turbulence + seed * 1.7, y * 3.0 - time * 2.4));

    // The body tapers out below the card's top edge, so no tongue is ever clipped by the quad.
    let halfWidth = 0.46 * pow(max(0.95 - y, 0.0) / 0.95, 0.75) * smoothstep(-0.1, 0.25, y);
    let wobble = (nA - 0.5) * 0.3 * turbulence * y;
    let body = 1.0 - abs(x + wobble) / max(halfWidth, 1e-3);
    // Erosion grows with height: the base stays solid, the tip tears into tongues.
    let heat = clamp(body - (1.0 - nB) * 1.1 * pow(y, 0.8) + 0.25 * (1.0 - y), 0.0, 1.0);

    // Each column burns out at its own slowly wandering height: tongues end staggered, not on one line.
    let tip = 0.68 + 0.27 * fireNoise(vec2f(x * 7.0 + seed * 3.1, time * 1.7));
    let mask = smoothstep(0.0, 0.12, heat) * smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(tip - 0.2, tip, y));
    var color = mix(obj.matParam3.rgb, obj.matParam2.rgb, smoothstep(0.05, 0.35, heat));
    color = mix(color, obj.matParam1.rgb, smoothstep(0.45, 0.85, heat));

    let emission = displayToTarget(color) * (mask * edgeFade * intensity);
    return vec4f(emission, mask * edgeFade);
}
