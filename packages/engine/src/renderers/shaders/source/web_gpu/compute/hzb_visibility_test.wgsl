// Tests each frustum-visible object's bounding sphere against the HZB pyramid built by
// hzb_copy_depth.wgsl/hzb_downsample_max.wgsl -- see
// docs/adr/0008-hzb-occlusion-culling-webgpu-only.md.
//
// `structs.wgsl` (GlobalUniforms: `global.vp`, `global.viewPos`, `global.projScale`,
// `global.resolution`) is prepended before this file, same as cluster_cull.wgsl, giving
// `@group(0)` for free -- this file only adds `@group(1)`, its own bindings.
//
// Conservative by design: tests a bounding SPHERE, not a tight AABB (`BoundingVolume` only
// generically exposes `center`/`getBroadRadius()` across Box/Sphere/OBB), and treats anything it
// can't confidently project (camera inside/behind the sphere) as visible. An occlusion test
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
    if (clip.w <= 0.0001) {
        results[i] = 1u; // behind/at the camera -- can't project reliably, assume visible
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
    var nearDepth = ndc.z;
    if (nearClip.w > 0.0001) {
        nearDepth = nearClip.z / nearClip.w;
    }

    let viewDist = max(length(center - global.viewPos.xyz), 0.0001);
    let ndcRadius = worldRadiusToNdcRadius(radius, viewDist);
    let footprintPx = max(ndcRadius.x * global.resolution.x, ndcRadius.y * global.resolution.y);

    // Mip where the footprint covers roughly one texel -- coarser (higher) mips hold the
    // *farthest* depth over a wider area, which only ever makes the test MORE conservative.
    var mip = 0u;
    if (footprintPx > 1.0) {
        mip = min(u32(ceil(log2(footprintPx))), params.mipCount - 1u);
    }

    let mipDims = vec2f(textureDimensions(hzbTex, mip));
    let uv = vec2f(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5)); // NDC Y-up -> texture V-down
    let texel = vec2i(clamp(uv * mipDims, vec2f(0.0), mipDims - vec2f(1.0)));
    let farthestInFootprint = textureLoad(hzbTex, texel, i32(mip)).r;

    results[i] = select(0u, 1u, nearDepth <= farthestInFootprint);
}
