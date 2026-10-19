// Shared by the GLSL300 and GLSL100 RainPuddle fragment shaders (texture-free on purpose, so the
// two dialects can include it verbatim). Physics: capillary-gravity dispersion, a stationary-phase
// ring profile per drop, viscous damping. The liquid is data (ADR 0042): sigma/rho and nu arrive in
// a `fluid` vec4 built by rpFluid(), so water, blood, oil and acid run through the same code.
// Define RP_BUBBLES before including this file to enable floating surface bubbles.

const float RP_G = 9.81;
const float RP_TWO_PI = 6.2831853;
const float RP_SPREAD_REF = 0.02;

float rpHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float rpNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = rpHash(i);
    float b = rpHash(i + vec2(1.0, 0.0));
    float c = rpHash(i + vec2(0.0, 1.0));
    float d = rpHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float rpFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int o = 0; o < 4; o++) {
        sum += rpNoise(p) * amp;
        p = p * 2.03 + vec2(17.1, 9.7);
        amp *= 0.5;
    }
    return sum;
}

// GLSL ES 1.00 has no tanh().
float rpTanh(float x) {
    float e = exp(-2.0 * clamp(x, 0.0, 10.0));
    return (1.0 - e) / (1.0 + e);
}

// fluid = (sigma/rho, nu, minimum group velocity, k_m). Both thresholds scale with sigma/rho:
// c_min = sqrt(2*sqrt(g*sigma/rho)) is the phase-speed minimum, the group velocity bottoms out at
// 0.768 of it (inside r/t below that no capillary ring exists yet). Below k_m = sqrt(g/(sigma/rho))
// gravity dominates and the stationary-phase solve no longer tracks the capillary branch.
vec4 rpFluid(float sigmaRho, float nu) {
    float s = max(sigmaRho, 1.0e-7);
    float cMin = sqrt(2.0 * sqrt(RP_G * s));
    return vec4(s, nu, 0.768 * cMin, sqrt(RP_G / s));
}

float rpOmega(float k, float depth, float sigmaRho) {
    return sqrt((RP_G * k + sigmaRho * k * k * k) * rpTanh(k * depth));
}

// Drops the d(tanh)/dk term: at the visible ripple wavenumbers (k*depth >~ 1) it changes c_g by a
// few percent, not worth a second exp per iteration.
float rpGroupVelocity(float k, float depth, float sigmaRho) {
    return (RP_G + 3.0 * sigmaRho * k * k) * rpTanh(k * depth) / (2.0 * rpOmega(k, depth, sigmaRho));
}

// Stationary phase: the wavenumber seen at radius r and age t is the one whose group velocity is r/t.
// Fixed-point iteration is exact for the pure-capillary power law c_g ~ k^0.5 and converges in a
// few steps on the full branch.
float rpLocalWavenumber(float v, float depth, vec4 fluid) {
    float k = max(4.0 * v * v / (9.0 * fluid.x), fluid.w);
    for (int n = 0; n < 3; n++) {
        float ratio = v / rpGroupVelocity(k, depth, fluid.x);
        k = max(k * ratio * ratio, fluid.w);
    }
    return k;
}

// x = resolved radial slope d(eta)/dr, y = slope variance of the part too fine for the pixel
// footprint (fed into roughness instead of aliasing).
vec2 rpRipple(float r, float age, float dropDiameter, float strength, float depth, float footprint,
              vec4 fluid) {
    float rSafe = max(r, 1.0e-4);
    float ageSafe = max(age, 1.0e-3);
    float v = rSafe / ageSafe;
    float k = rpLocalWavenumber(v, depth, fluid);
    float craterRadius = 1.5 * dropDiameter;
    float spectrum = exp(-0.25 * k * k * craterRadius * craterRadius);
    float propagating = smoothstep(fluid.z, fluid.z * 1.2, v);
    float damping = exp(-2.0 * fluid.y * k * k * ageSafe);
    // 2D geometric spreading ~ 1/sqrt(r), normalized where the ring has detached from the crater
    // splash (a few cm), not at the mm-sized crater itself.
    float spreading = sqrt(RP_SPREAD_REF / max(rSafe, RP_SPREAD_REF));
    float slope = strength * spectrum * propagating * damping * spreading * step(0.0, age);
    float phase = k * rSafe - rpOmega(k, depth, fluid.x) * ageSafe;
    float resolved = smoothstep(2.0, 4.0, (RP_TWO_PI / k) / max(footprint, 1.0e-5));
    return vec2(slope * sin(phase) * resolved, 0.5 * slope * slope * (1.0 - resolved));
}

