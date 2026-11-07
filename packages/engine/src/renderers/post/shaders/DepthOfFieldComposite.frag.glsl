#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_sceneColor;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_cocMap;
uniform sampler2D u_gatherMap;
uniform float u_near;
uniform float u_far;
uniform float u_focusDistance;
uniform float u_cocScale;
uniform float u_maxCoc;

out vec4 fragColor;

const float HALF_RES_DIAMETER_SCALE = 4.0;
// CoC diameters (full-res px) between which the pixel fades from sharp to the half-res bokeh.
const float SHARP_COC_PX = 1.0;
const float FULL_BLUR_COC_PX = 4.0;

float linearizeDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * u_near * u_far) / max(u_far + u_near - z * (u_far - u_near), 0.00001);
}

float signedCocDiameter(float d) {
    float z = linearizeDepth(d);
    return clamp(u_cocScale * (1.0 - u_focusDistance / z), -u_maxCoc, u_maxCoc);
}

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    vec4 sharp = texelFetch(u_sceneColor, coord, 0);
    float coc = signedCocDiameter(texelFetch(u_opaqueDepthMap, coord, 0).r);

    // CoC-aware bilinear upsample: half-res texels whose CoC differs from this pixel's are
    // down-weighted, so a blurred background never smears the colour of an in-focus edge.
    ivec2 halfDims = textureSize(u_gatherMap, 0);
    vec2 p = v_uv * vec2(halfDims) - 0.5;
    ivec2 base = ivec2(floor(p));
    vec2 f = p - floor(p);
    vec4 sum = vec4(0.0);
    float weightSum = 0.0;
    for (int i = 0; i < 4; i++) {
        ivec2 o = ivec2(i & 1, i >> 1);
        ivec2 c = clamp(base + o, ivec2(0), halfDims - ivec2(1));
        vec2 bilinear = mix(vec2(1.0) - f, f, vec2(o));
        float tapCoc = texelFetch(u_cocMap, c, 0).a * HALF_RES_DIAMETER_SCALE;
        float w = bilinear.x * bilinear.y / (1.0 + abs(tapCoc - coc)) + 0.00001;
        sum += texelFetch(u_gatherMap, c, 0) * w;
        weightSum += w;
    }
    vec4 blurred = sum / weightSum;

    float blend = max(smoothstep(SHARP_COC_PX, FULL_BLUR_COC_PX, abs(coc)), blurred.a);
    fragColor = vec4(mix(sharp.rgb, blurred.rgb, blend), sharp.a);
}
