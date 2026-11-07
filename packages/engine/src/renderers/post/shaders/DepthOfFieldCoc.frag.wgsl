struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct DofUniforms {
    near: f32,
    far: f32,
    focusDistance: f32,
    cocScale: f32,
    maxCoc: f32,
    pad0: f32,
    pad1: f32,
    pad2: f32,
}

@group(0) @binding(0) var sceneColor: texture_2d<f32>;
@group(0) @binding(1) var depthMap: texture_depth_2d;
@group(0) @binding(2) var<uniform> u: DofUniforms;

// Signed CoC radius stored in half-res pixels: diameter (full-res px) / 2 for radius, / 2 for half res.
const HALF_RES_RADIUS_SCALE: f32 = 0.25;

fn linearizeDepth(d: f32) -> f32 {
    return (u.near * u.far) / max(u.far - d * (u.far - u.near), 0.00001);
}

// Thin lens: c(d) = S * (1 - d_f / d), negative in front of the focus plane.
fn signedCocDiameter(d: f32) -> f32 {
    let z = linearizeDepth(d);
    return clamp(u.cocScale * (1.0 - u.focusDistance / z), -u.maxCoc, u.maxCoc);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let maxCoord = vec2i(textureDimensions(depthMap)) - vec2i(1);
    let base = vec2i(in.position.xy) * 2;

    var color = vec3f(0.0);
    var nearestDepth = 1.0;
    for (var i = 0u; i < 4u; i++) {
        let c = clamp(base + vec2i(i32(i & 1u), i32(i >> 1u)), vec2i(0), maxCoord);
        color += textureLoad(sceneColor, c, 0).rgb;
        nearestDepth = min(nearestDepth, textureLoad(depthMap, c, 0));
    }

    // The nearest tap's CoC dilates the near field, so a defocused foreground silhouette keeps
    // spreading over the in-focus background instead of being averaged away at half res.
    return vec4f(color * 0.25, signedCocDiameter(nearestDepth) * HALF_RES_RADIUS_SCALE);
}
