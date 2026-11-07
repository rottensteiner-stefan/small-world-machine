[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]

uniform vec4 u_matParam0; // [intensity, falloff, unused, unused]
uniform vec4 u_matParam1; // [color.rgb, unused]

void main() {
    float r = length(v_uv - 0.5) * 2.0;
    // Gaussian core, clipped to zero before the quad border so the square never shows.
    float glow = exp(-r * r * u_matParam0.y) * (1.0 - smoothstep(0.75, 1.0, r));
    fragColor = vec4(displayToTarget(u_matParam1.rgb) * (glow * u_matParam0.x), glow);
}
