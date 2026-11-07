// Geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019; Filament's normalFiltering, Unity HDRP
// "Geometric Specular AA"): widens the GGX lobe by the screen-space variance of the shading normal, so
// normal-map and curvature detail below pixel size stops sparkling. Perceptual roughness in and out
// (ADR 0051).
// WebGL1 needs OES_standard_derivatives (enabled in base.frag.glsl); without it the filter is off.
#ifdef GL_OES_standard_derivatives
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
#else
float specularAntiAliasing(float perceptualRoughness, vec3 n, float normalLength, float normalStrength) {
    return perceptualRoughness;
}
#endif

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
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// KHR_materials_specular: Schlick with an explicit grazing reflectance F90 (== F_Schlick at F90 = 1).
vec3 F_Schlick90(float cosTheta, vec3 F0, float F90) {
    return F0 + (vec3(F90) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Analytic split-sum environment BRDF (scale, bias), Karis 2014 "Physically Based Shading on Mobile".
// Stands in for the GL2/WGPU `u_brdfLUT` texture lookup (WebGL1 carries no LUT sampler / IBL bake).
vec2 EnvBRDFApprox(float roughness, float dotNV) {
    const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = roughness * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * dotNV)) * r.x + r.y;
    // The fit undershoots to about -0.003 at grazing/smooth corners; a negative lobe would subtract light.
    return max(vec2(-1.04, 1.04) * a004 + r.zw, vec2(0.0));
}

// The iridescence and anisotropy helpers below are compiled only for materials with the feature: an unused
// copy still costs compile time (the flag becomes a #define).
#ifdef USE_IRIDESCENCE
// KHR_materials_iridescence, WebGL1 tier: cheap two-beam RGB thin film (Fresnel at both film interfaces,
// Snell refraction, interference at three fixed wavelengths) instead of the spectral Belcour & Barla model
// the WebGPU / WebGL2 chunks use (ADR 0055: instruction budget and precision on WebGL1 hardware).
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

// Bent normal for the specular IBL lookup (Khronos single-sample recommendation).
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

// Linear to sRGB
vec3 linearToSRGB(vec3 color) {
    return pow(color, vec3(1.0 / 2.2));
}

// sRGB to Linear
vec3 sRGBToLinear(vec3 color) {
    return pow(color, vec3(2.2));
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
vec3 VolumeAbsorption(vec3 attenuationColor, float attenuationDistance, float thickness) {
    if (attenuationDistance <= 0.0 || attenuationDistance >= 999.0) {
        return vec3(1.0);
    }
    vec3 sigma_a = -log(clamp(attenuationColor, vec3(0.001), vec3(1.0))) / attenuationDistance;
    return exp(-sigma_a * thickness);
}

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
