#version 300 es
precision mediump float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_currentTexture;
uniform sampler2D u_historyTexture;
uniform float u_feedback;
uniform int u_hasHistory;

void main() {
    vec3 current = texture(u_currentTexture, v_uv).rgb;

    if (u_hasHistory == 0) {
        // First frame after (re)initialization -- no history to blend against yet.
        fragColor = vec4(current, 1.0);
        return;
    }

    vec3 history = texture(u_historyTexture, v_uv).rgb;
    vec3 resolved = mix(current, history, u_feedback);
    fragColor = vec4(resolved, 1.0);
}
