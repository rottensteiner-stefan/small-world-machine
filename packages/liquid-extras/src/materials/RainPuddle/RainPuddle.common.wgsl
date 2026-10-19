// WGSL twin of RainPuddle.common.glsl -- keep the two in lockstep.

// The liquid is data (ADR 0042): sigma/rho and nu arrive in a `fluid` vec4 built by rpFluid().
// Unlike the GLSL file there is no preprocessor switch: WebGPU always renders surface bubbles.

const RP_G: f32 = 9.81;
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

// fluid = (sigma/rho, nu, minimum group velocity, k_m). c_min = sqrt(2*sqrt(g*sigma/rho)) is the
// phase-speed minimum, the group velocity bottoms out at 0.768 of it; below k_m = sqrt(g/(sigma/rho))
// gravity dominates and the stationary-phase solve no longer tracks the capillary branch.
fn rpFluid(sigmaRho: f32, nu: f32) -> vec4f {
    let s = max(sigmaRho, 1.0e-7);
    let cMin = sqrt(2.0 * sqrt(RP_G * s));
    return vec4f(s, nu, 0.768 * cMin, sqrt(RP_G / s));
}

fn rpOmega(k: f32, depth: f32, sigmaRho: f32) -> f32 {
    return sqrt((RP_G * k + sigmaRho * k * k * k) * tanh(k * depth));
}

// Drops the d(tanh)/dk term: at the visible ripple wavenumbers (k*depth >~ 1) it changes c_g by a
// few percent, not worth the extra work per iteration.
fn rpGroupVelocity(k: f32, depth: f32, sigmaRho: f32) -> f32 {
    return (RP_G + 3.0 * sigmaRho * k * k) * tanh(k * depth) / (2.0 * rpOmega(k, depth, sigmaRho));
}

// Stationary phase: the wavenumber seen at radius r and age t is the one whose group velocity is r/t.
fn rpLocalWavenumber(v: f32, depth: f32, fluid: vec4f) -> f32 {
    var k = max(4.0 * v * v / (9.0 * fluid.x), fluid.w);
    for (var n = 0; n < 3; n++) {
        let ratio = v / rpGroupVelocity(k, depth, fluid.x);
        k = max(k * ratio * ratio, fluid.w);
    }
    return k;
}

// x = resolved radial slope d(eta)/dr, y = slope variance of the part too fine for the pixel footprint.
fn rpRipple(r: f32, age: f32, dropDiameter: f32, strength: f32, depth: f32, footprint: f32,
            fluid: vec4f) -> vec2f {
    let rSafe = max(r, 1.0e-4);
    let ageSafe = max(age, 1.0e-3);
    let v = rSafe / ageSafe;
    let k = rpLocalWavenumber(v, depth, fluid);
    let craterRadius = 1.5 * dropDiameter;
    let spectrum = exp(-0.25 * k * k * craterRadius * craterRadius);
    let propagating = smoothstep(fluid.z, fluid.z * 1.2, v);
    let damping = exp(-2.0 * fluid.y * k * k * ageSafe);
    // 2D geometric spreading ~ 1/sqrt(r), normalized where the ring has detached from the crater
    // splash (a few cm), not at the mm-sized crater itself.
    let spreading = sqrt(RP_SPREAD_REF / max(rSafe, RP_SPREAD_REF));
    let slope = strength * spectrum * propagating * damping * spreading * step(0.0, age);
    let phase = k * rSafe - rpOmega(k, depth, fluid.x) * ageSafe;
    let resolved = smoothstep(2.0, 4.0, (RP_TWO_PI / k) / max(footprint, 1.0e-5));
    return vec2f(slope * sin(phase) * resolved, 0.5 * slope * slope * (1.0 - resolved));
}

// Crown + Worthington-jet illusion for the first ~50 ms of an impact (ADR 0042, decision 3).
// x = radial slope d(eta)/dr, y = highlight weight. Sub-pixel crowns fade instead of aliasing.
fn rpCrown(r: f32, age: f32, diameter: f32, strength: f32, footprint: f32) -> vec2f {
    let craterRadius = 1.5 * diameter;
    let t = age / 0.05;
    let alive = step(0.0, age) * (1.0 - smoothstep(0.6, 1.0, t));
    let rimRadius = craterRadius * (1.0 + 0.8 * clamp(t, 0.0, 1.0));
    let x = (r - rimRadius) / (0.35 * craterRadius);
    let rim = exp(-x * x);
    let jetWindow = smoothstep(0.25, 0.4, t) * (1.0 - smoothstep(0.8, 1.0, t));
    let jetR = r / (0.4 * diameter);
    let jet = exp(-jetR * jetR) * jetWindow;
    let size = clamp(2.0 * craterRadius / max(footprint, 1.0e-5), 0.0, 1.0);
    return strength * vec2f(-2.4 * x * rim * alive * size * size, (0.6 * rim * alive + jet) * size);
}

