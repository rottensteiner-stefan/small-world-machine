#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_lowResShaftsMap;
uniform sampler2D u_fullResDepthMap;
uniform sampler2D u_lowResDepthMap;
uniform vec2 u_lowResTexelSize;
uniform float u_depthThreshold; // default: 0.05

out vec4 fragColor;

void main() {
    float fullDepth = texture(u_fullResDepthMap, v_uv).r;

    // 4 nearest half-resolution texel centers
    vec2 offsets[4] = vec2[](
        vec2(-0.5, -0.5),
        vec2( 0.5, -0.5),
        vec2(-0.5,  0.5),
        vec2( 0.5,  0.5)
    );

    vec3 sumColor = vec3(0.0);
    float sumWeight = 0.0;
    float minDepthDiff = 1000.0;
    vec3 nearestColor = vec3(0.0);

    for (int i = 0; i < 4; i++) {
        vec2 tapUV = v_uv + offsets[i] * u_lowResTexelSize;
        float lowDepth = texture(u_lowResDepthMap, tapUV).r;
        vec3 color = texture(u_lowResShaftsMap, tapUV).rgb;

        float depthDiff = abs(fullDepth - lowDepth);
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
        fragColor = vec4(nearestColor, 1.0);
    } else {
        fragColor = vec4(sumColor / sumWeight, 1.0);
    }
}
