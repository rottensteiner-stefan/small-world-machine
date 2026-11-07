// One Gerstner wave term with deep-water dispersion (w = sqrt(g * k)).
// Accumulates its tangent/bitangent contribution into `t`/`b` and returns its displacement.
// Shared by every wave-displaced liquid surface (OpenWater, StylizedWater) -- mirrors
// liquid_gerstner_wave.wgsl exactly. Plain GLSL ES 1.00-compatible syntax.
vec3 gerstnerWave(vec4 wave, vec3 wp, float speed, float time, inout vec3 t, inout vec3 b) {
    vec2 dir = normalize(wave.xy);
    float steepness = wave.z;
    float wavelength = max(wave.w, 0.001);
    float k = 6.28318530718 / wavelength;
    float w = sqrt(9.81 * k);
    float a = steepness / max(k, 0.001);
    float f = k * dot(dir, wp.xz) - w * speed * time;
    float cosf = cos(f);
    float sinf = sin(f);

    float WA = a * k * dir.x * dir.y;
    float WB = a * k * dir.x * dir.x;
    float WC = a * k * dir.y * dir.y;

    t.x -= WB * sinf;
    t.y += dir.x * k * a * cosf;
    t.z -= WA * sinf;

    b.x -= WA * sinf;
    b.y += dir.y * k * a * cosf;
    b.z -= WC * sinf;

    return vec3(dir.x * a * cosf, a * sinf, dir.y * a * cosf);
}
