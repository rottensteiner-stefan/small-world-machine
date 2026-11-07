// One Gerstner wave term with deep-water dispersion (w = sqrt(g * k)).
// Accumulates its tangent/bitangent contribution into `*t`/`*b` and returns its displacement.
// Shared by every wave-displaced liquid surface (OpenWater, StylizedWater) -- mirrors
// liquid_gerstner_wave.glsl exactly.
fn gerstnerWave(wave: vec4<f32>, wp: vec3<f32>, speed: f32, time: f32, t: ptr<function, vec3<f32>>, b: ptr<function, vec3<f32>>) -> vec3<f32> {
    let dir = normalize(wave.xy);
    let steepness = wave.z;
    let wavelength = max(wave.w, 0.001);
    let k = 6.28318530718 / wavelength;
    let w = sqrt(9.81 * k);
    let a = steepness / max(k, 0.001);
    let f = k * dot(dir, wp.xz) - w * speed * time;
    let cosf = cos(f);
    let sinf = sin(f);

    let WA = a * k * dir.x * dir.y;
    let WB = a * k * dir.x * dir.x;
    let WC = a * k * dir.y * dir.y;

    (*t).x -= WB * sinf;
    (*t).y += dir.x * k * a * cosf;
    (*t).z -= WA * sinf;

    (*b).x -= WA * sinf;
    (*b).y += dir.y * k * a * cosf;
    (*b).z -= WC * sinf;

    return vec3<f32>(dir.x * a * cosf, a * sinf, dir.y * a * cosf);
}
