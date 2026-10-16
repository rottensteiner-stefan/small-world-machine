#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_lowResFogMap;
uniform sampler2D u_fullResDepthMap;
uniform vec2 u_lowResTexelSize;
uniform vec2 u_nearFar;
uniform float u_depthThreshold; // default: 0.05

out vec4 fragColor;

float linearizeDepth(float d) {
    float near = u_nearFar.x;
    float far = u_nearFar.y;
    float z = d * 2.0 - 1.0;
    return (2.0 * near * far) / max(far + near - z * (far - near), 0.00001);
}

void main() {
    float fullDepth = texture(u_fullResDepthMap, v_uv).r;
    float fullLinear = linearizeDepth(fullDepth);

    // 4 nearest half-resolution texel centers
    vec2 offsets[4] = vec2[](
        vec2(-0.5, -0.5),
        vec2( 0.5, -0.5),
        vec2(-0.5,  0.5),
        vec2( 0.5,  0.5)
    );

    vec4 sumColor = vec4(0.0);
    float sumWeight = 0.0;
    float minDepthDiff = 1000.0;
    vec4 nearestColor = vec4(0.0);

    for (int i = 0; i < 4; i++) {
        vec2 tapUV = v_uv + offsets[i] * u_lowResTexelSize;
        float lowDepth = texture(u_fullResDepthMap, tapUV).r;
        float lowLinear = linearizeDepth(lowDepth);
        vec4 color = texture(u_lowResFogMap, tapUV);

        // Relative linearized depth difference to prevent premature occluder rejection
        float depthDiff = abs(fullLinear - lowLinear) / max(fullLinear, 0.001);
        if (depthDiff < minDepthDiff) {
            minDepthDiff = depthDiff;
            nearestColor = color;
        }

        // Exponential cross-bilateral depth weight
        float weight = exp(-depthDiff / max(u_depthThreshold, 0.0001)) + 0.0001;
        sumColor += color * weight;
        sumWeight += weight;
    }

    // At sharp geometric silhouettes, fallback to the nearest-depth tap to completely eliminate edge bleeding
    if (minDepthDiff > u_depthThreshold * 2.0) {
        fragColor = nearestColor;
    } else {
        fragColor = sumColor / sumWeight;
    }
}
