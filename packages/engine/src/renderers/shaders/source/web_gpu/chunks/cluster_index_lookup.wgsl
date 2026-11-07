// Clustered light lookup -- single shared implementation (I01) of the cluster cell/index formula
// used by lighting_pbr.wgsl, lighting.wgsl and glass_pbr_loops.wgsl (previously 3 inline copies,
// drift-prone). See docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md. The WebGL2 twin is
// the computeClusterCellIndex function in web_gl2/chunks/lights.frag.glsl -- same formula.
// J01 hard requirement: the log(far/near) divisor stays max(...,1e-6)-guarded here, because a
// degenerate near==far camera would otherwise turn the slice math into NaN and drop/blend lights.
let clusterDimsU = vec3u(u32(global.clusterDims.x), u32(global.clusterDims.y), u32(global.clusterDims.z));
let clusterCellX = min(u32(i.pos.x / global.tileSizePx.x), clusterDimsU.x - 1u);
let clusterCellY = min(u32(i.pos.y / global.tileSizePx.y), clusterDimsU.y - 1u);
let clusterViewDist = clamp(length(global.viewPos.xyz - i.wp), global.cameraNearFar.x, global.cameraNearFar.y);
let clusterLogRatio = max(log(global.cameraNearFar.y / global.cameraNearFar.x), 1e-6);
let clusterSliceF = floor(log(clusterViewDist / global.cameraNearFar.x) * f32(clusterDimsU.z) / clusterLogRatio);
let clusterCellZ = min(u32(max(clusterSliceF, 0.0)), clusterDimsU.z - 1u);
let clusterCellIndex = clusterCellX + clusterDimsU.x * (clusterCellY + clusterDimsU.y * clusterCellZ);
