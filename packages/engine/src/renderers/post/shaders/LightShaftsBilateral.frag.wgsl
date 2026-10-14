struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var lowResShaftsMap: texture_2d<f32>;
@group(0) @binding(2) var fullResDepthMap: texture_depth_2d;
@group(0) @binding(3) var<uniform> params: vec4f; // x: texelSize.x, y: texelSize.y, z: depthThreshold

fn linearizeDepth(d: f32) -> f32 {
    let near = 0.1;
    let far = 1000.0;
    return (near * far) / max(far - d * (far - near), 0.00001);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let fullDims = vec2f(textureDimensions(fullResDepthMap));
    let fullCoord = vec2i(in.uv * fullDims);
    let fullDepth = textureLoad(fullResDepthMap, fullCoord, 0);
    let fullLinear = linearizeDepth(fullDepth);

    let texelSize = params.xy;
    let threshold = max(params.z, 0.0001);

    var offsets = array<vec2f, 4>(
        vec2f(-0.5, -0.5),
        vec2f( 0.5, -0.5),
        vec2f(-0.5,  0.5),
        vec2f( 0.5,  0.5)
    );

    var sumColor = vec3f(0.0);
    var sumWeight = 0.0;
    var minDepthDiff = 1000.0;
    var nearestColor = vec3f(0.0);

    for (var i: u32 = 0u; i < 4u; i++) {
        let tapUV = in.uv + offsets[i] * texelSize;
        let lowCoord = vec2i(clamp(tapUV * fullDims, vec2f(0.0), fullDims - vec2f(1.0)));
        let lowDepth = textureLoad(fullResDepthMap, lowCoord, 0);
        let lowLinear = linearizeDepth(lowDepth);
        let color = textureSampleLevel(lowResShaftsMap, linearSampler, tapUV, 0.0).rgb;

        // Relative linearized depth difference to prevent premature occluder rejection
        let depthDiff = abs(fullLinear - lowLinear) / max(fullLinear, 0.001);
        if (depthDiff < minDepthDiff) {
            minDepthDiff = depthDiff;
            nearestColor = color;
        }

        let weight = exp(-depthDiff / threshold) + 0.0001;
        sumColor += color * weight;
        sumWeight += weight;
    }

    if (minDepthDiff > threshold * 2.0) {
        return vec4f(nearestColor, 1.0);
    }

    return vec4f(sumColor / sumWeight, 1.0);
}
