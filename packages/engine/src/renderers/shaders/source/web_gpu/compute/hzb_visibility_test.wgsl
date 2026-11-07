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
    // clip.w is the view-space depth of the centre. Behind/at the camera, or a sphere that reaches
    // the near plane, cannot be projected reliably -- assume visible.
    if (clip.w <= radius + 0.0001) {
        results[i] = 1u;
        return;
    }
    let ndc = clip.xyz / clip.w;
    if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0) {
        results[i] = 1u; // off-screen center -- frustum culling (a separate, earlier gate) owns this
        return;
    }

    // Nearest point of the sphere toward the camera, reprojected to get an accurate NDC depth
    // for the occlusion compare (cheaper than reconstructing the view basis, since
    // `global.viewPos` is already available).
    let toCam = global.viewPos.xyz - center;
    let toCamLen = length(toCam);
    var nearestWorld = center;
    if (toCamLen > 0.0001) {
        nearestWorld = center + (toCam / toCamLen) * min(radius, toCamLen);
    }
    let nearClip = global.vp * vec4f(nearestWorld, 1.0);
    if (nearClip.w <= 0.0001) {
        results[i] = 1u;
        return;
    }
    let nearDepth = nearClip.z / nearClip.w;

    // Screen-space rect of the sphere (projected by view depth = clip.w, not by Euclidean distance,
    // which would shrink the footprint off-axis).
    let ndcRadius = worldRadiusToNdcRadius(radius, clip.w);
    let uvCenter = vec2f(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5)); // NDC Y-up -> texture V-down
    let uvHalf = ndcRadius * 0.5;
    let uvMin = clamp(uvCenter - uvHalf, vec2f(0.0), vec2f(1.0));
    let uvMax = clamp(uvCenter + uvHalf, vec2f(0.0), vec2f(1.0));
    let rectPx = (uvMax - uvMin) * global.resolution.xy;
    let extentPx = max(max(rectPx.x, rectPx.y), 1.0);

    // Mip whose texel is at least as large as the rect: the rect then touches at most 2x2 texels,
    // and the four corner loads below cover all of them. Taking the max (farthest) depth of those
    // texels is conservative -- it can only keep an object, never wrongly drop it.
    let mip = min(u32(ceil(log2(extentPx))), params.mipCount - 1u);
    let mipDims = vec2f(textureDimensions(hzbTex, mip));
    let lo = vec2i(clamp(uvMin * mipDims, vec2f(0.0), mipDims - vec2f(1.0)));
    let hi = vec2i(clamp(uvMax * mipDims, vec2f(0.0), mipDims - vec2f(1.0)));
    let d00 = textureLoad(hzbTex, vec2i(lo.x, lo.y), i32(mip)).r;
    let d10 = textureLoad(hzbTex, vec2i(hi.x, lo.y), i32(mip)).r;
    let d01 = textureLoad(hzbTex, vec2i(lo.x, hi.y), i32(mip)).r;
    let d11 = textureLoad(hzbTex, vec2i(hi.x, hi.y), i32(mip)).r;
    let farthestInFootprint = max(max(d00, d10), max(d01, d11));

    results[i] = select(0u, 1u, nearDepth <= farthestInFootprint);
}
