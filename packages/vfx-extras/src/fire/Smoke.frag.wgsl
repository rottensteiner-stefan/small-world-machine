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

// Analytic value + exact closed-form gradient of the cell noise (see Smoke.frag.glsl). Within a
// cell the hash corners are constants, so the chain rule through the smoothstep weights is exact.
fn smokeNoiseGrad(p: vec2f) -> vec3f {
    let i = floor(p);
    let f = p - i;
    let u = f * f * (3.0 - 2.0 * f);
    let du = 6.0 * f * (1.0 - f);
    let a = smokeHash(i);
    let b = smokeHash(i + vec2f(1.0, 0.0));
    let c = smokeHash(i + vec2f(0.0, 1.0));
    let d = smokeHash(i + vec2f(1.0, 1.0));
    let lo = mix(a, b, u.x);
    let hi = mix(c, d, u.x);
    let v = mix(lo, hi, u.y);
    let gx = mix(b - a, d - c, u.y) * du.x;
    let gy = (hi - lo) * du.y;
    return vec3f(v, gx, gy);
}

// 3-octave FBM of the analytic gradient field: xyz = (density, dD/dx, dD/dy). Chain rule
// multiplies each octave's gradient by its frequency.
fn smokeFbmGrad(p: vec2f) -> vec3f {
    var acc = vec3f(0.0);
    var amp = 0.5;
    var freq = 1.0;
    for (var o = 0; o < 3; o++) {
        let g = smokeNoiseGrad(p * freq);
        acc += vec3f(g.x * amp, g.y * amp * freq, g.z * amp * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return acc;
}

// Lanes: matParam0 [time, churn, softFadeDistance, softEnabled01],
// matParam1 [lightDir.xyz, lightIntensity], matParam2 [ambient, selfShadow, rimStrength,
// forwardScatter], matParam3 [lightScale, lightSlope, lightEnabled01, -], matParam4 [tintStart.rgba],
// matParam6 [tintEnd.rgba]. The per-instance buffer carries the per-particle seed (r) and the
// opacity (a); for smoke the alpha is opacity, NOT a size
// fold, so the emitter pairs this material with `ParticleMeshRenderer` foldAlphaIntoScale = false.
@fragment fn fs(i: Out) -> @location(0) vec4f {
    let inst = i.instColor;
    let d = length(i.uv - vec2f(0.5, 0.5));
    let blob = 1.0 - smoothstep(0.28, 0.5, d);

    // Per-particle seed: inst.r is written once at spawn and never animated (the emitter keeps the
    // colour ramp OFF the rgb channels), so the noise offset is lifetime-stable. The tint is rebuilt
    // from the opacity ramp: k = 1 at birth (alpha = start), 0 at death (alpha = end).
    let ramp = obj.matParam4.w - obj.matParam6.w;
    let k = select(1.0, clamp((inst.a - obj.matParam6.w) / ramp, 0.0, 1.0), abs(ramp) > 1e-4);
    let tint = mix(obj.matParam6.rgb, obj.matParam4.rgb, k);
    let offset = inst.r * 8.0;
    let churnScroll = obj.matParam0.x * 0.35 * obj.matParam0.y;
    let n = smokeNoise(vec2f(
        i.uv.x * 5.0 + offset + churnScroll,
        i.uv.y * 5.0 - churnScroll * 1.3 + offset * 1.7,
    ));
    // Old, nearly transparent puffs dissolve into ragged wisps; young puffs stay soft.
    let dissolve = mix(0.1, 0.9, 1.0 - smoothstep(0.0, 0.22, inst.a));
    let rough = 1.0 - (n - 0.5) * dissolve;

    var opacity = blob * rough * inst.a;

    // S2: soft particles via the shared opaque-depth texture (u_opaqueDepthMap @ group(1)
    // binding(16), ADR 0028 infra). alpha_soft = alpha * clamp((z_scene - z_particle)/d_fade, 0,
    // 1); discard when fully occluded. Skipped when softEnabled01 is 0 (byte-identical output).
    if (obj.matParam0.w > 0.5) {
        let depthDims = vec2<i32>(textureDimensions(u_opaqueDepthMap));
        let depthCoord = clamp(vec2<i32>(i.pos.xy), vec2<i32>(0), depthDims - vec2<i32>(1));
        var rawBg = textureLoad(u_opaqueDepthMap, depthCoord, 0);
        if (rawBg <= 0.0) { rawBg = 1.0; }
        let near = global.cameraNearFar.x;
        let far = global.cameraNearFar.y;
        let linBg = (2.0 * near * far) / (far + near - (rawBg * 2.0 - 1.0) * (far - near));
        let linFrag =
            (2.0 * near * far) / (far + near - (i.pos.z * 2.0 - 1.0) * (far - near));
        let soft = clamp((linBg - linFrag) / max(obj.matParam0.z, 1e-4), 0.0, 1.0);
        opacity = opacity * soft;
        if (soft <= 0.001) { discard; }
    }

    var color = tint;

    // S3: procedural 6-way volume lighting (0 MB). The FBM gradient supplies the in-plane axis
    // contributions (±u, ±v), +z is the billboard base. Analytic directional self-shadowing
    // (density attenuates) + Henyey-Greenstein forward-scatter rim. Disabled at 0 for golden
    // byte-parity with the pre-S3 material.
    if (obj.matParam3.z > 0.5) {
        let den = smokeFbmGrad(i.uv * obj.matParam3.x + vec2f(offset));
        let rho = clamp(den.x * 1.2, 0.0, 1.0);
        let normal3 = normalize(vec3f(-den.y * obj.matParam3.y, -den.z * obj.matParam3.y, 1.0));
        let lightDir = normalize(obj.matParam1.xyz);
        let ndl = max(dot(normal3, lightDir), 0.0);
        let shadow = 1.0 - smoothstep(0.25, 0.9, rho) * obj.matParam2.y;
        let mu = dot(normal3, lightDir);
        let g = obj.matParam2.w;
        let hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
        let lightFactor = clamp(
            obj.matParam2.x + obj.matParam1.w * (ndl * shadow + hg * obj.matParam2.z),
            0.0,
            3.0,
        );
        color = tint * lightFactor;
    }

    return vec4f(displayToTarget(color), opacity);
}
