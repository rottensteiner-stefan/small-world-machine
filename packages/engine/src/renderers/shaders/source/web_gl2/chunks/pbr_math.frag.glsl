// Geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019; Filament's normalFiltering, Unity HDRP
// "Geometric Specular AA"): widens the GGX lobe by the screen-space variance of the shading normal, so
// normal-map and curvature detail below pixel size stops sparkling. Perceptual roughness in and out
// (ADR 0051).
const float SPECULAR_AA_VARIANCE = 0.15; // screen-space filter kernel variance (Filament default)
const float SPECULAR_AA_THRESHOLD = 0.2; // cap on the added roughness^2 (Filament default)
// The normal map's own sub-pixel variance (Toksvig 2005, vMF form of Kaplanyan et al. 2016): mipmapped
// normals average to a shorter vector, sigma^2 = 1/kappa with kappa = (3r - r^3) / (1 - r^2). Lengths
// above 0.99 are 8-bit quantisation, not variance. `normalStrength` is the larger |normalScale|.
float specularAntiAliasing(float perceptualRoughness, vec3 n, float normalLength, float normalStrength) {
    vec3 du = dFdx(n);
    vec3 dv = dFdy(n);
    float nl = clamp(normalLength / 0.99, 0.0001, 1.0);
    float toksvig = (1.0 - nl * nl) / (3.0 * nl - nl * nl * nl) * normalStrength * normalStrength;
    float variance = SPECULAR_AA_VARIANCE * (dot(du, du) + dot(dv, dv)) + toksvig;
    float kernelRoughness = min(2.0 * variance, SPECULAR_AA_THRESHOLD);
    float r = perceptualRoughness * perceptualRoughness;
    return sqrt(sqrt(clamp(r * r + kernelRoughness, 0.0, 1.0)));
}

// GGX Normal Distribution Function
float D_GGX(float dotNH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = (dotNH * dotNH * (a2 - 1.0) + 1.0);
    return a2 / (3.14159265359 * denom * denom);
}

// Smith's Geometric Shadowing Function
float G_SchlickGGX(float dotNL, float dotNV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    float GL = dotNL / (dotNL * (1.0 - k) + k);
    float GV = dotNV / (dotNV * (1.0 - k) + k);
    return GL * GV;
}

// Fresnel Schlick
vec3 F_Schlick(float cosTheta, vec3 F0) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x * x;
    return F0 + (1.0 - F0) * (x2 * x2 * x);
}

// Fresnel Schlick with roughness injected (for IBL)
vec3 F_SchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x * x;
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * (x2 * x2 * x);
}

// KHR_materials_specular: Schlick with an explicit grazing reflectance F90 (== F_Schlick at F90 = 1).
vec3 F_Schlick90(float cosTheta, vec3 F0, float F90) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x * x;
    return F0 + (vec3(F90) - F0) * (x2 * x2 * x);
}

// The iridescence and anisotropy helpers below are compiled only for materials with the feature: their code
// is large and an unused copy still costs compile time (the flag becomes a #define).
#ifdef USE_IRIDESCENCE
#ifdef USE_IRIDESCENCE_CHEAP
// KHR_materials_iridescence, cheap tier (`quality.cheapIridescence`, ADR 0055): two-beam RGB thin film (Fresnel at
// both film interfaces, Snell refraction, interference at three fixed wavelengths) instead of the spectral model.
vec3 iridescenceFresnelCheap(float cosTheta1, float filmIor, float thicknessNm, vec3 baseF0) {
    float filmF0 = pow((filmIor - 1.0) / (filmIor + 1.0), 2.0);
    float sinTheta2Sq = (1.0 - cosTheta1 * cosTheta1) / (filmIor * filmIor);
    float cosTheta2 = sqrt(max(1.0 - sinTheta2Sq, 0.0));
    float r1 = filmF0 + (1.0 - filmF0) * pow(clamp(1.0 - cosTheta1, 0.0, 1.0), 5.0);
    vec3 r2 = baseF0 + (vec3(1.0) - baseF0) * pow(clamp(1.0 - cosTheta2, 0.0, 1.0), 5.0);
    vec3 crossTerm = 2.0 * sqrt(max(vec3(r1) * r2, 0.0));
    float opd = 2.0 * filmIor * thicknessNm * cosTheta2;
    vec3 phase = (6.28318530718 / vec3(650.0, 550.0, 450.0)) * opd;
    return clamp(vec3(r1) + r2 + crossTerm * cos(phase), 0.0, 1.0);
}
#else
// KHR_materials_iridescence: thin-film Fresnel after Belcour & Barla 2017 (spectral sensitivity in Fourier
// space, two reflection orders), as in the Khronos sample viewer. XYZ -> linear Rec.709.
const mat3 XYZ_TO_REC709 = mat3(
    3.2404542, -0.9692660, 0.0556434,
    -1.5371385, 1.8760108, -0.2040259,
    -0.4985314, 0.0415560, 1.0572252
);

