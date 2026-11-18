[WGSL_STRUCTS]

const OCEAN_PI: f32 = 3.14159265359;
const OCEAN_G: f32 = 9.81;

fn rot2D(v: vec2f, a: f32) -> vec2f {
    let c = cos(a);
    let s = sin(a);
    return vec2f(v.x * c - v.y * s, v.x * s + v.y * c);
}

fn evalOceanWave(
    dir: vec2f,
    steepness: f32,
    wavelength: f32,
    wp: vec3f,
    speed: f32,
    time: f32,
    phaseOffset: f32,
    t: ptr<function, vec3f>,
    b: ptr<function, vec3f>,
) -> vec3f {
    if (steepness <= 0.0001 || wavelength <= 0.001) {
        return vec3f(0.0);
    }
    let k = (2.0 * OCEAN_PI) / wavelength;
    let c = sqrt(OCEAN_G / k) * speed;
    let perp = vec2f(-dir.y, dir.x);
    // Low-frequency wave-group envelope prevents parallel horizon "worm" stripes.
    let groupEnv = 0.78 + 0.22 * cos(dot(wp.xz, perp) * (k * 0.19) + time * 0.28 + phaseOffset);
    let amp = (steepness / k) * groupEnv;
    let f = k * (dot(dir, wp.xz) - c * time) + phaseOffset;
    let sinF = sin(f);
    let cosF = cos(f);
    let q = clamp(steepness * groupEnv, 0.0, 0.85);

    *t += vec3f(
        -dir.x * dir.x * (q * sinF),
        dir.x * (q * cosF),
        -dir.x * dir.y * (q * sinF)
    );
    *b += vec3f(
        -dir.x * dir.y * (q * sinF),
        dir.y * (q * cosF),
        -dir.y * dir.y * (q * sinF)
    );

    return vec3f(
        dir.x * (amp * cosF),
        amp * sinF,
        dir.y * (amp * cosF)
    );
}

@vertex
fn vs(
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec4f
) -> Out {
    var o: Out;

    let time = obj.time;
    let speed = obj.reflectivity;
    let rawWind = obj.matParam2.xy;
    let windLen = length(rawWind);
    let windDir = select(vec2f(0.84, 0.54), rawWind / max(windLen, 1e-4), windLen > 1e-4);
    let waveScale = max(obj.matParam2.z, 0.0);
    let lambda = max(obj.matParam2.w, 2.0);
    let fadeStart = obj.matParam3.x;
    let fadeEnd = max(obj.matParam3.y, fadeStart + 1.0);

    var wp = (obj.model * vec4f(pos, 1.0)).xyz;
    let radialDist = length(wp.xz - global.viewPos.xz);
    let swellFade = 1.0 - smoothstep(fadeStart, fadeEnd, radialDist);

    var t = vec3f(1.0, 0.0, 0.0);
    var b = vec3f(0.0, 0.0, 1.0);
    var disp = vec3f(0.0);
    var crestMetric = 0.0;

#ifdef USE_OCEAN_FFT
    let patchSize = max(obj.matParam5.z, 16.0);
    let uvA = wp.xz / patchSize;
    let uvB = rot2D(wp.xz, 0.541) / (patchSize * 0.43) + vec2f(0.37, 0.71);
    let dispA = textureSampleLevel(u_oceanDispMap, s, uvA, 0.0);
    let dispB = textureSampleLevel(u_oceanDispMap, s, uvB, 0.0);
    let dispBWorldXZ = rot2D(dispB.xz, -0.541);
    let fftDisp = vec3f(
        dispA.x + dispBWorldXZ.x * 0.35,
        dispA.y * 0.85 + dispB.y * 0.30,
        dispA.z + dispBWorldXZ.y * 0.35
    ) * swellFade;

    // Long macro directional swell layered beneath FFT breaks horizon periodicity cleanly.
    let macroDisp = evalOceanWave(windDir, 0.09 * waveScale * swellFade, lambda * 2.1, wp, speed, time, 0.73, &t, &b);
    disp = fftDisp + macroDisp;

    let foldMetric = clamp((dispA.w * 0.8 + dispB.w * 0.35) * 0.9, 0.0, 1.0);
    let heightMetric = clamp(disp.y / max(waveScale * 1.4, 0.15), 0.0, 1.0);
    crestMetric = clamp((heightMetric * 0.55 + foldMetric * 0.65) * swellFade, 0.0, 1.0);
#else
    // 5 incommensurate directions + golden-ratio wavelength cadence eliminate repeating grid lines
    disp += evalOceanWave(windDir,               0.19 * waveScale * swellFade, lambda,        wp, speed, time, 0.0,  &t, &b);
    disp += evalOceanWave(rot2D(windDir,  0.42), 0.16 * waveScale * swellFade, lambda * 0.64, wp, speed, time, 1.37, &t, &b);
    disp += evalOceanWave(rot2D(windDir, -0.58), 0.13 * waveScale * swellFade, lambda * 0.43, wp, speed, time, 2.91, &t, &b);
    disp += evalOceanWave(rot2D(windDir,  1.17), 0.10 * waveScale * swellFade, lambda * 0.27, wp, speed, time, 4.13, &t, &b);
    disp += evalOceanWave(rot2D(windDir, -1.40), 0.08 * waveScale * swellFade, lambda * 0.17, wp, speed, time, 5.48, &t, &b);

    let jacobian = t.x * b.z - t.z * b.x;
    let heightMetric = clamp(disp.y / max(waveScale * 1.4, 0.15), 0.0, 1.0);
    let pinchMetric = clamp((1.0 - jacobian) * 1.4, 0.0, 1.0);
    crestMetric = clamp((heightMetric * 0.65 + pinchMetric * 0.55) * swellFade, 0.0, 1.0);
#endif

    wp += disp;
    o.wp = wp;
    o.pos = global.vp * vec4f(wp, 1.0);

    let waveN = normalize(cross(b, t));
    let upN = vec3f(0.0, 1.0, 0.0);
    o.n = normalize(mix(upN, waveN, swellFade));
    o.t = normalize(t);
    o.b = normalize(b);
    o.uv = uv;
    o.original_uv = vec2f(crestMetric, swellFade);

    return o;
}
