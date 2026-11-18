// Assembles spatial-domain FFT results into filterable rgba16float ocean maps:
//   outDisp:     [chop * Dx, h, chop * Dz, fold]
//   outNormFoam: [N.x, N.z, fold, persistentFoam]

struct OceanAssembleParams {
    resolution: u32,
    choppiness: f32,
    deltaTime: f32,
    _pad0: u32,
}

@group(0) @binding(0) var<uniform> params: OceanAssembleParams;
@group(0) @binding(1) var<storage, read> spatialA: array<vec4f>;
@group(0) @binding(2) var<storage, read> spatialB: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> foamState: array<f32>;
@group(0) @binding(4) var outDisp: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outNormFoam: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = params.resolution;
    if (gid.x >= n || gid.y >= n) {
        return;
    }
    let idx = gid.y * n + gid.x;
    let a = spatialA[idx];
    let b = spatialB[idx];

    let h = a.x;
    let dxx = a.y;
    let dx = a.z;
    let dz = a.w;

    let sx = b.x;
    let sz = b.y;
    let dzz = b.z;
    let dxz = b.w;

    let chop = params.choppiness;
    let j = (1.0 + chop * dxx) * (1.0 + chop * dzz) - (chop * dxz) * (chop * dxz);
    let fold = clamp(1.0 - j, 0.0, 1.5);

    let decay = exp(-clamp(params.deltaTime, 0.0, 0.1) * 1.15);
    let instantFoam = smoothstep(0.42, 0.95, fold);
    let foam = clamp(max(foamState[idx] * decay, instantFoam), 0.0, 1.0);
    foamState[idx] = foam;

    let t = vec3f(1.0 + chop * dxx, sx, chop * dxz);
    let bVec = vec3f(chop * dxz, sz, 1.0 + chop * dzz);
    let nrm = normalize(cross(bVec, t));

    let coords = vec2<i32>(i32(gid.x), i32(gid.y));
    textureStore(outDisp, coords, vec4f(chop * dx, h, chop * dz, fold));
    textureStore(outNormFoam, coords, vec4f(nrm.x, nrm.z, fold, foam));
}
