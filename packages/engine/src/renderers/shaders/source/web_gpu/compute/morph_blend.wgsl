struct MorphParams {
    vertexCount: u32,
    targetCount: u32,
    hasNormals: u32,
    hasTangents: u32,
    baseNormOffset: u32,
    baseTanOffset: u32,
    _pad0: u32,
    _pad1: u32,
}

const NO_DELTA: u32 = 0xFFFFFFFFu;
const WEIGHT_EPSILON: f32 = 1e-6;

@group(0) @binding(0) var<uniform> params: MorphParams;
@group(0) @binding(1) var<storage, read> baseAttrs: array<f32>;
@group(0) @binding(2) var<storage, read> deltaAttrs: array<f32>;
@group(0) @binding(3) var<storage, read> targetMeta: array<vec4<u32>>;
@group(0) @binding(4) var<storage, read> weights: array<f32>;
@group(0) @binding(5) var<storage, read_write> outPos: array<f32>;
@group(0) @binding(6) var<storage, read_write> outNorm: array<f32>;
@group(0) @binding(7) var<storage, read_write> outTan: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let v = gid.x;
    if (v >= params.vertexCount) {
        return;
    }

    let v3 = v * 3u;
    var px = baseAttrs[v3];
    var py = baseAttrs[v3 + 1u];
    var pz = baseAttrs[v3 + 2u];

    var nx: f32 = 0.0;
    var ny: f32 = 0.0;
    var nz: f32 = 0.0;
    if (params.hasNormals != 0u) {
        let nb = params.baseNormOffset + v3;
        nx = baseAttrs[nb];
        ny = baseAttrs[nb + 1u];
        nz = baseAttrs[nb + 2u];
    }

    var tx: f32 = 0.0;
    var ty: f32 = 0.0;
    var tz: f32 = 0.0;
    var tw: f32 = 1.0;
    if (params.hasTangents != 0u) {
        let tb = params.baseTanOffset + v * 4u;
        tx = baseAttrs[tb];
        ty = baseAttrs[tb + 1u];
        tz = baseAttrs[tb + 2u];
        tw = baseAttrs[tb + 3u];
    }

    var touchedN = false;
    var touchedT = false;

    for (var t: u32 = 0u; t < params.targetCount; t = t + 1u) {
        let w = weights[t];
        if (abs(w) <= WEIGHT_EPSILON) {
            continue;
        }
        let targetOffsets = targetMeta[t];
        if (targetOffsets.x != NO_DELTA) {
            let d = targetOffsets.x + v3;
            px = px + deltaAttrs[d] * w;
            py = py + deltaAttrs[d + 1u] * w;
            pz = pz + deltaAttrs[d + 2u] * w;
        }
        if (params.hasNormals != 0u && targetOffsets.y != NO_DELTA) {
            let d = targetOffsets.y + v3;
            nx = nx + deltaAttrs[d] * w;
            ny = ny + deltaAttrs[d + 1u] * w;
            nz = nz + deltaAttrs[d + 2u] * w;
            touchedN = true;
        }
        if (params.hasTangents != 0u && targetOffsets.z != NO_DELTA) {
            let d = targetOffsets.z + v3;
            tx = tx + deltaAttrs[d] * w;
            ty = ty + deltaAttrs[d + 1u] * w;
            tz = tz + deltaAttrs[d + 2u] * w;
            touchedT = true;
        }
    }

    outPos[v3] = px;
    outPos[v3 + 1u] = py;
    outPos[v3 + 2u] = pz;

    if (params.hasNormals != 0u) {
        if (touchedN) {
            let lenSq = nx * nx + ny * ny + nz * nz;
            if (lenSq > 1e-12) {
                let inv = inverseSqrt(lenSq);
                nx = nx * inv;
                ny = ny * inv;
                nz = nz * inv;
            }
        }
        outNorm[v3] = nx;
        outNorm[v3 + 1u] = ny;
        outNorm[v3 + 2u] = nz;
    }

    if (params.hasTangents != 0u) {
        if (touchedT) {
            let lenSq = tx * tx + ty * ty + tz * tz;
            if (lenSq > 1e-12) {
                let inv = inverseSqrt(lenSq);
                tx = tx * inv;
                ty = ty * inv;
                tz = tz * inv;
            }
        }
        let v4 = v * 4u;
        outTan[v4] = tx;
        outTan[v4 + 1u] = ty;
        outTan[v4 + 2u] = tz;
        outTan[v4 + 3u] = tw;
    }
}
