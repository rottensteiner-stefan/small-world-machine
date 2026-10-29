fn smokeHash(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn smokeNoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = smokeHash(i);
    let b = smokeHash(i + vec2f(1.0, 0.0));
    let c = smokeHash(i + vec2f(0.0, 1.0));
    let d = smokeHash(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Lanes: matParam0 [time, churn, -, -]. The per-instance buffer carries the smoke tint (rgb) and
// the opacity (a); for smoke the alpha is opacity, NOT a size fold, so the emitter pairs this
// material with `ParticleMeshRenderer` foldAlphaIntoScale = false.
@fragment fn fs(i: Out) -> @location(0) vec4f {
    let inst = i.instColor;
    let d = length(i.uv - vec2f(0.5, 0.5));
    let blob = 1.0 - smoothstep(0.28, 0.5, d);

    // Coarse per-particle offset derived from the tint channels (quantised so the slow aging fade
    // does not visibly shuffle the shape every frame), plus a slow time scroll so the plume
    // writhes instead of popping between static frames.
    let offset = floor(inst.r * 5.0 + inst.g * 3.0 + inst.b * 7.0) / 13.0;
    let churnScroll = obj.matParam0.x * 0.35 * obj.matParam0.y;
    let n = smokeNoise(vec2f(
        i.uv.x * 5.0 + offset + churnScroll,
        i.uv.y * 5.0 - churnScroll * 1.3 + offset * 1.7,
    ));
    // Old, nearly transparent puffs dissolve into ragged wisps; young puffs stay soft.
    let dissolve = mix(0.1, 0.9, 1.0 - smoothstep(0.0, 0.22, inst.a));
    let rough = 1.0 - (n - 0.5) * dissolve;

    let opacity = blob * rough * inst.a;
    return vec4f(displayToTarget(inst.rgb), opacity);
}
