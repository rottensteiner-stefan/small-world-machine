precision highp float;

varying vec2 v_uv;

uniform sampler2D u_sceneColor;
uniform vec2 u_texelSize;
uniform float u_focusScreenY;
uniform float u_farCoc;

const int TAP_COUNT = 16;
const float GOLDEN_ANGLE = 2.39996323;
// Screen-height fractions: fully sharp band around the focus row, then a ramp up to the lens'
// far-field CoC. WebGL1 has no scene depth, so screen height stands in for distance.
const float FOCUS_BAND_HALF_HEIGHT = 0.1;
const float FALLOFF_HEIGHT = 0.35;

void main() {
    float bandDistance = abs(v_uv.y - u_focusScreenY);
    float ramp = clamp((bandDistance - FOCUS_BAND_HALF_HEIGHT) / FALLOFF_HEIGHT, 0.0, 1.0);
    float radius = 0.5 * u_farCoc * ramp;

    vec3 acc = texture2D(u_sceneColor, v_uv).rgb;
    for (int i = 0; i < TAP_COUNT; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / float(TAP_COUNT)) * radius;
        float theta = fi * GOLDEN_ANGLE;
        acc += texture2D(u_sceneColor, v_uv + vec2(cos(theta), sin(theta)) * r * u_texelSize).rgb;
    }
    gl_FragColor = vec4(acc / float(TAP_COUNT + 1), 1.0);
}