vec3 iridescenceSensitivity(float opd, vec3 shift) {
    float phase = 2.0 * 3.14159265359 * opd * 1.0e-9;
    vec3 amplitude = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
    vec3 position = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
    vec3 variance = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);
    vec3 xyz = amplitude * sqrt(2.0 * 3.14159265359 * variance) * cos(position * phase + shift) * exp(-(phase * phase) * variance);
    xyz.x += 9.7470e-14 * sqrt(2.0 * 3.14159265359 * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
    return XYZ_TO_REC709 * (xyz / 1.0685e-7);
}

// Fresnel of an air-film-base stack. `outsideIor` 1.0 is air, `filmIor` the film, `baseF0` the base layer's
// reflectance at normal incidence (converted to an IOR, extinction assumed 0 as the Khronos spec does).
vec3 evalIridescence(float outsideIor, float filmIor, float cosTheta1, float thicknessNm, vec3 baseF0) {
    float iridescenceIor = mix(outsideIor, filmIor, smoothstep(0.0, 0.03, thicknessNm));
    float ratio = outsideIor / iridescenceIor;
    float cosTheta2Sq = 1.0 - ratio * ratio * (1.0 - cosTheta1 * cosTheta1);
    if (cosTheta2Sq < 0.0) {
        return vec3(1.0);
    }
    float cosTheta2 = sqrt(cosTheta2Sq);

    float x1 = pow(clamp(1.0 - cosTheta1, 0.0, 1.0), 5.0);
    float r0 = pow((iridescenceIor - outsideIor) / (iridescenceIor + outsideIor), 2.0);
    float r12 = r0 + (1.0 - r0) * x1;
    float t121 = 1.0 - r12;
    float phi12 = iridescenceIor < outsideIor ? 3.14159265359 : 0.0;
    float phi21 = 3.14159265359 - phi12;

    vec3 sqrtF0 = sqrt(clamp(baseF0, 0.0, 0.9999));
    vec3 baseIor = (vec3(1.0) + sqrtF0) / (vec3(1.0) - sqrtF0);
    vec3 ior1 = (baseIor - vec3(iridescenceIor)) / (baseIor + vec3(iridescenceIor));
    vec3 r1 = ior1 * ior1;
    float x2 = pow(clamp(1.0 - cosTheta2, 0.0, 1.0), 5.0);
    vec3 r23 = r1 + (vec3(1.0) - r1) * x2;
    vec3 phi23 = vec3(baseIor.x < iridescenceIor ? 3.14159265359 : 0.0,
                      baseIor.y < iridescenceIor ? 3.14159265359 : 0.0,
                      baseIor.z < iridescenceIor ? 3.14159265359 : 0.0);

    float opd = 2.0 * iridescenceIor * thicknessNm * cosTheta2;
    vec3 phi = vec3(phi21) + phi23;

    vec3 r123Sq = clamp(r12 * r23, 1e-5, 0.9999);
    vec3 r123 = sqrt(r123Sq);
    vec3 rs = (t121 * t121) * r23 / (vec3(1.0) - r123Sq);

    vec3 result = vec3(r12) + rs;
    vec3 cm = (rs - vec3(t121)) * r123;
    result += cm * (2.0 * iridescenceSensitivity(opd, phi));
    cm = cm * r123;
    result += cm * (2.0 * iridescenceSensitivity(2.0 * opd, 2.0 * phi));
    return max(result, vec3(0.0));
}
#endif

// Inverse of Schlick at one angle: the F0 whose Schlick curve passes through `fresnel` at `cosTheta`.
vec3 schlickToF0(vec3 fresnel, float f90, float cosTheta) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x5 = clamp(x * x * x * x * x, 0.0, 0.9999);
    return (fresnel - vec3(f90 * x5)) / (1.0 - x5);
}

