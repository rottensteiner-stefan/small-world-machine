/**
 * Canonical shared thin-film / oil-sheen shading module.
 *
 * Contains the only-authoritative implementations of the muted thin-film interference model
 * used across Small World Machine's oil/puddle materials (ADR 0025 extension package `@small-world-machine/
 * liquid-extras`). The GLSL declaration is valid GLSL ES 1.00, 3.00 and WebGL 1/2 fragment
 * shaders; the WGSL declaration mirrors it for the WebGPU path. Both are self-contained pure
 * functions (no samplers, no uniforms, no globals), so they can be injected through any decl
 * hook of `StylizedWaterMaterial` (the `composeStylizedWaterSources` extension hooks) or into a
 * standalone `AbstractMaterial` fragment shader.
 *
 * Style contract (from the Graphic-Noir art direction, see `.agents/collaborate/oil-puddles.md`):
 * iridescence must stay MUTED. `strength` drives the desaturation re-mix towards luminance, so
 * the default physical path is a restrained sheen, never a bright saturated rainbow. The
 * `oilFilmRainbow` helper is the intentionally desaturated alternative for material authors who
 * want a non-physical, fully controlled ramp palette; the underlying physical model is the
 * canonical default (proven in `the-whisper`'s floor material).
 *
 * Physical model (KHR_materials_iridescence style, two-beam approximation as implemented and
 * verified in `apps/sample-apps/the-whisper/scenes/character-diorama/OilSlick.frag.*`): real
 * Fresnel reflectance at both film interfaces (air->film, film->base), Snell refraction into the
 * film, optical path difference and per-RGB-wavelength phase combined via the classic
 * interference formula `I = R1 + R2 + 2·sqrt(R1·R2)·cos(phase)`. Not the Belcour & Barla (2017)
 * spectral/Airy-sum model; see `.agents/notes/oil-shader-roadmap.md` Abschnitt 6.3.
 */

/** GLSL function declarations (valid for GLSL ES 1.00 and 3.00). */
export const THIN_FILM_GLSL_DECL = `
// Canonical muted thin-film interference (KHR_materials_iridescence style, two-beam approximation).
// Returns the physically tinted film reflectance, desaturated by 'strength' (0..1, style control).
vec3 oilFilmThinFilm(float cosTheta1, float thicknessNorm, float strength) {
    const float iridescenceIor = 1.3;
    const float filmF0 = 0.0169; // ((1.3-1)/(1.3+1))^2 -- air->film Fresnel at normal incidence
    const float baseF0 = 0.0204; // oil/water Fresnel (IOR 1.333) -- film->base reflectance
    const float thicknessMinNm = 100.0;
    const float thicknessMaxNm = 400.0;

    float sinTheta1Sq = 1.0 - cosTheta1 * cosTheta1;
    float sinTheta2Sq = sinTheta1Sq / (iridescenceIor * iridescenceIor); // Snell's law
    float cosTheta2 = sqrt(max(1.0 - sinTheta2Sq, 0.0));

    float r1 = filmF0 + (1.0 - filmF0) * pow(1.0 - cosTheta1, 5.0);
    float r2 = baseF0 + (1.0 - baseF0) * pow(1.0 - cosTheta2, 5.0);
    float crossTerm = 2.0 * sqrt(max(r1 * r2, 0.0));

    float thicknessNm = mix(thicknessMinNm, thicknessMaxNm, clamp(thicknessNorm, 0.0, 1.0));
    float opd = 2.0 * iridescenceIor * thicknessNm * cosTheta2;

    vec3 wavelengthsNm = vec3(650.0, 550.0, 450.0); // approximate R, G, B visible-light peaks
    vec3 phase = (6.28318530718 / wavelengthsNm) * opd;
    vec3 rawIridescence = clamp(vec3(r1 + r2) + crossTerm * cos(phase), 0.0, 1.0);

    float luminance = dot(rawIridescence, vec3(0.299, 0.587, 0.114));
    return mix(vec3(luminance), rawIridescence, strength);
}

// Artistic non-physical fallback: cosine rainbow palette, desaturated by 'strength' so it
// honours the "muted sheen, never a bright saturated rainbow" style limit.
vec3 oilFilmRainbow(float phase, float strength) {
    vec3 c1 = vec3(1.0, 1.0, 1.0);
    vec3 c2 = vec3(0.0, 0.333, 0.667);
    vec3 rainbow = clamp(0.5 + 0.5 * cos(6.2831853 * (c1 * phase + c2)), 0.0, 1.0);
    float luminance = dot(rainbow, vec3(0.299, 0.587, 0.114));
    return mix(vec3(luminance), rainbow, strength);
}
`;

/** WGSL function declarations (mirror of the GLSL above for the WebGPU path). */
export const THIN_FILM_WGSL_DECL = `
fn oilFilmThinFilm(cosTheta1: f32, thicknessNorm: f32, strength: f32) -> vec3<f32> {
    let iridescenceIor = 1.3;
    let filmF0 = 0.0169; // ((1.3-1)/(1.3+1))^2 -- air->film Fresnel at normal incidence
    let baseF0 = 0.0204; // oil/water Fresnel (IOR 1.333) -- film->base reflectance
    let thicknessMinNm = 100.0;
    let thicknessMaxNm = 400.0;

    let sinTheta1Sq = 1.0 - cosTheta1 * cosTheta1;
    let sinTheta2Sq = sinTheta1Sq / (iridescenceIor * iridescenceIor); // Snell's law
    let cosTheta2 = sqrt(max(1.0 - sinTheta2Sq, 0.0));

    let r1 = filmF0 + (1.0 - filmF0) * pow(1.0 - cosTheta1, 5.0);
    let r2 = baseF0 + (1.0 - baseF0) * pow(1.0 - cosTheta2, 5.0);
    let crossTerm = 2.0 * sqrt(max(r1 * r2, 0.0));

    let thicknessNm = mix(thicknessMinNm, thicknessMaxNm, clamp(thicknessNorm, 0.0, 1.0));
    let opd = 2.0 * iridescenceIor * thicknessNm * cosTheta2;

    let wavelengthsNm = vec3<f32>(650.0, 550.0, 450.0); // approximate R, G, B visible-light peaks
    let phase = (6.28318530718 / wavelengthsNm) * opd;
    let rawIridescence = clamp(vec3<f32>(r1 + r2) + crossTerm * cos(phase), vec3<f32>(0.0), vec3<f32>(1.0));

    let luminance = dot(rawIridescence, vec3<f32>(0.299, 0.587, 0.114));
    return mix(vec3<f32>(luminance), rawIridescence, strength);
}

fn oilFilmRainbow(phase: f32, strength: f32) -> vec3<f32> {
    let c1 = vec3<f32>(1.0, 1.0, 1.0);
    let c2 = vec3<f32>(0.0, 0.333, 0.667);
    let rainbow = clamp(0.5 + 0.5 * cos(6.2831853 * (c1 * phase + c2)), vec3<f32>(0.0), vec3<f32>(1.0));
    let luminance = dot(rainbow, vec3<f32>(0.299, 0.587, 0.114));
    return mix(vec3<f32>(luminance), rainbow, strength);
}
`;