// Floating hemispherical bubble: born once the crater has closed (~40 ms), lives `lifetime` seconds,
// radius 0.8-3.2x the drop diameter (a few mm). x = radial slope of the spherical cap, y = rim highlight.
fn rpBubble(r: f32, age: f32, diameter: f32, roll: f32, present: f32, lifetime: f32, footprint: f32) -> vec2f {
    let life = age - 0.04;
    let alive = present * step(0.0, life) * step(life, lifetime);
    let radius = clamp(diameter * mix(0.8, 3.2, roll), 5.0e-4, 4.0e-3) * mix(0.6, 1.0, smoothstep(0.0, 0.01, life));
    let q = r / radius;
    let inside = 1.0 - step(1.0, q);
    let qc = min(q, 0.95);
    let slope = -qc / sqrt(1.0 - qc * qc);
    let rimLight = smoothstep(0.7, 0.95, q);
    let size = clamp(radius / max(footprint, 1.0e-5), 0.0, 1.0);
    return alive * inside * vec2f(slope * size * size, rimLight * size);
}

// One stochastic drop per cell and period over the 3x3 neighbourhood. layerParams = (diameterMin,
// diameterMax, slopeScale, daughterProbability), fx = (crownStrength, bubbleProbability).
// xy = gradient, z = slope variance, w = crown/bubble highlight weight.
fn rpDropLayer(p: vec2f, time: f32, cellSize: f32, period: f32, density: f32, layerParams: vec4f,
               fx: vec2f, fluid: vec4f, bubbleLifetime: f32, depth: f32, footprint: f32, seed: f32) -> vec4f {
    var acc = vec4f(0.0);
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
            let diameter = mix(layerParams.x, layerParams.y, sizeRoll * sizeRoll);
            let strength = landed * layerParams.z * mix(0.6, 1.4, rpHash(dropKey + 21.2));
            let daughter = landed * step(rpHash(dropKey + 33.9), layerParams.w);
            let d = p - center;
            let r = length(d);
            let dir = d / max(r, 1.0e-5);
            let mainRing = rpRipple(r, age, diameter, strength, depth, footprint, fluid);
            // Worthington-jet daughter drop: lands ~0.1 s later at the same spot, ~0.4x the size.
            let daughterRing = rpRipple(r, age - 0.1, diameter * 0.4, strength * 0.6 * daughter, depth, footprint, fluid);
            let crown = rpCrown(r, age, diameter, landed * fx.x, footprint);
            let bubbleHere = landed * step(rpHash(dropKey + 47.3), fx.y);
            let bubble = rpBubble(r, age, diameter, rpHash(dropKey + 51.7), bubbleHere, bubbleLifetime, footprint);
            let radial = mainRing.x + daughterRing.x + crown.x + bubble.x;
            acc += vec4f(dir * radial, mainRing.y + daughterRing.y, crown.y + bubble.y);
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

// Beer-Lambert through the liquid column down to the ground and back up: path ~ 2*depth/cos(theta_t).
fn rpColumnTransmission(cosI: f32, ior: f32, depthMm: f32, absorptionPerMm: vec3f) -> vec3f {
    let c = clamp(cosI, 0.0, 1.0);
    let cosT = sqrt(max(1.0 - (1.0 - c * c) / (ior * ior), 0.0025));
    return exp(-absorptionPerMm * (2.0 * max(depthMm, 0.0) / cosT));
}

// rainLayer/dripLayer = (diameterMin, diameterMax, slopeScale, daughterProbability),
// fx = (rain crown, rain bubble, drip crown, drip bubble). Cell size and period stay per layer.
fn rpRainField(p: vec2f, time: f32, rainIntensity: f32, dripIntensity: f32, rainLayer: vec4f, dripLayer: vec4f,
               fx: vec4f, fluid: vec4f, bubbleLifetime: f32, depth: f32, footprint: f32) -> vec4f {
    let rain = rpDropLayer(p, time, 0.2, 0.5, rainIntensity, rainLayer, fx.xy, fluid, bubbleLifetime,
                           depth, footprint, 3.17);
    let drips = rpDropLayer(p, time, 0.45, 1.6, dripIntensity, dripLayer, fx.zw, fluid, bubbleLifetime,
                            depth, footprint, 41.9);
    return rain + drips;
}
