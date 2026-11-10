// Shared screen-space footprint math. Requires `structs.wgsl` (for `global.projScale`) prepended
// before this chunk.

// Converts a world-space radius at a given view distance into an NDC-space radius, via the
// projection matrix's diagonal scale terms (`global.projScale`). Conservative on purpose: the
// exact perspective tangent projection of a sphere is `P00 * r * sqrt(x_c^2 + z_c^2 - r^2) /
// (z_c^2 - r^2)`, and `r / sqrt(max(viewDist^2 - r^2, 1e-4))` is >= that for any off-axis
// position (replacing the plain `r / viewDist` term, which UNDER-estimates the NDC radius when
// r / z_c or x_c / z_c is non-trivial and would let the footprint texels escape a sphere the
// test is supposed to cover). `viewDist` MUST be the positive view-space depth of the sphere
// center (e.g. `clip.w` in a perspective projection) and MUST strictly exceed `radius` when the
// footprint is computed (callers guard this); the `1e-4` floor keeps the result finite for a
// degenerate tangent case. Same conservative trade-off `cluster_cull.wgsl`'s light-cell
// assignment and `hzb_visibility_test.wgsl`'s occlusion footprint accept.
fn worldRadiusToNdcRadius(radius: f32, viewDist: f32) -> vec2f {
    let safeZ = sqrt(max(viewDist * viewDist - radius * radius, 1e-4));
    return vec2f(radius / safeZ) * global.projScale;
}
