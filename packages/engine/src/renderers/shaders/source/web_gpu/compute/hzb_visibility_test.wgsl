// Tests each frustum-visible object's bounding sphere against the HZB pyramid built by
// hzb_copy_depth.wgsl/hzb_downsample_max.wgsl -- see
// docs/adr/0008-hzb-occlusion-culling-webgpu-only.md.
//
// `structs.wgsl` (GlobalUniforms: `global.vp`, `global.viewPos`, `global.projScale`,
// `global.resolution`) is prepended before this file, same as cluster_cull.wgsl, giving
// `@group(0)` for free -- this file only adds `@group(1)`, its own bindings.
//
// Conservative by design: tests a bounding SPHERE (not a tight AABB) (`BoundingVolume` only
// generically exposes `center`/`getBroadRadius()` across Box/Sphere/OBB) against its whole screen
// rect (four corner texels of one mip), and treats anything it can't confidently project (camera
// inside/behind the sphere, sphere reaching the near plane) as visible. An occlusion test
// that's slightly too generous costs a few wasted draw calls next frame; one that's too
// aggressive would make a real, visible object disappear.
//
// Screen-space footprint math shares `worldRadiusToNdcRadius()` (screen_footprint.wgsl) with
// cluster_cull.wgsl's `lightCoverage()` -- world-space radius -> NDC radius via `projScale`, then
// -> pixels via `resolution` -- the same proven approach already used for a near-identical
// problem in this codebase.

struct HzbTestParams {
    objectCount: u32,
    mipCount: u32,
    pad0: u32,
    pad1: u32,
}

@group(1) @binding(0) var<storage, read> aabbs: array<vec4f>; // xyz = world-space center, w = radius
@group(1) @binding(1) var hzbTex: texture_2d<f32>; // all mips, r32float, farthest depth per texel
@group(1) @binding(2) var<storage, read_write> results: array<u32>; // 1 = visible, 0 = occluded
@group(1) @binding(3) var<uniform> params: HzbTestParams;

@compute @workgroup_size(64)
fn testVisibility(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= params.objectCount) {
        return;
    }

    let center = aabbs[i].xyz;
    let radius = aabbs[i].w;

    let clip = global.vp * vec4f(center, 1.0);
    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;
    let z_near = clip.w - radius;
    // clip.w is the planar view-space depth of the sphere center. If the sphere's frontmost
    // planar point reaches or crosses the near plane, mark visible immediately.
    if (z_near <= near || clip.w <= radius + 0.0001) {
        results[i] = 1u;
        return;
    }
    let ndc = clip.xyz / clip.w;
    if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0) {
        results[i] = 1u; // off-screen center -- frustum culling (a separate, earlier gate) owns this
        return;
    }

    // Direct WebGPU ZO [0, 1] depth of the planar frontmost point z_near = viewZ - radius.
    let nearDepth = (far * (z_near - near)) / (z_near * max(far - near, 1e-5));

    // Conservative 2D projected sphere bounds in NDC space per Mara & McGuire (JCGT 2013).
    let ndcBounds = projectSphereBoundsNdc(ndc.xy, clip.w, radius);
    // NDC X [-1, 1] -> UV U [0, 1]; NDC Y-up [-1, 1] -> texture V-down [0, 1]
    let uvMin = clamp(
        vec2f(ndcBounds.x * 0.5 + 0.5, 1.0 - (ndcBounds.w * 0.5 + 0.5)),
        vec2f(0.0),
        vec2f(1.0)
    );
    let uvMax = clamp(
        vec2f(ndcBounds.z * 0.5 + 0.5, 1.0 - (ndcBounds.y * 0.5 + 0.5)),
        vec2f(0.0),
        vec2f(1.0)
    );
    let baseDims = vec2f(textureDimensions(hzbTex, 0u));
    let rectPx = (uvMax - uvMin) * baseDims;
    let extentPx = max(max(rectPx.x, rectPx.y), 1.0);

    // Mip whose texel is at least as large as the rect: the rect then touches at most 2x2 texels,
    // and the four corner loads below cover all of them. Taking the max (farthest) depth of those
    // texels is conservative -- it can only keep an object, never wrongly drop it.
    let mip = min(u32(ceil(log2(extentPx))), params.mipCount - 1u);
    // Mip-0 texel cover of the rect, then right-shift by `mip` (hzb_downsample_max.wgsl maps
    // mip-L texel t to mip-0 texels [t*2^L, (t+1)*2^L)). Directly computing uv * mipDims drifts
    // by up to one full texel on NPOT bases (1080p: mip 9 is 2 px wide); deriving from BASE dims
    // and shifting right is exact.
    let mipDimsI = vec2i(textureDimensions(hzbTex, mip));
    let maxCoord = mipDimsI - vec2i(1);
    let shift = vec2u(mip);
    let lo = clamp(vec2i(uvMin * baseDims) >> shift, vec2i(0), maxCoord);
    let hi = clamp(vec2i(uvMax * baseDims) >> shift, vec2i(0), maxCoord);
    let d00 = textureLoad(hzbTex, vec2i(lo.x, lo.y), i32(mip)).r;
    let d10 = textureLoad(hzbTex, vec2i(hi.x, lo.y), i32(mip)).r;
    let d01 = textureLoad(hzbTex, vec2i(lo.x, hi.y), i32(mip)).r;
    let d11 = textureLoad(hzbTex, vec2i(hi.x, hi.y), i32(mip)).r;
    let farthestInFootprint = max(max(d00, d10), max(d01, d11));

    results[i] = select(0u, 1u, nearDepth <= farthestInFootprint);
}