#endif

#ifdef USE_ANISOTROPY
// KHR_materials_anisotropy (Khronos non-normative BRDF): Burley anisotropic GGX D times the height-correlated
// visibility V, returned as D * V so a caller multiplies by F (V already carries the 1 / (4 NL NV) term).
// `at` / `ab` are the alpha (roughness^2) along the tangent and bitangent, T / B the anisotropy frame.
float specularAnisotropic(vec3 T, vec3 B, vec3 V, vec3 L, vec3 H, float dotNL, float dotNV, float dotNH, float at, float ab) {
    float a2 = at * ab;
    vec3 f = vec3(ab * dot(T, H), at * dot(B, H), a2 * dotNH);
    float w2 = a2 / max(dot(f, f), 1e-8);
    float D = a2 * w2 * w2 / 3.14159265359;
    float ggxV = dotNL * length(vec3(at * dot(T, V), ab * dot(B, V), dotNV));
    float ggxL = dotNV * length(vec3(at * dot(T, L), ab * dot(B, L), dotNL));
    return D * clamp(0.5 / max(ggxV + ggxL, 1e-5), 0.0, 1.0);
}

// Bent normal for the specular IBL lookup (Khronos single-sample recommendation): the reflection centre
// of the anisotropic lobe, blended back towards N as the surface gets rough or less anisotropic.
vec3 anisotropyBentNormal(vec3 B, vec3 V, vec3 N, float strength, float roughness) {
    // V parallel to B makes cross(cross(B, V), B) the zero vector: normalize() would give NaN (bloom rectangles in
    // HDR). Fall back to N there.
    vec3 bentRaw = cross(cross(B, V), B);
    float bentLen2 = dot(bentRaw, bentRaw);
    vec3 bent = bentLen2 > 1e-12 ? bentRaw * inversesqrt(bentLen2) : N;
    float t = 1.0 - strength * (1.0 - roughness);
    float t2 = t * t;
    return normalize(mix(bent, N, t2 * t2));
}

#endif

vec3 F_SchlickRoughness90(float cosTheta, vec3 F0, float F90, float roughness) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x * x;
    return F0 + (max(vec3(F90 * (1.0 - roughness)), F0) - F0) * (x2 * x2 * x);
}

// Charlie Sheen Distribution Function (Estevez & Kulla 2017)
float D_Charlie(float dotNH, float roughness) {
    float alpha = max(roughness * roughness, 0.000001);
    float invAlpha = 1.0 / alpha;
    float cos2h = dotNH * dotNH;
    float sin2h = max(1.0 - cos2h, 0.0078125);
    return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * 3.14159265359);
}

// Neubelt Sheen Visibility Function (Neubelt & Pettineo 2013)
float V_Neubelt(float dotNL, float dotNV) {
    return 1.0 / (4.0 * (dotNL + dotNV - dotNL * dotNV) + 0.0001);
}

// Kelemen Geometric Shadowing for Clearcoat (Kelemen 2000 / Burley 2012)
float G_Kelemen(float dotVH) {
    return 0.25 / (dotVH * dotVH + 0.0001);
}

// Volumetric Beer-Lambert Attenuation (KHR_materials_volume)

// KHR_materials_sheen IBL term: analytic fit of the Charlie sheen directional albedo times visibility
// (Estevez & Kulla 2017, "Production Friendly Microfacet Sheen BRDF"; coefficients as in three.js
// IBLSheenBRDF). Multiplied with the diffuse irradiance -- the sheen lobe is too rough for the prefilter.
float IBLSheenBRDF(float dotNV, float roughness) {
    float r2 = roughness * roughness;
    float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
    float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
    float DG = exp(a * dotNV + b) + (roughness < 0.25 ? 0.0 : 0.1 * (roughness - 0.25));
    return clamp(DG * 0.31830988618, 0.0, 1.0);
}

vec3 VolumeAbsorption(vec3 attenuationColor, float attenuationDistance, float thickness) {
    if (attenuationDistance <= 0.0 || attenuationDistance >= 999.0) {
        return vec3(1.0);
    }
    vec3 sigma_a = -log(clamp(attenuationColor, vec3(0.001), vec3(1.0))) / attenuationDistance;
    return exp(-sigma_a * thickness);
}

