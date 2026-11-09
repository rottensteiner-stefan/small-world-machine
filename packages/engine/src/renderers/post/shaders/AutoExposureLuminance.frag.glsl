#version 300 es
// Auto exposure (ADR 0061), step 1 -- mirrors AutoExposureLuminance.frag.wgsl.
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_centerWeight;

const int TAPS_PER_AXIS = 4;
const float TAP_SPACING = 1.0 / 64.0;
const float MIN_LUMINANCE = 1e-4;
const float MIN_WEIGHT = 0.05;

void main() {
    float sumLog = 0.0;
    for (int y = 0; y < TAPS_PER_AXIS; y++) {
        for (int x = 0; x < TAPS_PER_AXIS; x++) {
            vec2 offset = (vec2(float(x), float(y)) - 1.5) * TAP_SPACING;
            vec3 c = textureLod(u_source, v_uv + offset, 0.0).rgb;
            float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
            float safeLum = (lum == lum && lum < 65504.0) ? lum : MIN_LUMINANCE;
            sumLog += log2(max(safeLum, MIN_LUMINANCE));
        }
    }
    float meanLog = sumLog / float(TAPS_PER_AXIS * TAPS_PER_AXIS);
    float radius = length(v_uv - 0.5) * 2.0;
    float weight = mix(1.0, max(1.0 - radius, MIN_WEIGHT), u_centerWeight);
    fragColor = vec4(meanLog * weight, weight, 0.0, 1.0);
}
