#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D u_sceneColor;
uniform sampler2D u_opaqueDepthMap;
uniform float u_near;
uniform float u_far;
uniform float u_focusDistance;
uniform float u_cocScale;
uniform float u_maxCoc;

out vec4 fragColor;

// Signed CoC radius stored in half-res pixels: diameter (full-res px) / 2 for radius, / 2 for half res.
const float HALF_RES_RADIUS_SCALE = 0.25;

float linearizeDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * u_near * u_far) / max(u_far + u_near - z * (u_far - u_near), 0.00001);
}

// Thin lens: c(d) = S * (1 - d_f / d), negative in front of the focus plane.
float signedCocDiameter(float d) {
    float z = linearizeDepth(d);
    return clamp(u_cocScale * (1.0 - u_focusDistance / z), -u_maxCoc, u_maxCoc);
}

void main() {
    ivec2 maxCoord = textureSize(u_opaqueDepthMap, 0) - ivec2(1);
    ivec2 base = ivec2(gl_FragCoord.xy) * 2;

    vec3 color = vec3(0.0);
    float nearestDepth = 1.0;
    for (int i = 0; i < 4; i++) {
        ivec2 c = clamp(base + ivec2(i & 1, i >> 1), ivec2(0), maxCoord);
        color += texelFetch(u_sceneColor, c, 0).rgb;
        nearestDepth = min(nearestDepth, texelFetch(u_opaqueDepthMap, c, 0).r);
    }

    // The nearest tap's CoC dilates the near field, so a defocused foreground silhouette keeps
    // spreading over the in-focus background instead of being averaged away at half res.
    fragColor = vec4(color * 0.25, signedCocDiameter(nearestDepth) * HALF_RES_RADIUS_SCALE);
}
