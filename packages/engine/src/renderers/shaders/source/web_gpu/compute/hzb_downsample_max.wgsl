// Part of the Hierarchical-Z (HZB) occlusion culling pyramid build -- see
// docs/adr/0008-hzb-occlusion-culling-webgpu-only.md and hzb_copy_depth.wgsl (the sibling kernel
// that seeds mip 0 from this frame's depth buffer).
//
// Reduces mip `L-1` into mip `L`, one dispatch per level -- same "one pass per mip level" shape
// `_generateMipmaps()`/`BloomPassGPU` already use for their own mip chains, but a *max* of the
// 2x2 footprint instead of a bilinear average: HZB must store the *farthest* depth in each
// texel's region so the visibility test can never mistake a coarser mip for "closer than it
// really is" and wrongly cull something that's actually visible. `_hzbTexture` needs both
// `TEXTURE_BINDING` (this shader's read side) and `STORAGE_BINDING` (its write side) usage --
// always different mip levels in the same dispatch, never the same subresource read+written at
// once.

@group(0) @binding(0) var srcMip: texture_2d<f32>;
@group(0) @binding(1) var dstMip: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn downsampleMax(@builtin(global_invocation_id) id: vec3u) {
    let dstDims = textureDimensions(dstMip);
    if (id.x >= dstDims.x || id.y >= dstDims.y) {
        return;
    }
    let srcDims = textureDimensions(srcMip, 0);
    let x0 = min(id.x * 2u, srcDims.x - 1u);
    let y0 = min(id.y * 2u, srcDims.y - 1u);
    // Mip sizes are floor(size / 2): for an odd source size the last destination texel also owns
    // the extra last source column/row. Dropping it would make the pyramid non-conservative there.
    var x1 = min(x0 + 1u, srcDims.x - 1u);
    var y1 = min(y0 + 1u, srcDims.y - 1u);
    if (id.x == dstDims.x - 1u) { x1 = srcDims.x - 1u; }
    if (id.y == dstDims.y - 1u) { y1 = srcDims.y - 1u; }

    var farthest = 0.0;
    for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
            farthest = max(farthest, textureLoad(srcMip, vec2i(i32(x), i32(y)), 0).r);
        }
    }

    textureStore(dstMip, vec2i(id.xy), vec4f(farthest, 0.0, 0.0, 0.0));
}
