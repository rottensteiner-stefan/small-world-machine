// Volumetric Fog -- Screen-space single-tap composite lookup (Phase 1).
// Replaces the per-pixel 32-step raymarch loop with a single hardware-trilinear 3D texture sample
// into the pre-integrated froxel volume (Option R).
//
// Output: rgba16float target with integrated in-scattering (rgb) and transmittance (a); the HDR
// buffer is attenuated by `a` and the scattering added before tonemapping (see PostProcess.frag.wgsl).

@group(0) @binding(0) var opaqueDepth: texture_depth_2d;
@group(0) @binding(1) var volumeSampler: sampler;
@group(0) @binding(2) var integratedVolume: texture_3d<f32>;
@group(0) @binding(3) var<uniform> uni: FroxelCompositeSettings;

struct FroxelCompositeSettings {
    nearFar: vec4f,          // [near, far, screenW, screenH]
    params: vec4f,           // [density, maxWorldDistance, sliceCount, intensity] (density/sliceCount unused)
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

// Inverse depth mapping: NDC depth -> view-space (positive) linear depth.
fn projInvDepth(ndcZ: f32, near: f32, far: f32) -> f32 {
    let z = ndcZ * 2.0 - 1.0;
    return (2.0 * near * far) / max(far + near - z * (far - near), 1e-6);
}

// Continuous froxel depth coordinate in [0, 1]. The integrated volume stores, for slice i, the
// value at that slice's geometric centre (n * (f/n)^((i+0.5)/N)), which is exactly texel centre
// (i+0.5)/N of the log mapping -- so no floor()/snapping, the hardware trilinear filter does the work.
fn volumeDepthCoord(viewZ: f32, near: f32, far: f32) -> f32 {
    let clampedZ = clamp(viewZ, near, far);
    return clamp(log(clampedZ / near) / max(log(far / near), 1e-6), 0.0, 1.0);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let near = uni.nearFar.x;
    let far = uni.nearFar.y;
    let maxDist = uni.params.y;
    let intensity = uni.params.w;

    let dims = textureDimensions(opaqueDepth);
    let pixCoord = vec2u(clamp(in.uv * vec2f(dims), vec2f(0.0), vec2f(dims) - 1.0));
    let rawDepth = textureLoad(opaqueDepth, pixCoord, 0);

    // If depth is at far plane (sky), evaluate up to maxDistance.
    var sceneDepth = maxDist;
    if (rawDepth < 1.0) {
        sceneDepth = projInvDepth(rawDepth, near, far);
    }
    sceneDepth = min(sceneDepth, maxDist);

    let w = volumeDepthCoord(sceneDepth, near, far);

    // Single hardware-trilinear 3D sample from the integrated volume.
    let fog = textureSampleLevel(integratedVolume, volumeSampler, vec3f(in.uv, w), 0.0);

    return vec4f(fog.rgb * intensity, fog.a);
}
