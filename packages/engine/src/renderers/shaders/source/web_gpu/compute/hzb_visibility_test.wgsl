// Tests each frustum-visible object's world bounds against the HZB pyramid built by
// hzb_copy_depth.wgsl/hzb_downsample_max.wgsl -- see
// docs/adr/0008-hzb-occlusion-culling-webgpu-only.md.
//
// `structs.wgsl` (GlobalUniforms: `global.vp`, `global.viewPos`, `global.projScale`,
// `global.resolution`) is prepended before this file, same as cluster_cull.wgsl, giving
// `@group(0)` for free -- this file only adds `@group(1)`, its own bindings.
//
// Conservative by design: uses the tight 8-corner world AABB when `boxInfo.w > 0.5`
// (BoundingBox), falling back to a conservative bounding sphere (`BoundingSphere` / `OBB` /
// `ConvexHull`) against its 2x2 mip texels (`clip.w > 0` / near-plane intersections mark
// visible immediately). Two vec4f slots per object:
//   aabbs[2*i]     = (center.x, center.y, center.z, broadRadiusPadded)
//   aabbs[2*i + 1] = (halfExtentX, halfExtentY, halfExtentZ, useTightBox 0/1)

struct HzbTestParams {
    objectCount: u32,
    mipCount: u32,
    pad0: u32,
    pad1: u32,
}

@group(1) @binding(0) var<storage, read> aabbs: array<vec4f>; // 2 x vec4f per object
@group(1) @binding(1) var hzbTex: texture_2d<f32>; // all mips, r32float, farthest depth per texel
@group(1) @binding(2) var<storage, read_write> results: array<u32>; // 1 = visible, 0 = occluded
@group(1) @binding(3) var<uniform> params: HzbTestParams;

@compute @workgroup_size(64)
fn testVisibility(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= params.objectCount) {
        return;
    }

    let c = aabbs[i * 2u];
    let boxInfo = aabbs[i * 2u + 1u];
    let center = c.xyz;
    let radius = c.w;

    var uvMin = vec2f(0.0);
    var uvMax = vec2f(1.0);
    var nearDepth = 0.0;

    if (boxInfo.w > 0.5) {
        let ext = boxInfo.xyz;
        var minNdc = vec3f(1e9);
        var maxNdc = vec3f(-1e9);
        for (var corner = 0u; corner < 8u; corner++) {
            let s = vec3f(
                select(-1.0, 1.0, (corner & 1u) != 0u),
                select(-1.0, 1.0, (corner & 2u) != 0u),
                select(-1.0, 1.0, (corner & 4u) != 0u),
            );
            let cornerClip = global.vp * vec4f(center + s * ext, 1.0);
            if (cornerClip.w <= 1e-4 || cornerClip.z < 0.0) {
                results[i] = 1u;
                return;
            }
            let cornerNdc = cornerClip.xyz / cornerClip.w;
            minNdc = min(minNdc, cornerNdc);
            maxNdc = max(maxNdc, cornerNdc);
        }
        if (maxNdc.x < -1.0 || minNdc.x > 1.0 || maxNdc.y < -1.0 || minNdc.y > 1.0) {
            results[i] = 1u;
            return;
        }
        // NDC X [-1, 1] -> UV U [0, 1]; NDC Y-up [-1, 1] -> texture V-down [0, 1]
        uvMin = clamp(
            vec2f(minNdc.x * 0.5 + 0.5, 1.0 - (maxNdc.y * 0.5 + 0.5)),
            vec2f(0.0),
            vec2f(1.0)
        );
        uvMax = clamp(
            vec2f(maxNdc.x * 0.5 + 0.5, 1.0 - (minNdc.y * 0.5 + 0.5)),
            vec2f(0.0),
            vec2f(1.0)
        );
        nearDepth = minNdc.z;
    } else {
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
        nearDepth = (far * (z_near - near)) / (z_near * max(far - near, 1e-5));

        // Conservative 2D projected sphere bounds in NDC space per Mara & McGuire (JCGT 2013).
        let ndcBounds = projectSphereBoundsNdc(ndc.xy, clip.w, radius);
        // NDC X [-1, 1] -> UV U [0, 1]; NDC Y-up [-1, 1] -> texture V-down [0, 1]
        uvMin = clamp(
            vec2f(ndcBounds.x * 0.5 + 0.5, 1.0 - (ndcBounds.w * 0.5 + 0.5)),
            vec2f(0.0),
            vec2f(1.0)
        );
        uvMax = clamp(
            vec2f(ndcBounds.z * 0.5 + 0.5, 1.0 - (ndcBounds.y * 0.5 + 0.5)),
            vec2f(0.0),
            vec2f(1.0)
        );
    }

    let baseDims = vec2f(textureDimensions(hzbTex, 0u));
    let rectPx = (uvMax - uvMin) * baseDims;
    let extentPx = max(max(rectPx.x, rectPx.y), 1.0);

    // Mip whose texel is at least as large as the rect: the rect then touches at most 2x2 texels,
    // and the four corner loads below cover all of them. Taking the max (farthest) depth of those
    // texels is conservative -- it can only keep an object, never wrongly drop it.
    let mip = min(u32(ceil(log2(extentPx))), params.mipCount - 1u);
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

