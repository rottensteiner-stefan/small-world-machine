// Tone operators (chunk WGSL_TONE_OPERATORS): the single WGSL source for the forward pass (structs
// chunk) and the WebGPU post pass (PostProcess.frag.wgsl). Mirrors tone_operators.glsl line by
// line. Input: linear HDR with exposure applied. Output: linear display-referred [0,1]; the
// caller's sRGB encode follows. Mode numbers = ToneMappingMode. Sources: REFERENCES.md
// "Tone mapping operators".

fn tmReinhard(c: vec3f) -> vec3f {
    return c / (c + vec3f(1.0));
}

// Reinhard et al. 2002 eq. 4 on luminance: `white` maps to 1.0, hue preserved (unlike per channel).
fn tmReinhardExtended(c: vec3f, white: f32) -> vec3f {
    let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    let lm = l * (1.0 + l / max(white * white, 1e-4)) / (1.0 + l);
    return clamp(c * (lm / max(l, 1e-6)), vec3f(0.0), vec3f(1.0));
}

// Hejl/Burgess-Dawson filmic fit; its output carries the 2.2 display encode -> decoded to linear.
fn tmCineon(c: vec3f) -> vec3f {
    let m = max(vec3f(0.0), c - vec3f(0.004));
    return pow((m * (6.2 * m + 0.5)) / (m * (6.2 * m + 1.7) + 0.06), vec3f(2.2));
}

// ACES filmic, Narkowicz 2015 fit (luminance-only curve, no gamut matrices).
fn tmAcesNarkowicz(c: vec3f) -> vec3f {
    return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

// ACES RRT+ODT, Stephen Hill fit (BakingLab) incl. sRGB->AP1->sRGB matrices, as in the Khronos glTF
// Sample Viewer. `v * M` with the column-major constructor applies the rows written below.
fn tmAcesHill(c: vec3f) -> vec3f {
    let inM = mat3x3f(0.59719, 0.35458, 0.04823,
                      0.07600, 0.90834, 0.01566,
                      0.02840, 0.13383, 0.83777);
    let outM = mat3x3f(1.60475, -0.53108, -0.07367,
                       -0.10208, 1.10813, -0.00605,
                       -0.00327, -0.07276, 1.07602);
    let v = c * inM;
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return clamp((a / b) * outM, vec3f(0.0), vec3f(1.0));
}

// AgX (Sobotka), minimal fit by Wrensch: inset matrix, log2 encode, 6th-order contrast polynomial,
// outset matrix; the result is display-encoded (2.2) -> decoded to linear. Default look.
fn tmAgxContrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn tmAgx(c: vec3f) -> vec3f {
    let inM = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    let outM = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    let minEv = -12.47393;
    let maxEv = 4.026069;
    var v = clamp(log2(max(inM * c, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
    v = outM * tmAgxContrast((v - minEv) / (maxEv - minEv));
    let e = pow(max(v, vec3f(0.0)), vec3f(2.2));
    // WP-C2: saturated highlights can exceed 1.0 after the outset matrix; clamp so forward and
    // post passes never hand the caller an out-of-range display value.
    return clamp(e, vec3f(0.0), vec3f(1.0));
}

// Khronos PBR Neutral (Khronos 3D Commerce, 2024): base colors up to ~0.8 under unit light stay
// exact (0.04 Fresnel offset removed), only highlights compress and desaturate toward white.
fn tmPbrNeutral(cIn: vec3f) -> vec3f {
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;
    let x = min(cIn.r, min(cIn.g, cIn.b));
    let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
    var c = cIn - offset;
    let peak = max(c.r, max(c.g, c.b));
    if (peak < startCompression) { return c; }
    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    c *= newPeak / peak;
    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(c, vec3f(newPeak), g);
}

// ToneMappingMode dispatch: 0 NONE, 1 REINHARD, 2 CINEON, 3 ACES_FILMIC, 4 REINHARD_EXTENDED,
// 5 ACES_HILL, 6 ACES_HILL_EXPOSURE_BOOST, 7 AGX, 8 PBR_NEUTRAL.
fn toneMapOperator(c: vec3f, mode: i32, white: f32) -> vec3f {
    switch mode {
        case 1: { return tmReinhard(c); }
        case 2: { return tmCineon(c); }
        case 3: { return tmAcesNarkowicz(c); }
        case 4: { return tmReinhardExtended(c, white); }
        case 5: { return tmAcesHill(c); }
        case 6: { return tmAcesHill(c / 0.6); }
        case 7: { return tmAgx(c); }
        case 8: { return tmPbrNeutral(c); }
        default: { return c; }
    }
}
