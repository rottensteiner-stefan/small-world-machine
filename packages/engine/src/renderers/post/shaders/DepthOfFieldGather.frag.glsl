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
// Vogel disc tap table: xy = unit direction (cos/sin of i * GOLDEN_ANGLE), z = sqrt((i + 0.5) / TAP_COUNT).
// Constant per tap, so it is baked instead of evaluating cos/sin/sqrt 32x per pixel.
const vec3 TAPS[TAP_COUNT] = vec3[TAP_COUNT](
    vec3(1.00000000, 0.00000000, 0.12500000),
    vec3(-0.73736888, 0.67549029, 0.21650635),
    vec3(0.08742573, -0.99617104, 0.27950850),
    vec3(0.60843886, 0.79360075, 0.33071891),
    vec3(-0.98471349, -0.17418195, 0.37500000),
    vec3(0.84375530, -0.53672805, 0.41457810),
    vec3(-0.25960431, 0.96571507, 0.45069391),
    vec3(-0.46090702, -0.88744843, 0.48412292),
    vec3(0.93932130, 0.34303863, 0.51538820),
    vec3(-0.92434556, 0.38155641, 0.54486237),
    vec3(0.42384600, -0.90573427, 0.57282196),
    vec3(0.29928386, 0.95416412, 0.59947894),
    vec3(-0.86521121, -0.50140758, 0.62500000),
    vec3(0.97667577, -0.21471943, 0.64951905),
    vec3(-0.57512943, 0.81806243, 0.67314560),
    vec3(-0.12851069, -0.99170812, 0.69597055),
    vec3(0.76464899, 0.64444699, 0.71807033),
    vec3(-0.99914605, 0.04131782, 0.73950997),
    vec3(0.70882942, -0.70537994, 0.76034532),
    vec3(-0.04619145, 0.99893261, 0.78062475),
    vec3(-0.64070914, -0.76778369, 0.80039053),
    vec3(0.99106941, 0.13334699, 0.81967982),
    vec3(-0.82085834, 0.57113185, 0.83852549),
    vec3(0.21948138, -0.97561669, 0.85695683),
    vec3(0.49718087, 0.86764692, 0.87500000),
    vec3(-0.95269278, -0.30393499, 0.89267855),
    vec3(0.90779114, -0.41942252, 0.91001374),
    vec3(-0.38606109, 0.92247322, 0.92702481),
    vec3(-0.33845227, -0.94098356, 0.94372930),
    vec3(0.88518943, 0.46523077, 0.96014322),
    vec3(-0.96697001, 0.25489018, 0.97628121),
    vec3(0.54083775, -0.84112694, 0.99215674)
);
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
        vec3 tap = TAPS[i];
        float radius = tap.z * maxRadius;
        vec4 s = texture(u_cocMap, v_uv + tap.xy * radius * texel);

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
