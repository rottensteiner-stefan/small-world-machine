// Part of the Hierarchical-Z (HZB) occlusion culling pyramid build -- see
// docs/adr/0008-hzb-occlusion-culling-webgpu-only.md and hzb_downsample_max.wgsl (the sibling
// kernel that reduces the rest of the mip chain from what this one writes).
//
// Converts this frame's just-finished `_depthTexture` (a `depth32float` render-attachment
// texture, which cannot itself be bound as a storage texture) into mip 0 of the persistent
// `_hzbTexture` (`r32float`, `STORAGE_BINDING`). Pure format conversion, no filtering -- a 1:1
// texel copy.

@group(0) @binding(0) var srcDepth: texture_depth_2d;
@group(0) @binding(1) var dstMip0: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn copyDepthToHzb(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(dstMip0);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    let d = textureLoad(srcDepth, vec2i(id.xy), 0);
    textureStore(dstMip0, vec2i(id.xy), vec4f(d, 0.0, 0.0, 0.0));
}
