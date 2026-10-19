#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_cocMap;
uniform float u_maxCoc;

out vec4 fragColor;

// Half the WebGPU tap count: same Vogel disc, coarser sampling for the WebGL2 budget.
const int TAP_COUNT = 32;
const float GOLDEN_ANGLE = 2.39996323;
const float HALF_RES_RADIUS_SCALE = 0.25;
// Fraction of covering near-field taps at which the composite fully switches to the gathered
// result; below it the sharp full-res pixel shows through the thin edge of the foreground blur.
const float NEAR_COVERAGE_GAIN = 4.0;

// Scatter-as-gather bokeh: every tap asks "does this sample's blur disc reach me?" instead of
// scattering sprites, so the cost is fixed per pixel.
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_cocMap, 0));
    vec4 center = texture(u_cocMap, v_uv);
    float centerRadius = abs(center.a);
    float maxRadius = u_maxCoc * HALF_RES_RADIUS_SCALE;

    vec3 acc = center.rgb;
    float total = 1.0;
    float nearCovering = 0.0;
    for (int i = 0; i < TAP_COUNT; i++) {
        float fi = float(i);
        float radius = sqrt((fi + 0.5) / float(TAP_COUNT)) * maxRadius;
        float theta = fi * GOLDEN_ANGLE;
        vec4 s = texture(u_cocMap, v_uv + vec2(cos(theta), sin(theta)) * radius * texel);

        float isBehind = step(center.a, s.a);
        // A sample behind the centre may spread no wider than the centre's own blur: a sharp
        // foreground must never be overdrawn by the defocused background behind it.
        float sampleRadius = mix(abs(s.a), min(abs(s.a), centerRadius * 2.0), isBehind);
        float covers = smoothstep(radius - 0.5, radius + 0.5, sampleRadius);

        acc += mix(acc / total, s.rgb, covers);
        total += 1.0;
        nearCovering += covers * (1.0 - isBehind);
    }

    float nearCoverage = clamp(nearCovering / float(TAP_COUNT) * NEAR_COVERAGE_GAIN, 0.0, 1.0);
    fragColor = vec4(acc / total, nearCoverage);
}