// Crown + Worthington-jet illusion for the first ~50 ms of an impact (ADR 0042, decision 3): no
// geometry, only a raised rim travelling out of the crater and a bright point where the jet rises.
// x = radial slope d(eta)/dr, y = highlight weight. Sub-pixel crowns fade instead of aliasing.
vec2 rpCrown(float r, float age, float diameter, float strength, float footprint) {
    float craterRadius = 1.5 * diameter;
    float t = age / 0.05;
    float alive = step(0.0, age) * (1.0 - smoothstep(0.6, 1.0, t));
    float rimRadius = craterRadius * (1.0 + 0.8 * clamp(t, 0.0, 1.0));
    float x = (r - rimRadius) / (0.35 * craterRadius);
    float rim = exp(-x * x);
    float jetWindow = smoothstep(0.25, 0.4, t) * (1.0 - smoothstep(0.8, 1.0, t));
    float jetR = r / (0.4 * diameter);
    float jet = exp(-jetR * jetR) * jetWindow;
    float size = clamp(2.0 * craterRadius / max(footprint, 1.0e-5), 0.0, 1.0);
    return strength * vec2(-2.4 * x * rim * alive * size * size, (0.6 * rim * alive + jet) * size);
}

#ifdef RP_BUBBLES
// Floating hemispherical bubble the impact entrains: born once the crater has closed (~40 ms), lives
// `lifetime` seconds, radius 0.8-3.2x the drop diameter (a few mm). x = radial slope of the spherical
// cap, y = rim highlight where the cap turns grazing.
vec2 rpBubble(float r, float age, float diameter, float roll, float present, float lifetime, float footprint) {
    float life = age - 0.04;
    float alive = present * step(0.0, life) * step(life, lifetime);
    float radius = clamp(diameter * mix(0.8, 3.2, roll), 5.0e-4, 4.0e-3) * mix(0.6, 1.0, smoothstep(0.0, 0.01, life));
    float q = r / radius;
    float inside = 1.0 - step(1.0, q);
    float qc = min(q, 0.95);
    float slope = -qc / sqrt(1.0 - qc * qc);
    float rimLight = smoothstep(0.7, 0.95, q);
    float size = clamp(radius / max(footprint, 1.0e-5), 0.0, 1.0);
    return alive * inside * vec2(slope * size * size, rimLight * size);
}
#endif

// One stochastic drop per cell and period, re-randomized every period, evaluated over the 3x3
// neighbourhood so rings can cross cell borders. layerParams = (diameterMin, diameterMax,
// slopeScale, daughterProbability), fx = (crownStrength, bubbleProbability).
// xy = resolved height gradient, z = slope variance, w = crown/bubble highlight weight.
vec4 rpDropLayer(vec2 p, float time, float cellSize, float period, float density, vec4 layerParams,
                 vec2 fx, vec4 fluid, float bubbleLifetime, float depth, float footprint, float seed) {
    vec4 acc = vec4(0.0);
    vec2 cellBase = floor(p / cellSize);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 cell = cellBase + vec2(float(i), float(j));
            float cyclePhase = time / period + rpHash(cell + seed);
            float cycle = floor(cyclePhase);
            float age = fract(cyclePhase) * period;
            vec2 dropKey = cell + seed + cycle * vec2(1.618, 2.718);
            float landed = step(rpHash(dropKey), density);
            vec2 center = (cell + 0.1 + 0.8 * vec2(rpHash(dropKey + 5.1), rpHash(dropKey + 9.3))) * cellSize;
            float sizeRoll = rpHash(dropKey + 13.7);
            float diameter = mix(layerParams.x, layerParams.y, sizeRoll * sizeRoll);
            float strength = landed * layerParams.z * mix(0.6, 1.4, rpHash(dropKey + 21.2));
            float daughter = landed * step(rpHash(dropKey + 33.9), layerParams.w);
            vec2 d = p - center;
            float r = length(d);
            vec2 dir = d / max(r, 1.0e-5);
            vec2 mainRing = rpRipple(r, age, diameter, strength, depth, footprint, fluid);
            // Worthington-jet daughter drop: lands ~0.1 s later at the same spot, ~0.4x the size.
            vec2 daughterRing = rpRipple(r, age - 0.1, diameter * 0.4, strength * 0.6 * daughter, depth, footprint, fluid);
            vec2 crown = rpCrown(r, age, diameter, landed * fx.x, footprint);
            float radial = mainRing.x + daughterRing.x + crown.x;
            float highlight = crown.y;
#ifdef RP_BUBBLES
            float bubbleHere = landed * step(rpHash(dropKey + 47.3), fx.y);
            vec2 bubble = rpBubble(r, age, diameter, rpHash(dropKey + 51.7), bubbleHere, bubbleLifetime, footprint);
            radial += bubble.x;
            highlight += bubble.y;
#endif
            acc.xy += dir * radial;
            acc.z += mainRing.y + daughterRing.y;
            acc.w += highlight;
        }
    }
    return acc;
}

