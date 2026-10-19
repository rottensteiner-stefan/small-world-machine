// Shared by the GLSL300 and GLSL100 RainPuddle fragment shaders (texture-free on purpose, so the
// two dialects can include it verbatim). Physics and constants: .agents/scratches/puddle/analysis.md
// sections 2.3-2.4b (capillary-gravity dispersion, stationary-phase ring profile, viscous damping).

const float RP_G = 9.81;
const float RP_SIGMA_RHO = 7.3e-5;
const float RP_NU = 1.0e-6;
// Minimum group velocity of capillary-gravity waves: inside r/t < this no capillary ring exists yet.
const float RP_CG_MIN = 0.178;
// k_m = sqrt(rho*g/sigma): below it gravity dominates and the stationary-phase solve below no longer
// tracks the capillary branch the visible ripples live on.
const float RP_K_MIN = 370.0;
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

float rpOmega(float k, float depth) {
    return sqrt((RP_G * k + RP_SIGMA_RHO * k * k * k) * rpTanh(k * depth));
}

// Drops the d(tanh)/dk term: at the visible ripple wavenumbers (k*depth >~ 1) it changes c_g by a
// few percent, not worth a second exp per iteration.
float rpGroupVelocity(float k, float depth) {
    return (RP_G + 3.0 * RP_SIGMA_RHO * k * k) * rpTanh(k * depth) / (2.0 * rpOmega(k, depth));
}

// Stationary phase: the wavenumber seen at radius r and age t is the one whose group velocity is r/t.
// Fixed-point iteration is exact for the pure-capillary power law c_g ~ k^0.5 and converges in a
// few steps on the full branch.
float rpLocalWavenumber(float v, float depth) {
    float k = max(4.0 * v * v / (9.0 * RP_SIGMA_RHO), RP_K_MIN);
    for (int n = 0; n < 3; n++) {
        float ratio = v / rpGroupVelocity(k, depth);
        k = max(k * ratio * ratio, RP_K_MIN);
    }
    return k;
}

// x = resolved radial slope d(eta)/dr, y = slope variance of the part too fine for the pixel
// footprint (fed into roughness instead of aliasing).
vec2 rpRipple(float r, float age, float dropDiameter, float strength, float depth, float footprint) {
    float rSafe = max(r, 1.0e-4);
    float ageSafe = max(age, 1.0e-3);
    float v = rSafe / ageSafe;
    float k = rpLocalWavenumber(v, depth);
    float craterRadius = 1.5 * dropDiameter;
    float spectrum = exp(-0.25 * k * k * craterRadius * craterRadius);
    float propagating = smoothstep(RP_CG_MIN, RP_CG_MIN * 1.2, v);
    float damping = exp(-2.0 * RP_NU * k * k * ageSafe);
    // 2D geometric spreading ~ 1/sqrt(r), normalized where the ring has detached from the crater
    // splash (a few cm), not at the mm-sized crater itself.
    float spreading = sqrt(RP_SPREAD_REF / max(rSafe, RP_SPREAD_REF));
    float slope = strength * spectrum * propagating * damping * spreading * step(0.0, age);
    float phase = k * rSafe - rpOmega(k, depth) * ageSafe;
    float resolved = smoothstep(2.0, 4.0, (RP_TWO_PI / k) / max(footprint, 1.0e-5));
    return vec2(slope * sin(phase) * resolved, 0.5 * slope * slope * (1.0 - resolved));
}

// One stochastic drop per cell and period, re-randomized every period, evaluated over the 3x3
// neighbourhood so rings can cross cell borders. xy = resolved height gradient, z = slope variance.
vec3 rpDropLayer(vec2 p, float time, float cellSize, float period, float density, vec2 diameterRange,
                 float daughterProb, float slopeScale, float depth, float footprint, float seed) {
    vec3 acc = vec3(0.0);
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
            float diameter = mix(diameterRange.x, diameterRange.y, sizeRoll * sizeRoll);
            float strength = landed * slopeScale * mix(0.6, 1.4, rpHash(dropKey + 21.2));
            float daughter = landed * step(rpHash(dropKey + 33.9), daughterProb);
            vec2 d = p - center;
            float r = length(d);
            vec2 dir = d / max(r, 1.0e-5);
            vec2 mainRing = rpRipple(r, age, diameter, strength, depth, footprint);
            // Worthington-jet daughter drop: lands ~0.1 s later at the same spot, ~0.4x the size.
            vec2 daughterRing = rpRipple(r, age - 0.1, diameter * 0.4, strength * 0.6 * daughter, depth, footprint);
            acc.xy += dir * (mainRing.x + daughterRing.x);
            acc.z += mainRing.y + daughterRing.y;
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
// street camera sees puddles at (analysis.md 3.2).
float rpFresnelDielectric(float cosI, float ior) {
    float c = clamp(cosI, 0.0, 1.0);
    float sinT2 = (1.0 - c * c) / (ior * ior);
    float cosT = sqrt(max(1.0 - sinT2, 0.0));
    float rs = (c - ior * cosT) / (c + ior * cosT);
    float rp = (ior * c - cosT) / (ior * c + cosT);
    return 0.5 * (rs * rs + rp * rp);
}

// Rain = many small fast-dying rings, drips = rare big ones with daughter drops (analysis.md 2.4b).
vec3 rpRainField(vec2 p, float time, float rainIntensity, float dripIntensity, float depth, float footprint) {
    vec3 rain = rpDropLayer(p, time, 0.2, 0.5, rainIntensity, vec2(0.0005, 0.0013), 0.0, 0.09, depth, footprint, 3.17);
    vec3 drips = rpDropLayer(p, time, 0.45, 1.6, dripIntensity, vec2(0.0022, 0.0045), 0.6, 0.22, depth, footprint, 41.9);
    return rain + drips;
}
