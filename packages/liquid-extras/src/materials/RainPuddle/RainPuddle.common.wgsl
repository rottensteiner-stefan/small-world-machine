// WGSL twin of RainPuddle.common.glsl -- keep the two in lockstep.

const RP_G: f32 = 9.81;
const RP_SIGMA_RHO: f32 = 7.3e-5;
const RP_NU: f32 = 1.0e-6;
// Minimum group velocity of capillary-gravity waves: inside r/t < this no capillary ring exists yet.
const RP_CG_MIN: f32 = 0.178;
// k_m = sqrt(rho*g/sigma): below it gravity dominates and the stationary-phase solve below no longer
// tracks the capillary branch the visible ripples live on.
const RP_K_MIN: f32 = 370.0;
const RP_TWO_PI: f32 = 6.2831853;
const RP_SPREAD_REF: f32 = 0.02;

fn rpHash(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn rpNoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = rpHash(i);
    let b = rpHash(i + vec2f(1.0, 0.0));
    let c = rpHash(i + vec2f(0.0, 1.0));
    let d = rpHash(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn rpFbm(pIn: vec2f) -> f32 {
    var p = pIn;
    var sum = 0.0;
    var amp = 0.5;
    for (var o = 0; o < 4; o++) {
        sum += rpNoise(p) * amp;
        p = p * 2.03 + vec2f(17.1, 9.7);
        amp *= 0.5;
    }
    return sum;
}

fn rpOmega(k: f32, depth: f32) -> f32 {
    return sqrt((RP_G * k + RP_SIGMA_RHO * k * k * k) * tanh(k * depth));
}

// Drops the d(tanh)/dk term: at the visible ripple wavenumbers (k*depth >~ 1) it changes c_g by a
// few percent, not worth the extra work per iteration.
fn rpGroupVelocity(k: f32, depth: f32) -> f32 {
    return (RP_G + 3.0 * RP_SIGMA_RHO * k * k) * tanh(k * depth) / (2.0 * rpOmega(k, depth));
}

// Stationary phase: the wavenumber seen at radius r and age t is the one whose group velocity is r/t.
fn rpLocalWavenumber(v: f32, depth: f32) -> f32 {
    var k = max(4.0 * v * v / (9.0 * RP_SIGMA_RHO), RP_K_MIN);
    for (var n = 0; n < 3; n++) {
        let ratio = v / rpGroupVelocity(k, depth);
        k = max(k * ratio * ratio, RP_K_MIN);
    }
    return k;
}

// x = resolved radial slope d(eta)/dr, y = slope variance of the part too fine for the pixel footprint.
fn rpRipple(r: f32, age: f32, dropDiameter: f32, strength: f32, depth: f32, footprint: f32) -> vec2f {
    let rSafe = max(r, 1.0e-4);
    let ageSafe = max(age, 1.0e-3);
    let v = rSafe / ageSafe;
    let k = rpLocalWavenumber(v, depth);
    let craterRadius = 1.5 * dropDiameter;
    let spectrum = exp(-0.25 * k * k * craterRadius * craterRadius);
    let propagating = smoothstep(RP_CG_MIN, RP_CG_MIN * 1.2, v);
    let damping = exp(-2.0 * RP_NU * k * k * ageSafe);
    // 2D geometric spreading ~ 1/sqrt(r), normalized where the ring has detached from the crater
    // splash (a few cm), not at the mm-sized crater itself.
    let spreading = sqrt(RP_SPREAD_REF / max(rSafe, RP_SPREAD_REF));
    let slope = strength * spectrum * propagating * damping * spreading * step(0.0, age);
    let phase = k * rSafe - rpOmega(k, depth) * ageSafe;
    let resolved = smoothstep(2.0, 4.0, (RP_TWO_PI / k) / max(footprint, 1.0e-5));
    return vec2f(slope * sin(phase) * resolved, 0.5 * slope * slope * (1.0 - resolved));
}

// One stochastic drop per cell and period over the 3x3 neighbourhood. xy = gradient, z = slope variance.
fn rpDropLayer(p: vec2f, time: f32, cellSize: f32, period: f32, density: f32, diameterRange: vec2f,
               daughterProb: f32, slopeScale: f32, depth: f32, footprint: f32, seed: f32) -> vec3f {
    var acc = vec3f(0.0);
    let cellBase = floor(p / cellSize);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let cell = cellBase + vec2f(f32(i), f32(j));
            let cyclePhase = time / period + rpHash(cell + seed);
            let cycle = floor(cyclePhase);
            let age = fract(cyclePhase) * period;
            let dropKey = cell + seed + cycle * vec2f(1.618, 2.718);
            let landed = step(rpHash(dropKey), density);
            let center = (cell + 0.1 + 0.8 * vec2f(rpHash(dropKey + 5.1), rpHash(dropKey + 9.3))) * cellSize;
            let sizeRoll = rpHash(dropKey + 13.7);
            let diameter = mix(diameterRange.x, diameterRange.y, sizeRoll * sizeRoll);
            let strength = landed * slopeScale * mix(0.6, 1.4, rpHash(dropKey + 21.2));
            let daughter = landed * step(rpHash(dropKey + 33.9), daughterProb);
            let d = p - center;
            let r = length(d);
            let dir = d / max(r, 1.0e-5);
            let mainRing = rpRipple(r, age, diameter, strength, depth, footprint);
            // Worthington-jet daughter drop: lands ~0.1 s later at the same spot, ~0.4x the size.
            let daughterRing = rpRipple(r, age - 0.1, diameter * 0.4, strength * 0.6 * daughter, depth, footprint);
            acc = vec3f(acc.xy + dir * (mainRing.x + daughterRing.x), acc.z + mainRing.y + daughterRing.y);
        }
    }
    return acc;
}

