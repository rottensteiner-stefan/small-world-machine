// Tone operators (chunk TONE_OPERATORS): the single source for the forward pass (LIGHT_DEFS, glsl300 +
// glsl100) and the WebGL2 post pass (PostProcess.frag.glsl). Input: linear HDR with exposure
// applied. Output: linear display-referred [0,1]; the caller's sRGB encode follows. Mode numbers =
// ToneMappingMode. GLSL ES 1.00-compatible subset. Sources: REFERENCES.md "Tone mapping operators".

vec3 tmReinhard(vec3 c) {
    return c / (c + vec3(1.0));
}

// Reinhard et al. 2002 eq. 4 on luminance: `white` maps to 1.0, hue preserved (unlike per channel).
vec3 tmReinhardExtended(vec3 c, float white) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float lm = l * (1.0 + l / max(white * white, 1e-4)) / (1.0 + l);
    return clamp(c * (lm / max(l, 1e-6)), 0.0, 1.0);
}

// Hejl/Burgess-Dawson filmic fit; its output carries the 2.2 display encode -> decoded to linear.
vec3 tmCineon(vec3 c) {
    vec3 m = max(vec3(0.0), c - vec3(0.004));
    return pow((m * (6.2 * m + 0.5)) / (m * (6.2 * m + 1.7) + 0.06), vec3(2.2));
}

// ACES filmic, Narkowicz 2015 fit (luminance-only curve, no gamut matrices).
vec3 tmAcesNarkowicz(vec3 c) {
    return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}

// ACES RRT+ODT, Stephen Hill fit (BakingLab) incl. sRGB->AP1->sRGB matrices, as in the Khronos glTF
// Sample Viewer. `v * M` with the GLSL column constructor applies the rows written below.
vec3 tmAcesHill(vec3 c) {
    mat3 inM = mat3(0.59719, 0.35458, 0.04823,
                    0.07600, 0.90834, 0.01566,
                    0.02840, 0.13383, 0.83777);
    mat3 outM = mat3(1.60475, -0.53108, -0.07367,
                     -0.10208, 1.10813, -0.00605,
                     -0.00327, -0.07276, 1.07602);
    vec3 v = c * inM;
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return clamp((a / b) * outM, 0.0, 1.0);
}

// AgX (Sobotka), minimal fit by Wrensch: inset matrix, log2 encode, 6th-order contrast polynomial,
// outset matrix; the result is display-encoded (2.2) -> decoded to linear. Default look.
vec3 tmAgxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 tmAgx(vec3 c) {
    mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                    0.0784335999999992, 0.878468636469772, 0.0784336,
                    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                     -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                     -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    const float minEv = -12.47393;
    const float maxEv = 4.026069;
    vec3 v = clamp(log2(max(inM * c, vec3(1e-10))), minEv, maxEv);
    v = outM * tmAgxContrast((v - minEv) / (maxEv - minEv));
    vec3 e = pow(max(v, vec3(0.0)), vec3(2.2));
    // WP-C2: saturated highlights can exceed 1.0 after the outset matrix; clamp so forward and
    // post passes never hand the caller an out-of-range display value.
    return clamp(e, 0.0, 1.0);
}

// Khronos PBR Neutral (Khronos 3D Commerce, 2024): base colors up to ~0.8 under unit light stay
// exact (0.04 Fresnel offset removed), only highlights compress and desaturate toward white.
vec3 tmPbrNeutral(vec3 c) {
    const float startCompression = 0.8 - 0.04;
    const float desaturation = 0.15;
    float x = min(c.r, min(c.g, c.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c -= offset;
    float peak = max(c.r, max(c.g, c.b));
    if (peak < startCompression) return c;
    const float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    c *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(c, vec3(newPeak), g);
}

// ToneMappingMode dispatch: 0 NONE, 1 REINHARD, 2 CINEON, 3 ACES_FILMIC, 4 REINHARD_EXTENDED,
// 5 ACES_HILL, 6 ACES_HILL_EXPOSURE_BOOST, 7 AGX, 8 PBR_NEUTRAL.
vec3 toneMapOperator(vec3 c, int mode, float white) {
    if (mode == 1) return tmReinhard(c);
    if (mode == 2) return tmCineon(c);
    if (mode == 3) return tmAcesNarkowicz(c);
    if (mode == 4) return tmReinhardExtended(c, white);
    if (mode == 5) return tmAcesHill(c);
    if (mode == 6) return tmAcesHill(c / 0.6);
    if (mode == 7) return tmAgx(c);
    if (mode == 8) return tmPbrNeutral(c);
    return c;
}
