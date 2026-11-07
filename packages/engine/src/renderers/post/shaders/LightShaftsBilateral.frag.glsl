#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_lowResShaftsMap;
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

    // The four half-resolution texels around this pixel, fetched at their exact texel centres.
    // The low-res pass shaded each texel with the full-res depth under that texel's centre, so
    // the depth weight must read the same full-res texel (a +-0.5 uv offset would land on
    // neighbouring ones), and the colour must not be filtered by the sampler.
    ivec2 fullSize = textureSize(u_fullResDepthMap, 0);
    ivec2 lowMax = ivec2(1.0 / u_lowResTexelSize) - 1;
    vec2 p = v_uv / u_lowResTexelSize - 0.5;
    ivec2 base = ivec2(floor(p));
    vec2 f = fract(p);

    vec3 sumColor = vec3(0.0);
    float sumWeight = 0.0;
    float minDepthDiff = 1000.0;
    vec3 nearestColor = vec3(0.0);

    for (int i = 0; i < 4; i++) {
        ivec2 o = ivec2(i & 1, i >> 1);
        ivec2 c = clamp(base + o, ivec2(0), lowMax);
        vec2 centreUV = (vec2(c) + 0.5) * u_lowResTexelSize;
        float lowDepth = texelFetch(u_fullResDepthMap, min(ivec2(centreUV * vec2(fullSize)), fullSize - 1), 0).r;
        float lowLinear = linearizeDepth(lowDepth);
        vec3 color = texelFetch(u_lowResShaftsMap, c, 0).rgb;

        // Relative linearized depth difference to prevent premature occluder rejection
        float depthDiff = abs(fullLinear - lowLinear) / max(fullLinear, 0.001);
        if (depthDiff < minDepthDiff) {
            minDepthDiff = depthDiff;
            nearestColor = color;
        }

        // Bilinear spatial weight x exponential cross-bilateral depth weight
        vec2 bw = mix(1.0 - f, f, vec2(o));
        float weight = bw.x * bw.y * exp(-depthDiff / max(u_depthThreshold, 0.0001)) + 0.0001;
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
