// Generates static initial JONSWAP directional sea spectrum h0(k) & conj(h0(-k)).
// Packed vec4f output per bin: [h0(k).re, h0(k).im, conj(h0(-k)).re, conj(h0(-k)).im].

struct OceanSpectrumInitParams {
    resolution: u32,
    patchSize: f32,
    windSpeed: f32,
    waveScale: f32,
    windDir: vec2f,
    seed: u32,
    _pad0: u32,
}

@group(0) @binding(0) var<uniform> params: OceanSpectrumInitParams;
@group(0) @binding(1) var<storage, read_write> h0Out: array<vec4f>;

const OCEAN_PI: f32 = 3.14159265359;
const OCEAN_G: f32 = 9.81;

fn pcgHash(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn hashGaussian(kx: i32, kz: i32, seed: u32) -> vec2f {
    let ux = bitcast<u32>(kx);
    let uz = bitcast<u32>(kz);
    let h0 = pcgHash(ux ^ pcgHash(uz ^ seed));
    let h1 = pcgHash(h0 ^ 0x9e3779b9u);
    let u1 = max(f32(h0) / 4294967296.0, 1e-6);
    let u2 = f32(h1) / 4294967296.0;
    let mag = sqrt(-2.0 * log(u1));
    let ang = 2.0 * OCEAN_PI * u2;
    return vec2f(mag * cos(ang), mag * sin(ang));
}

fn evalJonswapH0(kxInt: i32, kzInt: i32) -> vec2f {
    if (kxInt == 0 && kzInt == 0) {
        return vec2f(0.0);
    }
    let dk = (2.0 * OCEAN_PI) / max(params.patchSize, 1.0);
    let k = vec2f(f32(kxInt), f32(kzInt)) * dk;
    let kMag = length(k);
    if (kMag < 1e-5) {
        return vec2f(0.0);
    }

    let omega = sqrt(OCEAN_G * kMag);
    let u10 = clamp(7.5 + params.windSpeed * 6.5, 4.0, 26.0);
    let fetch = 85000.0;
    let dimFetch = (OCEAN_G * fetch) / (u10 * u10);
    let alpha = 0.076 * pow(dimFetch, -0.22);
    let omegaP = 2.0 * OCEAN_PI * 3.5 * (OCEAN_G / u10) * pow(dimFetch, -0.33);

    let sigma = select(0.09, 0.07, omega <= omegaP);
    let rExp = (omega - omegaP) / (sigma * omegaP);
    let r = exp(-0.5 * rExp * rExp);
    let peakBoost = pow(3.3, r);
    let wRatio = omegaP / max(omega, 1e-4);
    let wRatio4 = wRatio * wRatio * wRatio * wRatio;
    let omega5 = omega * omega * omega * omega * omega;
    let sJonswap = (alpha * OCEAN_G * OCEAN_G / max(omega5, 1e-6)) * exp(-1.25 * wRatio4) * peakBoost;

    let windLen = length(params.windDir);
    let windUnit = select(vec2f(0.84, 0.54), params.windDir / max(windLen, 1e-4), windLen > 1e-4);
    let kDir = k / kMag;
    let cosTheta = dot(kDir, windUnit);
    let halfCos = max(0.5 + 0.5 * cosTheta, 0.0);
    let dWind = 0.695 * pow(halfCos, 6.0);
    let dRefl = 0.025 / (2.0 * OCEAN_PI);
    let dirSpread = mix(dRefl, dWind + dRefl, 0.94);

    // Jacobian dw/dk * (1/k) * dk^2 converts continuous S(w)D(theta) into per-bin variance.
    let dOmegaDk = OCEAN_G / (2.0 * omega);
    let shortCut = (params.patchSize / f32(params.resolution)) * 0.45;
    let capDamp = exp(-kMag * kMag * shortCut * shortCut);
    let variance = max(sJonswap * dirSpread * (dOmegaDk / kMag) * (dk * dk) * capDamp, 0.0);

    let xi = hashGaussian(kxInt, kzInt, params.seed);
    return xi * (0.5 * params.waveScale * sqrt(variance));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = params.resolution;
    if (gid.x >= n || gid.y >= n) {
        return;
    }
    let halfN = n >> 1u;
    let idx = gid.y * n + gid.x;

    // Zero DC and Nyquist row/col so every remaining k has a distinct -k partner in (-halfN, halfN).
    if ((gid.x == 0u && gid.y == 0u) || gid.x == halfN || gid.y == halfN) {
        h0Out[idx] = vec4f(0.0);
        return;
    }

    let kxInt = select(i32(gid.x) - i32(n), i32(gid.x), gid.x < halfN);
    let kzInt = select(i32(gid.y) - i32(n), i32(gid.y), gid.y < halfN);

    let h0Pos = evalJonswapH0(kxInt, kzInt);
    let h0Neg = evalJonswapH0(-kxInt, -kzInt);
    h0Out[idx] = vec4f(h0Pos.x, h0Pos.y, h0Neg.x, -h0Neg.y);
}