// Puddles are where the water level stands above the asphalt: low-frequency basins minus the
// aggregate height (bright stones stick out), so the shoreline frays exactly at the visible grains.
float rpWaterDepthMm(vec2 p, float asphaltLuma, vec4 pud0, vec4 pud1, vec4 pud2, vec4 pud3,
                     float basinDepthMm, float heightContrastMm, float edgeNoise) {
    vec2 q0 = (p - pud0.xy) / max(pud0.zw, vec2(1.0e-3));
    vec2 q1 = (p - pud1.xy) / max(pud1.zw, vec2(1.0e-3));
    vec2 q2 = (p - pud2.xy) / max(pud2.zw, vec2(1.0e-3));
    vec2 q3 = (p - pud3.xy) / max(pud3.zw, vec2(1.0e-3));
    float basin = max(max(exp(-dot(q0, q0)), exp(-dot(q1, q1))), max(exp(-dot(q2, q2)), exp(-dot(q3, q3))));
    // Wobble scales with the basin so open street far from any basin never floods by noise alone.
    float wobble = (rpFbm(p * 1.7) - 0.5) * edgeNoise;
    float grain = (asphaltLuma - 0.5) * heightContrastMm;
    return (basin * (1.0 + wobble) - 0.45) * basinDepthMm - grain;
}

// Exact unpolarized Fresnel for a dielectric: Schlick drifts ~15 % off at the 60-70 deg incidence a
// street camera sees puddles at.
float rpFresnelDielectric(float cosI, float ior) {
    float c = clamp(cosI, 0.0, 1.0);
    float sinT2 = (1.0 - c * c) / (ior * ior);
    float cosT = sqrt(max(1.0 - sinT2, 0.0));
    float rs = (c - ior * cosT) / (c + ior * cosT);
    float rp = (ior * c - cosT) / (ior * c + cosT);
    return 0.5 * (rs * rs + rp * rp);
}

// Beer-Lambert through the liquid column down to the ground and back up: path ~ 2*depth/cos(theta_t).
vec3 rpColumnTransmission(float cosI, float ior, float depthMm, vec3 absorptionPerMm) {
    float c = clamp(cosI, 0.0, 1.0);
    float cosT = sqrt(max(1.0 - (1.0 - c * c) / (ior * ior), 0.0025));
    return exp(-absorptionPerMm * (2.0 * max(depthMm, 0.0) / cosT));
}

// Rain = many small fast-dying rings, drips = rare big ones with daughter drops. Cell size and
// period stay per layer (weather), the drop physics comes from the liquid data:
// rainLayer/dripLayer = (diameterMin, diameterMax, slopeScale, daughterProbability),
// fx = (rain crown, rain bubble, drip crown, drip bubble).
vec4 rpRainField(vec2 p, float time, float rainIntensity, float dripIntensity, vec4 rainLayer, vec4 dripLayer,
                 vec4 fx, vec4 fluid, float bubbleLifetime, float depth, float footprint) {
    vec4 rain = rpDropLayer(p, time, 0.2, 0.5, rainIntensity, rainLayer, fx.xy, fluid, bubbleLifetime,
                            depth, footprint, 3.17);
    vec4 drips = rpDropLayer(p, time, 0.45, 1.6, dripIntensity, dripLayer, fx.zw, fluid, bubbleLifetime,
                             depth, footprint, 41.9);
    return rain + drips;
}