fn rpWaterDepthMm(p: vec2f, asphaltLuma: f32, pud0: vec4f, pud1: vec4f, pud2: vec4f, pud3: vec4f,
                  basinDepthMm: f32, heightContrastMm: f32, edgeNoise: f32) -> f32 {
    let q0 = (p - pud0.xy) / max(pud0.zw, vec2f(1.0e-3));
    let q1 = (p - pud1.xy) / max(pud1.zw, vec2f(1.0e-3));
    let q2 = (p - pud2.xy) / max(pud2.zw, vec2f(1.0e-3));
    let q3 = (p - pud3.xy) / max(pud3.zw, vec2f(1.0e-3));
    let basin = max(max(exp(-dot(q0, q0)), exp(-dot(q1, q1))), max(exp(-dot(q2, q2)), exp(-dot(q3, q3))));
    // Wobble scales with the basin so open street far from any basin never floods by noise alone.
    let wobble = (rpFbm(p * 1.7) - 0.5) * edgeNoise;
    let grain = (asphaltLuma - 0.5) * heightContrastMm;
    return (basin * (1.0 + wobble) - 0.45) * basinDepthMm - grain;
}

fn rpFresnelDielectric(cosI: f32, ior: f32) -> f32 {
    let c = clamp(cosI, 0.0, 1.0);
    let sinT2 = (1.0 - c * c) / (ior * ior);
    let cosT = sqrt(max(1.0 - sinT2, 0.0));
    let rs = (c - ior * cosT) / (c + ior * cosT);
    let rp = (ior * c - cosT) / (ior * c + cosT);
    return 0.5 * (rs * rs + rp * rp);
}

fn rpRainField(p: vec2f, time: f32, rainIntensity: f32, dripIntensity: f32, depth: f32, footprint: f32) -> vec3f {
    let rain = rpDropLayer(p, time, 0.2, 0.5, rainIntensity, vec2f(0.0005, 0.0013), 0.0, 0.09, depth, footprint, 3.17);
    let drips = rpDropLayer(p, time, 0.45, 1.6, dripIntensity, vec2f(0.0022, 0.0045), 0.6, 0.22, depth, footprint, 41.9);
    return rain + drips;
}
