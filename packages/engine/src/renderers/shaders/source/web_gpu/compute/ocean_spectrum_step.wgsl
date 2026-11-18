// Advances static JONSWAP spectrum h0(k) in time using deep-water dispersion omega(k) = sqrt(g * k)
// and packs 8 real ocean fields into 4 complex spectra across specA and specB:
//   specA = [c0 = H + i*Dxx, c1 = Dx + i*Dz]
//   specB = [c2 = Sx + i*Sz, c3 = Dzz + i*Dxz]

struct OceanSpectrumStepParams {
    resolution: u32,
    patchSize: f32,
    time: f32,
    _pad0: u32,
}

@group(0) @binding(0) var<uniform> params: OceanSpectrumStepParams;
@group(0) @binding(1) var<storage, read> h0Buf: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> specA: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> specB: array<vec4f>;

const OCEAN_PI: f32 = 3.14159265359;
const OCEAN_G: f32 = 9.81;

fn cMul(a: vec2f, b: vec2f) -> vec2f {
    return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn packComplexPair(reField: vec2f, imField: vec2f) -> vec2f {
    // IDFT(reField + i * imField) = IDFT(reField) + i * IDFT(imField) when both fields are Hermitian.
    return vec2f(reField.x - imField.y, reField.y + imField.x);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = params.resolution;
    if (gid.x >= n || gid.y >= n) {
        return;
    }
    let halfN = n >> 1u;
    let idx = gid.y * n + gid.x;

    if ((gid.x == 0u && gid.y == 0u) || gid.x == halfN || gid.y == halfN) {
        specA[idx] = vec4f(0.0);
        specB[idx] = vec4f(0.0);
        return;
    }

    let kxInt = select(i32(gid.x) - i32(n), i32(gid.x), gid.x < halfN);
    let kzInt = select(i32(gid.y) - i32(n), i32(gid.y), gid.y < halfN);
    let dk = (2.0 * OCEAN_PI) / max(params.patchSize, 1.0);
    let kx = f32(kxInt) * dk;
    let kz = f32(kzInt) * dk;
    let kMag = length(vec2f(kx, kz));
    if (kMag < 1e-5) {
        specA[idx] = vec4f(0.0);
        specB[idx] = vec4f(0.0);
        return;
    }

    let omega = sqrt(OCEAN_G * kMag);
    let wt = omega * params.time;
    let phasePos = vec2f(cos(wt), sin(wt));
    let phaseNeg = vec2f(phasePos.x, -phasePos.y);

    let h0Packed = h0Buf[idx];
    let h = cMul(h0Packed.xy, phasePos) + cMul(h0Packed.zw, phaseNeg);

    let invK = 1.0 / kMag;
    let ixH = vec2f(-h.y, h.x);

    // +i*(kx/k)*h ensures inward Gerstner crest pinching (negative Dxx at wave crests).
    let dx = ixH * (kx * invK);
    let dz = ixH * (kz * invK);
    let sx = ixH * kx;
    let sz = ixH * kz;
    let dxx = h * (-(kx * kx) * invK);
    let dzz = h * (-(kz * kz) * invK);
    let dxz = h * (-(kx * kz) * invK);

    let c0 = packComplexPair(h, dxx);
    let c1 = packComplexPair(dx, dz);
    let c2 = packComplexPair(sx, sz);
    let c3 = packComplexPair(dzz, dxz);

    specA[idx] = vec4f(c0, c1);
    specB[idx] = vec4f(c2, c3);
}
