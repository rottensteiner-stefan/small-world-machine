// Shared screen-space footprint math. Requires `structs.wgsl` (for `global.projScale`) prepended
// before this chunk.

// Converts a world-space radius at a given distance from the camera into an NDC-space radius,
// via the projection matrix's diagonal scale terms (`global.projScale`) -- an approximation
// that over-estimates screen radius slightly (ignores perspective distortion off-axis), the same
// trade-off `cluster_cull.wgsl`'s light-cell assignment and `hzb_visibility_test.wgsl`'s
// occlusion footprint both already accept for this near-identical problem.
fn worldRadiusToNdcRadius(radius: f32, viewDist: f32) -> vec2f {
    return vec2f(radius / viewDist) * global.projScale;
}
