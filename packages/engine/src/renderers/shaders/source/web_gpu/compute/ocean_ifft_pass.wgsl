// 1D in-place Cooley-Tukey Radix-2 DIT Inverse FFT over rows (direction == 0) or columns (direction == 1).
// Fixed N = 256 per workgroup: processes two packed complex pairs per texel (specA + specB).

struct OceanIfftParams {
    resolution: u32,
    direction: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: OceanIfftParams;
@group(0) @binding(1) var<storage, read> inA: array<vec4f>;
@group(0) @binding(2) var<storage, read> inB: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outA: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> outB: array<vec4f>;

const OCEAN_PI: f32 = 3.14159265359;

// 256 elements x 2 vec4f (4 complex lanes) = 8192 bytes <= 16 KB guaranteed shared memory.
var<workgroup> sharedBuf: array<vec4f, 512>;

fn cMul(a: vec2f, b: vec2f) -> vec2f {
    return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

@compute @workgroup_size(256, 1, 1)
fn main(
    @builtin(local_invocation_id) lid: vec3u,
    @builtin(workgroup_id) wid: vec3u,
) {
    let n = params.resolution;
    let i = lid.x;

    let row = select(i, wid.y, params.direction == 0u);
    let col = select(wid.x, i, params.direction == 0u);
    let globalIdx = row * n + col;

    // 8-bit reversal for N = 256: reverseBits(0..255) >> 24u.
    let rev = reverseBits(i) >> 24u;
    sharedBuf[rev * 2u] = inA[globalIdx];
    sharedBuf[rev * 2u + 1u] = inB[globalIdx];
    workgroupBarrier();

    for (var stage: u32 = 0u; stage < 8u; stage++) {
        if (i < 128u) {
            let m = 2u << stage;
            let halfM = 1u << stage;
            let k = i & (halfM - 1u);
            let base = ((i >> stage) << (stage + 1u)) + k;
            let pair = base + halfM;

            let angle = (2.0 * OCEAN_PI * f32(k)) / f32(m);
            let w = vec2f(cos(angle), sin(angle));

            let a0 = sharedBuf[base * 2u];
            let a1 = sharedBuf[base * 2u + 1u];
            let b0 = sharedBuf[pair * 2u];
            let b1 = sharedBuf[pair * 2u + 1u];

            let wb0xy = cMul(w, b0.xy);
            let wb0zw = cMul(w, b0.zw);
            let wb1xy = cMul(w, b1.xy);
            let wb1zw = cMul(w, b1.zw);

            sharedBuf[base * 2u] = vec4f(a0.xy + wb0xy, a0.zw + wb0zw);
            sharedBuf[pair * 2u] = vec4f(a0.xy - wb0xy, a0.zw - wb0zw);
            sharedBuf[base * 2u + 1u] = vec4f(a1.xy + wb1xy, a1.zw + wb1zw);
            sharedBuf[pair * 2u + 1u] = vec4f(a1.xy - wb1xy, a1.zw - wb1zw);
        }
        workgroupBarrier();
    }

    outA[globalIdx] = sharedBuf[i * 2u];
    outB[globalIdx] = sharedBuf[i * 2u + 1u];
}
