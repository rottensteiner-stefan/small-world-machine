struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var lowResShaftsMap: texture_2d<f32>;
@group(0) @binding(2) var fullResDepthMap: texture_depth_2d;
@group(0) @binding(3) var lowResDepthMap: texture_depth_2d;
@group(0) @binding(4) var<uniform> params: vec4f; // x: texelSize.x, y: texelSize.y, z: depthThreshold

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let fullDims = vec2f(textureDimensions(fullResDepthMap));
    let fullCoord = vec2i(in.uv * fullDims);
    let fullDepth = textureLoad(fullResDepthMap, fullCoord, 0);

    let texelSize = params.xy;
    let threshold = max(params.z, 0.0001);

    var offsets = array<vec2f, 4>(
        vec2f(-0.5, -0.5),
        vec2f( 0.5, -0.5),
        vec2f(-0.5,  0.5),
        vec2f( 0.5,  0.5)
    );

    let lowDims = vec2f(textureDimensions(lowResDepthMap));
    var sumColor = vec3f(0.0);
    var sumWeight = 0.0;
    var minDepthDiff = 1000.0;
    var nearestColor = vec3f(0.0);

    for (var i: u32 = 0u; i < 4u; i++) {
        let tapUV = in.uv + offsets[i] * texelSize;
        let lowCoord = vec2i(clamp(tapUV * lowDims, vec2f(0.0), lowDims - vec2f(1.0)));
        let lowDepth = textureLoad(lowResDepthMap, lowCoord, 0);
        let color = textureSampleLevel(lowResShaftsMap, linearSampler, tapUV, 0.0).rgb;

        let depthDiff = abs(fullDepth - lowDepth);
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
